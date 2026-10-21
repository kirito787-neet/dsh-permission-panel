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
/*
 * The Host's live permission state per Session, as the panel would see it
 * through a cold read. This is deliberately a MUTABLE map, not constants:
 * `commands.execute` writes here when it accepts `/permission <preset>`, so a
 * later projection read returns the new value the way the real Host would.
 * Without that loop the suite could not tell "re-read and show the truth" from
 * "show the value I optimistically recorded after my own command".
 */
const hostPresets = new Map([["s1", "workspace-write"], ["s2", "read-only"]]);
const hostTitles = new Map([["s1", "Session A"], ["s2", "Session B"]]);

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
       *
       * The answer is PER SESSION, not one canned row: the current-policy card
       * shows the value this read returned, so a stub that answered "Session B"
       * for every id would make the card prove nothing.
       */
      projections: async (request) => {
        projectionReads.push(request.sessionId);
        const values = { title: hostTitles.get(request.sessionId) ?? request.sessionId };
        const preset = hostPresets.get(request.sessionId);
        if (preset !== undefined) values.permissions = permissionsOf(preset);
        return { ok: true, value: { kind: "sequenced", asOfSeq: 1, values } };
      },
    },
    /*
     * The archive set AND the Workspace rows arrive on the same stream.
     *
     * Two Workspaces with one member each, so grouping is real: a flat list would
     * hide a regression where `workspace.sessionIds` is ignored (the grouping has
     * to come from that authoritative membership relation, never from comparing
     * `cwd` strings). `s3` is archived and belongs to neither.
     */
    workspace: {
      follow: async function* (signal) {
        archiveSignals.push(signal);
        yield {
          type: "baseline",
          value: {
            items: [
              { workspaceId: "w1", path: "H:/work/a", title: "Alpha", sessionIds: ["s1"], createdAt: 1, updatedAt: 1 },
              { workspaceId: "w2", path: "H:/work/b", title: "Beta", sessionIds: ["s2"], createdAt: 2, updatedAt: 2 },
              /* Sole member is archived, so this Workspace has no manageable row and no heading. */
              { workspaceId: "w3", path: "H:/work/c", title: "Gamma", sessionIds: ["s3"], createdAt: 3, updatedAt: 3 },
            ],
            archivedSessionIds: ["s3"],
            pinnedSessionIds: [],
          },
        };
      },
    },
    /*
     * The slash-command surface the panel dispatches through.
     *
     * The first argument is a BARE Session id: `commands/execute` declares
     * `parameters[0] = { name: "agent", wire: "agentId", source: "lookup",
     * codec: SessionId }` with `jsonSchema: { type: "string" }`. An object here
     * is rejected by the gateway as
     * `wire field "agentId" failed boundary validation` before the handler runs.
     *
     * This stub therefore REJECTS an object the way the gateway does, instead of
     * accepting whatever it is handed. Accepting both shapes is what let the
     * object-form bug ship: the suite saw a recorded call and called it a pass.
     */
    commands: {
      execute: async (target, line) => {
        if (typeof target !== "string") {
          return { ok: false, error: { code: "gateway/input-invalid", message: "wire field \"agentId\" failed boundary validation" } };
        }
        commandCalls.push({ target, line });
        /*
         * Accepting `/permission <preset>` must actually change the Host state the
         * next cold read sees. Otherwise "the card re-reads after a switch" is
         * untestable: both a re-read and a stale echo would display the same text.
         */
        const match = /^\/permission (.+)$/u.exec(line);
        if (match !== null) hostPresets.set(target, match[1]);
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
    /*
     * `description` is the Host's own prose for what a preset means. The panel
     * is forbidden from inventing it (the sandbox/approval knobs have no client
     * wire), so the current-policy card can only quote this field — the fixture
     * supplies distinct text per preset so quoting is provable.
     */
    permissionPresets: {
      catalog: async () => ({
        ok: true,
        value: {
          options: [
            { value: "read-only", name: "read-only", description: "Reads only; no writes and no commands." },
            { value: "workspace-write", name: "workspace-write", description: "Writes inside the workspace; asks before leaving it." },
            { value: "danger-full-access", name: "danger-full-access", description: "Unrestricted writes and commands." },
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
  /*
   * The search/grouping templates the new toolbar renders. Same reason as above:
   * the suite has to read the RENDERED count, so the template must be resolved.
   */
  wpSearchCount: "{n} / {total} matching",
  wpSearchEmpty: "No matching sessions.",
  wpGroupCount: "{n} session(s)",
  wpSelectAllLabel: "Select all",
  wpSelectGroup: "Select every session in this workspace",
  wpSelectAll: "Select every manageable session",
  wpSelectAllVisible: "Select all {n} visible sessions",
  wpGroupEmptyHidden: "Workspaces with no manageable sessions hidden: {n}",
  wpCurrentRefresh: "Read again",
  /*
   * Default-collapsed controls. `wpExpandAll` / `wpCollapseAll` are read off the
   * fold-all button's face, `wpGroupSelected` off a folded group's header.
   */
  wpExpandAll: "Expand all",
  wpCollapseAll: "Collapse all",
  wpGroupSelected: "{n} selected",
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
  /*
   * Groups default to folded, so the row dropdowns only exist once the list is
   * unfolded. A real user clicks "Expand all" before picking a session preset;
   * the harness does the same instead of reaching into component state.
   */
  const expandedTree = expandAll(renderOnce(true));
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

/*
 * Default-collapsed groups mean every case that wants to SEE rows must unfold
 * first — exactly what a user does. This helper clicks the toolbar's fold-all
 * button when it shows "Expand all" and returns the re-rendered tree.
 *
 * It is a no-op in flat mode (no workspaces), where nothing folds and the button
 * does not render at all, so callers need not branch.
 */
const expandAll = (tree) => {
  const button = collect(tree, (entry) => entry.props?.className?.includes?.("dshk-wpFoldAll"))[0];
  if (button === undefined) return tree;
  if (!explain(button).includes("Expand all")) return tree;
  button.props.onClick();
  return renderOnce(false);
};

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
  if (commandCalls[0].target !== "s1") {
    throw new Error("case 3/4: the command was not addressed to the clicked session by id; saw target=" + JSON.stringify(commandCalls[0].target));
  }
  /* Snapshot before later cases clear the log (see the case 5 note). */
  const reportedCommands = commandCalls.slice();

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
  /*
   * Snapshot the recorder now: later cases clear these arrays to isolate their
   * own assertions, and the closing summary must report what each case ACTUALLY
   * observed rather than whatever the last case happened to leave behind.
   */
  const reportedSettingsOp = mutateCalls[0][1];

  // ---- case 6: confirming Full access actually applies it (once) ----
  // The confirmation handler used to call switchSession() again, which
  // re-detected "full access from a non-full-access session" - row.current has not
  // changed yet - and reopened the very dialog just confirmed. The preset was
  // never sent, only re-confirmed forever.
  commandCalls.length = 0;
  portalCalls.length = 0;
  hookSlots.clear();
  let gateTree = expandAll(renderOnce(true));
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
  /*
   * Uses Session B, not Session A: case 8 just switched Session A to Full
   * access and the panel now reflects the accepted preset, so picking Full
   * access on that row again is correctly a no-op and would raise no gate.
   * Session B is still at workspace-write, so this case exercises the gate
   * rather than the dropdown's "already selected" short circuit.
   */
  hookSlots.clear();
  let escTree = expandAll(renderOnce(true));
  await flush();
  escTree = openDropdown(2);
  const escRow = collect(escTree, (entry) => entry.props?.className === "dshk-wpRow").find((row) => explain(row).includes("Session B"));
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
  /* Snapshot before later cases clear the log (see the case 5 note). */
  const reportedProjectionReads = projectionReads.slice();
  sessionRows[1].projections = withValues;
  /* Put the catalog back to the hinted state the later cases expect. */
  const backFill = renderOnce(true);
  const refreshAgain = collect(backFill, (entry) => entry.type === "button" && explain(entry).includes("wpRefresh"))[0];
  if (refreshAgain !== undefined) refreshAgain.props.onClick();
  await flush();

  // ---- case 11: bulk select + one-click apply ----
  hookSlots.clear();
  let bulkTree = expandAll(renderOnce(true));
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
  const bulkTargets = commandCalls.map((call) => call.target).sort();
  if (bulkTargets.length !== 1 || bulkTargets[0] !== "s1") {
    throw new Error("case 11: bulk apply must touch exactly the ticked session (s1); saw " + JSON.stringify(commandCalls));
  }
  if (commandCalls[0].line !== "/permission read-only") {
    throw new Error("case 11: bulk apply sent the wrong command; saw " + JSON.stringify(commandCalls[0].line));
  }
  /*
   * The bulk path must ALSO publish the accepted preset to the row. It has its
   * own copy of the dispatch loop, so fixing only the single-row path leaves a
   * batch apply reporting success while every touched row keeps its old value.
   * Asserted on the rendered rows, not on the recorder: the recorder only proves
   * the command went out, which was already true when the bug was live.
   */
  bulkTree = renderOnce(false);
  const bulkRowsAfter = collect(bulkTree, (entry) => entry.props?.className === "dshk-wpRow");
  const bulkRowA = bulkRowsAfter.find((row) => explain(row).includes("Session A"));
  if (bulkRowA === undefined) throw new Error("case 11: Session A row vanished after the bulk apply");
  if (!explain(bulkRowA).includes("read-only")) {
    throw new Error("case 11: the bulk apply reported success but the row kept its old preset; saw " + explain(bulkRowA));
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

  // ---- case 13: a switched session's row shows the ACCEPTED preset ----
  /*
   * The switch used to be fire-and-forget: the command went out, the toast said
   * "switched to …", and the row kept rendering the value the last cold read had
   * resolved. Nothing ever revisited the session — `ensureProjections` reads only
   * `idle` rows and `adoptSessionItems` leaves a hinted row `ready` — so the cell
   * showed the OLD preset until a page reload, which reads as "did it work?".
   *
   * Session B starts at workspace-write in this fixture. Switching it to
   * read-only must be reflected on the row without a refresh.
   */
  hookSlots.clear();
  commandCalls.length = 0;
  let reflectTree = expandAll(renderOnce(true));
  await flush();
  const rowFor = (tree, title) => collect(tree, (entry) => entry.props?.className === "dshk-wpRow").find((row) => explain(row).includes(title));
  let rowB = rowFor(reflectTree, "Session B");
  if (rowB === undefined) throw new Error("case 13: Session B row not found");
  if (!explain(rowB).includes("workspace-write")) {
    throw new Error("case 13: Session B did not start at workspace-write; saw " + explain(rowB));
  }
  reflectTree = openDropdown(2);
  rowB = rowFor(reflectTree, "Session B");
  if (rowB === undefined) throw new Error("case 13: Session B row vanished when its dropdown opened");
  const readOnlyPick = optionNamed(rowB, "read-only");
  if (readOnlyPick === undefined) throw new Error("case 13: Session B's dropdown rendered no read-only option");
  /*
   * Cleared HERE, after the mount settled: earlier cases read s2 and their
   * records are still in the log. What this case is about is whether the
   * switch itself triggers a re-read.
   */
  projectionReads.length = 0;
  readOnlyPick.props.onClick();
  await flush();
  if (commandCalls.length !== 1 || commandCalls[0].line !== "/permission read-only" || commandCalls[0].target !== "s2") {
    throw new Error("case 13: the switch was not dispatched to Session B; saw " + JSON.stringify(commandCalls));
  }
  const afterSwitch = renderOnce(false);
  const rowBAfter = rowFor(afterSwitch, "Session B");
  if (rowBAfter === undefined) throw new Error("case 13: Session B row vanished after the switch");
  if (!explain(rowBAfter).includes("read-only")) {
    throw new Error("case 13: the row still shows the old preset after a successful switch; saw " + explain(rowBAfter));
  }
  if (explain(rowBAfter).includes("workspace-write")) {
    throw new Error("case 13: the row still renders the superseded preset; saw " + explain(rowBAfter));
  }
  // The value came from the accepted command, not from a re-read: no projection
  // may be fetched for a row that is already known.
  if (projectionReads.includes("s2")) {
    throw new Error("case 13: the row was re-read from the Host to learn its own accepted value; reads=" + JSON.stringify(projectionReads));
  }

  // ---- case 14: a refused RPC surfaces the Host's message, not "[object Object]" ----
  /*
   * A refused RPC does not arrive as an Error. `dispatchCommand` catches the
   * rejection and funnels it through `describe()`, which originally only knew
   * `Error` instances — so a plain `{ code, message }` refusal (the shape a
   * gateway rejection takes) rendered as the literal string "[object Object]"
   * under the session list instead of the Host's own explanation.
   *
   * Driven through the per-row switch because `problem` is component state: the
   * mount effect re-runs on every render in this harness, so a `panel.status`
   * based surface would race a concurrent reload, while the inline note does not.
   */
  hookSlots.clear();
  commandCalls.length = 0;
  const refusal = { code: "commands/rejected", message: "expected revision 1, found 2" };
  const originalExecute = fakeScope.remote.commands.execute;
  fakeScope.remote.commands.execute = async (target, line) => {
    if (typeof target !== "string") {
      return { ok: false, error: { code: "gateway/input-invalid", message: "wire field \"agentId\" failed boundary validation" } };
    }
    commandCalls.push({ target, line });
    throw refusal;
  };
  try {
    let refuseTree = expandAll(renderOnce(true));
    await flush();
    refuseTree = openDropdown(1);
    const refuseRow = collect(refuseTree, (entry) => entry.props?.className === "dshk-wpRow").find((row) => explain(row).includes("Session A"));
    if (refuseRow === undefined) throw new Error("case 14: Session A row not found");
    const rejectedPick = optionNamed(refuseRow, "workspace-write");
    if (rejectedPick === undefined) throw new Error("case 14: Session A's dropdown rendered no workspace-write option");
    rejectedPick.props.onClick();
    await flush();
    refuseTree = renderOnce(false);
    const note = collect(refuseTree, (entry) => entry.props?.className === "dshk-note")[0];
    if (note === undefined) throw new Error("case 14: a refused command reported nothing at all");
    const noteText = explain(note);
    if (noteText.includes("[object Object]")) {
      throw new Error("case 14: a refused command rendered the useless literal [object Object]; saw " + noteText);
    }
    if (!noteText.includes("expected revision 1, found 2")) {
      throw new Error("case 14: the Host's refusal message never reached the user; saw " + noteText);
    }
    if (!noteText.includes("wpSwitchFailed")) {
      throw new Error("case 14: the refusal was not reported as a failed permission switch; saw " + noteText);
    }
  } finally {
    fakeScope.remote.commands.execute = originalExecute;
  }

  // ---- case 15: a read-only document offers no write control ----
  /*
   * The official settings row refuses to write when the document is not writable
   * (`!state.writable` guard), and `permissionPanel.select()` now carries the
   * same guard. This case pins the USER-VISIBLE half of that contract: on a
   * locked document the default-preset selector is disabled, no write is
   * attempted by merely rendering, and no failure is reported for a write that
   * was never allowed to happen.
   *
   * The guard inside `select()` is NOT reachable from here — the disabled
   * trigger is exactly what keeps a click from reaching it — so this case does
   * not and cannot prove it. It is defence in depth for the risk gate, which
   * calls `select()` directly; a mutation of that guard leaves this case green.
   * Written down rather than implied, because a test that silently claims more
   * than it covers is worse than no test.
   */
  hookSlots.clear();
  mutateCalls.length = 0;
  settingsView.writable = false;
  try {
    renderOnce(true);
    await flush();
    const readOnlyTree = renderOnce(true);
    const readOnlyCard = collect(readOnlyTree, (entry) => entry.props?.className === "dshk-card")
      .find((card) => explain(card).includes("wpDefaultSection"));
    if (readOnlyCard === undefined) throw new Error("case 15: the default card disappeared");
    const readOnlyTrigger = collect(readOnlyCard, (entry) => entry.props?.className === "dshk-wpSelect")[0];
    if (readOnlyTrigger === undefined) throw new Error("case 15: the default preset selector disappeared");
    if (readOnlyTrigger.props.disabled !== true) {
      throw new Error("case 15: the default preset selector is offered on a read-only document");
    }
    if (mutateCalls.length !== 0) {
      throw new Error("case 15: a read-only document attempted a settings write; saw " + JSON.stringify(mutateCalls));
    }
    if (collect(readOnlyTree, (entry) => entry.props?.className === "dshk-note").length !== 0) {
      throw new Error("case 15: a read-only document reported a write failure it never attempted");
    }
  } finally {
    settingsView.writable = true;
  }

  // ---- case 16: the Session header button opens the panel in place ----
  /*
   * Reaching this panel used to require Settings → Plugins → 工作区权限 on every
   * single visit. The header now carries one button that opens the same panel
   * over the current Session, so the entry point stops being a three-step
   * digression.
   *
   * Rendered through the registered slot component itself rather than through
   * the settings page: this is a DIFFERENT registration (its own id, in the
   * conversation header rather than 'settings.section'), and the assertion that
   * matters is that the portalled panel is reachable from it.
   */
  const HeaderButton = registrations.get("dsh-permission-panel-button");
  if (HeaderButton === undefined) {
    throw new Error("case 16: the Session header never registered a permission-panel button");
  }
  /*
   * Measured RELATIVE to this baseline, not against zero: earlier cases open and
   * close the confirmation gate, and this harness never runs effect cleanups, so
   * their Escape listeners are still in the log. What this case can prove is
   * that the header button itself adds none.
   */
  const keydownBeforeHeader = keydownListeners.length;
  /*
   * The header entry keeps its own hook state across re-renders (open/closed), so
   * this case gets the same owner-reset discipline `renderOnce` applies — with
   * one deviation: `hookSlots` is wiped only on the FIRST pass. Wiping it on the
   * click's re-render would silently discard the `open` state the click just
   * wrote, and the portal assertion would fail for the wrong reason.
   */
  let firstHeaderPass = true;
  const renderHeader = () => {
    // Wipe stale slots from earlier cases so the mounted panel starts clean
    // (a leftover hook value could resurrect e.g. an open confirmation gate).
    if (firstHeaderPass) { hookSlots.clear(); firstHeaderPass = false; }
    dropdownOwners.length = 0;
    ownerCounter = 0;
    hookOwner = "c" + (++ownerCounter);
    hookSlot = 0;
    const tree = renderNode(HeaderButton({ t: translate, sessionId: "s1" }));
    for (const effect of pendingEffects.splice(0, pendingEffects.length)) {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
    return tree;
  };
  let headerTree = renderHeader();
  const openButton = collect(headerTree, (entry) => entry.props?.className?.includes("dshk-wpEntry"))[0];
  if (openButton === undefined) {
    throw new Error("case 16: the header button rendered no entry control; saw " + explain(headerTree));
  }
  if (openButton.props.disabled === true) {
    throw new Error("case 16: the header button is disabled, so the panel is unreachable");
  }
  /*
   * `portalCalls` is the only channel this harness has for "something reached
   * document.body": `createPortal` records its container and drops the children.
   * Recording the baseline here proves the panel mounted BECAUSE of the click,
   * not as a side effect of some earlier case.
   */
  const portalsBeforeClick = portalCalls.length;
  openButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
  headerTree = renderHeader();
  if (portalCalls.length <= portalsBeforeClick) {
    throw new Error("case 16: clicking the header button opened nothing on document.body");
  }
  if (portalCalls[portalCalls.length - 1] !== fakeBody) {
    throw new Error("case 16: the panel portal landed on something other than document.body");
  }
  /*
   * A panel that opens and cannot close traps the user in it. Closed through the
   * same portalled surface it opened through.
   */
  const closeControl = collect(headerTree, (entry) => entry.props?.className?.includes("dshk-wpClose"))[0];
  if (closeControl === undefined) {
    throw new Error("case 16: the opened panel offers no way to close it");
  }
  const portalsBeforeClose = portalCalls.length;
  closeControl.props.onClick({ preventDefault() {}, stopPropagation() {} });
  headerTree = renderHeader();
  if (portalCalls.length !== portalsBeforeClose) {
    throw new Error("case 16: closing the panel re-opened it; the overlay never went away");
  }
  /*
   * The header lives on EVERY Session, so an unguarded render would install a
   * document listener per frame. `platform.cjs` asserts no global keydown
   * listener exists at load; this asserts the closed state adds none either.
   */
  if (keydownListeners.length !== keydownBeforeHeader) {
    throw new Error("case 16: the closed header button added " + (keydownListeners.length - keydownBeforeHeader) + " keydown listener(s)");
  }

  // ---- case 17: the current session's effective policy is displayed ----
  /*
   * The user asked to SEE what is actually in effect, because a changed preset
   * otherwise only shows up as "I clicked something and I hope it worked".
   *
   * This case opens the Session-header entry for `s1` and asserts two separate
   * facts: the card names the Session and its preset, and it carries the Host's
   * own policy prose. The prose can only come from the catalog Remote (the
   * sandbox/approval knobs have no wire), so a value invented locally fails here.
   */
  hookSlots.clear();
  firstHeaderPass = false;
  projectionReads.length = 0;
  /*
   * Put the Host on a value the list hint does NOT carry: `s1`'s list row says
   * `workspace-write`, while the live Host state below says `danger-full-access`
   * (an earlier case already switched `s1` away from its original value). If the
   * card ever rendered the hint, an optimistic record, or a canned answer, the
   * preset and the description would disagree with this value.
   */
  hostPresets.set("s1", "danger-full-access");
  headerTree = renderHeader();
  await flush();
  const policyTrigger = collect(headerTree, (entry) => entry.props?.className?.includes("dshk-wpEntry"))[0];
  if (policyTrigger === undefined) throw new Error("case 17: the header button vanished");
  policyTrigger.props.onClick({ preventDefault() {}, stopPropagation() {} });
  /*
   * Two renders, deliberately. The first one runs the panel's effects, which
   * START the forced cold read; the answer arrives on a later microtask. A tree
   * captured before that settles is a photograph of the pre-read state — the
   * exact "stale value" the card exists to eliminate. Re-render after `flush`
   * so the assertions read what the user ends up seeing.
   */
  renderHeader();
  await flush();
  const policyTree = renderHeader();
  await flush();
  const policyCards = collect(policyTree, (entry) => entry.props?.className?.split(" ").includes("dshk-current"));
  const policyCard = policyCards[0];
  if (policyCard === undefined) {
    throw new Error("case 17: the panel for a Session rendered no current-policy card; saw " + JSON.stringify(explain(policyTree).slice(0, 400)));
  }
  const policyText = explain(policyCard);
  if (!policyText.includes("Session A")) {
    throw new Error("case 17: the current-policy card does not say which Session it describes; saw " + JSON.stringify(policyText));
  }
  if (!policyText.includes("danger-full-access")) {
    throw new Error("case 17: the current-policy card does not show the Session's real preset; saw " + JSON.stringify(policyText));
  }
  if (!policyText.includes("Unrestricted writes and commands")) {
    throw new Error("case 17: the current-policy card does not show the Host's policy description; saw " + JSON.stringify(policyText));
  }
  /*
   * A forced cold read is what makes the card evidence rather than echo: the
   * panel's own recorded value would survive a change made elsewhere. `s1` must
   * therefore appear in the projection reads even though its list hint already
   * carried a preset.
   */
  if (!projectionReads.includes("s1")) {
    throw new Error("case 17: the panel never re-read the shown Session's projection; saw " + JSON.stringify(projectionReads));
  }
  /* Close it again so later cases start from the collapsed header button. */
  const policyClose = collect(policyTree, (entry) => entry.props?.className?.includes("dshk-wpClose"))[0];
  if (policyClose !== undefined) policyClose.props.onClick({ preventDefault() {}, stopPropagation() {} });
  headerTree = renderHeader();

  // ---- case 18: search filters rows and reports the count ----
  /*
   * Two rows fit on screen; a real user has dozens. Search must narrow the LIST
   * (not just highlight), and the heading must say how many matched, because a
   * filtered list that still claims "2" is indistinguishable from a broken filter.
   */
  hookSlots.clear();
  let searchTree = expandAll(renderOnce(true));
  await flush();
  const searchBox = () => collect(searchTree, (entry) => entry.props?.className === "dshk-wpSearch")[0];
  if (searchBox() === undefined) throw new Error("case 18: the session list has no search box");
  searchBox().props.onChange({ target: { value: "session b" } });
  searchTree = renderOnce(false);
  const matchedRows = collect(searchTree, (entry) => entry.props?.className === "dshk-wpRow");
  if (matchedRows.length !== 1 || !explain(matchedRows[0]).includes("Session B")) {
    throw new Error("case 18: searching for 'session b' did not narrow the list to Session B; saw " + JSON.stringify(matchedRows.map(explain)));
  }
  if (!explain(searchTree).includes("1 / 2 matching")) {
    throw new Error("case 18: the heading does not report the match count; saw " + JSON.stringify(explain(searchTree).slice(0, 400)));
  }
  /*
   * A query that matches nothing must say so. Rendering an empty list under a
   * heading that still counts rows is the failure mode users read as "it broke".
   */
  searchBox().props.onChange({ target: { value: "no such session" } });
  searchTree = renderOnce(false);
  if (!explain(searchTree).includes("No matching sessions")) {
    throw new Error("case 18: an empty search result rendered no explanation");
  }
  searchBox().props.onChange({ target: { value: "" } });
  searchTree = renderOnce(false);
  if (collect(searchTree, (entry) => entry.props?.className === "dshk-wpRow").length !== 2) {
    throw new Error("case 18: clearing the search did not restore every row");
  }

  // ---- case 19: select-all covers exactly the visible rows ----
  /*
   * The complaint was "clicking one by one until my hand cramps". Select-all
   * therefore has to be one click, and its EFFECT must be scoped to the rows on
   * screen: under a filter it may only ever write the matches.
   *
   * Note what this case does and does not prove. The panel enforces the scoping
   * twice — the control is handed the visible rows, and separately the effective
   * selection is intersected with the visible set on every read. Because of that
   * redundancy, a mutation that wires the control to the unfiltered list is NOT
   * observable here (the intersection masks it), and this case must not pretend
   * otherwise. What it pins down is the guarantee the user cares about: a hidden
   * Session is never part of a bulk write, in either order of filtering and
   * selecting.
   */
  hookSlots.clear();
  let allTree = expandAll(renderOnce(true));
  await flush();
  const selectAllBox = () => collect(allTree, (entry) => entry.props?.className === "dshk-pickAll")[0];
  const searchInput = () => collect(allTree, (entry) => entry.props?.className === "dshk-wpSearch")[0];
  if (selectAllBox() === undefined) throw new Error("case 19: the list has no select-all control");
  selectAllBox().props.onChange();
  allTree = renderOnce(false);
  const allBar = collect(allTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (allBar === undefined) throw new Error("case 19: select-all did not reveal the bulk bar");
  if (!/\b2\b/u.test(explain(allBar))) {
    throw new Error("case 19: select-all did not claim both rows; saw " + JSON.stringify(explain(allBar)));
  }
  /* Selecting everything, then filtering: the count has to fall with the list. */
  searchInput().props.onChange({ target: { value: "session a" } });
  allTree = renderOnce(false);
  const filteredBar = collect(allTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (filteredBar === undefined) {
    throw new Error("case 19: filtering away a selected row dropped the whole selection instead of pruning it");
  }
  if (!/\b1\b/u.test(explain(filteredBar)) || /\b2\b/u.test(explain(filteredBar))) {
    throw new Error("case 19: the selection was not pruned to the visible rows; saw " + JSON.stringify(explain(filteredBar)));
  }
  /*
   * Clearing the filter must not resurface the tick that was hidden meanwhile.
   * An implementation that only intersects on read (and never drops the hidden
   * tick) still passes this, so this too is a guarantee test, not a mechanism
   * test — but it is the guarantee that stops "I filtered, selected, applied,
   * and it changed a Session I had filtered out".
   */
  searchInput().props.onChange({ target: { value: "" } });
  allTree = renderOnce(false);
  const clearedBar = collect(allTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (clearedBar === undefined) {
    throw new Error("case 19: clearing the filter dropped the selection entirely");
  }
  if (/\b2\b/u.test(explain(clearedBar))) {
    throw new Error("case 19: a filtered-away Session came back selected; saw " + JSON.stringify(explain(clearedBar)));
  }
  /*
   * Reset to an empty selection before the next phase. After clearing the filter
   * only one row is still ticked, so a single click on select-all ADDS the other
   * row (the control is "all on?" — not "empty?"), and a second click clears.
   */
  selectAllBox().props.onChange();
  allTree = renderOnce(false);
  selectAllBox().props.onChange();
  allTree = renderOnce(false);
  /* Filtering FIRST and selecting then: still only the visible row. */
  searchInput().props.onChange({ target: { value: "session a" } });
  allTree = renderOnce(false);
  if (collect(allTree, (entry) => entry.props?.className === "dshk-bulk").length !== 0) {
    throw new Error("case 19: the selection did not reset before the filter-first phase");
  }
  selectAllBox().props.onChange();
  allTree = renderOnce(false);
  const scopedBar = collect(allTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (scopedBar === undefined) throw new Error("case 19: select-all under a filter selected nothing");
  if (!/\b1\b/u.test(explain(scopedBar)) || /\b2\b/u.test(explain(scopedBar))) {
    throw new Error("case 19: select-all under a filter reached beyond the visible rows; saw " + JSON.stringify(explain(scopedBar)));
  }
  searchInput().props.onChange({ target: { value: "" } });
  allTree = renderOnce(false);
  selectAllBox().props.onChange(); // clear for the next case
  allTree = renderOnce(false);

  // ---- case 20: rows are grouped by Workspace, with its own select-all ----
  /*
   * Grouping is the third ask. The membership has to come from
   * `workspace.sessionIds` (the registry's owner relation), never from `cwd`:
   * the two disagree routinely and a cwd-derived heading would silently file a
   * session under the wrong Workspace.
   */
  hookSlots.clear();
  let groupTree = renderOnce(true);
  await flush();
  const groupHeads = collect(groupTree, (entry) => entry.props?.className === "dshk-wpGroupHead");
  if (groupHeads.length !== 2) {
    throw new Error("case 20: expected one heading per Workspace (2), saw " + groupHeads.length + ": " + JSON.stringify(groupHeads.map(explain)));
  }
  const alphaHead = groupHeads.find((head) => explain(head).includes("Alpha"));
  const betaHead = groupHeads.find((head) => explain(head).includes("Beta"));
  if (alphaHead === undefined || betaHead === undefined) {
    throw new Error("case 20: the group headings do not name their Workspaces; saw " + JSON.stringify(groupHeads.map(explain)));
  }
  if (!explain(alphaHead).includes("1")) {
    throw new Error("case 20: a group heading does not report its member count");
  }
  /*
   * Each group carries its own select-all, which is what makes "this whole
   * workspace" one click. Asserted by ticking Alpha's box and checking the bulk
   * bar counts exactly one session, not two.
   */
  const alphaBox = collect(alphaHead, (entry) => entry.props?.className === "dshk-pickAllGroup")[0];
  if (alphaBox === undefined) throw new Error("case 20: a group heading offers no group-level select-all");
  alphaBox.props.onChange();
  groupTree = renderOnce(false);
  const groupBar = collect(groupTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (groupBar === undefined) throw new Error("case 20: the group select-all did not reveal the bulk bar");
  if (!/\b1\b/u.test(explain(groupBar))) {
    throw new Error("case 20: the group select-all did not select exactly that group's member; saw " + JSON.stringify(explain(groupBar)));
  }
  /*
   * A Workspace whose only member is archived has nothing to show, so it gets no
   * heading — but the count must say so, or "my Gamma workspace disappeared" is
   * the only available reading. It is counted from the UNFILTERED rows, so typing
   * in the search box cannot inflate it.
   */
  const hiddenNote = collect(groupTree, (entry) => entry.props?.className === "dshk-wpState" && explain(entry).includes("Workspaces with no manageable sessions hidden"));
  if (hiddenNote.length !== 1) {
    throw new Error("case 20: the empty Workspace was dropped without saying so; saw " + JSON.stringify(hiddenNote.map(explain)));
  }
  if (!/\b1\b/u.test(explain(hiddenNote[0]))) {
    throw new Error("case 20: the hidden-Workspace note reports the wrong count; saw " + JSON.stringify(explain(hiddenNote[0])));
  }
  if (groupTree !== undefined && collect(groupTree, (entry) => entry.props?.className === "dshk-wpGroupTitle" && explain(entry).includes("Gamma")).length !== 0) {
    throw new Error("case 20: a Workspace with no manageable session still rendered a heading");
  }

  /*
   * ---- case 21: groups start FOLDED, and the list-wide fold control ----
   *
   * The fourth ask on top of grouping: a long list of Workspaces should open
   * compact. A first render must show the group HEADINGS (the map of what is
   * there) but no session rows at all — otherwise "default collapsed" is just a
   * chevron that happens not to be rotated.
   */
  hookSlots.clear();
  let foldTree = renderOnce(true);
  await flush();
  const collapsedHeads = collect(foldTree, (entry) => entry.props?.className === "dshk-wpGroupHead");
  if (collapsedHeads.length !== 2) {
    throw new Error("case 21: the collapsed list must still show every group heading; saw " + collapsedHeads.length);
  }
  if (collect(foldTree, (entry) => entry.props?.className === "dshk-wpRow").length !== 0) {
    throw new Error("case 21: session rows are expanded by default; groups must start folded");
  }
  const foldButton = () => collect(foldTree, (entry) => entry.props?.className?.includes?.("dshk-wpFoldAll"))[0];
  if (foldButton() === undefined) throw new Error("case 21: the toolbar offers no expand-all control");
  if (!explain(foldButton()).includes("Expand all")) {
    throw new Error("case 21: the fold control does not offer to expand a fully collapsed list; saw " + explain(foldButton()));
  }
  /* One click must reveal every session — ten Workspaces must not mean ten clicks. */
  foldButton().props.onClick();
  foldTree = renderOnce(false);
  if (collect(foldTree, (entry) => entry.props?.className === "dshk-wpRow").length !== 2) {
    throw new Error("case 21: expand-all did not reveal every session row");
  }
  /*
   * Ticks placed inside a group must survive folding it, and stay visible on the
   * header. Folding is a view operation; silently dropping the selection would
   * make the bulk bar's count unexplainable.
   */
  const foldBoxes = collect(foldTree, (entry) => entry.props?.className === "dshk-pick");
  if (foldBoxes.length !== 2) throw new Error("case 21: the expanded list offers no per-row selection");
  foldBoxes[0].props.onChange();
  foldTree = renderOnce(false);
  if (foldButton() === undefined || !explain(foldButton()).includes("Collapse all")) {
    throw new Error("case 21: the fold control does not offer to collapse an expanded list; saw " + explain(foldButton()));
  }
  foldButton().props.onClick();
  foldTree = renderOnce(false);
  if (collect(foldTree, (entry) => entry.props?.className === "dshk-wpRow").length !== 0) {
    throw new Error("case 21: collapse-all left session rows on screen");
  }
  const pickedHeads = collect(foldTree, (entry) => entry.props?.className === "dshk-wpGroupHead" && explain(entry).includes("1 selected"));
  if (pickedHeads.length !== 1) {
    throw new Error("case 21: folding a group hid how many of its sessions are selected; saw " + JSON.stringify(collect(foldTree, (entry) => entry.props?.className === "dshk-wpGroupHead").map(explain)));
  }
  const foldedBar = collect(foldTree, (entry) => entry.props?.className === "dshk-bulk")[0];
  if (foldedBar === undefined || !/\b1\b/u.test(explain(foldedBar))) {
    throw new Error("case 21: folding dropped the selection instead of keeping it; saw " + (foldedBar === undefined ? "no bulk bar" : JSON.stringify(explain(foldedBar))));
  }

  console.log(
    "smoke ok: portals=" + portalCalls.length +
    " commands=" + JSON.stringify(reportedCommands) +
    " settings=" + JSON.stringify(reportedSettingsOp) +
    " projections-read=" + JSON.stringify(reportedProjectionReads) +
    " bulk=" + JSON.stringify(bulkTargets),
  );
})().catch((error) => {
  console.error("smoke FAILED:", error.message);
  process.exit(1);
});
