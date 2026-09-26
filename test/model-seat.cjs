/**
 * Model-seat test: the search box in the second-level MODEL menu.
 *
 * Loads the real client.js through a stubbed module loader and drives the seat's
 * menu the way a user does — open the trigger, drill into "Model", type a query,
 * press Enter, press Escape — asserting the shipped two-level shape is preserved
 * and that the search box sits above the model options on the level that lists
 * them.
 *
 * The locale stub mirrors the Host's real resolution rule (namespace-only lookup,
 * NO cross-namespace fallback), so a string that lives in the wrong namespace
 * surfaces here as its raw key instead of its translation.
 *
 * Usage: node test/model-seat.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

// ---- pull the seat dictionaries straight out of the module source ----
const grabObject = (name) => {
  const start = source.indexOf("const " + name + " = {");
  if (start < 0) throw new Error("missing dictionary: " + name);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return Function("return " + source.slice(open, i + 1))();
    }
  }
  throw new Error("unterminated dictionary: " + name);
};
const seatZh = grabObject("seatZh");
const seatEn = grabObject("seatEn");

let captured = null;
const portalCalls = [];
const selectCalls = [];
const loadCalls = [];

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
  innerWidth: 1280,
  innerHeight: 800,
};

// ---- react stub ----
const hookSlots = new Map();
let ownerCounter = 0;
let hookOwner = "root";
let hookSlot = 0;
const useState = (initial) => {
  const key = hookOwner + "#" + hookSlot++;
  // Real React supports a LAZY initializer (`useState(() => x)`); the stub must
  // too, or a component initializing a Set that way sees the function itself.
  if (!hookSlots.has(key)) hookSlots.set(key, { value: typeof initial === "function" ? initial() : initial });
  const slot = hookSlots.get(key);
  const set = (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; };
  return [slot.value, set];
};
const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState,
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "seat-test",
};
const createPortal = (children, container) => {
  if (container === null || container === undefined || typeof container.appendChild !== "function") {
    throw new Error("createPortal: Target container is not a DOM element.");
  }
  portalCalls.push(container);
  return { $$portal: true, children, container };
};
const requireStub = (id) => {
  if (id === "react") return React;
  if (id === "react-dom") return { createPortal };
  throw new Error("unexpected require: " + id);
};

new Function("require", "window", "document", source)(requireStub, global.window, global.document);
if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

// ---- fake host services ----
const MODELS = [
  { id: "alpha-1", name: "Alpha One", reasoning: { defaultEffort: "low", efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] } },
  { id: "beta-2", name: "Beta Two" },
  { id: "gamma-3", name: "Gamma Three" },
];
const directorySnapshot = {
  status: "ready",
  current: { provider: "prov-a", model: "alpha-1" },
  groups: [
    { id: "prov-a", name: "Provider A", models: [MODELS[0], MODELS[1]] },
    { id: "prov-b", name: "Provider B", models: [MODELS[2]] },
  ],
  failures: [],
  error: null,
};
const directory = {
  subscribe: () => () => {},
  getSnapshot: () => directorySnapshot,
};
const seatProps = {
  locked: false,
  available: true,
  directory,
  load: () => { loadCalls.push(1); },
  select: (selection) => { selectCalls.push(selection); return Promise.resolve(true); },
};

const registrations = new Map();
// Shortcut commands the plugin contributes to the OFFICIAL service. Captured so
// the suite can assert the plugin no longer runs its own keydown listener.
const shortcutCommands = new Map();
/** Minimal cordis effect: run the body, keep its disposer. */
const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };
const fakeScope = {
  effect: runEffect,
  settingsScope: { bind: () => ({ set: async () => {} }), describe: () => ({ subscribe: () => () => {}, ensure: async () => {}, getSnapshot: () => ({ status: "unavailable", error: null }), acceptView: () => {} }) },
  remote: { settings: { mutate: async () => ({ ok: true, value: {} }) } },
  settingsSchema: { describe: () => ({ namespaces: [] }), rehydrate: (v) => v, nodeAtPath: () => undefined },
  sessions: { list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {}, phase: "ready" }) }, binding: () => undefined, refresh: async () => {}, subagentAddress: () => undefined },
  modelDirectories: { directoryFor: () => ({ store: directory, load: () => Promise.resolve(), select: seatProps.select }) },
  shortcuts: {
    register: (command) => { shortcutCommands.set(command.id, command); return () => { shortcutCommands.delete(command.id); }; },
  },
  slots: {
    inject: (name, factory) => { factory(); return () => {}; },
    register: (options, component) => { registrations.set(options.name, component); return () => {}; },
  },
};
const ctx = {
  effect: runEffect,
  inject: (names, callback) => { callback(fakeScope); },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: fakeScope.slots,
  get: () => undefined,
};
const plugin = captured.factory(requireStub);
plugin.apply(ctx);

const ModelSeat = registrations.get("conversation.input.model");
if (ModelSeat === undefined) throw new Error("the model seat was never registered");

// ---- renderer ----
const renderNode = (node) => {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(renderNode);
  if (node.$$portal === true) return { ...node, children: renderNode(node.children) };
  if (node.$$el !== true) return node;
  const children = (node.children ?? []).map(renderNode);
  if (typeof node.type === "function") {
    const previousOwner = hookOwner;
    hookOwner = "c" + (++ownerCounter);
    hookSlot = 0;
    const rendered = renderNode(node.type({ ...node.props, children }));
    hookOwner = previousOwner;
    return rendered;
  }
  return { ...node, children };
};
const childList = (node) => (Array.isArray(node.children) ? node.children : node.children === undefined ? [] : [node.children]);
const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const entry of node) walk(entry, visit); return; }
  if (node.$$el === true || node.$$portal === true) { visit(node); for (const child of childList(node)) walk(child, visit); }
};
const collect = (node, predicate) => { const found = []; walk(node, (entry) => { if (predicate(entry)) found.push(entry); }); return found; };
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node !== "object") return "";
  return childList(node).map(textOf).join(" ");
};

// Faithful locale: the seat is registered against its own namespace, and the Host
// resolves keys within that namespace only (no cross-namespace fallback).
const seatTranslate = (key, params) => {
  const template = seatZh[key];
  if (template === undefined) return key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
};
const renderSeat = () => {
  ownerCounter = 0;
  hookOwner = "c" + (++ownerCounter);
  hookSlot = 0;
  return renderNode(ModelSeat({ ...seatProps, t: seatTranslate }));
};
const triggerOf = (tree) => collect(tree, (entry) => entry.props?.className === "dshk-trigger")[0];
const searchInputOf = (tree) => collect(tree, (entry) => entry.props?.className === "dshk-searchInput")[0];
const modelOptionsOf = (tree) => collect(tree, (entry) => entry.props?.role === "menuitemradio");
/** A root-level drill-in row ("模型" / "思考强度" / "返回"), identified by its label. */
const cellOf = (tree, label) => collect(tree, (entry) => entry.props?.className === "dshk-cell" && textOf(entry).includes(label))[0];
/**
 * Mount fresh, open the trigger, drill into the searchable model list, and return
 * that tree. Starting from a clean mount keeps this usable whatever level an
 * earlier case left the menu on.
 */
const openModelPane = () => {
  hookSlots.clear();
  let next = renderSeat();
  triggerOf(next).props.onClick();
  next = renderSeat();
  const cell = cellOf(next, "模型");
  if (cell === undefined) fail("the root menu offers no \"模型\" drill-in row");
  cell.props.onClick();
  return renderSeat();
};

const fail = (message) => { console.error("model-seat FAILED:", message); process.exit(1); };

// ---- case 1: opening the trigger lands on the shipped root rows ----
// The menu starts CLOSED, so the click below is a genuine first open — the level
// it lands on is the first-level menu the user sees.
hookSlots.clear();
let tree = renderSeat();
if (searchInputOf(tree) !== undefined) fail("case 1: the search box rendered while the menu was still closed");
if (modelOptionsOf(tree).length !== 0) fail("case 1: model options rendered while the menu was still closed");
const trigger = triggerOf(tree);
if (trigger === undefined) fail("case 1: no model trigger rendered");
trigger.props.onClick();
tree = renderSeat();
if (portalCalls.length === 0) fail("case 1: opening the menu never rendered a portal");
const rootCells = collect(tree, (entry) => entry.props?.className === "dshk-cell");
if (rootCells.length !== 2) fail("case 1: the root level should hold the Model and Effort rows, saw " + rootCells.length);
if (searchInputOf(tree) !== undefined) fail("case 1: the root level still renders the search box — it belongs to the model list");
if (modelOptionsOf(tree).length !== 0) fail("case 1: the root level lists models directly instead of drilling in");

// ---- case 2: the search box lives in the second-level MODEL list, above the options ----
tree = openModelPane();
const search = searchInputOf(tree);
if (search === undefined) fail("case 2: the model list has no search box");
const options = modelOptionsOf(tree);
if (options.length === 0) fail("case 2: the model list has no model options");
const order = [];
walk(tree, (entry) => {
  if (entry.props?.className === "dshk-searchInput") order.push("search");
  if (entry.props?.role === "menuitemradio") order.push("option");
});
if (order[0] !== "search") fail("case 2: the search box is not the first control in the model list, saw " + JSON.stringify(order.slice(0, 4)));
if (order.filter((entry) => entry === "search").length !== 1) fail("case 2: expected exactly one search box");

// ---- case 3: the placeholder is a real translation, not a raw dictionary key ----
if (search.props.placeholder === "searchPlaceholder") {
  fail("case 3: the placeholder resolved to its raw key — the key is missing from the seat namespace");
}
if (typeof search.props.placeholder !== "string" || search.props.placeholder.length === 0) fail("case 3: the placeholder is empty");

// ---- case 4: typing filters the model options ----
search.props.onChange({ target: { value: "beta" } });
tree = renderSeat();
const filtered = modelOptionsOf(tree);
const filteredText = filtered.map(textOf).join(" | ");
if (filtered.length !== 1 || !filteredText.includes("Beta Two")) fail("case 4: filtering by 'beta' produced " + filtered.length + " options: " + filteredText);
if (textOf(tree).includes("Gamma Three")) fail("case 4: a non-matching model survived the filter");

// ---- case 5: Enter selects the first match ----
const input = searchInputOf(tree);
let prevented = false;
input.props.onKeyDown({ key: "Enter", preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
if (!prevented) fail("case 5: Enter was not consumed by the search box");
if (selectCalls.length !== 1) fail("case 5: Enter did not select a model, calls=" + JSON.stringify(selectCalls));
if (selectCalls[0].provider !== "prov-a" || selectCalls[0].model !== "beta-2") fail("case 5: Enter selected " + JSON.stringify(selectCalls[0]));

// ---- case 6: Escape unwinds one level at a time ----
// The container owns the Escape semantics; the input only intercepts it while a
// query is present. In the DOM an unconsumed key bubbles to the container, so the
// harness replays that path explicitly. Unwinding is level by level: query ->
// model list -> root rows -> closed.
const rootOf = (candidate) => collect(candidate, (entry) => entry.props?.className === "dshk-root")[0];
tree = renderSeat();
searchInputOf(tree).props.onKeyDown({ key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
tree = renderSeat();
if (modelOptionsOf(tree).length !== 3) fail("case 6: Escape with a query did not restore the full list");
const escaped = searchInputOf(tree).props.onKeyDown({ key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
if (escaped !== undefined) fail("case 6: the empty-query input still swallowed Escape");
rootOf(tree).props.onKeyDown({ key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
tree = renderSeat();
if (searchInputOf(tree) !== undefined) fail("case 6: Escape left the model list but kept the search box");
if (collect(tree, (entry) => entry.props?.className === "dshk-cell").length !== 2) fail("case 6: Escape did not return to the root rows");
rootOf(tree).props.onKeyDown({ key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });
tree = renderSeat();
if (collect(tree, (entry) => entry.props?.className === "dshk-cell").length !== 0) fail("case 6: Escape on the root rows did not close the menu");

// ---- case 7: the effort drill-in stays reachable from the root rows ----
hookSlots.clear();
tree = renderSeat();
triggerOf(tree).props.onClick();
tree = renderSeat();
const effortCell = cellOf(tree, "思考强度");
if (effortCell === undefined) fail("case 7: the effort drill-in is missing from the root rows");
effortCell.props.onClick();
tree = renderSeat();
const effortOptions = collect(tree, (entry) => entry.props?.role === "menuitemradio" && ["Low", "High"].includes(textOf(entry).trim()));
if (effortOptions.length === 0) fail("case 7: the effort pane rendered no levels");
const back = cellOf(tree, "返回");
if (back === undefined) fail("case 7: the effort pane offers no way back");
back.props.onClick();
tree = renderSeat();
const modelCell = cellOf(tree, "模型");
if (modelCell === undefined) fail("case 7: going back from effort did not restore the root rows");
modelCell.props.onClick();
tree = renderSeat();
if (searchInputOf(tree) === undefined) fail("case 7: the searchable model list is unreachable from the root rows");

// ---- case 8: both seat dictionaries stay key-identical ----
const zhKeys = Object.keys(seatZh).sort().join(",");
const enKeys = Object.keys(seatEn).sort().join(",");
if (zhKeys !== enKeys) fail("case 8: seat zh/en dictionaries diverged");

// ---- case 9: no rendered label falls back to a raw key ----
const leftovers = collect(tree, (entry) => typeof entry.children?.[0] === "string")
  .map((entry) => entry.children[0])
  .filter((value) => /^(search|menu|trigger|empty|status|effort|warning)\./.test(value));
if (leftovers.length > 0) fail("case 9: untranslated keys rendered: " + JSON.stringify(leftovers));

// ---- case 10: the plugin injects every service the model seat reaches ----
// `modelDirectories` is a cordis Service whose tracker rebinds `this.ctx` to the
// CALLING context, so directoryFor() resolves `this.ctx.remote.session` through
// THIS plugin's fiber. Declaring only the services we call directly makes every
// directoryFor() throw "cannot get property \"remote.session\" without inject",
// which reaches the user as a model list stuck on its loading row. The stub
// harness cannot see this, so assert the declared list explicitly.
const declaredInject = plugin.inject;
if (!Array.isArray(declaredInject)) fail("case 10: the plugin exports no inject array");
for (const required of ["locale", "remote", "remote.session", "sessions", "slots"]) {
  if (!declaredInject.includes(required)) {
    fail("case 10: the plugin does not inject \"" + required + "\", so the model seat cannot resolve its directory");
  }
}

// The manifest's package-level inject list must cover the same providers.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const manifestInject = manifest.dsh?.client?.inject ?? [];
for (const provider of ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-api-session-controller"]) {
  if (!manifestInject.includes(provider)) {
    fail("case 10: package.json dsh.client.inject omits " + provider);
  }
}

console.log(
  "model-seat ok: search box above " + options.length + " model options" +
  ", filter/enter/escape verified" +
  ", seat dict=" + Object.keys(seatZh).length + " keys",
);
