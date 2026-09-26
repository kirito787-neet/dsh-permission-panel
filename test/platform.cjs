/**
 * Carrier test: the same bundle must serve both the DSH Desktop shell and a
 * plain browser (`dsh web`).
 *
 * Two things are carrier-dependent now.
 *
 * 1. **The Desktop-only commands.** Restart DSH and the three window-mode
 *    switches are contributed to the OFFICIAL shortcut service with Desktop
 *    profiles only, and their `resolve` refuses on a browser carrier. The plugin
 *    no longer runs its own `keydown` listener, so "does the key do anything" is
 *    no longer a question about a listener — it is a question about what the
 *    registered command resolves to, and about which profiles carry a default.
 * 2. **The `dsh-desktop` settings scope.** It is Desktop-owned; binding it on a
 *    browser carrier would subscribe to a namespace that has no settings row.
 *
 * The suite renders the real client.js through a stubbed module loader, once with
 * the Desktop bridge installed, once with only the URL marker, and once with
 * neither, and asserts what each carrier contributes.
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
  // Real React supports a LAZY initializer (`useState(() => x)`); the stub must
  // too, or a component initializing a Set that way sees the function itself.
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

/** Minimal cordis effect: run the body, keep its disposer. */
const runEffect = (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; };

/**
 * Load the plugin against one carrier.
 *
 * `bridge` installs the context-isolated Desktop preload bridge; `search` is the
 * window URL query, which carries the Electron-owned mode marker. `omit` names
 * services to WITHHOLD, which is how the suite proves a soft dependency really
 * is soft: the plugin must still activate and still register its sections.
 */
function loadPlugin({ bridge, search, omit = [] }) {
  const reloads = [];
  const fetches = [];
  const formReads = [];
  const commands = new Map();
  const registrations = new Map();
  /** Every `remote.settings.describe()` call: proof the settings binding fired. */
  const settingsReads = [];
  // The plugin must NOT install a global keydown listener any more; capturing
  // them here lets the suite assert that directly.
  const windowKeydown = [];

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

  /*
   * `configForms` is the DSH 0.1.7 settings surface. `settingsScope` is NOT
   * provided here on purpose: it was removed in 0.1.7, and a stub that still
   * offers it would let the plugin keep depending on a service the real Host does
   * not serve — which is exactly how the permission panel shipped broken.
   */
  const configForms = {
    configForms: {
      get: (entryId) => {
        formReads.push(entryId);
        return { set: async () => true, getSnapshot: () => ({ status: "ready", value: {}, writable: true, revision: 1 }) };
      },
    },
  };
  const sessionsService = {
    list: { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {}, current: null, phase: "ready" }) },
    binding: () => undefined,
    refresh: async () => {},
    subagentAddress: () => undefined,
  };
  const slotsService = {
    inject: (name, factory) => { factory(); return () => {}; },
    register: (options, component) => { registrations.set(options.id, component); return () => {}; },
  };
  /*
   * The Workspace registry, for the archive set. Present on BOTH carriers: the
   * panel reads it through a nested `ctx.inject(['workspaces'], …)` precisely so
   * a carrier without it still loads, and this stub is what lets the suite prove
   * that path stays optional rather than becoming a hard requirement.
   */
  const workspacesService = {
    list: {
      subscribe: () => () => {},
      getSnapshot: () => ({
        items: [], archivedSessionIds: [], pinnedSessionIds: [],
        state: "idle", phase: "ready", error: null,
      }),
    },
  };
  const shortcutsService = {
    register: (command) => { commands.set(command.id, command); return () => { commands.delete(command.id); }; },
  };
  const scopeFor = (names) => {
    const scope = { effect: runEffect };
    if (names.includes("configForms")) Object.assign(scope, configForms);
    if (names.includes("modelDirectories")) {
      Object.assign(scope, {
        // Must never be called during activation; the seat resolves it lazily.
        modelDirectories: { directoryFor: () => { throw new Error("directoryFor must not be called during activation"); } },
        sessions: sessionsService, slots: slotsService,
      });
    } else if (names.includes("sessions")) Object.assign(scope, { sessions: sessionsService });
    if (names.includes("shortcuts")) Object.assign(scope, { shortcuts: shortcutsService });
    if (names.includes("slots")) Object.assign(scope, { slots: slotsService });
    if (names.includes("workspaces")) Object.assign(scope, { workspaces: workspacesService });
    if (names.includes("remote") || names.includes("settingsSchema")) {
      Object.assign(scope, {
        remote: {
          settings: {
            // Counted: the panel's `load()` calls this, so a non-zero count is
            // direct evidence that the settings binding actually fired.
            describe: async () => { settingsReads.push(1); return { ok: true, value: { writable: true, namespaces: [] } }; },
            mutate: async () => ({ ok: true, value: { ns: "permission", revision: 1, value: {} } }),
          },
          permissionPresets: { catalog: async () => ({ ok: true, value: { options: [], defaultOptions: [], defaultPreset: "" } }) },
        },
        settingsSchema: { describe: () => ({ namespaces: [] }), rehydrate: (value) => value, nodeAtPath: () => undefined },
      });
    }
    return scope;
  };
  const ctx = {
    effect: runEffect,
    /*
     * A nested `ctx.inject([...], cb)` for an ABSENT service never calls back.
     * That is the real cordis behaviour and the reason a soft dependency is soft,
     * so the stub must reproduce it rather than hand the callback a scope anyway:
     * a stub that always calls back would hide a plugin that depends on a service
     * the carrier does not compose.
     */
    inject: (names, callback) => {
      if (names.some((name) => omit.includes(name))) return;
      callback(scopeFor(names));
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
  const carrier = { bridge, search, windowKeydown, reloads, fetches, formReads, registrations, commands, settingsReads };
  loaded.push(carrier);
  return carrier;
}

/**
 * Render a component and drain its queued mount effects, like React does.
 *
 * The effect drain is not optional: the permissions panel starts its
 * `remote.settings.describe()` from a mount effect, so a render that skips
 * effects makes the panel look inert no matter how it is wired.
 * @param component - the function component to render.
 * @param props - props to pass.
 * @returns the rendered tree.
 */
const renderWithEffects = (component, props) => {
  hookSlots.clear();
  ownerCounter = 0;
  hookOwner = "c" + (++ownerCounter);
  hookSlot = 0;
  const tree = renderNode(component(props));
  for (const effect of pendingEffects.splice(0, pendingEffects.length)) effect();
  return tree;
};

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
/**
 * Collect raw element nodes whose `type` satisfies a predicate.
 *
 * Distinct from {@link collect} because it inspects `type` rather than props,
 * and because it must run on an UNRENDERED tree: `renderNode` expands function
 * components, so a component reference is gone by the time it returns.
 * @param node - element, array, or scalar produced by the React stub.
 * @param predicate - receives each element's `type`.
 * @returns matching elements in render order.
 */
const collectElements = (node, predicate) => {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, predicate));
  const self = node.$$el === true && predicate(node.type) ? [node] : [];
  return [...self, ...collectElements(node.children, predicate)];
};

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
/** The switch rows on the settings page, keyed by their label text. */
const switchLabels = (tree) => collect(tree, (entry) => hasClass(entry, "dshk-row"))
  .map((row) => collect(row, (entry) => hasClass(entry, "dshk-rowLabel")).map(explain).join(""))
  .filter((label) => label.length > 0);

const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };

/** The exact set of command ids the plugin contributes to the official service. */
const EXPECTED_COMMANDS = [
  "hotkeyToolkit.refresh",
  "hotkeyToolkit.restart",
  "hotkeyToolkit.modeCompatibility",
  "hotkeyToolkit.modeExtended",
  "hotkeyToolkit.modeAdvanced",
];

(async () => {
  // ---- carrier A: a plain browser, no Desktop bridge and no mode marker ----
  const web = loadPlugin({ bridge: false, search: "" });

  // The plugin must no longer own a global key listener: the official shortcut
  // service is the single keyboard owner now.
  if (web.windowKeydown.length !== 0) {
    throw new Error("web: the plugin still installs its own global keydown listener; the official shortcut service must own the keyboard");
  }

  // Every command is contributed, on every carrier, so the official list is complete.
  for (const id of EXPECTED_COMMANDS) {
    if (!web.commands.has(id)) throw new Error("web: command " + id + " was not contributed to the official shortcut service");
  }

  // Desktop-only commands must ship NO web default: a web binding would advertise
  // a key that can never fire (and would collide with official web bindings).
  for (const id of ["hotkeyToolkit.restart", "hotkeyToolkit.modeCompatibility", "hotkeyToolkit.modeExtended", "hotkeyToolkit.modeAdvanced"]) {
    const defaults = web.commands.get(id).defaults;
    const webProfiles = Object.keys(defaults).filter((profile) => profile.startsWith("web:"));
    if (webProfiles.length !== 0) {
      throw new Error("web: " + id + " declares web defaults " + JSON.stringify(webProfiles) + "; Desktop-only commands must omit them");
    }
    if (Object.keys(defaults).length === 0) {
      throw new Error("web: " + id + " lost its Desktop defaults entirely");
    }
  }

  // Refresh ships unbound on purpose (Ctrl+R belongs to the official page.refresh).
  if (Object.keys(web.commands.get("hotkeyToolkit.refresh").defaults).length !== 0) {
    throw new Error("web: Refresh declares a default binding; it must stay unbound so it cannot collide with the official page.refresh");
  }

  // On a browser carrier the Desktop-only actions must REFUSE, not fire.
  for (const id of ["hotkeyToolkit.restart", "hotkeyToolkit.modeCompatibility", "hotkeyToolkit.modeExtended", "hotkeyToolkit.modeAdvanced"]) {
    const result = web.commands.get(id).resolve({ region: "page", modal: null, target: null });
    if (result.status !== "blocked") {
      throw new Error("web: " + id + " resolved to " + result.status + " on a browser carrier; it must refuse");
    }
  }

  // The `dsh-desktop` namespace is Desktop-owned; resolving its form on a browser
  // carrier would target a namespace that has no settings row.
  if (web.formReads.length !== 0) throw new Error("web: resolved the dsh-desktop settings form without the Desktop shell");

  // Refresh still works on the web carrier, via a page reload rather than a
  // Desktop endpoint. The command is unbound by default, so it is invoked the way
  // the official service invokes a command.
  const webRefresh = web.commands.get("hotkeyToolkit.refresh").resolve({ region: "page", modal: null, target: null });
  if (webRefresh.status !== "handled") throw new Error("web: Refresh did not resolve as handled");
  webRefresh.run();
  await flush();
  if (web.reloads.length !== 1) throw new Error("web: Refresh did not reload the page (reloads=" + web.reloads.length + ")");
  if (web.fetches.length !== 0) throw new Error("web: Refresh posted to a Desktop endpoint that does not exist; saw " + JSON.stringify(web.fetches.map((call) => call.url)));

  // ---- carrier A: the settings page reflects the new, smaller surface ----
  const webTree = renderSettings(web);
  const webSwitches = switchLabels(webTree);
  if (!webSwitches.includes("modelSearch")) {
    throw new Error("web: the model-search sub-plugin switch is missing; saw " + JSON.stringify(webSwitches));
  }
  // The old recorder is gone: no recording/enable rows must reappear.
  const webText = explain(webTree);
  for (const stale of ["enable", "record", "reset"]) {
    if (webText.includes(stale)) throw new Error("web: the retired shortcut recorder still renders '" + stale + "'");
  }
  if (collect(webTree, (entry) => hasClass(entry, "dshk-platformNote")).length !== 1) {
    throw new Error("web: the page does not explain which rows are Desktop-only");
  }

  // ---- carrier B: the Desktop shell, detected through its preload bridge ----
  const desktop = loadPlugin({ bridge: true, search: "" });
  for (const id of EXPECTED_COMMANDS) {
    if (!desktop.commands.has(id)) throw new Error("desktop: command " + id + " was not contributed");
  }
  // Restart carries its Desktop default here.
  const restartDefaults = desktop.commands.get("hotkeyToolkit.restart").defaults;
  for (const profile of ["desktop:macos", "desktop:windows", "desktop:linux"]) {
    if (restartDefaults[profile] === undefined) throw new Error("desktop: Restart has no default for " + profile);
  }
  if (desktop.formReads.length !== 1 || desktop.formReads[0] !== "dsh-desktop") {
    throw new Error("desktop: the dsh-desktop settings form was not resolved exactly once; saw " + JSON.stringify(desktop.formReads));
  }
  // Under the shell, Refresh rides the Desktop action rather than a page reload.
  const desktopRefresh = desktop.commands.get("hotkeyToolkit.refresh").resolve({ region: "page", modal: null, target: null });
  desktopRefresh.run();
  await flush();
  if (desktop.reloads.length !== 0) throw new Error("desktop: Refresh used a browser reload instead of the Desktop action");

  const desktopTree = renderSettings(desktop);
  if (collect(desktopTree, (entry) => hasClass(entry, "dshk-platformNote")).length !== 0) {
    throw new Error("desktop: the browser-carrier note is shown under the shell");
  }

  // ---- carrier C: the shell, detected through the URL marker alone ----
  // The bridge and the marker are independent signals; a generation that ships
  // only one of them must still be recognised as the shell.
  const marker = loadPlugin({ bridge: false, search: "?dsh-desktop-mode=extended" });
  if (marker.formReads.length !== 1) throw new Error("marker: the dsh-desktop settings form was not resolved");
  const markerRestart = marker.commands.get("hotkeyToolkit.restart").resolve({ region: "page", modal: null, target: null });
  if (markerRestart.status !== "handled") {
    throw new Error("marker: Restart refused on a shell detected from the URL marker alone");
  }

  // ---- carrier D: no Workspace registry at all ----
  // `workspaces` is a SOFT dependency: the archive set only refines the
  // permissions panel, so a carrier that does not compose it must still get the
  // whole plugin. This is the assertion that keeps it out of the hard-gate
  // `inject` array — there, a missing service would leave the plugin PENDING
  // forever instead of merely hiding one refinement.
  const noWorkspaces = loadPlugin({ bridge: false, search: "", omit: ["workspaces"] });
  if (!noWorkspaces.registrations.has("hotkey-toolkit")) {
    throw new Error("no-workspaces: the settings section was not registered; a missing optional service must not break activation");
  }
  if (!noWorkspaces.registrations.has("workspace-permissions")) {
    throw new Error("no-workspaces: the permissions panel was not registered; it must survive an absent Workspace registry");
  }
  if (noWorkspaces.commands.size !== web.commands.size) {
    throw new Error("no-workspaces: shortcut commands went missing with the Workspace registry absent");
  }

  // ---- carrier E: no settingsSchema service ----
  // The panel's settings binding is deliberately injected WITHOUT `settingsSchema`
  // now that the new-session defaults come from the Host catalog. If those two are
  // ever re-coupled, a carrier lacking the schema service leaves the binding
  // unfired and the panel permanently on "loading" — the same silent shape as the
  // original `settingsScope` bug. The stub withholds the service AND refuses to
  // call back for it, so re-coupling fails right here.
  const noSchema = loadPlugin({ bridge: false, search: "", omit: ["settingsSchema"] });
  const noSchemaPanel = noSchema.registrations.get("workspace-permissions");
  if (noSchemaPanel === undefined) {
    throw new Error("no-settings-schema: the permissions panel was not registered; its settings binding must not depend on settingsSchema");
  }
  /*
   * Rendered WITH effect draining, because the panel starts its settings read
   * from a mount effect. Inspect the RAW tree for the `PresetDropdown` component
   * reference: `renderNode` expands function components, so the name is gone
   * from the rendered output.
   */
  const noSchemaTree = renderWithEffects(noSchemaPanel, { t: (key) => key });
  const noSchemaDropdowns = collectElements(noSchemaPanel({ t: (key) => key }),
    (type) => typeof type === "function" && type.name === "PresetDropdown");
  if (noSchemaDropdowns.length === 0) {
    throw new Error("no-settings-schema: the panel rendered no preset dropdown without the schema service");
  }
  const noSchemaTriggers = collect(noSchemaTree, (entry) => hasClass(entry, "dshk-wpSelect"));
  if (noSchemaTriggers.length === 0) {
    throw new Error("no-settings-schema: the panel's dropdown produced no trigger; the settings binding did not run");
  }
  /*
   * The direct evidence: rendering the panel must have driven
   * `remote.settings.describe()`. Without the schema service the binding still
   * fires, so this read happens; re-coupling the two leaves `settingsCtx` null,
   * `load()` returns early, and this count stays ZERO.
   */
  await flush();
  if (noSchema.settingsReads.length === 0) {
    throw new Error("no-settings-schema: the panel never reached remote.settings.describe() without the schema "
      + "service — its settings binding is coupled to settingsSchema again, which would hang the panel on 'loading'");
  }

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
    "platform ok: web commands=" + web.commands.size + " no-keydown-listener=1"
    + " desktop-bound-scope=1 detection=[bridge,marker] locale-parity=2"
    + " web-defaults=0 refresh-unbound=1"
    + " soft-workspaces=1",
  );
})().catch((error) => {
  console.error("platform FAILED:", error && error.stack ? error.stack : error);
  process.exit(1);
});