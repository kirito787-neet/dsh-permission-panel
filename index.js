/**
 * dsh-permission-panel — host half.
 *
 * The permission panel itself lives in the browser half at ./client.js. This
 * node half exists so the loader has a row to mount (which is also what makes
 * client-modules scan the package for its `dsh.client` declaration) and it owns
 * the one thing the browser cannot do on its own: actually restarting DSH
 * Desktop, without leaving the user staring at the shell's crash dialog.
 *
 * How a restart works in DSH Desktop
 * ----------------------------------
 * The Electron shell spawns this host as a child process and treats *any* exit
 * of that child as a crash (`DesktopBackendController` calls `fail()` on close,
 * for exit code 0 as well), so simply calling `process.exit(0)` pops the
 * official recovery dialog ("应用无法启动或已意外停止。"). `app.relaunch()`
 * exists in exactly one production place — the 重启 button of that dialog — and
 * there is no IPC channel or preload bridge that asks the shell to relaunch.
 *
 * So a plugin cannot restart in-process. What it *can* do, and what this file
 * does, is restart from the outside:
 *
 *  1. Spawn a detached helper process that watches this host's parent — the
 *     Electron main process — and, once it is gone, launches the app again.
 *  2. Hard-terminate the Electron main process (the host's parent). Killing an
 *     ancestor does not cascade on Windows (`process.kill(pid)`, i.e. a
 *     TerminateProcess, or `taskkill` without `/T`), so the detached helper
 *     survives; killing *this* process would not help because the shell would
 *     then show its dialog.
 *  3. The main process dies, this host loses its IPC channel and stops itself
 *     (`process.once("disconnect", …)` in dsh-desktop-host), and the helper
 *     relaunches the app a moment later. No dialog appears because the shell
 *     process that would show it is already gone.
 *
 * The helper is a tiny inline script run on the same Electron binary in
 * `ELECTRON_RUN_AS_NODE=1` mode, so it needs no external Node install; when it
 * relaunches the app it strips that variable so the binary starts as the GUI app
 * again. The whole chain was verified against real child processes on Windows.
 *
 * Windows Job Object note: Electron's main process puts this host inside a job
 * with `KILL_ON_JOB_CLOSE`, which sounds fatal for the helper — but that job
 * also sets `SILENT_BREAKAWAY_OK` (`LimitFlags = 0x3C00` on the shipping build),
 * so any child a job member spawns leaves the job automatically. The detached
 * helper therefore survives the job closing. Verified against a real job with
 * the same flags: the helper was not in the job and outlived it.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Route path served to the browser half. Relative fetches from the app page reach it. */
const RESTART_ROUTE = "/api/permission-panel/restart";

/** argv marker that identifies the Desktop-owned host process. */
const DESKTOP_HOST_MARKER = "dsh-desktop-host";

/** Delay between flushing the 202 and hard-terminating the Electron parent. */
const KILL_DELAY_MS = 300;

/**
 * Safety net after the parent is killed: if the IPC `disconnect` that normally
 * stops this host does not arrive, exit anyway. Harmless — the shell that would
 * show a crash dialog is already dead by then.
 */
const EXIT_FALLBACK_MS = 1500;

/** Where the detached helper records what it did, for debugging. */
const HELPER_LOG_NAME = "dsh-permission-panel-restart.log";

/** Human sentence used when the helper cannot be started at all. */
const RESTART_NOTICE = "dsh-permission-panel: could not start the relaunch helper."
  + " (权限面板无法启动重启助手。)";

/**
 * Whether this host process was spawned by DSH Desktop rather than by `dsh web`.
 * Relaunching is only meaningful under the Desktop shell: `dsh web` has no shell
 * process to relaunch, so a hard exit there would just stop the server.
 */
function isDesktopHostProcess(argv = process.argv) {
  return argv.some((arg) => typeof arg === "string" && arg.includes(DESKTOP_HOST_MARKER));
}

/** True for IPv4/IPv6 loopback peers. */
function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  if (address === "::1" || address === "127.0.0.1") return true;
  const bare = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255) && parts[0] === "127";
}

/**
 * Reject requests that did not come from the local DSH app page.
 *
 * Two shapes are trusted, both requiring a loopback peer, no proxy headers, and
 * a non-empty `cookie`:
 *
 *  - Desktop forwarded shape. The shell deletes `host`, `origin`, `cookie` and
 *    `sec-fetch-site` before forwarding (electron #648), then forwards with
 *    Node's `fetch` — which puts `host` back from the target URL — and injects
 *    the host's own session cookie. So what actually arrives is: no `origin`,
 *    `host` equal to this host's own authority, and a `cookie`.
 *  - Same-origin shape: `origin` and `host` both present and agreeing (the
 *    `dsh web` browser page; it answers 409 there because no shell can relaunch).
 *
 * Requiring the cookie is not authentication — a local process can forge any
 * header — but this route is an *exact* route, so `match()` takes it before the
 * `/api` prefix and it does not inherit that chain's fence. Demand the cookie
 * anyway so a bare `curl -X POST`, or a probe that only sets `Origin`, cannot
 * take DSH down; anything with local code execution can already kill the
 * process, which is the real limit of every loopback-only guard (the community
 * plugin managers have the same limit).
 */
function isTrustedRestartRequest(request, ownHost) {
  const headers = request.headers ?? {};
  if (headers.forwarded !== undefined) return false;
  if (headers["x-forwarded-for"] !== undefined) return false;
  if (headers["x-real-ip"] !== undefined) return false;
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false;
  if (headers["sec-fetch-site"] === "cross-site") return false;
  const cookie = headers.cookie;
  if (typeof cookie !== "string" || cookie.length === 0) return false;

  const host = headers.host;
  const origin = headers.origin;

  // Desktop forwarded shape: the shell stripped `origin` and injected a cookie.
  if (origin === undefined) {
    return typeof ownHost === "string" && ownHost.length > 0 && host === ownHost;
  }

  // Same-origin shape: origin present, so a host header must agree with it.
  if (typeof host !== "string" || typeof origin !== "string") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Write a JSON response on the host transport object. */
function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

/** Readable one-liner for an unknown thrown value. */
function describeCause(cause) {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === "object" && typeof cause.message === "string") return cause.message;
  return String(cause);
}

/**
 * Source of the detached helper script.
 *
 * Runs on the same Electron binary in node mode. It takes its payload from the
 * environment (no quoting problems), waits for the Electron main process to
 * disappear, then launches the app and checks that it stayed up — retrying,
 * because the single-instance lock the old process released may take a moment to
 * free.
 */
const HELPER_SOURCE = [
  'const { spawn } = require("node:child_process");',
  'const fs = require("node:fs");',
  'const payload = JSON.parse(process.env.DSH_PERMISSION_PANEL_RESTART);',
  'const log = (m) => { try { fs.appendFileSync(payload.logFile, new Date().toISOString() + " " + m + "\\n"); } catch {} };',
  'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
  'const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };',
  'async function main() {',
  '  log("helper start mainPid=" + payload.mainPid + " execPath=" + payload.execPath);',
  '  const deadline = Date.now() + 20000;',
  '  while (alive(payload.mainPid) && Date.now() < deadline) await sleep(120);',
  '  if (alive(payload.mainPid)) { log("main still alive after timeout; aborting"); return 1; }',
  '  log("main gone; launching app");',
  '  await sleep(700);',
  '  for (let i = 0; i < 10; i++) {',
  '    let child;',
  '    try {',
  '      child = spawn(payload.execPath, [], { cwd: payload.cwd, detached: true, stdio: "ignore", windowsHide: true, env: payload.env });',
  '    } catch (error) { log("spawn threw " + error.message); await sleep(500); continue; }',
  '    let exited = "pending";',
  '    child.on("exit", (code) => { exited = code; });',
  '    await sleep(900);',
  '    if (exited === "pending") { try { child.unref(); } catch {} log("relaunch ok pid=" + child.pid + " attempt=" + i); return 0; }',
  '    log("relaunch died code=" + exited + " attempt=" + i);',
  '    await sleep(400);',
  '  }',
  '  log("relaunch FAILED after retries");',
  '  return 1;',
  '}',
  'main().then((code) => process.exit(code), (error) => { log("helper crashed " + ((error && error.stack) || error)); process.exit(1); });',
].join("\n");

/**
 * Start the detached helper that will relaunch DSH after the parent dies.
 *
 * @param mainPid - PID of the Electron main process (this host's parent).
 * @returns true when a helper process was actually spawned.
 */
function spawnRestartHelper(mainPid) {
  // Without an Electron runtime there is nothing to relaunch with; refuse
  // rather than spawn an unrelated `node` binary.
  if (typeof process.versions?.electron !== "string") return false;

  const appEnv = { ...process.env };
  // The parent spawns this host with ELECTRON_RUN_AS_NODE=1; the relaunched app
  // must NOT inherit it or the binary would come back as a node script runner.
  delete appEnv.ELECTRON_RUN_AS_NODE;

  const payload = {
    mainPid,
    execPath: process.execPath,
    cwd: process.cwd(),
    logFile: join(tmpdir(), HELPER_LOG_NAME),
    env: appEnv,
  };
  const helperEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    DSH_PERMISSION_PANEL_RESTART: JSON.stringify(payload),
  };

  const child = spawn(process.execPath, ["-e", HELPER_SOURCE], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: helperEnv,
  });
  if (typeof child.pid !== "number" || child.pid <= 0) return false;
  child.unref();
  return true;
}

/**
 * Plugin entry — registers the restart route on the host webServer.
 *
 * @param {object} ctx - Cordis context with the `webServer` service injected.
 */
function apply(ctx) {
  // The trusted-host comparison needs this server's own authority
  // (`127.0.0.1:PORT`) to recognise the Desktop forwarded shape, whose only
  // surviving header is `host`. `getOrigin()` throws before `listen` has bound a
  // port, and plugin activation races that bind, so read it lazily on the first
  // request and treat a throw as "unknown → refuse the forwarded shape".
  let ownHost;
  const authority = () => {
    if (ownHost === undefined) {
      try {
        ownHost = new URL(ctx.webServer.getOrigin()).host;
      } catch {
        return undefined;
      }
    }
    return ownHost;
  };

  // Register inside an effect so a plugin reload disposes the route instead of
  // throwing on a duplicate (kind, path) registration.
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: RESTART_ROUTE,
    handler: (request, response) => {
      if (request.method !== "POST") {
        writeJson(response, 405, { ok: false, error: "method not allowed" }, { allow: "POST" });
        return;
      }

      if (!isTrustedRestartRequest(request, authority())) {
        writeJson(response, 403, { ok: false, error: "forbidden: local app requests only" });
        return;
      }

      if (!isDesktopHostProcess()) {
        // Under `dsh web` there is no shell process to relaunch; killing the
        // server here would just leave a dead page.
        writeJson(response, 409, {
          ok: false,
          error: "restart is only available in the DSH Desktop app",
        });
        return;
      }

      // The parent of this host is the Electron main process. Kill *it* — not
      // this process — so the detached helper outlives the teardown and the
      // shell never gets the chance to show its crash dialog.
      const mainPid = process.ppid;
      if (typeof mainPid !== "number" || mainPid <= 0) {
        writeJson(response, 500, { ok: false, error: "cannot locate the Desktop shell process" });
        return;
      }

      let helperStarted = false;
      try {
        helperStarted = spawnRestartHelper(mainPid);
      } catch (cause) {
        writeJson(response, 500, { ok: false, error: "could not spawn the relaunch helper: " + describeCause(cause) });
        return;
      }
      if (!helperStarted) {
        writeJson(response, 500, { ok: false, error: RESTART_NOTICE });
        return;
      }

      writeJson(response, 202, { ok: true, restarting: true });

      // Let the 202 reach the page before anything dies. The kill timer is kept
      // alive by the server; the fallback exit is unref'd so it can never hold
      // the process open on its own.
      setTimeout(() => {
        try {
          process.kill(mainPid, "SIGKILL");
        } catch {
          // The parent may already be gone; the helper still relaunches.
        }
        const fallback = setTimeout(() => process.exit(0), EXIT_FALLBACK_MS);
        fallback.unref?.();
      }, KILL_DELAY_MS);
    },
  }), "dsh-permission-panel: restart route");
}

/**
 * Hard service dependency: the restart route is registered on the host
 * `webServer`. Without it there is nothing to register, so the plugin must not
 * mount at all rather than mount mute.
 */
const inject = ["webServer"];

export { apply, inject };
