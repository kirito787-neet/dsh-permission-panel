/**
 * Carrier test: the same bundle must serve both the DSH Desktop shell and a
 * plain browser (`dsh web`).
 *
 * The Desktop-only surface (Restart DSH, the window-mode switches, and the
 * `dsh-desktop` settings namespace) does not exist on a browser carrier, so the
 * plugin has to detect the shell and degrade: hide those rows, keep Refresh
 * working through a plain page reload, and never bind a scope it cannot serve.
 * Getting this wrong is not cosmetic — `switchMode` writing a namespace the
 * carrier does not own, or `restartApplication` posting to an endpoint only the
 * Electron main process serves, fails at the worst moment (a keystroke).
 *
 * Renders the real client.js through a stubbed module loader, once with the
 * Desktop bridge installed and once without, and asserts what each carrier sees.
 *
 * Usage: node test/platform.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

const loaded = [];
const registeredDictionaries = new Map();
let captured = null;

// ---- document stub ----
const fakeBody = { nodeType: 1, appendChild() {}, removeChild() {}, contains: () => false };
global.document = {
  body: fakeBody,
  head: { appendChild() {} },
  createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {}, appendChild() {} }),
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
};

// ---- react stub (element trees the harness renders itself) ----
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
const pendingEffects = [];
const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: "Fragment",
  useState,
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (fn) => fn(),
  useEffect: (body) => { pendingEffects.push(body); },
  useLayoutEffect: (body) => { pendingEffects.push(body); },
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useId: () => "platform",
};
const requireStub = (id) => {
  if (id === "react") return React;
  if (id === "react-dom") return { createPortal: () => ({ $$portal: true, children: null }) };
  throw new Error("unexpected require: " + id);
};

/**
 * Load the plugin against one carrier.
 *
 * `bridge` installs the context-isolated Desktop preload bridge; `search` is the
 * window URL query, which carries the Electron-owned mode marker.
 */
function loadPlugin({ bridge, search }) {
  const windowKeydown = [];
  const reloads = [];
  const fetches = [];
  const bindCalls = [];

  const fakeWindow = {
    __ModuleLoader__: { load: (definition) => { captured = definition; } },
    localStorage: { getItem: () => null, setItem() {} },
    location: {
      search,
      reload: () => { reloads.push(Date.now()); },
    },
    addEventListener(type, listener, capture) { if (type === "keydown" && capture === true) windowKeydown.push(listener); },
    removeEventListener(type, listener) {
      if (type === "keydown") { const at = windowKeydown.indexOf(listener); if (at >= 0) windowKeydown.splice(at, 1); }
    },
  };
  if (bridge) fakeWindow.dshDesktopActions = { invoke: async () => {} };

  const previousWindow = global.window;
  global.window = fakeWindow;
  global.fetch = async (url, options) => { fetches.push({ url, options }); return { ok: true, status: 200 }; };

  // Re-load the module against this window so the plugin closes over it.
  captured = null;
  new Function("require", "window", "document", source)(requireStub, fakeWindow, global.document);
  if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

  const registrations = new Map();
  const settingsScope = {
    settingsScope: {
      bind: (spec) => { bindCalls.push(spec); return { set: async () => {} }; },
      describe: () => ({ subscribe: () => () => {}, ensure: async () => {}, getSnapshot: () => ({ status: "ready", error: null, view: { writable: true, namespaces: [] } }), acceptView: () => {} }),
    },
  };
  const sessionsService = {
    list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {}, current: null, phase: "ready" }) },
    binding: () => undefined,
    refresh: async () => {},
    subagentAddress: () => undefined,
  };
  const slotsService = {
    inject: (name, factory) => factory(),
    register: (options, component) => { registrations.set(options.id, component); return () => {}; },
  };
  const ctx = {
    effect: (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; },
    inject: (names, callback) => {
      if (names.includes("settingsScope")) callback(settingsScope);
      // The seat asks for all three together; it needs a slots face and a
      // modelDirectories face whose directoryFor is never called eagerly.
      else if (names.includes("modelDirectories")) {
        callback({ modelDirectories: { directoryFor: () => { throw new Error("directoryFor must not be called during activation"); } }, sessions: sessionsService, slots: slotsService });
      } else if (names.includes("sessions")) {
        callback({ sessions: sessionsService });
      }
    },
    locale: {
      register: (ns, dict) => { registeredDictionaries.set(ns, dict); return () => {}; },
      bind: () => (key) => key,
    },
    slots: slotsService,
    get: () => undefined,
  };
  const plugin = captured.factory(requireStub);
  plugin.apply(ctx);

  global.window = previousWindow;
  loaded.push({ bridge, search, windowKeydown, reloads, fetches, bindCalls, registrations });
  return loaded[loaded.length - 1];
}

// ---- renderer: expands function components exactly like React does ----
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
/** Whether one element carries a class token (elements may carry several). */
const hasClass = (node, token) => typeof node.props?.className === "string" && node.props.className.split(/\s+/).includes(token);
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
/** Every rendered shortcut-row label, in order. */
const rowLabels = (tree) => collect(tree, (entry) => entry.props?.className === "dshk-row")
  .map((row) => collect(row, (entry) => entry.props?.className === "dshk-rowLabel").map(explain).join(""))
  .filter((label) => label.length > 0);

/** Render the settings page for one carrier. */
const renderSettings = (carrier) => {
  const Section = carrier.registrations.get("hotkey-toolkit");
  if (Section === undefined) throw new Error("the hotkey-toolkit settings section was never registered");
  hookSlots.clear();
  ownerCounter = 0;
  hookOwner = "c" + (++ownerCounter);
  hookSlot = 0;
  const tree = renderNode(Section({ t: (key) => key }));
  const effects = pendingEffects.splice(0, pendingEffects.length);
  for (const effect of effects) effect();
  return tree;
};

/** Press one combination against the plugin's global listener. */
const press = (carrier, event) => {
  if (carrier.windowKeydown.length === 0) throw new Error("the plugin registered no global keydown listener");
  const full = {
    repeat: false,
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    preventDefault() { full.defaultPrevented = true; },
    stopPropagation() {},
    defaultPrevented: false,
    ...event,
  };
  for (const listener of carrier.windowKeydown.slice()) listener(full);
  return full;
};
const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };

(async () => {
  // ---- carrier A: a plain browser, no Desktop bridge and no mode marker ----
  const web = loadPlugin({ bridge: false, search: "" });
  const webTree = renderSettings(web);
  const webRows = rowLabels(webTree);

  if (!webRows.includes("refresh")) throw new Error("web: the Refresh row is missing; saw " + JSON.stringify(webRows));
  if (webRows.includes("restart")) throw new Error("web: the Restart DSH row is offered on a carrier that cannot restart it");
  for (const mode of ["modeCompatibility", "modeExtended", "modeAdvanced"]) {
    if (webRows.includes(mode)) throw new Error("web: the " + mode + " row is offered without the Desktop shell; saw " + JSON.stringify(webRows));
  }
  if (collect(webTree, (entry) => hasClass(entry, "dshk-platformNote")).length !== 1) {
    throw new Error("web: the page does not explain which rows are Desktop-only");
  }
  // The intro must not advertise actions the carrier cannot perform.
  const webIntro = collect(webTree, (entry) => hasClass(entry, "dshk-intro")).map(explain).join("");
  if (webIntro !== "introWeb") throw new Error("web: the intro still advertises Desktop-only actions; saw " + JSON.stringify(webIntro));
  // The `dsh-desktop` namespace is Desktop-owned; binding it on a browser
  // carrier would subscribe to a namespace that has no settings row.
  if (web.bindCalls.length !== 0) throw new Error("web: bound the dsh-desktop settings scope without the Desktop shell");

  // ---- carrier A: Refresh falls back to a page reload ----
  press(web, { code: "KeyR", ctrlKey: true });
  await flush();
  if (web.reloads.length !== 1) throw new Error("web: the Refresh shortcut did not reload the page (reloads=" + web.reloads.length + ")");
  if (web.fetches.length !== 0) throw new Error("web: Refresh posted to a Desktop endpoint that does not exist; saw " + JSON.stringify(web.fetches.map((call) => call.url)));

  // ---- carrier A: a stale Restart binding must be inert, not a failed request ----
  press(web, { code: "KeyR", ctrlKey: true, shiftKey: true });
  await flush();
  if (web.fetches.length !== 0) throw new Error("web: the Restart binding reached the network; saw " + JSON.stringify(web.fetches.map((call) => call.url)));
  if (web.reloads.length !== 1) throw new Error("web: the Restart binding reloaded the page");

  // ---- carrier A: a stale mode binding must not write the Desktop namespace ----
  press(web, { code: "Digit2", ctrlKey: true, altKey: true });
  await flush();
  if (web.fetches.length !== 0) throw new Error("web: a mode binding reached the network");

  // ---- carrier B: the Desktop shell, detected through its preload bridge ----
  const desktop = loadPlugin({ bridge: true, search: "" });
  const desktopTree = renderSettings(desktop);
  const desktopRows = rowLabels(desktopTree);
  if (!desktopRows.includes("refresh")) throw new Error("desktop: the Refresh row is missing; saw " + JSON.stringify(desktopRows));
  if (!desktopRows.includes("restart")) throw new Error("desktop: the Restart DSH row disappeared under the shell; saw " + JSON.stringify(desktopRows));
  for (const mode of ["modeCompatibility", "modeExtended", "modeAdvanced"]) {
    if (!desktopRows.includes(mode)) throw new Error("desktop: the " + mode + " row is missing under the shell; saw " + JSON.stringify(desktopRows));
  }
  if (collect(desktopTree, (entry) => hasClass(entry, "dshk-platformNote")).length !== 0) {
    throw new Error("desktop: the browser-carrier note is shown under the shell");
  }
  const desktopIntro = collect(desktopTree, (entry) => hasClass(entry, "dshk-intro")).map(explain).join("");
  if (desktopIntro !== "intro") throw new Error("desktop: the intro does not describe the shell's full action set; saw " + JSON.stringify(desktopIntro));
  if (desktop.bindCalls.length !== 1 || desktop.bindCalls[0].namespace !== "dsh-desktop") {
    throw new Error("desktop: the dsh-desktop settings scope was not bound exactly once; saw " + JSON.stringify(desktop.bindCalls));
  }
  // Refresh must ride the Desktop action, not a raw page reload.
  press(desktop, { code: "KeyR", ctrlKey: true });
  await flush();
  if (desktop.reloads.length !== 0) throw new Error("desktop: Refresh used a browser reload instead of the Desktop action");

  // ---- carrier C: the shell, detected through the URL marker alone ----
  // The bridge and the marker are independent signals; a generation that ships
  // only one of them must still be recognised as the shell.
  const marker = loadPlugin({ bridge: false, search: "?dsh-desktop-mode=extended" });
  const markerTree = renderSettings(marker);
  const markerRows = rowLabels(markerTree);
  if (!markerRows.includes("restart")) throw new Error("marker: the Desktop shell was not detected from the URL marker alone");
  if (marker.bindCalls.length !== 1) throw new Error("marker: the dsh-desktop settings scope was not bound");

  // ---- dictionary parity: both locales must carry the same keys ----
  for (const ns of ["hotkeyToolkit", "hotkeyToolkit.seat"]) {
    const dict = registeredDictionaries.get(ns);
    if (dict === undefined) throw new Error("dictionary " + ns + " was never registered");
    const zhKeys = Object.keys(dict.zh).sort();
    const enKeys = Object.keys(dict.en).sort();
    if (zhKeys.join(",") !== enKeys.join(",")) {
      const onlyZh = zhKeys.filter((key) => !enKeys.includes(key));
      const onlyEn = enKeys.filter((key) => !zhKeys.includes(key));
      throw new Error(ns + ": locale key sets differ (zh-only=" + JSON.stringify(onlyZh) + " en-only=" + JSON.stringify(onlyEn) + ")");
    }
    if (zhKeys.length === 0) throw new Error(ns + ": empty dictionary");
  }

  console.log(
    "platform ok: web rows=" + JSON.stringify(webRows) +
    " reload-fallback=1 desktop rows=" + desktopRows.length +
    " detection=[bridge,marker] locale-parity=2",
  );
})().catch((error) => {
  console.error("platform FAILED:", error && error.stack ? error.stack : error);
  process.exit(1);
});
