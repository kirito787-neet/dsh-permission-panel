/**
 * Filter test for the workspace-permissions panel.
 *
 * Loads the real client.js through a stubbed module loader (fake react /
 * react-dom / document) and renders PermissionsSection, then drives the new
 * permission-level chips in the session-list toolbar.
 *
 * It guards the "filter sessions by permission level" feature:
 *   1. the chips are DERIVED from the current values actually present, with an
 *      「全部」 chip first and a 「未知/自定义」 bucket for null/custom values;
 *   2. picking 「完全权限」(danger-full-access) leaves only rows at that level;
 *   3. picking 「全部」 restores every row;
 *   4. the header count and each chip's count reflect the filter;
 *   5. an empty level shows the dedicated empty-state hint;
 *   6. a deployment whose catalog exposes only THREE presets (no `auto`) never
 *      crashes and grows no `auto` chip.
 *
 * A second activation runs against a 3-tier-only catalog to prove case 6.
 *
 * Usage: node test/filter.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

let captured = null;
const portalCalls = [];

// ---- document stub (render touches it only through the portal host) ----
const fakeBody = { nodeType: 1, appendChild() {}, removeChild() {}, contains: () => false };
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
const hookSlots = new Map();
let ownerCounter = 0;
let hookOwner = "root";
let hookSlot = 0;
const useState = (initial) => {
  const key = hookOwner + "#" + hookSlot++;
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
  useEffect: (body) => { pendingEffects.push(body); },
  useLayoutEffect: (body) => { pendingEffects.push(body); },
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "filter",
};
const pendingEffects = [];
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

// ---- load the plugin module ----
new Function("require", "window", "document", source)(requireStub, global.window, global.document);
if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

// ---- fake host services ----
const permissionsOf = (currentValue) => ({ currentValue });

/**
 * Build a fresh harness around ONE catalog + ONE set of session rows.
 *
 * Both are needed for case 6 (3-tier catalog), and rebuilding per activation is
 * also what keeps one case's hook state from leaking into the next.
 * @param options - `{ catalog, sessions, hostPresets }`
 */
function buildHarness(options) {
  const { catalog, sessions, hostPresets } = options;
  const sessionListCalls = [];

  const sessionRows = sessions.map((entry, index) => ({
    agentAvailable: true,
    sessionId: entry.id,
    updatedAt: index + 1,
    running: false,
    blank: false,
    cwd: entry.cwd ?? "H:/work/" + entry.id,
    projections: {
      kind: "cached",
      asOfSeq: index + 1,
      /*
       * Carry the permission hint inline, exactly as the real list snapshot does
       * for a checkpoint it has already read. Without it every row starts at
       * `current === null` and the level chips would all read as "Other" — i.e.
       * the fixture, not the feature, would decide the buckets.
       */
      values: { title: entry.title, permissions: permissionsOf(hostPresets.get(entry.id)) },
    },
  }));

  const workspaces = sessions.map((entry, index) => ({
    workspaceId: "w-" + entry.id,
    path: entry.cwd ?? "H:/work/" + entry.id,
    title: entry.workspace ?? entry.title,
    sessionIds: [entry.id],
    createdAt: index + 1,
    updatedAt: index + 1,
  }));

  const registrations = new Map();
  const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };
  const fakeScope = {
    effect: runEffect,
    remote: {
      session: {
        list: async (request, signal) => {
          sessionListCalls.push({ request, signal });
          return { ok: true, value: { items: sessionRows } };
        },
        projections: async (request) => {
          const values = { title: request.sessionId };
          const preset = hostPresets.get(request.sessionId);
          if (preset !== undefined) values.permissions = permissionsOf(preset);
          return { ok: true, value: { kind: "sequenced", asOfSeq: 1, values } };
        },
      },
      workspace: {
        follow: async function* () {
          yield {
            type: "baseline",
            value: { items: workspaces, archivedSessionIds: [], pinnedSessionIds: [] },
          };
        },
      },
      commands: {
        execute: async () => ({ ok: true, value: { commandId: "c", result: { kind: "success" } } }),
      },
      settings: {
        describe: async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: "permission", revision: 1, schema: {}, value: { defaultPreset: catalog[0].value } }] } }),
        mutate: async () => ({ ok: true, value: { ns: "permission", revision: 2, value: { defaultPreset: catalog[0].value } } }),
        update: async () => ({ ok: true, value: { ns: "permission", revision: 2, value: {} } }),
      },
      permissionPresets: {
        catalog: async () => ({ ok: true, value: { options: catalog.map((entry) => ({ value: entry.value, name: entry.value })), defaultOptions: [catalog[0]], defaultPreset: catalog[0].value } }),
      },
    },
    shortcuts: { register: () => () => {} },
    slots: {
      inject: (name, factory) => { factory(); return () => {}; },
      register: (options, component) => { registrations.set(options.id, component); return () => {}; },
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

  const Panel = registrations.get("workspace-permissions");
  if (Panel === undefined) throw new Error("workspace-permissions section was never registered");
  return { Panel, sessionListCalls };
}

// ---- dictionary mirror the panel resolves its labels through ----
const PRESET_LABELS = {
  wpPresetReadOnly: "read-only",
  wpPresetWorkspaceWrite: "workspace-write",
  wpPresetFullAccess: "danger-full-access",
  wpPresetAuto: "auto",
  wpCustom: "Custom",
  wpUnavailable: "Unavailable",
  wpFilterAll: "All",
  wpFilterOther: "Other",
  wpFilterEmpty: "No sessions with that permission level.",
  wpSearchEmpty: "No matching sessions.",
  wpSearchCount: "{n} / {total} matching",
  wpCount: "Sessions: ",
  wpSessionSection: "Session permissions",
  wpSelectAllLabel: "Select all",
  wpSelectAll: "Select every manageable session",
  wpSelectAllVisible: "Select all {n} visible sessions",
  wpSearchPlaceholder: "Search…",
  wpSearchClear: "Clear search",
  wpExpandAll: "Expand all",
  wpCollapseAll: "Collapse all",
  wpGroupCount: "{n} session(s)",
  wpGroupSelected: "{n} selected",
  wpSelectGroup: "Select every session in this workspace",
  wpGroupEmptyHidden: "Workspaces with no manageable sessions hidden: {n}",
  wpCurrentRefresh: "Read again",
};
const translate = (key) => PRESET_LABELS[key] ?? key;

// ---- renderer: expands function components exactly like React does ----
// `dropdownOwners` is filled during render; the four counters above are the
// globals the useState/render stubs close over and are reused here.
let dropdownOwners = [];
const cleanups = [];

const makeRenderer = (Panel) => {
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
  // Alias the shared hook-state globals the useState stub closes over.
  const renderOnce = (clearFirst) => {
    if (clearFirst) hookSlots.clear();
    ownerCounter = 0;
    dropdownOwners = [];
    hookOwner = "c" + (++ownerCounter);
    hookSlot = 0;
    const tree = renderNode(Panel({ t: translate }));
    const effects = pendingEffects.splice(0, pendingEffects.length);
    for (const effect of effects) {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
    return tree;
  };
  return { renderOnce };
};

// Shared tree helpers.
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
const flush = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
const byClass = (tree, className) => collect(tree, (entry) => typeof entry.props?.className === "string" && entry.props.className.split(" ").includes(className));
const chips = (tree) => collect(tree, (entry) => entry.type === "button" && typeof entry.props?.className === "string" && entry.props.className.split(" ").includes("dshk-wpFilter"));
const chipNamed = (tree, label) => chips(tree).find((chip) => explain(chip).includes(label));
const chipCountOf = (chip) => {
  const counter = collect(chip, (entry) => typeof entry.props?.className === "string" && entry.props.className.split(" ").includes("dshk-wpFilterCount"))[0];
  return counter === undefined ? undefined : explain(counter).trim();
};

/**
 * Two sessions at different levels, plus one `custom` row, so the buckets are:
 *   danger-full-access  → "Full row"
 *   read-only           → "Read row"
 *   other               → "Custom row" (current === "custom")
 * All three land in distinct Workspaces, so a filter that empties a Workspace
 * also exercises the drop-empty-group path.
 */
const THREE_TIER = [
  { value: "read-only" },
  { value: "workspace-write" },
  { value: "danger-full-access" },
];
const SESSIONS = [
  { id: "s-full", title: "Full row", workspace: "FullWS", cwd: "H:/work/full" },
  { id: "s-read", title: "Read row", workspace: "ReadWS", cwd: "H:/work/read" },
  { id: "s-custom", title: "Custom row", workspace: "CustomWS", cwd: "H:/work/custom" },
];
const HOST_PRESETS = new Map([["s-full", "danger-full-access"], ["s-read", "read-only"], ["s-custom", "custom"]]);

(async () => {
  // ---- activation 1: a three-preset deployment (no `auto`) ----
  const harness = buildHarness({ catalog: THREE_TIER, sessions: SESSIONS, hostPresets: HOST_PRESETS });
  const { renderOnce } = makeRenderer(harness.Panel);
  renderOnce(true);
  await flush();
  let tree = renderOnce(false);

  const allChips = chips(tree);
  if (allChips.length === 0) throw new Error("case 1: the permission-level filter rendered no chips");

  // case 1: 「全部」 is present and the chips are derived from actual values.
  const allChip = chipNamed(tree, "All");
  if (allChip === undefined) throw new Error("case 1: no 「全部 / All」 chip");
  if (chipNamed(tree, "danger-full-access") === undefined) throw new Error("case 1: no danger-full-access chip even though a row sits at that level");
  if (chipNamed(tree, "read-only") === undefined) throw new Error("case 1: no read-only chip even though a row sits at that level");
  if (chipNamed(tree, "Other") === undefined) throw new Error("case 1: no 「未知/自定义 / Other」 chip even though a custom row exists");
  if (chipNamed(tree, "auto") !== undefined) throw new Error("case 1: an `auto` chip appeared for a deployment that offers no `auto` preset");
  if (chipNamed(tree, "workspace-write") !== undefined) throw new Error("case 1: a workspace-write chip appeared although no row sits at that level");
  // Counts: 全部 = 3 rows, danger-full-access = 1, read-only = 1, Other = 1.
  if (chipCountOf(allChip) !== "3") throw new Error("case 1: 全部 chip count should be 3, saw " + JSON.stringify(chipCountOf(allChip)));
  if (chipCountOf(chipNamed(tree, "danger-full-access")) !== "1") throw new Error("case 1: danger-full-access chip count should be 1");
  if (chipCountOf(chipNamed(tree, "Other")) !== "1") throw new Error("case 1: Other chip count should be 1");

  const rowsOf = (t) => byClass(t, "dshk-wpRow");
  // Groups default collapsed AND the groups here are per-workspace (three of
  // them), so the rows live under closed headers. Expand all to see them.
  const expandButton = collect(tree, (entry) => typeof entry.props?.className === "string" && entry.props.className.includes("dshk-wpFoldAll"))[0];
  if (expandButton !== undefined && explain(expandButton).includes("Expand all")) {
    expandButton.props.onClick();
    tree = renderOnce(false);
  }
  const initialRows = rowsOf(tree);
  if (initialRows.length !== 3) {
    throw new Error("case 1: expected all 3 rows before filtering, saw " + initialRows.length + ": " + JSON.stringify(initialRows.map(explain)));
  }

  // case 2: pick 「完全权限」 → only the danger-full-access row survives.
  chipNamed(tree, "danger-full-access").props.onClick();
  tree = renderOnce(false);
  let filtered = rowsOf(tree);
  const filteredText = filtered.map(explain).join(" | ");
  if (filtered.length !== 1) throw new Error("case 2: filtering to danger-full-access should leave 1 row, saw " + filtered.length + ": " + filteredText);
  if (!filteredText.includes("Full row")) throw new Error("case 2: the surviving row is not the danger-full-access one: " + filteredText);
  if (filteredText.includes("Read row") || filteredText.includes("Custom row")) throw new Error("case 2: rows outside danger-full-access leaked through: " + filteredText);
  // The header count reflects the filter.
  const headText = explain(tree);
  if (!headText.includes("1 / 3 matching")) throw new Error("case 2: header did not switch to the filtered count (expected '1 / 3 matching'): " + headText);
  // The active chip is marked on.
  if (!chipNamed(tree, "danger-full-access").props.className.split(" ").includes("dshk-wpFilterOn")) throw new Error("case 2: the active chip is not marked on");
  if (chipNamed(tree, "All").props.className.split(" ").includes("dshk-wpFilterOn")) throw new Error("case 2: the 全部 chip stayed on while a level was active");

  // case 3: back to 「全部」 restores everything.
  chipNamed(tree, "All").props.onClick();
  tree = renderOnce(false);
  filtered = rowsOf(tree);
  if (filtered.length !== 3) throw new Error("case 3: choosing 全部 should restore all 3 rows, saw " + filtered.length);
  if (!chipNamed(tree, "All").props.className.split(" ").includes("dshk-wpFilterOn")) throw new Error("case 3: 全部 chip not marked on after restoring");

  /*
   * case 4: when nothing matches, the empty state names the LEVEL filter, not the
   * search box. The chips are derived from rows that exist, so a level with zero
   * rows has no chip — the honest way to reach a level-filtered empty list is
   * search + level (AND). Search for the danger-full-access row while the active
   * level is read-only: the two conditions exclude each other.
   */
  chipNamed(tree, "read-only").props.onClick();
  tree = renderOnce(false);
  if (rowsOf(tree).length !== 1) throw new Error("case 4: read-only filter should leave 1 row");
  const search = byClass(tree, "dshk-wpSearch")[0];
  if (search === undefined) throw new Error("case 4: no search box in the toolbar");
  search.props.onChange({ target: { value: "Full row" } });
  tree = renderOnce(false);
  if (rowsOf(tree).length !== 0) throw new Error("case 4: search 'Full row' AND level read-only must leave no rows, saw " + rowsOf(tree).length);
  const emptyState = byClass(tree, "dshk-wpState").map(explain).join(" | ");
  if (!emptyState.includes(PRESET_LABELS.wpFilterEmpty)) throw new Error("case 4: no 「没有符合该权限等级的会话」 hint; saw " + JSON.stringify(emptyState));
  if (emptyState.includes(PRESET_LABELS.wpSearchEmpty)) throw new Error("case 4: the wrong empty-state (search) hint was shown while a level is active");
  /*
   * With no level active, the SAME empty list must show the search hint instead —
   * proving the two hints are selected by the active filter, not hardwired into
   * the empty branch. Use a query that matches nothing at all.
   */
  chipNamed(tree, "All").props.onClick();
  tree = renderOnce(false);
  const search2 = byClass(tree, "dshk-wpSearch")[0];
  search2.props.onChange({ target: { value: "zzz-no-such-session" } });
  tree = renderOnce(false);
  if (rowsOf(tree).length !== 0) throw new Error("case 4: a non-matching search should leave no rows");
  if (!byClass(tree, "dshk-wpState").map(explain).join(" | ").includes(PRESET_LABELS.wpSearchEmpty)) {
    throw new Error("case 4: with no level active, the empty state should fall back to the search hint");
  }

  // ---- activation 2: a FOUR-preset deployment DOES grow an `auto` chip ----
  const fourTier = [...THREE_TIER, { value: "auto" }];
  const autoSessions = [...SESSIONS, { id: "s-auto", title: "Auto row", workspace: "AutoWS", cwd: "H:/work/auto" }];
  const autoPresets = new Map([...HOST_PRESETS, ["s-auto", "auto"]]);
  const autoHarness = buildHarness({ catalog: fourTier, sessions: autoSessions, hostPresets: autoPresets });
  const autoRenderer = makeRenderer(autoHarness.Panel);
  autoRenderer.renderOnce(true);
  await flush();
  const autoTree = autoRenderer.renderOnce(false);
  if (chipNamed(autoTree, "auto") === undefined) throw new Error("case 5: a deployment offering `auto` did not grow an `auto` chip");
  if (chipCountOf(chipNamed(autoTree, "auto")) !== "1") throw new Error("case 5: the auto chip count should be 1");
  if (chipCountOf(chipNamed(autoTree, "All")) !== "4") throw new Error("case 5: the 全部 chip count should be 4 on the four-preset deployment");

  // ---- summary ----
  const rowsSeen = allChips.map((chip) => explain(chip).replace(/\s+/g, " ").trim());
  console.log("filter ok: chips=[" + rowsSeen.join(", ") + "] danger-full-access→1 全部→3 auto-chip-on-4-tier=yes");
})().catch((err) => {
  console.error("filter FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
