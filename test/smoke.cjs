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
/** Every dispatched slash command as `{ id, line }`. */
const commandCalls = [];
const mutateCalls = [];
/** Sessions the panel asked the Host to read projections for. */
const projectionReads = [];

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
  // Real React supports a LAZY initializer (`useState(() => x)`). The stub used
  // to store the function itself, so a component that initialized a Set that way
  // rendered a function where a Set belonged. Model the real contract.
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

// ---- fake host services (0.2.1-rc.2 surface only) ----
//
// 0.2.1 removed the client `sessions.list` and `workspaces.list` snapshots and
// the `configForms`/`settingsSchema` services. The panel therefore reads:
//   - `remote.session.list({})`         → visible rows with projection hints
//   - `remote.workspace.follow(signal)` → archive set (baseline frame)
//   - `remote.session.projections(...)` → cold read for rows without hints
//   - `remote.commands.execute(...)`    → `/permission` dispatch
// A fixture that still served the removed snapshots would pass while the shipped
// plugin throws, which is the exact trap this suite exists to avoid.
const permissionsOf = (currentValue) => ({ currentValue });

/**
 * The visible Session rows.
 *
 * `s3` is archived (see the workspace baseline below) and is deliberately
 * WITHOUT a `permissions` value: if it carried one, the projection-read effect
 * would skip it as "already known" even when the archive filter was broken, and
 * the assertion that archived sessions are never read would pass vacuously.
 */
const sessionRows = [
  { agentAvailable: true, sessionId: "s1", updatedAt: 1, running: true, blank: false, cwd: "H:/work/a", projections: { kind: "cached", asOfSeq: 1, values: { title: "Session A", permissions: permissionsOf("workspace-write") } } },
  /*
   * Session B sits at the SAME preset Session A does, so a bulk apply that
   * ignored the selection would try to change it too and produce a second
   * dispatch. With Session B at `read-only` instead, an ignored selection would
   * skip it as a no-op and the defect would hide.
   */
  { agentAvailable: true, sessionId: "s2", updatedAt: 2, running: false, blank: false, cwd: "H:/work/b", projections: { kind: "cached", asOfSeq: 2, values: { title: "Session B", permissions: permissionsOf("workspace-write") } } },
  { agentAvailable: true, sessionId: "s3", updatedAt: 3, running: false, blank: false, cwd: "H:/work/c", projections: { kind: "cached", asOfSeq: 3, values: { title: "Session C" } } },
];
const sessionListCalls = [];
const archiveSignals = [];
const settingsView = {
  writable: true,
  namespaces: [{ ns: "permission", revision: 1, schema: {}, value: { defaultPreset: "workspace-write" } }],
};
const registrations = new Map();
/** Minimal cordis effect: run the body, keep its disposer. */
const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };
const fakeScope = {
  effect: runEffect,
  remote: {
    session: {
      list: async (request, signal) => {
        sessionListCalls.push({ request, signal });
        return { ok: true, value: { items: sessionRows } };
      },
      /*
       * A cold per-Session read. `s3` is archived, so the panel must never ask
       * for it; the fixture records every request so a regression is visible.
       */
      projections: async (request) => {
        projectionReads.push(request.sessionId);
        return { ok: true, value: { kind: "sequenced", asOfSeq: 1, values: { title: "Session B", permissions: permissionsOf("read-only") } } };
      },
    },
    /*
     * The archive set. `WorkspaceBaseline.archivedSessionIds` is the only field
     * this plugin reads; `follow` is an async stream that opens with a baseline.
     */
    workspace: {
      follow: async function* (signal) {
        archiveSignals.push(signal);
        yield { type: "baseline", value: { items: [], archivedSessionIds: ["s3"], pinnedSessionIds: [] } };
      },
    },
    /*
     * The slash-command surface the panel dispatches through. 0.2.1 types the
     * first argument as the receiving Agent (`{ id }`); the panel also retries
     * with the bare id on an older carrier. Recording both shapes is what lets
     * the suite assert the panel addressed the right session.
     */
    commands: {
      execute: async (target, line) => {
        commandCalls.push({ target, line });
        return { ok: true, value: { commandId: "c", result: { kind: "success" } } };
      },
    },
    // `remote.settings.describe` is how the panel reads the permission namespace.
    settings: {
      describe: async () => ({ ok: true, value: settingsView }),
      mutate: async (...args) => { mutateCalls.push(args); return { ok: true, value: settingsView.namespaces[0] }; },
      update: async () => ({ ok: true, value: settingsView.namespaces[0] }),
    },
    // The process-level preset catalog: the ONLY source of selectable presets.
    permissionPresets: {
      catalog: async () => ({
        ok: true,
        value: {
          options: [
            { value: "read-only", name: "read-only" },
            { value: "workspace-write", name: "workspace-write" },
            { value: "danger-full-access", name: "danger-full-access" },
          ],
          defaultOptions: [{ value: "read-only", name: "read-only" }],
          defaultPreset: "read-only",
        },
      }),
    },
  },
  shortcuts: { register: () => () => {} },
  slots: {
    inject: (name, factory) => { factory(); return () => {}; },
    register: (options, component) => { registrations.set(options.id, component); return () => {}; },
  },
};
const ctx = {
  // Effects run their body immediately (this is how the plugin registers its
  // settings sections); the returned disposer is what gets kept.
  effect: runEffect,
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
  /*
   * The bulk bar's count is a template, not a fixed string. Mirroring it here is
   * what lets the suite assert the number the user actually sees — asserting on
   * the raw key would pass for any count, including none.
   */
  wpSelectedCount: "{n} selected",
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
  /*
   * Exactly two rows from THREE sessions: `s3` ("Session C") is archived in the
   * workspaces stub, so the panel must skip it. The count is the archive guard —
   * a regression that drops the filter lists three rows here.
   */
  if (rows.length !== 2) {
    throw new Error("case 3: expected 2 session rows (s3 is archived and must be skipped), saw " + rows.length
      + ": " + JSON.stringify(rows.map((row) => explain(row))));
  }
  if (rows.some((row) => explain(row).includes("Session C"))) {
    throw new Error("case 3: the ARCHIVED session 'Session C' is listed; archived sessions must not be manageable here");
  }
  // The skip is reported, not silent: the user is told where the row went.
  if (!explain(tree).includes("wpArchivedSkipped")) {
    throw new Error("case 3: the panel did not report the skipped archived session");
  }
  const rowA = rows.find((row) => explain(row).includes("Session A"));
  if (rowA === undefined) throw new Error("case 3: Session A row not found");

  // ---- case 3a: session rows must be ACTIONABLE ----
  // This is the regression guard for the shipped bug where every row rendered
  // disabled. The panel derived each row's presets from
  // `projectionValues.permissions.options`, a field that does not exist on the
  // real `PermissionSelection` (it is `{ currentValue }`), so `capable` was
  // always false. Options now come from the process-level catalog Remote, and
  // this assertion fails loudly if that ever regresses.
  const rowATrigger = collect(rowA, (entry) => entry.props?.className === "dshk-wpSelect")[0];
  if (rowATrigger === undefined) throw new Error("case 3a: Session A has no preset selector");
  if (rowATrigger.props.disabled === true) {
    throw new Error("case 3a: the Session A preset selector is DISABLED - permission management is unavailable to the user");
  }

  const readOnly = optionNamed(rowA, "read-only");
  if (readOnly === undefined) throw new Error("case 3: no read-only option rendered on the Session A row");
  readOnly.props.onClick();
  // Full access must route through the confirmation gate, never straight out.
  const fullAccess = optionNamed(rowA, "danger-full-access");
  fullAccess.props.onClick();
  await flush();
  if (commandCalls.length !== 1 || commandCalls[0].line !== "/permission read-only") {
    throw new Error("case 3/4: expected exactly one '/permission read-only' call (Full access must not fire), saw " + JSON.stringify(commandCalls));
  }
  /*
   * The command must be addressed to THE SESSION THE USER CLICKED, by id. This is
   * the assertion that the panel no longer routes through a client-side binding:
   * `sessions.binding()` returns undefined in this fixture (as it does for any
   * unopened session), so a regression to that path fails here rather than in the
   * user's browser as "该会话暂时无法下发指令（尚未装载）".
   */
  if (commandCalls[0].target === null || typeof commandCalls[0].target !== "object" || commandCalls[0].target.id !== "s1") {
    throw new Error("case 3/4: the command was not addressed to the clicked session by id; saw target=" + JSON.stringify(commandCalls[0].target));
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
  if (commandCalls.length !== 1 || commandCalls[0].line !== "/permission danger-full-access") {
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

  // ---- case 10: rows without projection hints get their projections read ----
  /*
   * The list answer carries `projections.values` for s1/s2 in this fixture, so the
   * panel has nothing to fetch and this assertion would pass vacuously. The real
   * defect was a session with NO projection hint: the row had `current === null`,
   * so it rendered disabled and read as "不可用". Drop one session's hint and
   * assert the panel asks the Host for it instead of giving up.
   */
  const withValues = sessionRows[1].projections;
  delete sessionRows[1].projections;
  projectionReads.length = 0;
  hookSlots.clear();
  /*
   * The catalog is adopted from `remote.session.list` when the plugin activates
   * and re-read when the user asks for it, so dropping the hint alone changes
   * nothing: exercise the real refresh control, exactly as a user would.
   */
  const beforeRefresh = renderOnce(true);
  const refreshButton = collect(beforeRefresh, (entry) => entry.type === "button" && explain(entry).includes("wpRefresh"))[0];
  if (refreshButton === undefined) throw new Error("case 10: the panel rendered no refresh control");
  refreshButton.props.onClick();
  await flush();
  renderOnce(true);
  await flush();
  if (!projectionReads.includes("s2")) {
    throw new Error("case 10: a session with no permission projection was never read from the Host; reads=" + JSON.stringify(projectionReads));
  }
  if (projectionReads.includes("s3")) {
    throw new Error("case 10: the ARCHIVED session's projection was read; archived sessions are not managed here");
  }
  sessionRows[1].projections = withValues;
  /* Put the catalog back to the hinted state the later cases expect. */
  const backFill = renderOnce(true);
  const refreshAgain = collect(backFill, (entry) => entry.type === "button" && explain(entry).includes("wpRefresh"))[0];
  if (refreshAgain !== undefined) refreshAgain.props.onClick();
  await flush();

  // ---- case 11: bulk select + one-click apply ----
  hookSlots.clear();
  let bulkTree = renderOnce(true);
  await flush();
  const pickBoxes = () => collect(bulkTree, (entry) => entry.props?.className === "dshk-pick");
  if (pickBoxes().length !== 2) {
    throw new Error("case 11: expected a selection box on each of the 2 manageable rows, saw " + pickBoxes().length);
  }
  /*
   * Tick a STRICT SUBSET — one row of two.
   *
   * This matters. Ticking every row would make "selected" indistinguishable from
   * "all manageable rows", so a bulk implementation that ignored the selection and
   * targeted everything would pass. That is exactly what a first version of this
   * case did, and a mutation proved the assertion was worthless: dropping the
   * selection filter left the test green. One-of-two removes the ambiguity.
   *
   * The unticked row is left at a preset the bulk run would ALSO change, so an
   * unselected row appearing in the dispatch list is unambiguous evidence of the
   * defect rather than a no-op.
   */
  const boxes = pickBoxes();
  const boxFor = (title) => boxes.find((box) => explain(box).includes(title) || box.props["aria-label"]?.includes(title));
  const sessionABox = boxes[0];
  if (sessionABox === undefined) throw new Error("case 11: no selection box on the first row");
  sessionABox.props.onChange();
  bulkTree = renderOnce(false);
  const bulkBar = collect(bulkTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (bulkBar === undefined) throw new Error("case 11: ticking a row did not reveal the bulk bar");
  /*
   * The count must reflect the ONE row actually ticked, not the size of the list.
   * `wpSelectedCount` is rendered as the translated key here (the harness keeps
   * unknown keys literal), with the count substituted.
   */
  if (!explain(bulkBar).includes("selected")) {
    throw new Error("case 11: the bulk bar does not report how many sessions are selected");
  }
  if (!/\b1\b/u.test(explain(bulkBar))) {
    throw new Error("case 11: the bulk bar does not report the true selection size (expected 1); saw " + JSON.stringify(explain(bulkBar)));
  }
  /*
   * Apply must be inert until a preset is chosen: a bulk control that arrives
   * pre-armed would be one stray click away from rewriting every selected session.
   */
  const applyBtn = collect(bulkBar, (entry) => entry.props?.className?.includes("dshk-bulkApply"))[0];
  if (applyBtn === undefined) throw new Error("case 11: the bulk bar has no apply button");
  if (applyBtn.props.disabled !== true) {
    throw new Error("case 11: bulk Apply is enabled with no preset chosen; it must wait for an explicit choice");
  }
  // Choose the preset, then apply.
  commandCalls.length = 0;
  /*
   * The bulk bar's picker is identified through `dropdownOwners`, not by walking
   * the tree: `renderNode` EXPANDS function components, so the `PresetDropdown`
   * element no longer exists in the rendered output. Once rows are ticked the
   * bulk bar renders between the default card and the rows, making its picker
   * index 1 — and the row pickers shift up by one.
   */
  const bulkIndex = dropdownOwners.filter((entry) => entry.name === "PresetDropdown").length - 1 - 2;
  if (bulkIndex < 0) throw new Error("case 11: the bulk bar rendered no preset picker");
  /*
   * Drive it the way the harness drives any dropdown: open it, then click the
   * option. A bulk picker that cannot be opened is a bulk picker that cannot be
   * used, so this exercises the real path rather than poking props directly.
   */
  bulkTree = openDropdown(bulkIndex);
  const bulkMenuOption = optionNamed(bulkTree, "read-only");
  if (bulkMenuOption === undefined) {
    throw new Error("case 11: the bulk picker rendered no preset options");
  }
  bulkMenuOption.props.onClick();
  bulkTree = renderOnce(false);
  const bulkBar2 = collect(bulkTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (bulkBar2 === undefined) throw new Error("case 11: the bulk bar vanished after choosing a preset");
  const applyBtn2 = collect(bulkBar2, (entry) => entry.props?.className?.includes("dshk-bulkApply"))[0];
  if (applyBtn2.props.disabled === true) {
    throw new Error("case 11: bulk Apply stayed disabled after choosing a preset");
  }
  applyBtn2.props.onClick();
  await flush();
  /*
   * Exactly the TICKED session must be addressed, by id.
   *
   * The unticked row is left at workspace-write, which "read-only" would also
   * change — so if the implementation ignored the tick and targeted every row,
   * a second dispatch would appear here and this assertion would fail.
   */
  const bulkTargets = commandCalls.map((call) => (call.target !== null && typeof call.target === "object" ? call.target.id : call.target)).sort();
  if (bulkTargets.length !== 1 || bulkTargets[0] !== "s1") {
    throw new Error("case 11: bulk apply must touch exactly the ticked session (s1); saw " + JSON.stringify(commandCalls));
  }
  if (commandCalls[0].line !== "/permission read-only") {
    throw new Error("case 11: bulk apply sent the wrong command; saw " + JSON.stringify(commandCalls[0].line));
  }

  // ---- case 12: an ABSENT defaultPreset is not a broken deployment ----
  /*
   * `defaultPreset` is `z.string().volatile()` with neither `.required()` nor
   * `.default()`, and a volatile settings form only projects fields that hold a
   * value — so a user who never wrote a default gets `namespace.value === {}`.
   * The panel used to call that "permission settings has no defaultPreset value"
   * and render 默认权限加载失败 over a perfectly healthy deployment.
   *
   * The Host still derives an effective default (composition defaults folded
   * through `presets`) and publishes it as `catalog.defaultPreset`; that is the
   * documented fallback, and what the official settings row reads with `??`.
   * Emptying the namespace value is how this suite reproduces the shipped bug.
   */
  settingsView.namespaces[0].value = {};
  renderPanel(DEFAULT_DROPDOWN);
  await flush();
  const absentTree = renderOnce(false);
  const defaultCard = collect(absentTree, (entry) => entry.props?.className === "dshk-card")
    .find((card) => explain(card).includes("wpDefaultSection"));
  if (defaultCard === undefined) throw new Error("case 12: the new-session default card disappeared");
  const defaultHint = collect(defaultCard, (entry) => entry.props?.className === "dshk-hint")[0];
  if (defaultHint !== undefined && explain(defaultHint).includes("wpLoadFailed")) {
    throw new Error("case 12: an unset defaultPreset was reported as a load failure: " + explain(defaultHint));
  }
  const defaultTrigger = collect(defaultCard, (entry) => entry.props?.className === "dshk-wpSelect")[0];
  if (defaultTrigger === undefined) throw new Error("case 12: the default preset selector disappeared");
  if (explain(defaultTrigger).includes("wpUnavailable")) {
    throw new Error("case 12: the default preset reads as unavailable although the catalog advertises one: " + explain(defaultTrigger));
  }
  if (!explain(defaultTrigger).includes("read-only")) {
    throw new Error("case 12: the default preset did not fall back to catalog.defaultPreset; saw " + explain(defaultTrigger));
  }
  // Restore the fixture so the reported summary describes the normal path.
  settingsView.namespaces[0].value = { defaultPreset: "workspace-write" };

  console.log(
    "smoke ok: portals=" + portalCalls.length +
    " commands=" + JSON.stringify(commandCalls) +
    " settings=" + JSON.stringify(mutateCalls[0][1]) +
    " projections-read=" + JSON.stringify(projectionReads) +
    " bulk=" + JSON.stringify(bulkTargets),
  );
})().catch((error) => {
  console.error("smoke FAILED:", error.message);
  process.exit(1);
});
