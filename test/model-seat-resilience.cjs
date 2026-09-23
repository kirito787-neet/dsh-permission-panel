/**
 * Resilience check for the model seat (optional suite).
 *
 * The seat shadows a shipped slot, and the slot runtime retires an entry on its
 * FIRST render error ("abdication"): the composer silently falls back to the
 * shipped two-level menu and the search box disappears for the rest of the
 * session. Two inputs can trigger that at cold boot:
 *
 *   1. a store snapshot that is missing `groups`/`failures` (partial, or the
 *      empty object the directory publishes before its first load), and
 *   2. `modelDirectories.directoryFor(sessionId)` throwing for a session whose
 *      scope/binding is not resolved yet (session restore, cold boot).
 *
 * Both must degrade instead of throwing, and the menu must still open on the
 * search box. This suite pins that behavior against real React + jsdom.
 *
 * Requires react, react-dom and jsdom to be resolvable from DSH_DOMTEST_DIR.
 * Skips itself (exit 0) when they are absent, so `npm test` stays dependency-free.
 *
 *   DSH_DOMTEST_DIR=<dir with node_modules> node test/model-seat-resilience.cjs [client.js]
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const TEMP = process.env.DSH_DOMTEST_DIR;
const CLIENT = process.argv[2] ?? path.join(__dirname, "..", "client.js");
if (TEMP === undefined || TEMP === "") {
  console.log("model-seat-resilience skipped: set DSH_DOMTEST_DIR to a directory with react/react-dom/jsdom");
  process.exit(0);
}
let req;
try {
  req = Module.createRequire(path.join(TEMP, "noop.js"));
  req.resolve("jsdom");
  req.resolve("react");
  req.resolve("react-dom/client");
} catch (error) {
  console.log("model-seat-resilience skipped: " + error.message);
  process.exit(0);
}
const { JSDOM } = req("jsdom");
const React = req("react");
const ReactDOMClient = req("react-dom/client");
const act = React.act ?? req("react-dom/test-utils").act;

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;
// React 18 touches these during focus management; jsdom does not implement them.
if (typeof dom.window.HTMLElement.prototype.attachEvent !== "function") {
  dom.window.HTMLElement.prototype.attachEvent = function () {};
  dom.window.HTMLElement.prototype.detachEvent = function () {};
}

const fail = (message) => {
  console.error("model-seat-resilience FAIL: " + message);
  process.exit(1);
};

(async () => {
  // Capture the plugin module through the loader the shell installs.
  let captured = null;
  dom.window.__ModuleLoader__ = { load: (definition) => { captured = definition; } };
  const source = fs.readFileSync(CLIENT, "utf8");
  const requireStub = (id) => {
    if (id === "react") return React;
    if (id === "react-dom") return { createPortal: req("react-dom").createPortal };
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "window", "document", source)(requireStub, dom.window, dom.window.document);
  if (captured === null) fail("the plugin never registered with the loader");
  const plugin = captured.factory(requireStub);

  // The seat's own dictionary, extracted from the plugin source.
  const grab = (name) => {
    const start = source.indexOf("const " + name + " = {");
    if (start < 0) fail("could not find " + name + " in the plugin source");
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") { depth--; if (depth === 0) return Function("return " + source.slice(open, i + 1))(); }
    }
    fail("unterminated " + name);
  };
  const dict = grab("seatZh");
  const t = (key, params) => {
    const template = dict[key];
    if (template === undefined) return key;
    return params === undefined ? template : template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };

  // Drive apply() with a directory whose directoryFor() can be made to throw.
  const registrations = new Map();
  const noopStore = { subscribe: () => () => {}, getSnapshot: () => ({ current: null, status: "idle", error: null, groups: [], failures: [] }) };
  let directoryForImpl = () => ({ store: noopStore, load: () => Promise.resolve(), select: () => Promise.resolve(true) });
  let subagentImpl = () => undefined;
  const scope = {
    slots: { inject: (name, factory) => factory(), register: (options, component) => { registrations.set(options.name, component); return () => {}; } },
    modelDirectories: { directoryFor: (sessionId) => directoryForImpl(sessionId) },
    sessions: { list: noopStore, binding: () => undefined, refresh: async () => {}, subagentAddress: () => subagentImpl() },
    settingsScope: { bind: () => ({ set: async () => {} }), describe: () => ({ subscribe: () => () => {}, ensure: async () => {}, getSnapshot: () => ({ status: "unavailable", error: null }), acceptView: () => {} }) },
    remote: { settings: { mutate: async () => ({ ok: true, value: {} }) } },
    settingsSchema: { describe: () => ({ namespaces: [] }), rehydrate: (value) => value, nodeAtPath: () => undefined },
  };
  const makeCtx = (activeScope) => ({
    effect: (body) => { const disposer = body(); return typeof disposer === "function" ? disposer : () => {}; },
    inject: (names, callback) => callback(activeScope),
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: activeScope.slots,
    get: () => undefined,
  });
  plugin.apply(makeCtx(scope));
  const ModelSeat = registrations.get("conversation.input.model");
  if (ModelSeat === undefined) fail("the model seat was never registered");

  // A store's subscribe must be referentially stable, or React resubscribes forever.
  const STABLE_SUBSCRIBE = () => () => {};

  /** Mount the seat, open its menu, and report whether the search box rendered. */
  const openMenu = async (snapshot) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = { subscribe: STABLE_SUBSCRIBE, getSnapshot: () => snapshot };
    const root = ReactDOMClient.createRoot(host);
    const Seat = () => React.createElement(ModelSeat, {
      locked: false, available: true, directory: store,
      load: () => {}, select: () => Promise.resolve(true), t,
    });
    try {
      await act(async () => { root.render(React.createElement(Seat)); });
      const trigger = host.querySelector(".dshk-trigger");
      if (trigger !== null) {
        await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
      }
    } catch (error) {
      await act(async () => { root.unmount(); });
      host.remove();
      return { ok: false, reason: error.message };
    }
    const rendered = document.querySelector(".dshk-searchInput") !== null;
    await act(async () => { root.unmount(); });
    host.remove();
    return { ok: rendered, reason: rendered ? "" : "the menu opened without a search box" };
  };

  // Snapshots a cold boot can publish. Every one must still show the search box.
  const snapshots = [
    ["full snapshot", { status: "ready", current: { provider: "p", model: "m" }, groups: [{ id: "p", name: "P", models: [{ id: "m", name: "M" }] }], failures: [], error: null }],
    ["groups missing", { status: "ready", current: null, failures: [], error: null }],
    ["groups and failures null", { status: "ready", current: null, groups: null, failures: null, error: null }],
    ["empty object", {}],
    ["failures not an array", { status: "ready", current: null, groups: [], failures: "boom", error: null }],
    ["reasoning without efforts", { status: "ready", current: { provider: "p", model: "m" }, groups: [{ id: "p", name: "P", models: [{ id: "m", name: "M", reasoning: { defaultEffort: "low" } }] }], failures: [], error: null }],
  ];
  for (const [label, snapshot] of snapshots) {
    const result = await openMenu(snapshot);
    if (!result.ok) fail("snapshot '" + label + "': " + result.reason);
  }

  // An unresolved session must not take the whole registration down with it.
  directoryForImpl = () => { throw new Error("session resolved no binding"); };
  let face = null;
  const throwingScope = {
    ...scope,
    slots: { inject: (name, factory) => factory(), register: (options) => { if (options.inject) face = options.inject("session-unresolved"); return () => {}; } },
  };
  plugin.apply(makeCtx(throwingScope));
  if (face === null) fail("an unresolved session aborted the seat registration");
  // An unresolved session must NOT report unavailable: the seat renders null when
  // unavailable, which removes the composer's model button entirely.
  if (face.available !== true) fail("an unresolved session must keep the seat visible, saw available=" + JSON.stringify(face.available));
  if (await face.select({ provider: "p", model: "m" }) !== false) fail("select() must resolve false for an unresolved session");
  const idle = face.directory.getSnapshot();
  if (!Array.isArray(idle.groups) || !Array.isArray(idle.failures)) fail("the fallback store must publish arrays");
  // React re-reads getSnapshot every render and only bails out when the value is
  // cached; a fresh object per call would loop and crash the seat.
  if (face.directory.getSnapshot() !== idle) fail("the fallback store must return a cached snapshot");
  if (face.directory.subscribe(() => {}) !== face.directory.subscribe(() => {})) {
    // Two distinct unsubscribe closures are fine; what matters is that subscribe
    // itself is a stable reference, which React uses to decide resubscription.
    if (typeof face.directory.subscribe !== "function") fail("subscribe must be callable");
  }

  // And the degraded face must itself mount without crashing the seat.
  const degraded = await openMenu(face.directory.getSnapshot());
  if (!degraded.ok) fail("the degraded face did not render: " + degraded.reason);

  // The seat must still paint its trigger for an unresolved session: rendering
  // null would delete the model button from the composer.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = ReactDOMClient.createRoot(host);
  const Trigger = () => React.createElement(ModelSeat, {
    locked: false, available: face.available, directory: face.directory,
    load: face.load, select: face.select, t,
  });
  await act(async () => { root.render(React.createElement(Trigger)); });
  const trigger = host.querySelector(".dshk-trigger");
  const triggerText = trigger === null ? null : trigger.textContent.trim();
  await act(async () => { root.unmount(); });
  host.remove();
  if (trigger === null) fail("the model button disappeared for an unresolved session");

  // sessions.subagentAddress() may also throw; that must not hide the seat either.
  // Only a POSITIVE "this is an addressed subagent session" may hide it.
  const cases = [
    ["directoryFor throws", () => { directoryForImpl = () => { throw new Error("no binding"); }; }, undefined],
    ["subagentAddress throws", () => { directoryForImpl = () => ({ store: noopStore, load: () => Promise.resolve(), select: () => Promise.resolve(true) }); subagentImpl = () => { throw new Error("boom"); }; }, undefined],
    ["addressed subagent", () => { subagentImpl = () => "addr"; }, false],
  ];
  for (const [label, arrange, expectedAvailable] of cases) {
    arrange();
    let resolved = null;
    const probeScope = {
      ...scope,
      slots: { inject: (name, factory) => factory(), register: (options) => { if (options.inject) resolved = options.inject("session-probe"); return () => {}; } },
    };
    plugin.apply(makeCtx(probeScope));
    if (resolved === null) fail(label + ": the seat registration aborted");
    if (expectedAvailable !== undefined && resolved.available !== expectedAvailable) {
      fail(label + ": expected available=" + String(expectedAvailable) + ", saw " + JSON.stringify(resolved.available));
    }
    if (expectedAvailable === undefined && resolved.available !== true) {
      fail(label + ": an unexpected error must keep the seat visible, saw available=" + JSON.stringify(resolved.available));
    }
    if (expectedAvailable === undefined) {
      const shown = await openMenu(resolved.directory.getSnapshot());
      if (!shown.ok) fail(label + ": " + shown.reason);
    }
  }


  // The lazy directory must RECOVER: a session that is unresolvable at first
  // (cold boot) and binds later has to start showing models once it does. The
  // injected face is computed once per binding, so resolving eagerly would pin an
  // empty directory for the whole session - the menu would open with no rows.
  subagentImpl = () => undefined;
  let bindingReady = false;
  let realStore = null;
  const readySnapshot = {
    current: { provider: "prov-a", model: "alpha-1" },
    status: "ready",
    error: null,
    groups: [{ id: "prov-a", name: "Provider A", models: [{ id: "alpha-1", name: "Alpha One" }, { id: "beta-2", name: "Beta Two" }] }],
    failures: [],
  };
  directoryForImpl = () => {
    if (!bindingReady) throw new Error("session resolved no binding");
    if (realStore === null) {
      let snapshot = { current: null, status: "idle", error: null, groups: [], failures: [] };
      const listeners = new Set();
      realStore = {
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => snapshot,
        emit: (next) => { snapshot = next; for (const listener of [...listeners]) listener(); },
      };
    }
    return {
      store: realStore,
      load: () => { realStore.emit(readySnapshot); },
      select: () => Promise.resolve(true),
    };
  };

  let lazyFace = null;
  const lazyScope = {
    ...scope,
    slots: { inject: (name, factory) => factory(), register: (options) => { if (options.inject) lazyFace = options.inject("session-cold"); return () => {}; } },
  };
  plugin.apply(makeCtx(lazyScope));
  if (lazyFace === null) fail("the seat registration aborted for a cold session");
  // Building the face must NOT resolve the directory (that is what used to throw).
  const before = lazyFace.directory.getSnapshot();
  if (before.status !== "loading") fail("an unresolved session must report loading, saw " + JSON.stringify(before.status));
  if (before.groups.length !== 0) fail("an unresolved session must not invent models");

  // Mount it, open the menu, then let the session bind and load.
  const coldHost = document.createElement("div");
  document.body.appendChild(coldHost);
  const coldRoot = ReactDOMClient.createRoot(coldHost);
  const ColdSeat = () => React.createElement(ModelSeat, {
    locked: false, available: lazyFace.available, directory: lazyFace.directory,
    load: lazyFace.load, select: lazyFace.select, t,
  });
  await act(async () => { coldRoot.render(React.createElement(ColdSeat)); });
  const coldTrigger = coldHost.querySelector(".dshk-trigger");
  if (coldTrigger === null) fail("the model button is missing for a cold session");
  await act(async () => { coldTrigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  if (document.querySelector(".dshk-searchInput") === null) fail("the search box is missing for a cold session");
  // A bare search box over nothing is the bug: there must be a visible status row.
  const coldRows = document.querySelectorAll("[role=menuitemradio]").length;
  const coldStatus = document.querySelector(".dshk-status, .dshk-empty, .dshk-error");
  if (coldRows === 0 && coldStatus === null) fail("a cold session opened an empty menu with no status row");

  // The session binds; the same face must now surface the real models.
  bindingReady = true;
  await act(async () => { lazyFace.load(); });
  const warmRows = document.querySelectorAll("[role=menuitemradio]").length;
  if (warmRows !== 2) fail("models did not appear after the session bound, rows=" + warmRows);
  if (document.querySelector(".dshk-searchInput") === null) fail("the search box vanished after the session bound");
  await act(async () => { coldRoot.unmount(); });
  coldHost.remove();

  // The catalog must be warmed when the seat MOUNTS, not when the menu opens:
  // otherwise the first open always waits on a Host round-trip and the user sees
  // "Loading models..." instead of the list.
  bindingReady = true;
  let preloadCalls = 0;
  let preloadSnapshot = { current: null, status: "idle", error: null, groups: [], failures: [] };
  const preloadListeners = new Set();
  const preloadStore = {
    subscribe: (listener) => { preloadListeners.add(listener); return () => preloadListeners.delete(listener); },
    getSnapshot: () => preloadSnapshot,
    emit: (next) => { preloadSnapshot = next; for (const listener of [...preloadListeners]) listener(); },
  };
  directoryForImpl = () => ({
    store: preloadStore,
    load: () => {
      preloadCalls += 1;
      preloadStore.emit(readySnapshot);
      return Promise.resolve(readySnapshot);
    },
    select: () => Promise.resolve(true),
  });
  let preloadFace = null;
  const preloadScope = {
    ...scope,
    slots: { inject: (name, factory) => factory(), register: (options) => { if (options.inject) preloadFace = options.inject("session-preload"); return () => {}; } },
  };
  plugin.apply(makeCtx(preloadScope));
  if (preloadFace === null) fail("the seat registration aborted for the preload case");
  const preloadHost = document.createElement("div");
  document.body.appendChild(preloadHost);
  const preloadRoot = ReactDOMClient.createRoot(preloadHost);
  const PreloadSeat = () => React.createElement(ModelSeat, {
    locked: false, available: preloadFace.available, directory: preloadFace.directory,
    load: preloadFace.load, select: preloadFace.select, t,
  });
  await act(async () => { preloadRoot.render(React.createElement(PreloadSeat)); });
  // Menu still closed here: mounting alone must have warmed the catalog.
  if (preloadCalls === 0) fail("the catalog was not warmed when the seat mounted");
  const preloadTrigger = preloadHost.querySelector(".dshk-trigger");
  if (preloadTrigger === null) fail("the model button is missing in the preload case");
  await act(async () => { preloadTrigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  // The first open must show the list at once - no loading placeholder.
  const instantRows = document.querySelectorAll("[role=menuitemradio]").length;
  if (instantRows !== 2) fail("the first open did not show models immediately, rows=" + instantRows);
  if (document.querySelector(".dshk-status") !== null) fail("the first open still showed a loading placeholder");
  await act(async () => { preloadRoot.unmount(); });
  preloadHost.remove();

  console.log("model-seat-resilience ok: search box survives " + snapshots.length +
    " partial snapshots, an unresolved session, and the degraded face; a cold session shows a status row and recovers to " + warmRows + " models");
  process.exit(0);
})().catch((error) => fail(error && error.message ? error.message : String(error)));
