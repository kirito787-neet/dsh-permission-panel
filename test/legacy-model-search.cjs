/**
 * Cross-plugin legacy-compat test.
 *
 * The model-search box moved from THIS plugin (`dsh-hotkey-toolkit`) to
 * `dsh-client-ui-effort-slider`, which seats itself in the same
 * `conversation.input.model` cell. The user's old choice lives in this plugin's
 * own localStorage document under the key `dsh.hotkeyToolkit.v1`, as the field
 * `modelSearch`. The slider plugin reads that field ONCE to inherit the choice,
 * so a user who had deliberately turned the search box off is not silently given
 * it back on upgrade.
 *
 * That handoff has one easy way to break, and it is not obvious:
 *
 *   `createConfigStore().update()` persists `normalizeConfig({ ...snapshot, ... })`.
 *   If `normalizeConfig` drops `modelSearch` — which is exactly what a
 *   "remove the feature" refactor does — then the very next shortcut switch the
 *   user flips REWRITES the document WITHOUT that field. The slider plugin has
 *   not necessarily loaded yet, so the choice is destroyed before anyone can
 *   read it, and the user's OFF quietly becomes ON.
 *
 * So this suite pins the passthrough: the field is not read by this plugin any
 * more, but it must survive every write this plugin performs.
 *
 * Usage: node test/legacy-model-search.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

// ---- a localStorage that really stores, so writes can be inspected ----
const storage = new Map();
let captured = null;

global.document = {
  body: { nodeType: 1, appendChild() {}, removeChild() {}, contains: () => false },
  head: { appendChild() {} },
  createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, remove: () => {}, appendChild() {} }),
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  activeElement: null,
};
global.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
  },
  location: { search: "" },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
};

const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => { subscribe(() => {}); return getSnapshot(); },
  useId: () => "legacy",
};
const requireStub = (id) => {
  if (id === "react") return React;
  if (id === "react-dom") return { createPortal: () => ({ $$portal: true, children: null }) };
  throw new Error("unexpected require: " + id);
};

const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };

/** Components registered by id, so the settings page can be rendered. */
const registrations = new Map();
const slotsService = {
  inject: (name, factory) => { factory(); return () => {}; },
  register: (options, component) => { registrations.set(options.id ?? options.name, component); return () => {}; },
};
const scope = {
  effect: runEffect,
  sessions: {
    list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {}, current: null, phase: "ready" }) },
    binding: () => undefined,
    refresh: async () => {},
    subagentAddress: () => undefined,
  },
  slots: slotsService,
  remote: {
    commands: { execute: async () => ({ ok: true, value: true }) },
    settings: { describe: async () => ({ ok: true, value: { writable: true, namespaces: [] } }), mutate: async () => ({ ok: true, value: {} }) },
    permissionPresets: { catalog: async () => ({ ok: true, value: { options: [], defaultOptions: [], defaultPreset: "" } }) },
  },
  settingsSchema: { describe: () => ({ namespaces: [] }), rehydrate: (value) => value, nodeAtPath: () => undefined },
  shortcuts: { register: () => () => {} },
};
const ctx = {
  effect: runEffect,
  inject: (names, callback) => { callback(scope); },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: slotsService,
  get: () => undefined,
};

const STORAGE_KEY = "dsh.hotkeyToolkit.v1";

/** Load the plugin fresh against whatever the storage currently holds. */
const load = () => {
  registrations.clear();
  captured = null;
  new Function("require", "window", "document", source)(requireStub, global.window, global.document);
  captured.factory(requireStub).apply(ctx);
};

/** Drive one per-command switch on the rendered settings page, as a click would. */
const flipShortcut = (action, next) => {
  const Section = registrations.get("hotkey-toolkit");
  if (Section === undefined) throw new Error("the hotkey-toolkit settings section was never registered");
  const tree = Section({ t: (key) => key });
  const walk = (node, found = []) => {
    if (node === null || node === undefined || typeof node !== "object") return found;
    if (Array.isArray(node)) { for (const child of node) walk(child, found); return found; }
    if (node.$$el === true) { found.push(node); for (const child of node.children ?? []) walk(child, found); }
    return found;
  };
  const rows = walk(tree).filter((node) => node.props?.className === "dshk-row");
  const row = rows.find((candidate) => JSON.stringify(candidate).includes("switch_" + action));
  if (row === undefined) throw new Error("no settings row for the '" + action + "' switch; saw " + rows.length + " rows");
  const input = walk(row).find((node) => node.type === "input" && node.props?.type === "checkbox");
  if (input === undefined) throw new Error("the '" + action + "' row carries no checkbox");
  input.props.onChange({ target: { checked: next } });
};

const fail = (message) => { console.error("legacy-model-search FAILED:", message); process.exit(1); };

// ---- 1. A legacy OFF survives this plugin's own writes ----
storage.set(STORAGE_KEY, JSON.stringify({ modelSearch: false, shortcuts: { refresh: true } }));
load();
flipShortcut("restart", false);
{
  const raw = storage.get(STORAGE_KEY);
  if (raw === undefined) fail("flipping a shortcut switch persisted nothing");
  const persisted = JSON.parse(raw);
  if (persisted.modelSearch !== false) {
    fail("a legacy `modelSearch: false` was DROPPED when this plugin rewrote its preference document"
      + " (persisted=" + JSON.stringify(persisted) + "). The slider plugin reads that field once to inherit"
      + " the user's old choice; losing it silently re-enables the search box. Keep the field as an"
      + " unread passthrough in normalizeConfig.");
  }
  if (persisted.shortcuts?.restart !== false) fail("the shortcut change itself did not persist");
}

// ---- 2. A legacy ON survives too (the passthrough is not one-way) ----
storage.set(STORAGE_KEY, JSON.stringify({ modelSearch: true }));
load();
flipShortcut("extended", false);
{
  const persisted = JSON.parse(storage.get(STORAGE_KEY));
  if (persisted.modelSearch !== true) fail("a legacy `modelSearch: true` was dropped (persisted=" + JSON.stringify(persisted) + ")");
}

// ---- 3. A non-boolean legacy value must not be propagated as-is ----
// The field is only meaningful as a boolean; a corrupt payload must not smuggle
// arbitrary data into every future write.
storage.set(STORAGE_KEY, JSON.stringify({ modelSearch: "yes" }));
load();
flipShortcut("refresh", false);
{
  const persisted = JSON.parse(storage.get(STORAGE_KEY));
  if ("modelSearch" in persisted) {
    fail("a non-boolean legacy `modelSearch` was carried into the persisted payload (" + JSON.stringify(persisted.modelSearch) + ")");
  }
}

// ---- 4. This plugin no longer READS the field: no seat resurrection ----
// The regression this guards: if the seat ever came back, it would shadow the
// slider plugin's cell and the two would fight over one slot.
//
// Comments are stripped first: this file's own prose deliberately names the cell
// to explain where the seat went, and flagging that would punish the explanation
// rather than the defect. Only LIVE code is checked.
const live = source
  .replace(/\/\*[\s\S]*?\*\//gu, " ")
  .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");
for (const banned of ["conversation.input.model", "modelDirectories"]) {
  if (live.includes(banned)) {
    fail("client.js still references '" + banned + "' in live code; the model seat must live only in"
      + " dsh-client-ui-effort-slider, which seats itself in the same cell");
  }
}

console.log("legacy-model-search ok: passthrough-off=1 passthrough-on=1 non-boolean-dropped=1 seat-absent=1");
