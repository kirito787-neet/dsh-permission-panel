/**
 * Host-half test: the restart route registered on `webServer`.
 *
 * Why this exists
 * ---------------
 * The restart shortcut is only useful if the browser half's POST actually lands
 * on a route that (a) exists, (b) is reachable from the Desktop app page, and
 * (c) will not let a random local page bring DSH down. The shipped shell exposes
 * no restart IPC and no relaunch hook, so this route plus the detached helper it
 * spawns are the entire mechanism — a silent rename, a missing `inject`, or a
 * helper that never gets spawned would break the shortcut with no error anywhere.
 *
 * What is asserted
 * ----------------
 * - `inject` is exactly `["webServer"]` (a hard dependency: without the service
 *   the plugin must not mount at all rather than mount mute).
 * - `apply` registers exactly one exact-path route at the path the browser half
 *   posts to.
 * - Method gate: GET → 405.
 * - Peer gate: a non-loopback socket → 403.
 * - Proxy gate: any of `forwarded` / `x-forwarded-for` / `x-real-ip` → 403.
 * - Same-origin browser shape (host + origin agree) → 202.
 * - Desktop forwarded shape (origin stripped by the shell, `host` re-added by
 *   undici from the target URL, electron #648) → 202.
 * - Desktop forwarded shape with no `host` at all, or a foreign `host` → 403:
 *   `host` must equal this server's own authority.
 * - No cookie → 403 in both shapes. This route is `exact`, so it bypasses the
 *   `/api` prefix fence; without the cookie requirement a bare `curl -X POST`
 *   (or a probe that only sets `Origin`) would restart DSH.
 * - Non-Desktop host (no `dsh-desktop-host` in argv) → 409, and nothing is
 *   spawned or killed.
 * - A 202 spawns exactly one detached helper and schedules a kill of the
 *   *parent* process (the Electron main process) — never of this process, which
 *   would make the shell show its crash dialog instead of restarting silently.
 * - The helper payload carries the parent PID, this process's execPath and a
 *   relaunch environment with `ELECTRON_RUN_AS_NODE` stripped (otherwise the app
 *   would come back as a node script runner).
 * - No Electron runtime (plain `node`) → 500, no spawn.
 * - A real end-to-end pass: the handler is mounted on a real `http` server and
 *   reached with Node's own `fetch`, forwarding exactly the way the shell does
 *   (delete `host`/`origin`/`cookie`/`sec-fetch-site`, inject the host cookie).
 *   This is the only way to catch the fact that undici re-adds `host` from the
 *   target URL — an assumption that silently 403s every real restart.
 *
 * Usage: node test/restart-route.cjs [path/to/index.js] [path/to/client.js]
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { tmpdir } = os;
const { join } = path;

const indexPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "index.js"));
const clientPath = path.resolve(process.argv[3] ?? path.join(__dirname, "..", "client.js"));

/** The authority the host is listening on; the gate compares `host` against it. */
const OWN_ORIGIN = "http://127.0.0.1:59666";
const OWN_HOST = "127.0.0.1:59666";

/** Fake Electron main PID: the process the route must kill. */
const MAIN_PID = 4242;

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

/** Route path the browser half posts to; pinned from client.js so the two agree. */
function restartPathFromClient() {
  const source = fs.readFileSync(clientPath, "utf8");
  const match = source.match(/const\s+RESTART_PATH\s*=\s*"([^"]+)"/u);
  if (match === null) throw new Error("client.js no longer declares RESTART_PATH");
  // Guard against a regression to the fictional carrier probes this plugin used
  // to rely on: the shipped shell has no `dshDesktopActions` bridge and appends
  // no `dsh-desktop-mode` URL marker, so either name reappearing means the
  // shortcut has gone back to silently refusing on the real Desktop app.
  for (const ghost of ["dshDesktopActions", "dsh-desktop-mode", "/api/desktop/restart"]) {
    if (source.includes(ghost)) {
      throw new Error("client.js still references the non-existent Desktop signal " + JSON.stringify(ghost)
        + "; the only real carrier signal is document.documentElement.dataset.platform and the only real"
        + " restart route is " + match[1]);
    }
  }
  return match[1];
}

/** Minimal req/res doubles over the host transport contract. */
function makeRes() {
  const res = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) { res.status = status; res.headers = headers ?? {}; },
    end(payload) { if (typeof payload === "string") res.body = payload; res.ended = true; },
  };
  return res;
}

/** A loopback POST with both host and origin headers, as a same-origin page sends. */
function sameOriginRequest(overrides = {}) {
  return {
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: OWN_HOST, origin: OWN_ORIGIN, cookie: "dsh-auth-x=s3cret", ...overrides },
  };
}

/**
 * The shape DSH Desktop actually forwards: loopback peer, `origin` stripped, and
 * `host` present because the shell forwards with Node's `fetch` and undici puts
 * `host` back from the target URL. Verified against a real Node fetch.
 */
function desktopForwardedRequest(overrides = {}) {
  return {
    method: "POST",
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: OWN_HOST, cookie: "dsh-auth-x=s3cret", ...overrides },
  };
}

/**
 * Load index.js against fake `process` and `spawn` doubles, so neither the test
 * nor any real process is touched.
 */
function loadHost(argv, options = {}) {
  const source = fs.readFileSync(indexPath, "utf8");
  // index.js is ESM. Both `apply` and `inject` are declared with plain
  // `function` / `const` and only re-exported at the bottom, so stripping the
  // export forms leaves real bindings in scope. The `node:child_process`,
  // `node:os` and `node:path` imports are replaced by injected parameters
  // (`spawn` is a double; `tmpdir`/`join` are real, side-effect-free helpers) so
  // the helper launch can be observed and nothing on disk is touched.
  const esm = source
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*"node:child_process"\s*;?/mu, "")
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*"node:os"\s*;?/mu, "")
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*"node:path"\s*;?/mu, "")
    .replace(/\bexport\s*\{[^}]*\}\s*;?/u, "")
    .replace(/\bexport\s+const\s+/u, "const ")
    .replace(/\bexport\s+function\s+/u, "function ");
  if (/\bimport\s/u.test(esm.replace(/"[^"]*"/gu, '""'))) {
    throw new Error("index.js gained an import this test cannot shim; update loadHost");
  }
  const moduleShim = { exports: {} };
  const exits = [];
  const kills = [];
  const spawns = [];
  const fakeProcess = {
    argv,
    ppid: options.ppid ?? MAIN_PID,
    execPath: options.execPath ?? "C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe",
    cwd: () => options.cwd ?? "C:\\Users\\u\\.dsh\\profiles\\desktop",
    env: options.env ?? { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", KEEP_ME: "yes" },
    versions: options.versions ?? { electron: "44.7.0", node: "24.21.0" },
    exit: (code) => { exits.push(code); },
    kill: (pid, signal) => { kills.push({ pid, signal }); },
  };
  const fakeSpawn = (file, args, spawnOptions) => {
    spawns.push({ file, args, options: spawnOptions });
    if (options.spawnThrows === true) throw new Error("spawn EACCES");
    return { pid: 9999, unref() {} };
  };
  const fn = new Function(
    "module", "exports", "process", "spawn", "tmpdir", "join",
    `${esm}\n;return { apply, inject };`,
  );
  const { apply, inject } = fn(moduleShim, moduleShim.exports, fakeProcess, fakeSpawn, tmpdir, join);
  return { apply, inject, exits, kills, spawns };
}

/** Register the route against a fake ctx and capture it. */
function register(argv, options = {}) {
  const host = loadHost(argv, options);
  const getOrigin = options.getOrigin ?? (() => OWN_ORIGIN);
  check("inject must be exactly [\"webServer\"]", Array.isArray(host.inject) && host.inject.length === 1 && host.inject[0] === "webServer");
  const routes = [];
  const ctx = {
    webServer: {
      getOrigin,
      register: (route) => { routes.push(route); return () => {}; },
    },
    effect: (body) => { const dispose = body(); if (typeof dispose !== "function") failures.push("effect body must return a disposer"); },
  };
  // `apply` must not need the bound port: `getOrigin()` throws until `listen`
  // has bound, and activation races that bind. A throwing getOrigin here proves
  // registration survives it.
  host.apply(ctx);
  check("apply must register exactly one route", routes.length === 1);
  const route = routes[0];
  check("route.kind must be exact", route?.kind === "exact");
  return { route, ...host };
}

/** Run one request through the captured handler, then let scheduled timers fire. */
async function run(route, req) {
  const res = makeRes();
  let thrown = null;
  try {
    await route.handler(req, res);
  } catch (error) {
    thrown = error;
  }
  // The 202 path schedules the parent kill after KILL_DELAY_MS (300); wait past
  // that so the kill intent is observable on the fake process.
  await new Promise((resolve) => setTimeout(resolve, 450));
  return { res, thrown };
}

/** Parse the payload the helper would read from its environment. */
function helperPayload(host) {
  const spawn = host.spawns[0];
  const raw = spawn?.options?.env?.DSH_PERMISSION_PANEL_RESTART;
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}

(async () => {
  const clientRoute = restartPathFromClient();

  // ---- Desktop host: the real carrier ----
  const desktop = register([
    "C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe",
    "--expose-internals",
    "C:\\x\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js",
    "C:\\x\\app.asar\\dsh",
    "C:\\Users\\u\\.dsh\\profiles\\desktop",
  ]);
  check("route path must match the browser half's RESTART_PATH", desktop.route?.path === clientRoute);

  // Method gate.
  {
    const { res } = await run(desktop.route, { method: "GET", socket: { remoteAddress: "127.0.0.1" }, headers: { host: OWN_HOST, origin: OWN_ORIGIN } });
    check("GET must be refused with 405", res.status === 405);
    check("405 must advertise POST in Allow", String(res.headers?.allow ?? "").toUpperCase() === "POST");
  }

  // Peer gate: a non-loopback socket.
  {
    const remote = await run(desktop.route, {
      method: "POST",
      socket: { remoteAddress: "10.0.0.5" },
      headers: { host: "10.0.0.5:59666", origin: "http://10.0.0.5:59666", cookie: "a=b" },
    });
    check("a non-loopback peer must be refused with 403", remote.res.status === 403);
  }

  // Proxy gate: forwarded headers of any spelling.
  for (const header of ["forwarded", "x-forwarded-for", "x-real-ip"]) {
    const { res } = await run(desktop.route, desktopForwardedRequest({ [header]: "1.2.3.4" }));
    check("a request with the " + header + " header must be refused with 403", res.status === 403);
  }

  // Nothing so far may have spawned a helper or killed anything.
  {
    const before = { spawns: desktop.spawns.length, kills: desktop.kills.length };
    check("refused requests must not spawn a helper", before.spawns === 0);
    check("refused requests must not kill anything", before.kills === 0);
  }

  // Same-origin browser shape: accepted, helper spawned, parent kill scheduled.
  {
    const { res } = await run(desktop.route, sameOriginRequest());
    check("a same-origin loopback POST must be accepted with 202", res.status === 202);
    check("202 must set no-store", String(res.headers?.["cache-control"] ?? "") === "no-store");
    check("the 202 body must be JSON ok", (() => { try { return JSON.parse(res.body).ok === true; } catch { return false; } })());
    check("a 202 must spawn exactly one relaunch helper", desktop.spawns.length === 1);

    const spawn = desktop.spawns[0];
    check("the helper must run on this process's execPath (the Electron binary)", spawn?.file === "C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe");
    check("the helper must be a detached, unref'd `-e` script", spawn?.args?.[0] === "-e" && typeof spawn?.args?.[1] === "string" && spawn.options?.detached === true);
    check("the helper must not inherit a visible console", spawn?.options?.windowsHide === true);
    check("the helper must run as node (ELECTRON_RUN_AS_NODE=1)", spawn?.options?.env?.ELECTRON_RUN_AS_NODE === "1");

    const payload = helperPayload(desktop);
    check("the helper payload must carry the Electron main PID", payload?.mainPid === MAIN_PID);
    check("the helper payload must carry this process's execPath", payload?.execPath === "C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe");
    check("the relaunch env must strip ELECTRON_RUN_AS_NODE", payload !== null && payload.env?.ELECTRON_RUN_AS_NODE === undefined);
    check("the relaunch env must keep the rest of the environment", payload?.env?.KEEP_ME === "yes");

    // A parent kill, not a self exit: exiting this process would make the shell
    // show its crash dialog instead of restarting silently.
    check("a 202 must kill the Electron main process (not this one)", desktop.kills.length === 1 && desktop.kills[0].pid === MAIN_PID);
    check("the parent kill must be a hard SIGKILL", desktop.kills[0]?.signal === "SIGKILL");
  }

  // Desktop forwarded shape: `origin` stripped, `host` re-added by undici.
  {
    const before = desktop.spawns.length;
    const { res } = await run(desktop.route, desktopForwardedRequest());
    check("the Desktop forwarded shape (no origin, own host) must be accepted with 202", res.status === 202);
    check("an accepted forwarded request must spawn a helper", desktop.spawns.length === before + 1);
  }

  // A forwarded-shaped request whose host is absent or foreign must be refused:
  // `host` is the only thing left to pin the request to this server.
  {
    const { res } = await run(desktop.route, { method: "POST", socket: { remoteAddress: "127.0.0.1" }, headers: { cookie: "a=b" } });
    check("a loopback POST with no host and no origin must be refused with 403", res.status === 403);
  }
  {
    const { res } = await run(desktop.route, desktopForwardedRequest({ host: "evil.example" }));
    check("a forwarded-shaped POST claiming a foreign host must be refused with 403", res.status === 403);
  }
  {
    const { res } = await run(desktop.route, desktopForwardedRequest({ cookie: undefined }));
    check("a forwarded-shaped POST without the shell cookie must be refused with 403", res.status === 403);
  }

  // A same-origin request whose origin disagrees with host must be refused.
  {
    const { res } = await run(desktop.route, sameOriginRequest({ host: OWN_HOST, origin: "http://evil.example" }));
    check("a cross-origin loopback POST must be refused with 403", res.status === 403);
  }

  // A same-origin request with no cookie must be refused: `exact` routes skip the
  // `/api` fence, so the cookie is the only thing a header-only probe lacks.
  {
    const { res } = await run(desktop.route, sameOriginRequest({ cookie: undefined }));
    check("a same-origin POST without a cookie must be refused with 403", res.status === 403);
  }

  // A request the browser itself marks cross-site must be refused even when the
  // Origin/Host pair happens to agree.
  {
    const { res } = await run(desktop.route, sameOriginRequest({ "sec-fetch-site": "cross-site" }));
    check("a sec-fetch-site: cross-site POST must be refused with 403", res.status === 403);
  }

  // ---- `dsh web` host (no Desktop marker in argv): must not tear the server down ----
  {
    const web = register(["C:\\Program Files\\nodejs\\node.exe", "C:\\x\\dsh\\bin.js", "web"]);
    check("web route path must still be the same", web.route?.path === clientRoute);
    const { res } = await run(web.route, sameOriginRequest());
    check("on a non-Desktop host the route must answer 409", res.status === 409);
    check("on a non-Desktop host the route must NOT spawn a helper", web.spawns.length === 0);
    check("on a non-Desktop host the route must NOT kill anything", web.kills.length === 0);
  }

  // ---- No Electron runtime (plain node): refuse rather than spawn a stranger ----
  {
    const plainNode = register(
      ["C:\\Program Files\\nodejs\\node.exe", "x\\dsh-desktop-host\\lib\\index.js"],
      { versions: { node: "24.21.0" } },
    );
    const { res } = await run(plainNode.route, sameOriginRequest());
    check("without an Electron runtime the route must answer 500", res.status === 500);
    check("without an Electron runtime the route must NOT spawn a helper", plainNode.spawns.length === 0);
  }

  // ---- Helper spawn failure surfaces as 500, not a silent 202 ----
  {
    const broken = register(
      ["DeepSeek Harness.exe", "x\\dsh-desktop-host\\lib\\index.js"],
      { spawnThrows: true },
    );
    const { res, thrown } = await run(broken.route, sameOriginRequest());
    check("a helper spawn failure must answer 500", res.status === 500);
    check("a helper spawn failure must not throw out of the handler", thrown === null);
    check("a helper spawn failure must not kill anything", broken.kills.length === 0);
  }

  // ---- `getOrigin()` throws until the port is bound; activation must survive ----
  {
    let bound = false;
    const late = register(
      ["C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe", "x\\dsh-desktop-host\\lib\\index.js"],
      { getOrigin: () => { if (!bound) throw new Error("webServer: not listening yet"); return OWN_ORIGIN; } },
    );
    // First request while still unbound: the forwarded shape cannot be pinned to
    // an authority, so it must be refused rather than trusted blindly.
    const unbound = await run(late.route, desktopForwardedRequest());
    check("a forwarded-shape request while getOrigin() throws must be refused with 403", unbound.res.status === 403);
    // Once listening, the same shape succeeds.
    bound = true;
    const boundRes = await run(late.route, desktopForwardedRequest());
    check("the same forwarded shape must succeed once the port is bound", boundRes.res.status === 202);
  }

  // ---- Real socket pass: what the shell's forward actually looks like ----
  // Everything above uses hand-written request doubles, which can only assert
  // the shapes we thought of. This mounts the real handler on a real server and
  // forwards with Node's own `fetch` the way the shell does, so the header
  // mutations undici performs (notably re-adding `host`) are part of the test.
  {
    const fakeArgv = ["DeepSeek Harness.exe", "--expose-internals", "x\\dsh-desktop-host\\lib\\index.js"];
    let route = null;
    let liveOrigin = "";
    const ctx = {
      webServer: {
        getOrigin: () => liveOrigin,
        register: (r) => { route = r; return () => {}; },
      },
      effect: (body) => body(),
    };
    const server = http.createServer((req, res) => {
      if (route === null) { res.writeHead(503); res.end(); return; }
      route.handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    liveOrigin = `http://127.0.0.1:${server.address().port}`;
    const real = loadHost(fakeArgv);
    real.apply(ctx);

    // Forward exactly as `forwardWebRequest` does: delete the four headers, then
    // set the shell's own session cookie.
    const forwarded = async () => {
      const headers = new Headers({ "content-type": "application/json" });
      for (const name of ["host", "origin", "cookie", "sec-fetch-site"]) headers.delete(name);
      headers.set("cookie", "dsh=s3cret");
      const response = await fetch(`${liveOrigin}${clientRoute}`, { method: "POST", headers, body: "{}", redirect: "manual" });
      return { status: response.status, body: await response.text() };
    };
    const sent = await forwarded();
    check("a real shell-shaped forward must be accepted with 202 (undici re-adds host)", sent.status === 202);
    check("the real forward's body must be the ok JSON", (() => { try { return JSON.parse(sent.body).ok === true; } catch { return false; } })());

    // A proxied forward must still be refused through the real socket.
    const proxied = await fetch(`${liveOrigin}${clientRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", cookie: "dsh=s3cret" },
      body: "{}",
    });
    check("a real forward carrying x-forwarded-for must be refused with 403", proxied.status === 403);
    await proxied.text();

    await new Promise((resolve) => setTimeout(resolve, 450));
    check("the real accepted forward must kill the Electron main process", real.kills.length === 1 && real.kills[0].signal === "SIGKILL");
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error("restart-route FAILED: " + failure);
    process.exit(1);
  }
  console.log(
    "restart-route ok: path=" + clientRoute + " inject=webServer method-gate=405"
    + " peer-gate=403 proxy-gate=403 cross-site=403 same-origin=202 desktop-forwarded=202"
    + " no-host=403 foreign-host=403 cross-origin=403 web-carrier=409-no-spawn"
    + " lazy-origin=1 no-electron=500 spawn-failure=500"
    + " helper-detached=1 payload-strips-electron-run-as-node=1"
    + " kills-parent-not-self=1 real-forward=202",
  );
})();
