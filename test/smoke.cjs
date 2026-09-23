/**
 * Render smoke test for the workspace-permissions panel.
 *
 * Loads the real client.js through a stubbed module loader (fake react /
 * react-dom / document), renders PermissionsSection with a preset dropdown OPEN,
 * and clicks presets end to end down to the /permission command and the
 * permission settings namespace.
 *
 * This guards the regression where the dropdown portal was handed a null
 * container: in the shipped production build that fails at commit
 * (container.appendChild), which unmounts the whole settings tree — the blank
 * screen seen when clicking a permission switch.
 *
 * Usage: node test/smoke.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

let captured = null;
const portalCalls = [];
const commandCalls = [];
const mutateCalls = [];

// ---- document stub (render touches it only through the portal host) ----
const fakeBody = { nodeType: 1, appendChild() {}, removeChild() {}, contains: () => false };
// Keydown listeners the panel registers while its confirmation modal is open.
const keydownListeners = [];
global.document = {
  body: fakeBody,
  head: { appendChild() {} },
  createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {}, appendChild() {} }),
  getElementById: () => null,
  addEventListener(type, listener) { if (type === "keydown") keydownListeners.push(listener); },
  removeEventListener(type, listener) { if (type === "keydown") { const at = keydownListeners.indexOf(listener); if (at >= 0) keydownListeners.splice(at, 1); } },
  querySelector: () => null,
};
// ---- window stub: capture the module definition, provide localStorage ----
global.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: "" },
  addEventListener() {},
  removeEventListener() {},
};

// ---- react stub: plain element trees the harness renders itself ----
// Hook state is keyed by (component instance, slot index) and component
// instances are numbered in render order, which lets the harness open exactly
// one dropdown before rendering — mirroring what a click does in the live UI.
const hookSlots = new Map();
let ownerCounter = 0;
let hookOwner = "root";
let hookSlot = 0;
const useState = (initial) => {
  const key = hookOwner + "#" + hookSlot++;
  if (!hookSlots.has(key)) hookSlots.set(key, { value: initial });
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
  // Effects run their body once (queued), exactly as far as this panel needs:
  // the mount effect is what kicks off the settings-mirror load.
  useEffect: (body) => { pendingEffects.push(body); },
  useLayoutEffect: (body) => { pendingEffects.push(body); },
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "smoke",
};
const pendingEffects = [];
const createPortal = (children, container) => {
  // Mirrors React's contract: a portal needs a real DOM container.
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

// ---- load the plugin module ----
new Function("require", "window", "document", source)(requireStub, global.window, global.document);
if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

// ---- fake host services ----
const permissionsOf = (currentValue) => ({
  currentValue,
  options: [
    { value: "read-only", name: "read-only" },
    { value: "workspace-write", name: "workspace-write" },
    { value: "danger-full-access", name: "danger-full-access" },
  ],
});
const listSnapshot = {
  ids: ["s1", "s2"],
  byId: {
    s1: { id: "s1", displayTitle: "Session A", running: true, cwd: "H:/work/a", projectionValues: { permissions: permissionsOf("workspace-write") } },
    s2: { id: "s2", displayTitle: "Session B", running: false, cwd: "H:/work/b", projectionValues: { permissions: permissionsOf("read-only") } },
  },
  current: "s1",
  phase: "ready",
};
const sessions = {
  list: { subscribe: () => () => {}, getSnapshot: () => listSnapshot },
  binding: () => ({ session: { command: async (line) => { commandCalls.push(line); return { ok: true, value: { matched: true } }; } } }),
  refresh: async () => {},
  subagentAddress: () => undefined,
};
const settingsView = {
  writable: true,
  namespaces: [{ ns: "permission", revision: 1, schema: {}, value: { defaultPreset: "workspace-write" } }],
};
const registrations = new Map();
const fakeScope = {
  settingsScope: {
    bind: () => ({ set: async () => {} }),
    describe: () => ({
      subscribe: () => () => {},
      ensure: async () => {},
      getSnapshot: () => ({ status: "ready", error: null, view: settingsView }),
      acceptView: () => {},
    }),
  },
  remote: { settings: { mutate: async (...args) => { mutateCalls.push(args); return { ok: true, value: settingsView }; } } },
  settingsSchema: {
    describe: () => ({ namespaces: [{ ns: "permission", schema: {} }] }),
    rehydrate: (value) => value,
    nodeAtPath: () => ({ type: "union", list: [
      { type: "const", value: "read-only" },
      { type: "const", value: "workspace-write" },
      { type: "const", value: "danger-full-access" },
    ] }),
  },
  sessions,
  slots: {
    inject: (name, factory) => factory(),
    register: (options, component) => { registrations.set(options.id, component); return () => {}; },
  },
};
const ctx = {
  // Effects run their body immediately (this is how the plugin registers its
  // settings sections); the returned disposer is what gets kept.
  effect: (body) => {
    const dispose = body();
    return typeof dispose === "function" ? dispose : () => {};
  },
  inject: (names, callback) => { callback(fakeScope); },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: fakeScope.slots,
  get: () => undefined,
};

const plugin = captured.factory(requireStub);
plugin.apply(ctx);

// The panel resolves preset labels through this plugin's OWN dictionary, so the
// harness translator mirrors just those entries. Everything else stays a key.
const PRESET_LABELS = {
  wpPresetReadOnly: "read-only",
  wpPresetWorkspaceWrite: "workspace-write",
  wpPresetFullAccess: "danger-full-access",
  wpCustom: "Custom",
  wpUnavailable: "Unavailable",
};
const translate = (key) => PRESET_LABELS[key] ?? key;

const Panel = registrations.get("workspace-permissions");
if (Panel === undefined) throw new Error("workspace-permissions section was never registered");

// ---- renderer: expands function components exactly like React does ----
const dropdownOwners = [];
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
    if (typeof node.type.name === "string" && node.type.name.length > 0) dropdownOwners.push({ owner: hookOwner, name: node.type.name });
    const rendered = renderNode(node.type({ ...node.props, children }));
    hookOwner = previousOwner;
    return rendered;
  }
  return { ...node, children };
};
const childList = (node) => (Array.isArray(node.children) ? node.children : node.children === undefined ? [] : [node.children]);
const explain = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(explain).join(" ");
  if (typeof node !== "object") return "";
  return childList(node).map(explain).join(" ");
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
const optionNamed = (node, label) => collect(node, (entry) => entry.props?.role === "option").find((option) => explain(option).includes(label));
const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };

// Render once, then re-render with one PresetDropdown's open/pos hooks scripted
// (what clicking its trigger does in the live UI).
// Render one pass. `clearFirst` wipes the hook store, which is what the tests
// want for a fresh mount; stateful flows (opening the confirmation, ticking its
// checkbox, confirming) re-render with clearFirst=false so the state survives,
// the way React preserves it.
const renderOnce = (clearFirst) => {
  // The second pass must PRESERVE the scripted open/pos slots, otherwise the
  // dropdown the harness just opened is silently reset.
  if (clearFirst) hookSlots.clear();
  ownerCounter = 0;
  dropdownOwners.length = 0;
  hookOwner = "c" + (++ownerCounter);
  hookSlot = 0;
  const tree = renderNode(Panel({ t: translate }));
  // Drain queued effects so the panel's mount load() runs, like React does.
  const effects = pendingEffects.splice(0, pendingEffects.length);
  for (const effect of effects) {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  }
  return tree;
};

const renderPanel = (openIndex) => {
  renderOnce(true);
  const target = dropdownOwners.filter((entry) => entry.name === "PresetDropdown")[openIndex];
  if (target === undefined) throw new Error("no PresetDropdown instance at index " + openIndex + " (saw " + dropdownOwners.map((entry) => entry.name).join(",") + ")");
  hookSlots.set(target.owner + "#0", { value: true });
  hookSlots.set(target.owner + "#1", { value: { left: 10, top: 10 } });
  const tree = renderOnce(false);
  // The layout effect only ever calls setPos when a DOM button is measurable,
  // which this headless harness has no way to provide — so keep the scripted
  // placement (that is the state a real click settles into).
  hookSlots.set(target.owner + "#1", { value: { left: 10, top: 10 } });
  return tree;
};
const cleanups = [];

// Dropdown render order after the default card: index 0 = new-session default,
// index 1 = first session row ("Session A" sorts before "Session B").
const DEFAULT_DROPDOWN = 0;
const ROW_A_DROPDOWN = 1;

// Open one PresetDropdown across a re-render, exactly as renderPanel scripts it.
// Both slots are needed: the menu only renders when open AND pos is non-null, and
// a headless harness cannot measure the trigger to place it.
const openDropdown = (index) => {
  const target = dropdownOwners.filter((entry) => entry.name === "PresetDropdown")[index];
  if (target === undefined) throw new Error("no PresetDropdown at index " + index);
  hookSlots.set(target.owner + "#0", { value: true });
  hookSlots.set(target.owner + "#1", { value: { left: 10, top: 10 } });
  const tree = renderOnce(false);
  hookSlots.set(target.owner + "#1", { value: { left: 10, top: 10 } });
  return tree;
};

(async () => {
  // Settle the panel's async settings-mirror load first: the default dropdown
  // only publishes options once the mirror reports a ready namespace.
  renderPanel(0);
  await flush();

  // ---- case 1: the new-session default dropdown renders OPEN (portal path) ----
  portalCalls.length = 0;
  renderPanel(DEFAULT_DROPDOWN);
  if (portalCalls.length === 0) throw new Error("case 1: opening the default dropdown never rendered a portal");
  if (portalCalls.some((container) => container !== global.document.body)) throw new Error("case 1: portal mounted outside document.body");

  // ---- case 2: a session row dropdown renders OPEN too ----
  portalCalls.length = 0;
  const tree = renderPanel(ROW_A_DROPDOWN);
  if (portalCalls.length === 0) throw new Error("case 2: a row dropdown never rendered a portal");
  if (portalCalls.some((container) => container !== global.document.body)) throw new Error("case 2: portal mounted outside document.body");

  // ---- case 3/4: clicking presets on a session row ----
  const rows = collect(tree, (entry) => entry.props?.className === "dshk-wpRow");
  if (rows.length !== 2) throw new Error("case 3: expected 2 session rows, saw " + rows.length);
  const rowA = rows.find((row) => explain(row).includes("Session A"));
  if (rowA === undefined) throw new Error("case 3: Session A row not found");
  const readOnly = optionNamed(rowA, "read-only");
  if (readOnly === undefined) throw new Error("case 3: no read-only option rendered on the Session A row");
  readOnly.props.onClick();
  // Full access must route through the confirmation gate, never straight out.
  const fullAccess = optionNamed(rowA, "danger-full-access");
  fullAccess.props.onClick();
  await flush();
  if (commandCalls.length !== 1 || commandCalls[0] !== "/permission read-only") {
    throw new Error("case 3/4: expected exactly one '/permission read-only' call (Full access must not fire), saw " + JSON.stringify(commandCalls));
  }

  // ---- case 5: the default-preset write goes through the settings mutate path ----
  await flush();
  const defaultTree = renderPanel(DEFAULT_DROPDOWN);
  const cards = collect(defaultTree, (entry) => entry.props?.className === "dshk-card");
  const defaultPick = optionNamed(cards[0], "read-only");
  if (defaultPick === undefined) throw new Error("case 5: default dropdown rendered no options");
  defaultPick.props.onClick();
  await flush();
  if (mutateCalls.length !== 1) throw new Error("case 5: default preset never reached remote.settings.mutate");
  if (mutateCalls[0][0] !== "permission") throw new Error("case 5: unexpected settings namespace " + JSON.stringify(mutateCalls[0][0]));
  const ops = mutateCalls[0][1];
  if (ops[0].path[0] !== "defaultPreset" || ops[0].value !== "read-only") throw new Error("case 5: unexpected settings op " + JSON.stringify(ops));
  if (mutateCalls[0][2] !== 1) throw new Error("case 5: expected the descriptor revision to ride along");

  // ---- case 6: confirming Full access actually applies it (once) ----
  // The confirmation handler used to call switchSession() again, which
  // re-detected "full access from a non-full-access session" - row.current has not
  // changed yet - and reopened the very dialog just confirmed. The preset was
  // never sent, only re-confirmed forever.
  commandCalls.length = 0;
  portalCalls.length = 0;
  hookSlots.clear();
  let gateTree = renderOnce(true);
  await flush();
  const gateRows = collect(gateTree, (entry) => entry.props?.className === "dshk-wpRow");
  const gateRowA = gateRows.find((row) => explain(row).includes("Session A"));
  if (gateRowA === undefined) throw new Error("case 6: Session A row not found");
  // Open the row's dropdown and pick Full access -> this must raise the gate.
  gateTree = openDropdown(1);
  const gateRowAOpen = collect(gateTree, (entry) => entry.props?.className === "dshk-wpRow").find((row) => explain(row).includes("Session A"));
  const fullOption = optionNamed(gateRowAOpen, "danger-full-access");
  if (fullOption === undefined) throw new Error("case 6: no Full access option on the Session A row");
  // Portal calls so far: the row dropdown that is still open. The gate must add one more.
  const gatePortalsBefore = portalCalls.length;
  fullOption.props.onClick();
  gateTree = renderOnce(false);
  await flush();
  if (commandCalls.length !== 0) throw new Error("case 6: Full access fired without confirmation, saw " + JSON.stringify(commandCalls));
  const modal = collect(gateTree, (entry) => entry.props?.className === "dshk-modal")[0];
  if (modal === undefined) throw new Error("case 6: picking Full access did not raise the confirmation");

  // ---- case 7: the confirmation is a CENTERED MODAL, not a card in the list ----
  // It used to render as a dshk-card in the panel flow, i.e. AFTER the whole
  // session list, so a long list forced the user to scroll to the bottom to find
  // the dialog they had just triggered.
  if (collect(gateTree, (entry) => entry.props?.className === "dshk-overlay").length !== 1) {
    throw new Error("case 7: the confirmation is not rendered as a fixed overlay");
  }
  if (collect(modal, (entry) => entry.props?.className === "dshk-card").length !== 0) {
    throw new Error("case 7: the confirmation is still a panel card (it would sit below the list)");
  }
  if (modal.props?.role !== "dialog" || modal.props?.["aria-modal"] !== "true") {
    throw new Error("case 7: the confirmation is not exposed as a modal dialog");
  }
  // The overlay must be a PORTAL to <body>. renderNode flattens portals into their
  // children, so class names alone cannot tell a portalled dialog from one rendered
  // inline at the end of the panel flow - and escaping that flow is the whole point.
  if (portalCalls.length !== gatePortalsBefore + 1) {
    throw new Error("case 7: the confirmation was not portalled; portal calls went " + gatePortalsBefore + " -> " + portalCalls.length);
  }
  if (portalCalls[portalCalls.length - 1] !== global.document.body) {
    throw new Error("case 7: the confirmation portal did not mount on document.body");
  }
  // The overlay is a portal, so the only proof available here is the portal call
  // itself: renderNode flattens portals into their children.
  const ack = collect(modal, (entry) => entry.props?.type === "checkbox")[0];
  if (ack === undefined) throw new Error("case 7: the confirmation has no acknowledgement checkbox");
  const confirmBtn = collect(modal, (entry) => typeof entry.props?.onClick === "function" && explain(entry).includes("confirmEnable"))[0];
  if (confirmBtn === undefined) throw new Error("case 7: the confirmation has no enable button");
  if (confirmBtn.props.disabled !== true) throw new Error("case 7: the enable button is not gated on the acknowledgement");

  // ---- case 8: acknowledging then confirming sends Full access exactly once ----
  ack.props.onChange({ target: { checked: true } });
  gateTree = renderOnce(false);
  const modal2 = collect(gateTree, (entry) => entry.props?.className === "dshk-modal")[0];
  const confirmBtn2 = collect(modal2, (entry) => typeof entry.props?.onClick === "function" && explain(entry).includes("confirmEnable"))[0];
  if (confirmBtn2.props.disabled === true) throw new Error("case 8: the enable button stayed disabled after acknowledging");
  confirmBtn2.props.onClick();
  await flush();
  if (commandCalls.length !== 1 || commandCalls[0] !== "/permission danger-full-access") {
    throw new Error("case 8: confirming Full access did not apply it exactly once, saw " + JSON.stringify(commandCalls));
  }
  gateTree = renderOnce(false);
  if (collect(gateTree, (entry) => entry.props?.className === "dshk-modal").length !== 0) {
    throw new Error("case 8: the confirmation stayed open after being confirmed");
  }

  // ---- case 9: Escape closes the centered modal ----
  hookSlots.clear();
  let escTree = renderOnce(true);
  await flush();
  escTree = openDropdown(1);
  const escRow = collect(escTree, (entry) => entry.props?.className === "dshk-wpRow").find((row) => explain(row).includes("Session A"));
  optionNamed(escRow, "danger-full-access").props.onClick();
  escTree = renderOnce(false);
  if (collect(escTree, (entry) => entry.props?.className === "dshk-modal").length !== 1) {
    throw new Error("case 9: the confirmation did not open");
  }
  if (keydownListeners.length === 0) throw new Error("case 9: the modal registers no key handler");
  for (const listener of keydownListeners.slice()) listener({ key: "Escape" });
  escTree = renderOnce(false);
  if (collect(escTree, (entry) => entry.props?.className === "dshk-modal").length !== 0) {
    throw new Error("case 9: Escape did not close the confirmation");
  }

  console.log(
    "smoke ok: portals=" + portalCalls.length +
    " commands=" + JSON.stringify(commandCalls) +
    " settings=" + JSON.stringify(mutateCalls[0][1]),
  );
})().catch((error) => {
  console.error("smoke FAILED:", error.message);
  process.exit(1);
});
