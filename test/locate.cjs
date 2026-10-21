/**
 * Render test for the "locate current session" button in the workspace-permissions
 * panel.
 *
 * Loads the real client.js through a stubbed module loader (fake react / react-dom
 * / document, same shape as test/smoke.cjs), renders PermissionsSection with a
 * FOCUSED session id, and drives the toolbar's locate button end to end.
 *
 * It guards four promises the button makes:
 *   1. it is offered only when there IS a current session to point at;
 *   2. clicking it unfolds the Workspace that owns the current session;
 *   3. it scrolls the current session's own row into view (scrollIntoView with
 *      block:"center", behavior:"smooth") and flashes it;
 *   4. a search term that hides the current session does NOT turn the click into
 *      a bogus "not in this list" error — the search is cleared and the row is
 *      found anyway (membership is read from the UNFILTERED rows).
 *
 * A session that truly is absent from the list (here: an archived one) must be
 * reported through the panel's `problem` line instead of failing silently.
 *
 * Usage: node test/locate.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

let captured = null;

// ---- document stub (the panel only reaches for the portal host / handlers) ----
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
const pendingEffects = [];
const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState,
  // A STATELESS ref, exactly like the smoke harness: every render hands out a
  // fresh { current } object. The renderer below fills `current` with the fake
  // root on the element that carries a `ref`, so the locate effect's
  // listRef.current is populated by the time the effect runs.
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (fn) => fn(),
  useEffect: (body) => { pendingEffects.push(body); },
  useLayoutEffect: (body) => { pendingEffects.push(body); },
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "locate",
};
const createPortal = (children, container) => {
  if (container === null || container === undefined || typeof container.appendChild !== "function") {
    throw new Error("createPortal: Target container is not a DOM element.");
  }
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

// ---- fake host services (0.2.1 surface) ----
const permissionsOf = (currentValue) => ({ currentValue });
const hostPresets = new Map([["s1", "workspace-write"], ["s2", "read-only"]]);
const hostTitles = new Map([["s1", "Session A"], ["s2", "Session B"]]);
/*
 * s1 lives in Workspace w1 (Alpha), s2 in w2 (Beta). s3 is ARCHIVED: it is
 * filtered out of every manageable row and belongs to no group, which is exactly
 * the "current session is not in this list" case for the locate button.
 */
const sessionRows = [
  { agentAvailable: true, sessionId: "s1", updatedAt: 1, running: true, blank: false, cwd: "H:/work/a", projections: { kind: "cached", asOfSeq: 1, values: { title: "Session A", permissions: permissionsOf("workspace-write") } } },
  { agentAvailable: true, sessionId: "s2", updatedAt: 2, running: false, blank: false, cwd: "H:/work/b", projections: { kind: "cached", asOfSeq: 2, values: { title: "Session B", permissions: permissionsOf("read-only") } } },
  { agentAvailable: true, sessionId: "s3", updatedAt: 3, running: false, blank: false, cwd: "H:/work/c", projections: { kind: "cached", asOfSeq: 3, values: { title: "Session C" } } },
];
const settingsView = {
  writable: true,
  namespaces: [{ ns: "permission", revision: 1, schema: {}, value: { defaultPreset: "workspace-write" } }],
};
const registrations = new Map();
const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };
const fakeScope = {
  effect: runEffect,
  remote: {
    session: {
      list: async () => ({ ok: true, value: { items: sessionRows } }),
      projections: async (request) => {
        const values = { title: hostTitles.get(request.sessionId) ?? request.sessionId };
        const preset = hostPresets.get(request.sessionId);
        if (preset !== undefined) values.permissions = permissionsOf(preset);
        return { ok: true, value: { kind: "sequenced", asOfSeq: 1, values } };
      },
    },
    workspace: {
      follow: async function* () {
        yield {
          type: "baseline",
          value: {
            items: [
              { workspaceId: "w1", path: "H:/work/a", title: "Alpha", sessionIds: ["s1"], createdAt: 1, updatedAt: 1 },
              { workspaceId: "w2", path: "H:/work/b", title: "Beta", sessionIds: ["s2"], createdAt: 2, updatedAt: 2 },
              { workspaceId: "w3", path: "H:/work/c", title: "Gamma", sessionIds: ["s3"], createdAt: 3, updatedAt: 3 },
            ],
            archivedSessionIds: ["s3"],
            pinnedSessionIds: [],
          },
        };
      },
    },
    commands: { execute: async () => ({ ok: true, value: { commandId: "c", result: { kind: "success" } } }) },
    settings: {
      describe: async () => ({ ok: true, value: settingsView }),
      mutate: async (...args) => ({ ok: true, value: settingsView.namespaces[0] }),
      update: async () => ({ ok: true, value: settingsView.namespaces[0] }),
    },
    permissionPresets: {
      catalog: async () => ({
        ok: true,
        value: {
          options: [
            { value: "read-only", name: "read-only", description: "Reads only." },
            { value: "workspace-write", name: "workspace-write", description: "Writes inside the workspace." },
            { value: "danger-full-access", name: "danger-full-access", description: "Unrestricted." },
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
  effect: runEffect,
  inject: (names, callback) => { callback(fakeScope); },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: fakeScope.slots,
  get: () => undefined,
};

const plugin = captured.factory(requireStub);
plugin.apply(ctx);

// Resolve just the strings the assertions read off the rendered tree.
const PRESET_LABELS = {
  wpLocate: "Locate current session",
  wpLocateMissing: "Current session is not in this list (it may be archived)",
  wpPresetReadOnly: "read-only",
  wpPresetWorkspaceWrite: "workspace-write",
  wpPresetFullAccess: "danger-full-access",
  wpExpandAll: "Expand all",
  wpCollapseAll: "Collapse all",
  wpSelectedCount: "{n} selected",
  wpGroupCount: "{n} session(s)",
  wpSearchCount: "{n} / {total} matching",
  wpSearchEmpty: "No matching sessions.",
  wpSelectAllLabel: "Select all",
  wpSelectAll: "Select every manageable session",
  wpSelectAllVisible: "Select all {n} visible sessions",
};
const translate = (key) => PRESET_LABELS[key] ?? key;

const Panel = registrations.get("workspace-permissions");
if (Panel === undefined) throw new Error("workspace-permissions section was never registered");

// ---- renderer: expands function components exactly like React does ----
const dropdownOwners = [];
/** The most recently rendered tree; the fake root queries it to answer selectors. */
let lastTree = null;
/** Every scrollIntoView call the locate effect made, as { id, options }. */
const scrollCalls = [];
/**
 * Fake DOM root standing in for the panel's list container.
 *
 * The real panel does `listRef.current.querySelector('[data-session-id="…"]')`
 * and then `scrollIntoView(...)`. This root answers that selector by searching
 * the freshly rendered tree, so the effect exercises the SAME code path the
 * browser would; the returned row node records the scroll so the test can assert
 * it (and the exact options).
 */
const fakeRoot = {
  querySelector(selector) {
    const match = /data-session-id="([^"]*)"/u.exec(selector);
    if (match === null) return null;
    const id = match[1];
    const rows = collect(lastTree, (entry) => entry.$$el === true && typeof entry.props?.className === "string" && entry.props.className.includes("dshk-wpRow") && entry.props["data-session-id"] === id);
    if (rows.length === 0) return null;
    return { scrollIntoView(options) { scrollCalls.push({ id, options }); } };
  },
};
const childList = (node) => (Array.isArray(node.children) ? node.children : node.children === undefined ? [] : [node.children]);
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
  // Fill object refs with the fake root — this is what makes listRef.current a
  // real queryable handle by the time the locate effect drains.
  if (node.props !== null && node.props !== undefined && typeof node.props.ref === "object" && node.props.ref !== null) {
    node.props.ref.current = fakeRoot;
  }
  return { ...node, children };
};
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
const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };
const cleanups = [];

/**
 * Render one pass. `clearFirst` wipes hook state for a fresh mount; stateful
 * flows (clicking locate, typing a query, re-rendering after an effect) pass
 * false so the state survives, the way React preserves it.
 *
 * `focusSessionId` is the panel's session anchor: undefined/null means the
 * Settings page (no current session), a string means the session header entry.
 */
const renderOnce = (clearFirst, focusSessionId) => {
  if (clearFirst) hookSlots.clear();
  ownerCounter = 0;
  dropdownOwners.length = 0;
  hookOwner = "c" + (++ownerCounter);
  hookSlot = 0;
  lastTree = null;
  const tree = renderNode(Panel({ t: translate, focusSessionId }));
  lastTree = tree;
  // Drain queued effects so the mount load() and the locate/flash effects run,
  // exactly like React does after a commit.
  const effects = pendingEffects.splice(0, pendingEffects.length);
  for (const effect of effects) {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  }
  return tree;
};

/** Mount fresh for a given session anchor, let the catalog load, then re-render. */
const mount = async (focusSessionId) => {
  renderOnce(true, focusSessionId);
  await flush();
  return renderOnce(false, focusSessionId);
};

const locateButtons = (tree) => collect(tree, (entry) => typeof entry.props?.className === "string" && entry.props.className.includes("dshk-wpLocate"));
const sessionRowsOf = (tree) => collect(tree, (entry) => typeof entry.props?.className === "string" && entry.props.className.includes("dshk-wpRow") && typeof entry.props["data-session-id"] === "string");
const rowFor = (tree, id) => sessionRowsOf(tree).find((row) => row.props["data-session-id"] === id);
const problemNotes = (tree) => collect(tree, (entry) => entry.props?.className === "dshk-note");
const groupHeadFor = (tree, workspaceTitle) => collect(tree, (entry) => entry.props?.className === "dshk-wpGroupHead" && explain(entry).includes(workspaceTitle))[0];
/** The disclosure button inside a group header; `aria-expanded` lives on it. */
const groupToggleFor = (tree, workspaceTitle) => {
  const head = groupHeadFor(tree, workspaceTitle);
  if (head === undefined) return undefined;
  return collect(head, (entry) => entry.props?.className === "dshk-wpGroupToggle")[0];
};

(async () => {
  // Warm the session catalog once; later mounts reuse the live module state.
  await mount("s1");

  // ---- case 1: the button is offered only when there is a current session ----
  {
    const withAnchor = await mount("s1");
    if (locateButtons(withAnchor).length !== 1) {
      throw new Error("case 1: the locate button did not render for a focused session; saw " + locateButtons(withAnchor).length);
    }
    if (!explain(locateButtons(withAnchor)[0]).includes("Locate current session")) {
      throw new Error("case 1: the locate button does not show its wpLocate label");
    }
    const noAnchor = await mount(undefined);
    if (locateButtons(noAnchor).length !== 0) {
      throw new Error("case 1: the locate button rendered with NO current session (Settings page)");
    }
    const nullAnchor = await mount(null);
    if (locateButtons(nullAnchor).length !== 0) {
      throw new Error("case 1: the locate button rendered for a null current session");
    }
  }

  // ---- case 2: groups start folded; locate unfolds the owner and scrolls to the row ----
  {
    scrollCalls.length = 0;
    let tree = await mount("s1");
    if (sessionRowsOf(tree).length !== 0) throw new Error("case 2: groups did not start folded");
    const alphaHead = groupHeadFor(tree, "Alpha");
    if (alphaHead === undefined) throw new Error("case 2: Alpha group heading missing");
    if (groupToggleFor(tree, "Alpha").props["aria-expanded"] !== false) throw new Error("case 2: Alpha should start collapsed");
    const button = locateButtons(tree)[0];
    if (button === undefined) throw new Error("case 2: locate button missing");
    button.props.onClick();
    // The click queues a query clear + an unfold + a pendingLocate; the next
    // render commits them and its effect performs the scroll.
    tree = renderOnce(false, "s1");
    if (rowFor(tree, "s1") === undefined) {
      throw new Error("case 2: clicking locate did not unfold the session's Workspace");
    }
    if (rowFor(tree, "s2") !== undefined) {
      throw new Error("case 2: clicking locate unfolded an UNRELATED Workspace (only the current session's should open)");
    }
    const reopenedHead = groupHeadFor(tree, "Alpha");
    if (reopenedHead === undefined || groupToggleFor(tree, "Alpha").props["aria-expanded"] !== true) {
      throw new Error("case 2: the current session's Workspace is not marked expanded after locate");
    }
    if (scrollCalls.length !== 1) {
      throw new Error("case 2: expected exactly one scrollIntoView call, saw " + scrollCalls.length);
    }
    if (scrollCalls[0].id !== "s1") throw new Error("case 2: scrolled to the wrong row: " + scrollCalls[0].id);
    if (scrollCalls[0].options?.block !== "center" || scrollCalls[0].options?.behavior !== "smooth") {
      throw new Error("case 2: scrollIntoView was called with the wrong options: " + JSON.stringify(scrollCalls[0].options));
    }
  }

  // ---- case 3: the located row flashes briefly ----
  {
    scrollCalls.length = 0;
    let tree = await mount("s1");
    locateButtons(tree)[0].props.onClick();
    tree = renderOnce(false, "s1"); // effect: scroll + setFlashId, clear pendingLocate
    tree = renderOnce(false, "s1"); // now the flash class is on the row
    const row = rowFor(tree, "s1");
    if (row === undefined) throw new Error("case 3: located row vanished");
    if (!row.props.className.includes("dshk-wpRowFlash")) {
      throw new Error("case 3: the located row was not highlighted; className=" + JSON.stringify(row.props.className));
    }
  }

  // ---- case 4: a search term hiding the current session must NOT report it missing ----
  {
    scrollCalls.length = 0;
    let tree = await mount("s1");
    const search = collect(tree, (entry) => entry.props?.className === "dshk-wpSearch")[0];
    if (search === undefined) throw new Error("case 4: the search box is missing");
    search.props.onChange({ target: { value: "zzz-nothing-matches" } });
    tree = renderOnce(false, "s1");
    if (sessionRowsOf(tree).length !== 0) throw new Error("case 4: the search filter did not hide the rows");
    // The button is still offered (there IS a current session), and clicking it
    // must recover the row rather than claim the session is gone.
    const button = locateButtons(tree)[0];
    if (button === undefined) throw new Error("case 4: locate button vanished while searching");
    button.props.onClick();
    tree = renderOnce(false, "s1");
    if (problemNotes(tree).length !== 0) {
      throw new Error("case 4: a search-only miss was reported as '" + explain(problemNotes(tree)[0]) + "'");
    }
    if (rowFor(tree, "s1") === undefined) {
      throw new Error("case 4: locating after a search did not clear the query and reveal the row");
    }
    if (scrollCalls.length !== 1 || scrollCalls[0].id !== "s1") {
      throw new Error("case 4: locating after a search did not scroll to the row; saw " + JSON.stringify(scrollCalls));
    }
  }

  // ---- case 5: a session genuinely absent from the list is reported, not swallowed ----
  {
    scrollCalls.length = 0;
    let tree = await mount("s3"); // archived: filtered out of every manageable row
    if (locateButtons(tree).length !== 1) throw new Error("case 5: the button should still be offered for a missing session");
    locateButtons(tree)[0].props.onClick();
    tree = renderOnce(false, "s3");
    const notes = problemNotes(tree);
    if (notes.length !== 1) throw new Error("case 5: an absent session produced no problem line");
    if (!explain(notes[0]).includes("Current session is not in this list")) {
      throw new Error("case 5: the problem line does not carry the wpLocateMissing text; saw " + JSON.stringify(explain(notes[0])));
    }
    if (scrollCalls.length !== 0) throw new Error("case 5: an absent session was scrolled to anyway");
  }

  // Tear down any effect cleanups (the flash timer) so the process exits at once.
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;

  console.log(
    "locate ok: cases=5 scrolls-last-case=" + JSON.stringify(scrollCalls.map((call) => call.id)),
  );
})().catch((error) => {
  console.error("locate FAILED:", error.message);
  process.exit(1);
});
