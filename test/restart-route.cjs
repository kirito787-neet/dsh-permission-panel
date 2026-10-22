/**
 * Host-half test: the restart route registered on `webServer`.
 *
 * Why this exists
 * ---------------
 * The restart shortcut is only useful if the browser half's POST actually lands
 * on a route that (a) exists, (b) is reachable from the Desktop app page, and
 * (c) will not let a random local page bring DSH down. The shipped shell exposes
 * no restart IPC, so this route is the entire mechanism — a silent rename or a
 * missing `inject` would break the shortcut with no error anywhere.
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
 * - Non-Desktop host (no `dsh-desktop-host` in argv) → 409, and nothing exits.
 * - A 202 schedules `process.exit` only after the response has been written.
 * - A 202 first reports `{kind:"fatal"}` over the host IPC channel, so the
 *   shell's recovery dialog shows our sentence instead of the tail of this
 *   process's stderr (which is whatever another plugin last logged). Refused
 *   requests must send nothing.
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
const path = require("path");

const indexPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "index.js"));
const clientPath = path.resolve(process.argv[3] ?? path.join(__dirname, "..", "client.js"));

/** The authority the host is listening on; the gate compares `host` against it. */
const OWN_ORIGIN = "http://127.0.0.1:59666";
const OWN_HOST = "127.0.0.1:59666";

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
 * Load index.js against a fake ctx, with a fake `process` (argv + spied exit) so
 * neither the test nor the real host process is touched.
 */
function loadHost(argv) {
  const source = fs.readFileSync(indexPath, "utf8");
  // index.js is ESM. Both `apply` and `inject` are declared with plain
  // `function` / `const` and only re-exported at the bottom, so stripping the
  // export forms leaves real bindings in scope.
  const esm = source
    .replace(/\bexport\s*\{[^}]*\}\s*;?/u, "")
    .replace(/\bexport\s+const\s+/u, "const ")
    .replace(/\bexport\s+function\s+/u, "function ");
  const moduleShim = { exports: {} };
  const exits = [];
  const sent = [];
  const fakeProcess = {
    argv,
    exit: (code) => { exits.push(code); },
    send: (message) => { sent.push(message); },
  };
  const fn = new Function("module", "exports", "process", `${esm}\n;return { apply, inject };`);
  const { apply, inject } = fn(moduleShim, moduleShim.exports, fakeProcess);
  return { apply, inject, exits, sent };
}

/** Register the route against a fake ctx and capture it. */
function register(argv, options = {}) {
  const { apply, inject, exits, sent } = loadHost(argv);
  const getOrigin = options.getOrigin ?? (() => OWN_ORIGIN);
  check("inject must be exactly [\"webServer\"]", Array.isArray(inject) && inject.length === 1 && inject[0] === "webServer");
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
  apply(ctx);
  check("apply must register exactly one route", routes.length === 1);
  const route = routes[0];
  check("route.kind must be exact", route?.kind === "exact");
  return { route, inject, exits, sent };
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
  // The 202 path schedules `process.exit` after EXIT_DELAY_MS (250); wait past
  // that so the exit intent is observable on the fake process.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { res, thrown };
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
      headers: { host: "10.0.0.5:59666", origin: "http://10.0.0.5:59666" },
    });
    check("a non-loopback peer must be refused with 403", remote.res.status === 403);
  }

  // Proxy gate: forwarded headers of any spelling.
  for (const header of ["forwarded", "x-forwarded-for", "x-real-ip"]) {
    const { res } = await run(desktop.route, desktopForwardedRequest({ [header]: "1.2.3.4" }));
    check("a request with the " + header + " header must be refused with 403", res.status === 403);
  }

  // Same-origin browser shape.
  {
    const { res } = await run(desktop.route, sameOriginRequest());
    check("a same-origin loopback POST must be accepted with 202", res.status === 202);
    check("202 must set no-store", String(res.headers?.["cache-control"] ?? "") === "no-store");
    check("a 202 must schedule process.exit(0)", desktop.exits.includes(0));
    check("the 202 body must be JSON ok", (() => { try { return JSON.parse(res.body).ok === true; } catch { return false; } })());
    // The shell builds the dialog detail from `desktopErrorState(error).message`;
    // on a bare host exit that is the stderr tail. Sending `fatal` first makes
    // `DesktopHostProcess.fail()` (idempotent) publish our sentence instead.
    check("a 202 must report one fatal IPC message first", desktop.sent.length === 1);
    const notice = desktop.sent[0];
    check("the IPC message must be a fatal event", notice?.type === "fatal");
    check("the fatal message must be the restart notice", typeof notice?.message === "string" && /permission-panel/u.test(notice.message));
    check("the fatal message must not be left as an omitted diagnostic", notice?.diagnostic === undefined);
  }

  // Desktop forwarded shape: `origin` stripped, `host` re-added by undici.
  {
    const { res } = await run(desktop.route, desktopForwardedRequest());
    check("the Desktop forwarded shape (no origin, own host) must be accepted with 202", res.status === 202);
    check("the Desktop forwarded shape must schedule process.exit(0)", desktop.exits.includes(0));
  }

  // A forwarded-shaped request whose host is absent or foreign must be refused:
  // `host` is the only thing left to pin the request to this server.
  {
    const { res } = await run(desktop.route, { method: "POST", socket: { remoteAddress: "127.0.0.1" }, headers: {} });
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

  // A refused request must not announce a shutdown to the shell: a 403 that
  // still sent `fatal` would pop the recovery dialog on a failed attempt.
  {
    const before = desktop.sent.length;
    const { res } = await run(desktop.route, sameOriginRequest({ cookie: undefined }));
    check("a refused request must be answered 403", res.status === 403);
    check("a refused request must not report a fatal event", desktop.sent.length === before);
  }

  // ---- `dsh web` host (no Desktop marker in argv): must not tear the server down ----
  {
    const web = register(["C:\\Program Files\\nodejs\\node.exe", "C:\\x\\dsh\\bin.js", "web"]);
    check("web route path must still be the same", web.route?.path === clientRoute);
    const { res } = await run(web.route, sameOriginRequest());
    check("on a non-Desktop host the route must answer 409", res.status === 409);
    check("on a non-Desktop host the route must NOT exit the server", web.exits.length === 0);
    check("on a non-Desktop host the route must NOT report a fatal event", web.sent.length === 0);
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
    const exits = real.exits;

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

    await new Promise((resolve) => setTimeout(resolve, 400));
    check("the real accepted forward must schedule process.exit(0)", exits.includes(0));
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error("restart-route FAILED: " + failure);
    process.exit(1);
  }
  console.log(
    "restart-route ok: path=" + clientRoute + " inject=webServer method-gate=405"
    + " peer-gate=403 proxy-gate=403 cross-site=403 same-origin=202 desktop-forwarded=202"
    + " no-host=403 foreign-host=403 cross-origin=403 web-carrier=409-no-exit"
    + " lazy-origin=1 real-forward=202 exit-after-202=1 fatal-notice=1",
  );
})();
