/**
 * Sub-plugin toggle test: the model-search seat must be switchable at runtime.
 *
 * The searchable model menu works by shadowing the official
 * `conversation.input.model` cell. That is a real takeover — the official
 * ModelSelect stops rendering in that cell — so it is a user-facing choice, not
 * an unconditional one. This suite drives the real client.js and asserts the
 * switch genuinely mounts and retires the seat.
 *
 * The end-to-end path is exercised for real: the settings page is RENDERED, the
 * modelSearch checkbox is found in the tree, and its onChange is invoked exactly
 * as a click would. That matters, because the interesting bug is not "does the
 * preference persist" but "does flipping it live re-register the seat" — the
 * disposed `slots.inject` handle cannot be re-armed, so re-enabling MUST call
 * `slots.inject` again. An implementation that stashes the old handle would pass
 * the "off" assertion and silently never come back.
 *
 * Usage: node test/seat-toggle.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

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
/** localStorage that actually stores, so the switch can be flipped and re-read. */
const storage = new Map();
global.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
  },
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
  // The settings page reads the plugin store through this; a live snapshot is
  // enough because the checkbox's onChange is what drives the flip.
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "seat-toggle",
};
const requireStub = (id) => {
  if (id === "react") return React;
  if (id === "react-dom") return { createPortal: () => ({ $$portal: true, children: null }) };
  throw new Error("unexpected require: " + id);
};

new Function("require", "window", "document", source)(requireStub, global.window, global.document);
if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

// ---- host services ----
/** Every seat registration currently live, in mount order. */
const liveSeats = [];
/** Slot entries registered by name (the settings page and the seat). */
const slotComponents = new Map();
let seatInjectCalls = 0;
const directory = { subscribe: () => () => {}, getSnapshot: () => ({ status: "ready", current: null, groups: [], failures: [], error: null }) };
const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };

const slotsService = {
  inject: (name, factory) => {
    // Track the model cell specifically, but run every declaration's factory so
    // the settings page and the permissions panel register as they do live.
    const isSeat = name === "conversation.input.model";
    if (isSeat) seatInjectCalls += 1;
    const entry = isSeat ? { name } : null;
    if (entry !== null) liveSeats.push(entry);
    factory();
    return () => {
      if (entry === null) return;
      const at = liveSeats.indexOf(entry);
      if (at >= 0) liveSeats.splice(at, 1);
    };
  },
  register: (options) => {
    slotComponents.set(options.name + ":" + (options.id ?? ""), options);
    const entry = liveSeats[liveSeats.length - 1];
    if (entry !== undefined && options.name === "conversation.input.model") entry.component = options.name;
    return () => {};
  },
};

const makeScope = () => ({
  effect: runEffect,
  // The permissions panel binds a settings scope on activation; the seat toggle
  // test does not exercise it, so a minimal face is enough.
  settingsScope: {
    bind: () => ({ set: async () => {} }),
    describe: () => ({
      subscribe: () => () => {},
      ensure: async () => {},
      getSnapshot: () => ({ status: "unavailable", error: null }),
      acceptView: () => {},
    }),
  },
  remote: { settings: { mutate: async () => ({ ok: true, value: {} }) } },
  settingsSchema: { describe: () => ({ namespaces: [] }), rehydrate: (v) => v, nodeAtPath: () => undefined },
  modelDirectories: { directoryFor: () => ({ store: directory, load: () => Promise.resolve(), select: () => Promise.resolve(true) }) },
  sessions: {
    list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {}, current: null, phase: "ready" }) },
    binding: () => undefined,
    refresh: async () => {},
    subagentAddress: () => undefined,
  },
  shortcuts: { register: () => () => {} },
  slots: slotsService,
});

/** Load the plugin fresh against the current stored preference. */
const load = () => {
  liveSeats.length = 0;
  slotComponents.clear();
  seatInjectCalls = 0;
  captured = null;
  new Function("require", "window", "document", source)(requireStub, global.window, global.document);
  const scope = makeScope();
  const ctx = {
    effect: runEffect,
    inject: (names, callback) => { callback(scope); },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: slotsService,
    get: () => undefined,
  };
  captured.factory(requireStub).apply(ctx);
};

// ---- renderer (expands function components the way React does) ----
const childList = (node) => (Array.isArray(node.children) ? node.children : node.children === undefined ? [] : [node.children]);
const renderNode = (node) => {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(renderNode);
  if (node.$$portal === true) return { ...node, children: renderNode(node.children) };
  if (node.$$el !== true) return node;
  const children = (node.children ?? []).map(renderNode);
  if (typeof node.type === "function") return renderNode(node.type({ ...node.props, children }));
  return { ...node, children };
};
const collect = (node, predicate, found = []) => {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) { for (const entry of node) collect(entry, predicate, found); return found; }
  if (node.$$el === true || node.$$portal === true) {
    if (predicate(node)) found.push(node);
    for (const child of childList(node)) collect(child, predicate, found);
  }
  return found;
};
/** Flatten one subtree's text, so rows can be located by their label key. */
const explain = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(explain).join(" ");
  if (typeof node !== "object") return "";
  return childList(node).map(explain).join(" ");
};
/** Render the settings page and return its tree. */
const renderSettings = () => {
  if (settingsComponent === null) throw new Error("the hotkey-toolkit settings section was never registered");
  return renderNode(settingsComponent({ t: (key) => key }));
};
/** Captured from the settings-section registration below. */
let settingsComponent = null;

// The settings component is the second argument to slots.register; capture it.
const originalRegister = slotsService.register;
slotsService.register = (options, component) => {
  if (options.name === "settings.section" && options.id === "hotkey-toolkit") settingsComponent = component;
  return originalRegister(options, component);
};

// ---- assertions ----
const fail = (message) => { throw new Error(message); };
const STORAGE_KEY = "dsh.hotkeyToolkit.v1";
/** Find the modelSearch checkbox in the rendered settings tree. */
const modelSearchCheckbox = () => {
  const tree = renderSettings();
  /*
   * The page carries one switch per contributed command PLUS the model-search
   * sub-plugin switch. Identify the model-search one by its row label rather than
   * by position, so adding or reordering command switches cannot silently make
   * this suite toggle the wrong thing.
   */
  const rows = collect(tree, (entry) => entry.props?.className === "dshk-row");
  const row = rows.find((candidate) => explain(candidate).includes("modelSearch"));
  if (row === undefined) {
    fail("no settings row labelled 'modelSearch'; saw " + JSON.stringify(rows.map(explain)));
  }
  const inputs = collect(row, (entry) => entry.type === "input" && entry.props.type === "checkbox");
  if (inputs.length !== 1) fail("the model-search row does not carry exactly one checkbox; saw " + inputs.length);
  return inputs[0];
};
/** Every per-command shortcut switch currently rendered, keyed by its action. */
const shortcutSwitches = () => {
  const tree = renderSettings();
  const out = new Map();
  for (const action of ["refresh", "restart", "compatibility", "extended", "advanced"]) {
    const row = collect(tree, (entry) => entry.props?.className === "dshk-row")
      .find((candidate) => explain(candidate).includes("switch_" + action));
    if (row === undefined) fail("the settings page has no switch row for '" + action + "'");
    const input = collect(row, (entry) => entry.type === "input" && entry.props.type === "checkbox")[0];
    if (input === undefined) fail("the '" + action + "' switch row carries no checkbox");
    out.set(action, input);
  }
  return out;
};

// 1. Default is ON: the seat is mounted, and the switch reads checked.
load();
if (liveSeats.length !== 1) fail("with the default preference the seat was not mounted (live seats=" + liveSeats.length + ")");
let box = modelSearchCheckbox();
if (box.props.checked !== true) fail("the model-search switch does not read as checked by default");

// 2. Flip OFF through the real onChange handler, as a click would.
box.props.onChange({ target: { checked: false } });
if (liveSeats.length !== 0) {
  fail("turning the switch off did not retire the seat; live seats=" + liveSeats.length);
}
if (storage.get(STORAGE_KEY) === undefined) fail("turning the switch off did not persist the preference");
box = modelSearchCheckbox();
if (box.props.checked !== false) fail("the switch did not read back as unchecked after being turned off");

// 3. Flip back ON — this is the assertion that catches a one-way toggle, since a
//    disposed slots.inject handle cannot be re-armed and re-enabling must call
//    slots.inject again.
const callsAfterOff = seatInjectCalls;
box.props.onChange({ target: { checked: true } });
if (liveSeats.length !== 1) {
  fail("turning the switch back on did not re-mount the seat; live seats=" + liveSeats.length
    + " (inject calls before=" + callsAfterOff + " after=" + seatInjectCalls + ")");
}
if (seatInjectCalls <= callsAfterOff) {
  fail("re-enabling did not call slots.inject again; it tried to reuse the disposed handle");
}

// 4. Flipping OFF twice must be idempotent, not double-dispose.
box.props.onChange({ target: { checked: false } });
box.props.onChange({ target: { checked: false } });
if (liveSeats.length !== 0) fail("a repeated OFF left a seat mounted");

// 5. A stored OFF must leave the official seat completely untouched.
storage.set(STORAGE_KEY, JSON.stringify({ modelSearch: false }));
load();
if (liveSeats.length !== 0) fail("with modelSearch=false the plugin still shadowed the official model seat");
if (seatInjectCalls !== 0) {
  fail("with modelSearch=false the plugin still called slots.inject for the model cell; the official menu must be left alone");
}

// 6. Absent preference falls back to the ON default.
storage.delete(STORAGE_KEY);
load();
if (liveSeats.length !== 1) fail("an absent preference did not fall back to the ON default");

// 7. The legacy pre-1.5 payload must not turn the seat off or crash the load.
storage.set(STORAGE_KEY, JSON.stringify({ enabled: true, refresh: "Ctrl+R", restart: "Ctrl+Shift+R", modes: {} }));
load();
if (liveSeats.length !== 1) fail("the legacy payload broke the seat; an upgrade must keep the default ON");

// 8. A corrupt payload must degrade to the default, never throw.
storage.set(STORAGE_KEY, "{not json");
load();
if (liveSeats.length !== 1) fail("a corrupt payload did not degrade to the default");

// 9. The seat must not carry a hard-coded priority: the dynamic facade overwrites
//    it with a rank lower than every shipped entry, so a literal is a lie.
if (/priority:\s*-1/.test(source)) {
  fail("the seat still passes priority: -1; the dynamic facade assigns a lower rank automatically and overwrites it");
}

// 10. Every contributed command must have its own switch on the settings page,
//     defaulting to ON, and flipping it must persist per-command (not clobber the
//     sibling switches or the model-search preference).
storage.delete(STORAGE_KEY);
load();
let switches = shortcutSwitches();
if (switches.size !== 5) fail("expected 5 per-command switches, saw " + switches.size);
for (const [action, input] of switches) {
  if (input.props.checked !== true) fail("the '" + action + "' switch does not default to ON");
}
// Turn exactly one off; the others must be untouched.
switches.get("restart").props.onChange({ target: { checked: false } });
const persisted = JSON.parse(storage.get(STORAGE_KEY));
if (persisted.shortcuts.restart !== false) fail("disabling 'restart' did not persist");
for (const other of ["refresh", "compatibility", "extended", "advanced"]) {
  if (persisted.shortcuts[other] !== true) {
    fail("disabling 'restart' also changed '" + other + "' (per-command isolation broken)");
  }
}
if (persisted.modelSearch !== true) fail("disabling a shortcut switch disturbed the model-search preference");
// And the rendered state must reflect it after a reload.
load();
switches = shortcutSwitches();
if (switches.get("restart").props.checked !== false) fail("the 'restart' switch did not read back as OFF");
if (switches.get("refresh").props.checked !== true) fail("the 'refresh' switch did not stay ON");

// 11. A payload written before a switch existed must default the missing key to ON,
//     never to `undefined` (which would read as disabled and silently kill a
//     shortcut the user never touched).
storage.set(STORAGE_KEY, JSON.stringify({ shortcuts: { refresh: false } }));
load();
switches = shortcutSwitches();
if (switches.get("refresh").props.checked !== false) fail("a stored explicit OFF was not honoured");
for (const action of ["restart", "compatibility", "extended", "advanced"]) {
  if (switches.get(action).props.checked !== true) {
    fail("the '" + action + "' switch defaulted to OFF when absent from the stored payload");
  }
}

console.log(
  "seat-toggle ok: default=on live-off=retired live-on=remounted"
  + " idempotent=1 stored-off=untouched absent=on legacy=on corrupt=on priority-literal=absent"
  + " command-switches=5 per-command-isolated=1 missing-key-defaults-on=1",
);