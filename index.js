/**
 * dsh-permission-panel — host half.
 *
 * The permission panel itself lives in the browser half at ./client.js. This
 * node half exists so the loader has a row to mount (which is also what makes
 * client-modules scan the package for its `dsh.client` declaration) and it owns
 * the one thing the browser cannot do on its own: asking the Desktop shell to
 * bring the process down so it can relaunch.
 *
 * How a restart actually works in DSH Desktop
 * -------------------------------------------
 * The Electron shell spawns this host as a child process and treats *any* exit
 * of that child as a crash (`DesktopBackendController` calls `fail()` on close,
 * for exit code 0 as well). `app.relaunch()` exists in exactly one production
 * place: the "restart" button of the official recovery dialog. There is no IPC
 * channel, no preload bridge and no webServer service that can ask the shell to
 * relaunch directly.
 *
 * So the only correct restart from a plugin is the same thing the official
 * "disable third-party plugins" flow and the community plugin managers do:
 * answer the request, then exit the host. The shell then shows its recovery
 * dialog ("应用无法启动或已意外停止。") whose default button is 重启, and the
 * user's click performs the real relaunch. Anything else — spawning a second
 * host, killing the Electron parent — either leaks a duplicate host or loses
 * the window.
 */

/** Route path served to the browser half. Relative fetches from the app page reach it. */
const RESTART_ROUTE = "/api/permission-panel/restart";

/** argv marker that identifies the Desktop-owned host process. */
const DESKTOP_HOST_MARKER = "dsh-desktop-host";

/** Delay between flushing the 202 and tearing the host down. */
const EXIT_DELAY_MS = 250;

/**
 * Text the shell shows in its recovery dialog as the failure detail.
 *
 * The shell builds that detail from `desktopErrorState(error).message`, and when
 * the host merely exits the error message is `dsh desktop host stopped: <stderr
 * tail>` — the last thing some unrelated plugin logged, which is alarming and
 * has nothing to do with this restart. Reporting over the host's own `fatal` IPC
 * first (`DesktopHostProcess.fail()` is idempotent via `failureReported`) makes
 * this sentence the detail instead. The dialog itself, its default 「重启」
 * button, the crash report and the relaunch are all unchanged.
 */
const RESTART_NOTICE = "dsh-permission-panel: 这是权限面板快捷键发起的重启，不是崩溃。点「重启」即可完成。"
  + " (Restart requested by the permission panel shortcut — not a crash.)";

/**
 * Whether this host process was spawned by DSH Desktop rather than by `dsh web`.
 * Restarting is only meaningful (and only safe) under the Desktop shell, because
 * only there does a host exit lead to the recovery dialog instead of a dead server.
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
        // Under `dsh web` there is no shell to relaunch the host; exiting would
        // just stop the server with nothing to bring it back.
        writeJson(response, 409, {
          ok: false,
          error: "restart is only available in the DSH Desktop app",
        });
        return;
      }

      writeJson(response, 202, { ok: true, restarting: true });

      // Tell the shell *why* the host is about to disappear, so its recovery
      // dialog shows a sentence instead of the tail of this process's stderr.
      // `process.send` exists because the shell spawns this process with an
      // "ipc" stdio channel; if it is ever absent, the exit below still opens
      // the same dialog with 重启 as its default button.
      try {
        process.send?.({ type: "fatal", message: RESTART_NOTICE }, () => {});
      } catch {
        // The restart still works; only the dialog detail stays generic.
      }

      // Let the 202 reach the page before the process goes away. The timer is
      // deliberately NOT unref'd: it must hold the loop for one tick so the
      // response flushes, then exit — the shell notices the host is gone and
      // shows its recovery dialog with 重启 as the default button.
      setTimeout(() => process.exit(0), EXIT_DELAY_MS);
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
