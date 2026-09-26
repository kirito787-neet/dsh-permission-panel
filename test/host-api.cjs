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

/*
 * Optional services must stay OUT of the hard-gate `inject` array.
 *
 * A name in that array parks the plugin in PENDING forever when the service is
 * absent; a nested `ctx.inject([...], …)` merely never calls back. So a service
 * the plugin can live without — one whose feature already degrades — must be
 * injected lazily. Putting it in the top-level array converts "this feature is
 * unavailable" into "this plugin does not load", which is a far worse failure
 * and exactly the trap that made the permission panel look broken.
 */
const OPTIONAL_SERVICES = ["workspaces", "shortcuts"];
const injectArray = /const inject = \[([\s\S]*?)\];/u.exec(live);
if (injectArray === null) {
  throw new Error("client.js no longer declares a top-level `const inject = [...]` array");
}
const declared = [...injectArray[1].matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
for (const optional of OPTIONAL_SERVICES) {
  if (declared.includes(optional)) {
    throw new Error("client.js lists '" + optional + "' in the HARD-gate `inject` array. "
      + "A missing hard-gate service leaves the whole plugin PENDING forever; inject it lazily "
      + "with ctx.inject([...], …) instead so only its feature degrades.");
  }
}

/*
 * Every `remote.<ns>` the code dereferences must be DECLARED.
 *
 * This is the shipped bug that this suite exists for. Cordis gates each nested
 * Remote namespace separately: `remote` does NOT cover `remote.settings` or
 * `remote.permissionPresets`, and reading an undeclared one throws
 * `cannot get property "remote.<ns>" without inject`. The panel swallowed that
 * throw into its error state, so the feature rendered as a generic
 * "unavailable" instead of failing loudly.
 *
 * Verified against real cordis (vendor/cordis): with the plugin's array missing
 * `remote.permissionPresets`, a nested scope reading `remote.permissionPresets`
 * throws while `remote.settings` still resolves — which is exactly why the
 * panel looked half-dead rather than absent. `tools/probe-inject.cjs` reproduces
 * both cases on demand.
 */
const dereferenced = [...new Set([...live.matchAll(/\bremote\.([A-Za-z_$][\w$]*)/gu)].map((match) => match[1]))];
for (const namespace of dereferenced) {
  const name = "remote." + namespace;
  if (!declared.includes(name)) {
    throw new Error("client.js reads `" + name + "` but never declares it in the `inject` array. "
      + "Nested Remote namespaces are separately gated — a plain 'remote' entry does NOT cover its "
      + "children — so this read throws `cannot get property \"" + name + "\" without inject`. "
      + "Declared: " + JSON.stringify(declared));
  }
}

/*
 * `settingsSchema` gates the panel's whole settings binding, so it deserves the
 * same scrutiny as a dotted Remote name.
 *
 * The panel binds `permissionPanel.settingsCtx` inside
 * `ctx.inject(['remote', 'settingsSchema'], …)`. If that callback never fires,
 * the binding stays null, `load()` returns early, and the panel spins on
 * "loading" forever — a silent failure of the same family this suite exists for.
 *
 * `settingsSchema` is a runtime SERVICE provided by `ui-settings`' own `apply`,
 * so the bundle-level `dsh.client.inject` is what guarantees that package's
 * client module is in the roster at all (it is a package-arrival edge, not an
 * activation gate). Assert the edge rather than assume it: dropping the package
 * would remove the provider, the nested inject would never fire, and the panel
 * would go mute with no error anywhere.
 */
const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(clientPath), "package.json"), "utf8"));
const bundleInject = pkg.dsh?.client?.inject ?? [];
if (!bundleInject.includes("@deepseek-ai/dsh-client-ui-settings")) {
  throw new Error("package.json dsh.client.inject no longer lists '@deepseek-ai/dsh-client-ui-settings'. "
    + "That package's client module provides the `settingsSchema` service the permission panel's nested "
    + "inject waits on; without the package edge the callback may never fire and the panel would hang on "
    + "'loading' with no error. Bundle inject: " + JSON.stringify(bundleInject));
}
if (!live.includes('"settingsSchema"')) {
  throw new Error("client.js no longer injects 'settingsSchema'; the permission panel's settings binding would never run");
}

/*
 * The permission panel must dispatch commands BY SESSION ID, not through a
 * client-side binding.
 *
 * `sessions.binding(id)` only returns a binding for a scope that ALREADY exists —
 * it never materializes one; `retain()` does. The panel lists every session, so
 * reaching for the binding meant every session the user had not opened threw
 * "该会话暂时无法下发指令（尚未装载）": the panel could only ever drive the handful of
 * sessions that happened to be open.
 *
 * `remote.commands.execute(sessionId, line, [])` takes the id directly and the
 * Host RESUMES a cold session on demand, so it has no such restriction. This is
 * the surface the official ui-plan chip uses.
 *
 * `dispatchCommand` keeps a binding lookup as a DOCUMENTED last-resort fallback
 * for a carrier that composes sessions without `remote.commands`; that one is
 * legitimate. What must not come back is a PANEL-LEVEL binding lookup — the
 * per-row path that made unopened sessions unusable.
 */
if (/binding\(row\.id\)/u.test(live)) {
  throw new Error("client.js resolves a per-row client-side session binding to dispatch a command. "
    + "`binding()` never materializes a scope, so any session the user has not opened refuses with "
    + "\"not materialized yet\". Dispatch by id through remote.commands.execute instead.");
}
/*
 * The remote path must be the PRIMARY one, not merely present.
 *
 * A textual "does `execute(id, line, [])` appear" check is not enough: the
 * fallback branch contains the same call, so disabling the remote path entirely
 * (leaving only the binding fallback) still matched and the guard stayed green.
 * That was caught by mutation testing, and this is the fix — assert the remote
 * call is reached under a real condition, by requiring the guard clause that
 * precedes it.
 */
if (!/typeof remoteCommands\.execute === "function"/u.test(live)) {
  throw new Error("client.js no longer gates on `typeof remoteCommands.execute === 'function'`; "
    + "the by-id dispatch path has been disabled and only the binding fallback remains, which "
    + "cannot reach sessions the user has not opened");
}
if (!/\.execute\(id, line, \[\]\)/u.test(live)) {
  throw new Error("client.js no longer dispatches through commands.execute(id, line, []); "
    + "the panel would fall back to a path that only works for already-open sessions");
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
  // Real React supports a LAZY initializer (`useState(() => x)`); the stub must
  // too, or a component initializing a Set that way sees the function itself.
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useLayoutEffect: () => {},
  /*
   * Real React SUBSCRIBES on mount; this stub used to skip straight to the
   * snapshot, which meant a component whose subscribe was never wired still
   * looked healthy here. Calling through keeps the stub honest and is what lets
   * the archive assertions observe the panel's subscription.
   */
  useSyncExternalStore: (subscribe, getSnapshot) => { subscribe(() => {}); return getSnapshot(); },
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
  const archiveSubscriptions = [];
  let settingsDescribed = 0;
  let catalogRead = 0;

  /*
   * The Workspace registry's archive set. `archivedSessionIds` is the only field
   * this plugin reads, and it is read off `list.getSnapshot()` — the same
   * `WorkspaceSource` face the official sidebar uses. `s2` is archived and `s1`
   * is not, so the panel has exactly one row to hide and one to keep.
   */
  const workspaces = {
    list: {
      subscribe: (listener) => { archiveSubscriptions.push(listener); return () => {}; },
      getSnapshot: () => ({
        items: [],
        archivedSessionIds: ["s2"],
        pinnedSessionIds: [],
        state: "idle",
        phase: "ready",
        error: null,
      }),
    },
  };

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
          /*
           * `options` and `defaultOptions` are DIFFERENT fields on the real
           * `PermissionCatalog`, and this stub keeps them different on purpose.
           * `auto` is selectable for a live session but is NOT an eligible
           * new-session default, so a panel that read the wrong field would offer
           * it — which is exactly the mistake this fixture can detect.
           */
          return {
            ok: true,
            value: {
              options: [
                { value: "read-only", name: "read-only" },
                { value: "workspace-write", name: "workspace-write" },
                { value: "auto", name: "auto" },
              ],
              defaultOptions: [
                { value: "read-only", name: "read-only" },
                { value: "workspace-write", name: "workspace-write" },
              ],
              defaultPreset: "workspace-write",
            },
          };
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
          ids: ["s1", "s2"], current: "s1", phase: "ready",
          byId: {
            s1: { id: "s1", displayTitle: "Session A", running: false, cwd: "H:/w", projectionValues: { permissions: { currentValue: "workspace-write" } } },
            s2: { id: "s2", displayTitle: "Archived B", running: false, cwd: "H:/w", projectionValues: { permissions: { currentValue: "read-only" } } },
          },
        }),
      },
      binding: () => undefined,
      refresh: async () => {},
      subagentAddress: () => undefined,
    },
    workspaces,
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
  /*
   * Render the panel on demand rather than once.
   *
   * The first render necessarily happens BEFORE `panel.load()` resolves, so its
   * row list is empty — that is the panel's real loading state, not a defect.
   * The archive assertions need the settled render, so this stays callable and
   * the suite re-renders after draining the async chain.
   */
  const renderPanel = () => {
    const pending = [];
    const originalUseEffect = React.useEffect;
    React.useEffect = (body) => { pending.push(body); };
    const tree = Panel({ t: (key) => key });
    React.useEffect = originalUseEffect;
    for (const effect of pending.splice(0, pending.length)) effect();
    return tree;
  };

  /*
   * Kick off the mount effect so `panel.load()` starts its async chain, exactly
   * as a real mount would. The returned tree is the loading state and is
   * discarded; assertions re-render once the chain has drained.
   */
  renderPanel();

  return {
    requested, formReads, registrations, archiveSubscriptions, renderPanel,
    reads: () => ({ settingsDescribed, catalogRead }),
  };
};

/**
 * Collect every string rendered in an element tree.
 *
 * The panel's own text assertions need the flattened output, not the tree
 * shape. Nested arrays are flattened and non-strings ignored.
 *
 * NOTE: this walks only what the panel itself creates. Child components
 * (`PermissionRow`, `PresetDropdown`) are elements here, not calls — a real
 * renderer is what invokes them — so their internals are reached through
 * {@link collectElements} rather than through this helper.
 * @param node - element, array, or scalar produced by the React stub.
 * @returns every string found, in render order.
 */
const renderedText = (node) => {
  if (typeof node === "string") return [node];
  if (node === null || node === void 0 || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(renderedText);
  return renderedText(node.children);
};

/**
 * Collect every element in the tree whose `type` satisfies a predicate.
 *
 * Used to read the PROPS the panel passed to a child component. That is the
 * faithful assertion here: a real renderer would call `PermissionRow`, so what
 * this suite can verify without reimplementing React is which rows the panel
 * chose to create — and an archived session is excluded by never producing one.
 * @param node - element, array, or scalar produced by the React stub.
 * @param predicate - receives each element's `type`.
 * @returns matching elements in render order.
 */
const collectElements = (node, predicate) => {
  if (node === null || node === void 0 || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, predicate));
  const self = node.$$el === true && predicate(node.type) ? [node] : [];
  return [...self, ...collectElements(node.children, predicate)];
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

    /*
     * The archive filter must actually run: `s2` is archived in the Workspace
     * snapshot and `s1` is not, so the panel builds exactly one permission row
     * and reports the one it skipped.
     *
     * Asserted through the row ELEMENTS the panel created, not through rendered
     * text: `PermissionRow` is a child component, so a stub renderer sees the
     * element and its props rather than the row's own markup. The element list
     * is exactly what the archive filter controls — an archived session is
     * excluded by never producing a row for it — so this is the faithful check.
     *
     * Re-rendered here because the settled row list only exists after
     * `panel.load()` drains.
     */
    if (run.archiveSubscriptions.length === 0) {
      fail(carrier + ": the panel never subscribed to workspaces.list; the archive set would never refresh");
    }
    const tree = run.renderPanel();
    const rows = collectElements(tree, (type) => typeof type === "function" && type.name === "PermissionRow");
    const titles = rows.map((row) => row.props.title);
    if (titles.includes("Archived B")) {
      fail(carrier + ": the archived session 'Archived B' still has a permission row; rows=" + JSON.stringify(titles));
    }
    if (!titles.includes("Session A")) {
      fail(carrier + ": the active session 'Session A' is missing from the permission rows; rows=" + JSON.stringify(titles));
    }
    const text = renderedText(tree);
    if (!text.some((line) => line.startsWith("wpArchivedSkipped"))) {
      fail(carrier + ": the panel did not report the skipped archived session; saw " + JSON.stringify(text));
    }

    /*
     * The NEW-SESSION DEFAULT cell must offer `defaultOptions`, not `options`.
     *
     * The two fields differ: `auto` is selectable for a live session but is not an
     * eligible default. Reading the wrong field would offer `auto` here, and the
     * schema-derived path cannot cover for it because the real `defaultPreset`
     * schema is a bare string with no enum. This asserts the field actually read.
     */
    const defaultSelect = collectElements(tree, (type) => typeof type === "function" && type.name === "PresetDropdown")[0];
    if (defaultSelect === undefined) {
      fail(carrier + ": the default-permission dropdown was not rendered");
    }
    const offered = (defaultSelect.props.options ?? []).map((option) => option.value);
    if (!offered.includes("read-only") || !offered.includes("workspace-write")) {
      fail(carrier + ": the default-permission dropdown is missing catalog defaultOptions; offered " + JSON.stringify(offered));
    }
    if (offered.includes("auto")) {
      fail(carrier + ": the default-permission dropdown offers 'auto', which is in `options` but not in "
        + "`defaultOptions` — the panel read the wrong catalog field; offered " + JSON.stringify(offered));
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
    + " desktop-form=1 browser-form=0 panel-sections=2"
    + " archived-hidden=2 archive-reported=2",
  );
}).catch((error) => {
  console.error("host-api FAILED:", error && error.message ? error.message : error);
  process.exit(1);
});