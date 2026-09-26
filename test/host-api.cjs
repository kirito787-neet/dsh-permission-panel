/**
 * Host-API compatibility test: no removed service, no invented field.
 *
 * Two shipped bugs motivated this suite, and they shared one shape — the plugin
 * trusted an API the Host does not serve, and nothing failed loudly.
 *
 * 1. `ctx.settingsScope` was REMOVED in DSH 0.1.7 (replaced by `configForms`).
 *    A nested `ctx.inject(['settingsScope'], …)` does not throw and does not fail
 *    activation: the callback simply NEVER RUNS. So the permission panel's
 *    settings face stayed null and the default-preset cell was permanently
 *    unusable, with no error anywhere.
 * 2. The panel read each session's preset OPTIONS from
 *    `projectionValues.permissions.options`. The real `PermissionSelection` is
 *    `{ currentValue }` — there is no `options` field — so every row computed
 *    `capable: false` and rendered disabled.
 *
 * Both were invisible because the test stubs were RICHER than the real Host: they
 * offered `settingsScope`, and they invented `permissions.options`. A stub that
 * is more capable than production hides exactly this class of bug.
 *
 * This suite therefore asserts the inverse: it loads the plugin against a Host
 * stub that provides ONLY the real 0.1.7 surface, and checks that the features
 * still come up. It fails if the plugin ever again depends on a service that the
 * Host does not provide, or on a projection field that does not exist.
 *
 * Usage: node test/host-api.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

// ---- static checks: the source must not name removed APIs ----
// Comments are stripped first: this file's own documentation deliberately names
// the removed service to explain why it must not be used, and flagging that would
// punish the explanation rather than the defect. Only LIVE code is checked.
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//gu, " ")
  .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");
const live = stripComments(source);

// These are deliberately textual. The point is to catch a REINTRODUCTION of the
// dependency anywhere in executable code.
const REMOVED_SERVICES = [
  // Removed in 0.1.7; the supported surface is `configForms` + `remote.settings`.
  "settingsScope",
];
for (const removed of REMOVED_SERVICES) {
  // `ctx.inject([...])` / `ctx.get()` mentions are the dangerous form.
  const injected = new RegExp("inject\\(\\[[^\\]]*[\"']" + removed + "[\"']", "u");
  if (injected.test(live)) {
    throw new Error("client.js still injects the REMOVED service '" + removed + "'. "
      + "A nested inject for a service the Host does not provide never calls back, so the "
      + "dependent feature silently does nothing. Use configForms/remote.settings instead.");
  }
  const probed = new RegExp("ctx\\.get\\([\"']" + removed + "[\"']\\)", "u");
  if (probed.test(live)) {
    throw new Error("client.js still probes the REMOVED service '" + removed + "' via ctx.get()");
  }
  const deref = new RegExp("ctx\\." + removed + "\\b", "u");
  if (deref.test(live)) {
    throw new Error("client.js still dereferences ctx." + removed + ", which the Host does not provide");
  }
}

// The panel must not read an `options` array off the permissions projection:
// `PermissionSelection` is `{ currentValue }` only.
if (/permission\.options/u.test(live) || /permissions\s*\)?[^;]*\.options/u.test(live)) {
  throw new Error("client.js reads `.options` off the permissions projection, which does not exist "
    + "(PermissionSelection is { currentValue }). Preset options come from remote.permissionPresets.catalog().");
}

// ---- behavioural check: activate against the real 0.1.7 surface only ----
let captured = null;
global.document = {
  body: { nodeType: 1, appendChild() {}, removeChild() {}, contains: () => false },
  head: { appendChild() {} },
  createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {}, appendChild() {} }),
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  activeElement: null,
};
global.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: "" },
  addEventListener() {},
  removeEventListener() {},
};

const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "host-api",
};
const requireStub = (id) => {
  if (id === "react") return React;
  if (id === "react-dom") return { createPortal: () => ({ $$portal: true, children: null }) };
  throw new Error("unexpected require: " + id);
};

const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };

/**
 * Activate the plugin against the real 0.1.7 surface, on one carrier.
 *
 * `settingsScope` is absent and the session projection carries no `options`, on
 * BOTH carriers: those are Host facts, not carrier facts.
 * @param desktop - whether to install the Desktop preload bridge.
 * @returns what the plugin asked for and which async reads it performed.
 */
const activate = (desktop) => {
  const requested = [];
  const formReads = [];
  const registrations = new Map();
  let settingsDescribed = 0;
  let catalogRead = 0;

  const hostScope = {
    effect: runEffect,
    configForms: {
      get: (entryId) => { formReads.push(entryId); return { set: async () => true, getSnapshot: () => ({ status: "ready", value: {}, writable: true, revision: 1 }) }; },
      describe: () => ({ subscribe: () => () => {}, ensure: async () => {}, getSnapshot: () => ({ status: "ready", error: null, view: { writable: true, namespaces: [] } }), acceptView: () => {} }),
    },
    remote: {
      settings: {
        describe: async () => {
          settingsDescribed += 1;
          return { ok: true, value: { writable: true, namespaces: [{ ns: "permission", revision: 7, schema: {}, value: { defaultPreset: "workspace-write" } }] } };
        },
        mutate: async () => ({ ok: true, value: { ns: "permission", revision: 8, value: { defaultPreset: "read-only" } } }),
      },
      permissionPresets: {
        catalog: async () => {
          catalogRead += 1;
          return { ok: true, value: { options: [{ value: "read-only", name: "read-only" }], defaultOptions: [], defaultPreset: "read-only" } };
        },
      },
    },
    settingsSchema: {
      describe: () => ({ namespaces: [{ ns: "permission", schema: {} }] }),
      rehydrate: (value) => value,
      nodeAtPath: () => ({ type: "union", list: [{ type: "const", value: "read-only" }] }),
    },
    sessions: {
      list: {
        subscribe: () => () => {},
        // A real session summary: `permissions` carries currentValue and NOTHING else.
        getSnapshot: () => ({
          ids: ["s1"], current: "s1", phase: "ready",
          byId: { s1: { id: "s1", displayTitle: "Session A", running: false, cwd: "H:/w", projectionValues: { permissions: { currentValue: "workspace-write" } } } },
        }),
      },
      binding: () => undefined,
      refresh: async () => {},
      subagentAddress: () => undefined,
    },
    shortcuts: { register: () => () => {} },
    slots: {
      inject: (name, factory) => { factory(); return () => {}; },
      register: (options, component) => { registrations.set(options.id, component); return () => {}; },
    },
  };

  const previousWindow = global.window;
  const fakeWindow = {
    ...previousWindow,
    location: { search: "" },
  };
  if (desktop) fakeWindow.dshDesktopActions = { invoke: async () => {} };
  global.window = fakeWindow;

  captured = null;
  new Function("require", "window", "document", source)(requireStub, fakeWindow, global.document);
  if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

  const ctx = {
    effect: runEffect,
    inject: (names, callback) => {
      requested.push(...names);
      callback(hostScope);
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: hostScope.slots,
    get: () => undefined,
  };

  // Activation must not throw on either carrier, even though the Host offers no
  // `settingsScope`.
  captured.factory(requireStub).apply(ctx);
  global.window = previousWindow;

  /*
   * Drive the panel so its async reads actually run. The panel is a function
   * component; rendering it queues its mount effects, which is what triggers
   * `panel.load()`. Whether the resulting rows are ENABLED is asserted in
   * smoke.cjs, which owns the full renderer.
   */
  const Panel = registrations.get("workspace-permissions");
  const pending = [];
  const originalUseEffect = React.useEffect;
  React.useEffect = (body) => { pending.push(body); };
  Panel({ t: (key) => key });
  React.useEffect = originalUseEffect;
  for (const effect of pending.splice(0, pending.length)) effect();

  return {
    requested, formReads, registrations,
    reads: () => ({ settingsDescribed, catalogRead }),
  };
};

const browser = activate(false);
const desktop = activate(true);

// Settle both async chains (describe -> catalog).
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
settle().then(() => {
  const fail = (message) => { throw new Error(message); };

  for (const [carrier, run] of [["browser", browser], ["desktop", desktop]]) {
    if (run.requested.some((name) => name === "settingsScope")) {
      fail(carrier + ": the plugin requested the removed 'settingsScope' service");
    }
    if (!run.requested.includes("remote")) {
      fail(carrier + ": the plugin never injected 'remote'; the permission panel reads settings through it");
    }
    if (!run.registrations.has("workspace-permissions")) fail(carrier + ": the workspace-permissions section was never registered");
    if (!run.registrations.has("hotkey-toolkit")) fail(carrier + ": the hotkey-toolkit settings section was never registered");

    const reads = run.reads();
    if (reads.settingsDescribed === 0) {
      fail(carrier + ": the permission panel never called remote.settings.describe(); the default-preset cell cannot load");
    }
    if (reads.catalogRead === 0) {
      fail(carrier + ": the permission panel never called remote.permissionPresets.catalog(); session rows would have no presets");
    }
  }

  // The Desktop form is resolved on the Desktop carrier only: `dsh-desktop` is a
  // Desktop-owned namespace, and a browser carrier serves no settings row for it.
  if (browser.formReads.length !== 0) {
    fail("browser: resolved the dsh-desktop form without the Desktop shell");
  }
  if (desktop.formReads.length !== 1 || desktop.formReads[0] !== "dsh-desktop") {
    fail("desktop: the dsh-desktop form was not resolved exactly once; saw " + JSON.stringify(desktop.formReads));
  }

  console.log(
    "host-api ok: no-removed-services=1 carriers=2"
    + " settings-describe=2 catalog-read=2"
    + " desktop-form=1 browser-form=0 panel-sections=2",
  );
}).catch((error) => {
  console.error("host-api FAILED:", error && error.message ? error.message : error);
  process.exit(1);
});