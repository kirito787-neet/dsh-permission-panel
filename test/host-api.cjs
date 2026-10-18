/**
 * Host-API compatibility test: no removed service, no invented field.
 *
 * Three shipped bugs motivated this suite, and they shared one shape — the plugin
 * trusted an API the Host does not serve, and nothing failed loudly.
 *
 * 1. `ctx.settingsScope` was REMOVED in DSH 0.1.7 (replaced by `configForms`).
 *    A nested `ctx.inject(['settingsScope'], …)` does not throw and does not fail
 *    activation: the callback simply NEVER RUNS.
 * 2. The panel read each session's preset OPTIONS from
 *    `projectionValues.permissions.options`. The real `PermissionSelection` is
 *    `{ currentValue }` — there is no `options` field.
 * 3. DSH 0.2.1 removed the two client-side snapshots the panel enumerated from:
 *    `sessions.list` (Session list store) and `workspaces.list` (Workspace
 *    registry snapshot). Both reads became `undefined`, and the panel threw on
 *    `undefined.subscribe` the moment it mounted. It also removed `configForms`
 *    and `settingsSchema` from the client surface.
 *
 * Every one of those was invisible because the test stubs were RICHER than the
 * real Host: they offered `settingsScope`, invented `permissions.options`, and
 * served client snapshots that no longer exist. A stub that is more capable than
 * production hides exactly this class of bug.
 *
 * This suite therefore asserts the inverse: it loads the plugin against a Host
 * stub that provides ONLY what 0.2.1-rc.2 actually serves, and checks that the
 * features still come up.
 *
 * Usage: node test/host-api.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

// ---- static checks: the source must not name removed APIs ----
// Comments are stripped first: this file's own documentation deliberately names
// the removed services to explain why they must not be used, and flagging that
// would punish the explanation rather than the defect. Only LIVE code is checked.
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//gu, " ")
  .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");
const live = stripComments(source);

// These are deliberately textual. The point is to catch a REINTRODUCTION of the
// dependency anywhere in executable code.
const REMOVED_SERVICES = [
  // Removed in 0.1.7; the supported surface is `remote.settings`.
  "settingsScope",
  // Removed in 0.2.1 (the client Session list store and the Workspace registry
  // snapshot). The supported surfaces are `remote.session.*` and
  // `remote.workspace.follow`.
  "sessionsStore",
  "workspacesRef",
];
for (const removed of REMOVED_SERVICES) {
  // `ctx.inject([...])` / `ctx.get()` mentions are the dangerous form.
  const injected = new RegExp("inject\\(\\[[^\\]]*[\"']" + removed + "[\"']", "u");
  if (injected.test(live)) {
    throw new Error("client.js still injects the REMOVED service '" + removed + "'. "
      + "A nested inject for a service the Host does not provide never calls back, so the "
      + "dependent feature silently does nothing. Use the Remote namespaces instead.");
  }
  if (new RegExp("\\b" + removed + "\\b", "u").test(live) && removed !== "settingsScope") {
    throw new Error("client.js still references '" + removed + "', which 0.2.1 removed from the "
      + "client surface. The panel must enumerate Sessions through remote.session.list and the "
      + "archive set through remote.workspace.follow.");
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
 * injected lazily.
 */
const OPTIONAL_SERVICES = ["workspaces", "shortcuts", "sessions"];
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
 * Cordis gates each nested Remote namespace separately: `remote` does NOT cover
 * `remote.settings` or `remote.permissionPresets`, and reading an undeclared one
 * throws `cannot get property "remote.<ns>" without inject`.
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
 * The 0.2.1 surfaces must be the ones actually used.
 *
 * `remote.session.list` is the Session catalog and `remote.workspace.follow` is
 * the archive stream: `sessions.list`/`workspaces.list` no longer exist, and a
 * reintroduced client snapshot would throw on mount. `remote.session.projections`
 * is the cold per-Session read that fills rows the list left without hints.
 */
for (const required of [
  [/session\.list\(/u, "remote.session.list"],
  [/session\.projections\(/u, "remote.session.projections"],
  [/workspace\.follow\(/u, "remote.workspace.follow"],
]) {
  if (!required[0].test(live)) {
    throw new Error("client.js no longer calls `" + required[1] + "`, the supported 0.2.1 surface "
      + "for the permission panel's data. The removed client snapshots cannot substitute.");
  }
}

/*
 * The permission panel must dispatch commands BY SESSION ID, not through a
 * client-side binding.
 *
 * `sessions.binding(id)` only returns a binding for a scope that ALREADY exists —
 * it never materializes one. The panel lists every session, so reaching for the
 * binding meant every session the user had not opened threw
 * "该会话暂时无法下发指令（尚未装载）".
 *
 * 0.2.1 types the first argument as the receiving Agent (`{ id }`); 0.1.x took
 * the bare id. The panel tries the current shape first and keeps the old call as
 * a fallback.
 */
if (/binding\(row\.id\)/u.test(live)) {
  throw new Error("client.js resolves a per-row client-side session binding to dispatch a command. "
    + "`binding()` never materializes a scope, so any session the user has not opened refuses with "
    + "\"not materialized yet\". Dispatch by id through remote.commands.execute instead.");
}
if (!/typeof remoteCommands\.execute === "function"/u.test(live)) {
  throw new Error("client.js no longer gates on `typeof remoteCommands.execute === 'function'`; "
    + "the by-id dispatch path has been disabled and only the binding fallback remains, which "
    + "cannot reach sessions the user has not opened");
}
if (!/\{ id \}/u.test(live) && !/\{ id \}/u.test(source)) {
  throw new Error("client.js no longer passes the receiving Agent (`{ id }`) to commands.execute; "
    + "0.2.1 changed the first argument from the bare Session id.");
}

// ---- behavioural check: activate against the real 0.2.1 surface only ----
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
   * Real React SUBSCRIBES on mount; this stub must too, or a component whose
   * subscribe was never wired still looked healthy here.
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
 * Activate the plugin against the real 0.2.1-rc.2 surface, on one carrier.
 *
 * `sessions.list`, `workspaces.list`, `configForms` and `settingsSchema` are
 * absent on BOTH carriers: those are Host facts, not carrier facts.
 * @param desktop - whether to install the Desktop preload bridge.
 * @returns what the plugin asked for and which async reads it performed.
 */
const activate = (desktop) => {
  const requested = [];
  const formsRead = [];
  const registrations = new Map();
  const archiveFrames = [];
  const executes = [];
  let settingsDescribed = 0;
  let catalogRead = 0;
  let sessionListed = 0;
  let projectionsRead = 0;

  /*
   * A faithful `remote.session.list` answer: `s1` is active and `s2` is
   * archived, and each row carries projection hints the way the Host sends them.
   * Title lives in the projections, not on the summary.
   */
  const sessionRows = [
    {
      agentAvailable: true,
      sessionId: "s1",
      updatedAt: 1,
      running: false,
      blank: false,
      cwd: "H:/w",
      projections: {
        kind: "cached",
        asOfSeq: 1,
        values: { title: "Session A", permissions: { currentValue: "workspace-write" } },
      },
    },
    {
      agentAvailable: true,
      sessionId: "s2",
      updatedAt: 2,
      running: false,
      blank: false,
      cwd: "H:/w",
      projections: {
        kind: "cached",
        asOfSeq: 2,
        values: { title: "Archived B", permissions: { currentValue: "read-only" } },
      },
    },
  ];

  const hostScope = {
    effect: runEffect,
    remote: {
      session: {
        list: async () => {
          sessionListed += 1;
          return { ok: true, value: { items: sessionRows } };
        },
        projections: async () => {
          projectionsRead += 1;
          return { ok: true, value: { kind: "sequenced", asOfSeq: 1, values: { title: "Session A" } } };
        },
      },
      workspace: {
        follow: async function* (signal) {
          archiveFrames.push("baseline");
          yield { type: "baseline", value: { items: [], archivedSessionIds: ["s2"], pinnedSessionIds: [] } };
        },
      },
      commands: {
        execute: async (target, line, attachments) => {
          executes.push({ target, line, attachments });
          return { ok: true, value: { commandId: "c", result: { kind: "success" } } };
        },
      },
      settings: {
        describe: async () => {
          settingsDescribed += 1;
          return { ok: true, value: { writable: true, namespaces: [{ ns: "permission", revision: 7, schema: {}, value: { defaultPreset: "workspace-write" } }] } };
        },
        mutate: async () => ({ ok: true, value: { ns: "permission", revision: 8, value: { defaultPreset: "read-only" } } }),
        update: async () => ({ ok: true, value: { ns: "dsh-desktop", revision: 9, value: {} } }),
      },
      permissionPresets: {
        catalog: async () => {
          catalogRead += 1;
          /*
           * `options` and `defaultOptions` are DIFFERENT fields on the real
           * `PermissionCatalog`, and this stub keeps them different on purpose.
           * `auto` is selectable for a live session but is NOT an eligible
           * new-session default.
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
  if (desktop) fakeWindow.dshDesktopActions = { invoke: async (action) => { formsRead.push(action); } };
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
  // `sessions.list`, `workspaces.list`, `configForms`, or `settingsSchema`.
  captured.factory(requireStub).apply(ctx);
  global.window = previousWindow;

  const Panel = registrations.get("workspace-permissions");
  /*
   * Render the panel on demand rather than once: the first render necessarily
   * happens BEFORE the catalog/panel loads resolve, so its row list is empty —
   * that is the panel's real loading state, not a defect.
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

  renderPanel();

  return {
    requested, formsRead, registrations, archiveFrames, executes, renderPanel,
    reads: () => ({ settingsDescribed, catalogRead, sessionListed, projectionsRead }),
  };
};

/**
 * Collect every string rendered in an element tree.
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

// Settle the async chains (session list -> archive stream -> panel load).
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
settle().then(() => {
  const fail = (message) => { throw new Error(message); };

  for (const [carrier, run] of [["browser", browser], ["desktop", desktop]]) {
    if (run.requested.some((name) => name === "settingsScope" || name === "sessions")) {
      fail(carrier + ": the plugin requested the removed 'settingsScope' or the removed client 'sessions' store");
    }
    if (!run.requested.includes("remote")) {
      fail(carrier + ": the plugin never injected 'remote'; the permission panel reads everything through it");
    }
    if (!run.registrations.has("workspace-permissions")) fail(carrier + ": the workspace-permissions section was never registered");
    if (!run.registrations.has("dsh-permission-panel")) fail(carrier + ": the dsh-permission-panel settings section was never registered");

    const reads = run.reads();
    if (reads.sessionListed === 0) {
      fail(carrier + ": the panel never called remote.session.list(); there would be no session rows");
    }
    if (reads.settingsDescribed === 0) {
      fail(carrier + ": the permission panel never called remote.settings.describe(); the default-preset cell cannot load");
    }
    if (reads.catalogRead === 0) {
      fail(carrier + ": the permission panel never called remote.permissionPresets.catalog(); session rows would have no presets");
    }
    if (!run.archiveFrames.includes("baseline")) {
      fail(carrier + ": the panel never consumed remote.workspace.follow(); the archive set would never arrive");
    }

    /*
     * The archive filter must actually run: `s2` is archived in the Workspace
     * baseline and `s1` is not, so the panel builds exactly one permission row
     * and reports the one it skipped.
     */
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
     * `auto` is selectable for a live session but is not an eligible default.
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

  /*
   * Commands dispatch through `remote.commands.execute` with the receiving Agent
   * as the first argument (0.2.1 shape). That path only runs on a user action, so
   * this suite asserts the CALL SHAPE in source rather than faking a click: the
   * static check above already requires `{ id }`, and smoke.cjs owns interaction.
   */

  console.log(
    "host-api ok: no-removed-services=3 carriers=2"
    + " session-list=2 archive-stream=2 settings-describe=2 catalog-read=2"
    + " panel-sections=2 archived-hidden=2 archive-reported=2",
  );
}).catch((error) => {
  console.error("host-api FAILED:", error && error.message ? error.message : error);
  process.exit(1);
});
