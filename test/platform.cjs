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
  /** Every argument the preload bridge was invoked with. */
  const bridgeCalls = [];
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
  if (bridge) fakeWindow.dshDesktopActions = { invoke: async (action) => { bridgeCalls.push(action); } };

  const previousWindow = global.window;
  global.window = fakeWindow;
  global.fetch = async (url, options) => { fetches.push({ url, options }); return { ok: true, status: 200 }; };

  // Re-load the module against this window so the plugin closes over it.
  captured = null;
  new Function("require", "window", "document", source)(requireStub, fakeWindow, global.document);
  if (captured === null) throw new Error("client.js never called __ModuleLoader__.load");

  /*
   * 0.2.1 service surface.
   *
   * `settingsScope` was removed in 0.1.7; `configForms`, `settingsSchema`, the
   * client `sessions` list store and the `workspaces` registry snapshot were all
   * removed in 0.2.1. None of them is provided here on purpose: a stub that still
   * offered them would let the plugin keep depending on services the real Host
   * does not serve — which is exactly how the permission panel shipped broken.
   *
   * What 0.2.1 does serve, and what this stub therefore provides, is the Remote
   * namespace set: `session.list`/`session.projections`, `workspace.follow`,
   * `commands.execute`, `settings.*` and `permissionPresets.catalog`.
   */
  const slotsService = {
    inject: (name, factory) => { factory(); return () => {}; },
    register: (options, component) => { registrations.set(options.id, component); return () => {}; },
  };
  const shortcutsService = {
    register: (command) => { commands.set(command.id, command); return () => { commands.delete(command.id); }; },
  };
  /** Mode writes performed through `remote.settings.update` on the Desktop carrier. */
  const modeWrites = [];
  const scopeFor = (names) => {
    const scope = { effect: runEffect };
    if (names.includes("shortcuts")) Object.assign(scope, { shortcuts: shortcutsService });
    if (names.includes("slots")) Object.assign(scope, { slots: slotsService });
    if (names.includes("remote") || names.includes("settingsSchema")) {
      const remote = {};
      if (!omit.includes("remote.session")) {
        remote.session = {
          list: async () => ({ ok: true, value: { items: [] } }),
          projections: async () => ({ ok: true, value: { kind: "sequenced", asOfSeq: 0, values: {} } }),
        };
      }
      if (!omit.includes("remote.workspace")) {
        remote.workspace = {
          follow: async function* () {
            yield { type: "baseline", value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } };
          },
        };
      }
      if (!omit.includes("remote.commands")) {
        remote.commands = {
          execute: async () => ({ ok: true, value: { commandId: "c", result: { kind: "success" } } }),
        };
      }
      if (!omit.includes("remote.settings")) {
        remote.settings = {
          // Counted: the panel's `load()` calls this, so a non-zero count is
          // direct evidence that the settings binding actually fired.
          describe: async () => { settingsReads.push(1); return { ok: true, value: { writable: true, namespaces: [] } }; },
          mutate: async () => ({ ok: true, value: { ns: "permission", revision: 1, value: {} } }),
          update: async (ns, patch) => { modeWrites.push({ ns, patch }); return { ok: true, value: { ns, revision: 2, value: patch } }; },
        };
      }
      if (!omit.includes("remote.permissionPresets")) {
        remote.permissionPresets = { catalog: async () => ({ ok: true, value: { options: [], defaultOptions: [], defaultPreset: "" } }) };
      }
      Object.assign(scope, { remote });
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
  const carrier = { bridge, search, windowKeydown, reloads, fetches, bridgeCalls, modeWrites, registrations, commands, settingsReads };
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
  const Section = carrier.registrations.get("dsh-permission-panel");
  if (Section === undefined) throw new Error("the dsh-permission-panel settings section was never registered");
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
  "permissionPanel.restart",
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

  // Restart is the plugin's only command; it must ship NO web default (a web
  // binding would advertise a key that can never fire). On a browser carrier it
  // must REFUSE rather than fire.
  {
    const id = "permissionPanel.restart";
    const defaults = web.commands.get(id).defaults;
    const webProfiles = Object.keys(defaults).filter((profile) => profile.startsWith("web:"));
    if (webProfiles.length !== 0) {
      throw new Error("web: " + id + " declares web defaults " + JSON.stringify(webProfiles) + "; Desktop-only commands must omit them");
    }
    if (Object.keys(defaults).length === 0) {
      throw new Error("web: " + id + " lost its Desktop defaults entirely");
    }
    const result = web.commands.get(id).resolve({ region: "page", modal: null, target: null });
    if (result.status !== "blocked") {
      throw new Error("web: " + id + " resolved to " + result.status + " on a browser carrier; it must refuse");
    }
  }

  // The plugin contributes NO other command: Refresh and the three window-mode
  // switches were removed in 2.1 (they duplicated official commands / wrote a
  // Desktop-owned settings namespace).
  for (const gone of ["permissionPanel.refresh", "permissionPanel.modeCompatibility", "permissionPanel.modeExtended", "permissionPanel.modeAdvanced"]) {
    if (web.commands.has(gone)) {
      throw new Error("web: " + gone + " is still contributed; the retained surface is Restart only");
    }
  }

  // The `dsh-desktop` namespace is Desktop-owned; it must never be written here.
  if (web.modeWrites.length !== 0) throw new Error("web: wrote the dsh-desktop namespace without the Desktop shell");
  if (web.reloads.length !== 0) throw new Error("web: something reloaded the page; the Refresh command is gone");

  // ---- carrier A: the settings page reflects the smaller surface ----
  const webTree = renderSettings(web);
  const webSwitches = switchLabels(webTree);
  /*
   * The model-search sub-plugin switch used to be asserted here. It moved to
   * `dsh-client-ui-effort-slider` together with the seat it drove, so what this
   * page must now show is the pointer to where it went — and it must NOT offer a
   * second control for it, which would be a switch with nothing behind it.
   */
  if (webSwitches.includes("modelSearch")) {
    throw new Error("web: the settings page still renders a model-search switch; that control lives in "
      + "dsh-client-ui-effort-slider now. Saw " + JSON.stringify(webSwitches));
  }
  const webText = explain(webTree);
  if (!webText.includes("subpluginMoved")) {
    throw new Error("web: the sub-plugins card does not point at the plugin that owns the model search box; "
      + "a user who upgraded has no way to find the switch");
  }
  // The old recorder is gone: no recording/enable rows must reappear.
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
  const restartDefaults = desktop.commands.get("permissionPanel.restart").defaults;
  for (const profile of ["desktop:macos", "desktop:windows", "desktop:linux"]) {
    if (restartDefaults[profile] === undefined) throw new Error("desktop: Restart has no default for " + profile);
  }
  /*
   * Under the shell, Restart must be HANDLED and ride the Desktop action bridge.
   * Nothing may write the `dsh-desktop` namespace: the mode switches are gone, and
   * that namespace belongs to the Desktop settings page.
   */
  const desktopRestart = desktop.commands.get("permissionPanel.restart").resolve({ region: "page", modal: null, target: null });
  if (desktopRestart.status !== "handled") {
    throw new Error("desktop: Restart resolved to " + desktopRestart.status + " under the Desktop shell");
  }
  desktopRestart.run();
  await flush();
  if (desktop.modeWrites.length !== 0) {
    throw new Error("desktop: something wrote the dsh-desktop settings namespace; saw " + JSON.stringify(desktop.modeWrites));
  }
  /*
   * The preload bridge is the preferred route and MUST win when it exists: the
   * HTTP endpoint is only a fallback for a shell generation that ships no bridge.
   */
  if (!desktop.bridgeCalls.includes("restart")) {
    throw new Error("desktop: Restart did not reach the preload bridge; saw " + JSON.stringify(desktop.bridgeCalls));
  }
  if (desktop.fetches.length !== 0) {
    throw new Error("desktop: Restart fell back to HTTP although the preload bridge was available; saw "
      + JSON.stringify(desktop.fetches.map((call) => call.url)));
  }
  if (desktop.reloads.length !== 0) throw new Error("desktop: something used a browser reload");

  const desktopTree = renderSettings(desktop);
  if (collect(desktopTree, (entry) => hasClass(entry, "dshk-platformNote")).length !== 0) {
    throw new Error("desktop: the browser-carrier note is shown under the shell");
  }

  // ---- carrier C: the shell, detected through the URL marker alone ----
  // The bridge and the marker are independent signals; a generation that ships
  // only one of them must still be recognised as the shell.
  const marker = loadPlugin({ bridge: false, search: "?dsh-desktop-mode=extended" });
  const markerRestart = marker.commands.get("permissionPanel.restart").resolve({ region: "page", modal: null, target: null });
  if (markerRestart.status !== "handled") {
    throw new Error("marker: Restart refused on a shell detected from the URL marker alone");
  }
  // With no bridge the same command must fall back to the HTTP endpoint.
  markerRestart.run();
  await flush();
  if (marker.fetches.every((call) => !String(call.url).includes("/restart"))) {
    throw new Error("marker: Restart had no bridge and did not fall back to the HTTP endpoint; saw "
      + JSON.stringify(marker.fetches.map((call) => call.url)));
  }

  // ---- carrier D: no archive stream at all ----
  // The archive set is a SOFT refinement: a carrier whose Remote namespace set
  // lacks `remote.workspace` must still get the whole plugin, with the panel
  // failing open to an empty archive set. This is the assertion that keeps the
  // archive read out of the hard-gate `inject` array.
  const noWorkspaces = loadPlugin({ bridge: false, search: "", omit: ["remote.workspace"] });
  if (!noWorkspaces.registrations.has("dsh-permission-panel")) {
    throw new Error("no-archive: the settings section was not registered; a missing optional surface must not break activation");
  }
  if (!noWorkspaces.registrations.has("workspace-permissions")) {
    throw new Error("no-archive: the permissions panel was not registered; it must survive an absent archive stream");
  }
  if (noWorkspaces.commands.size !== web.commands.size) {
    throw new Error("no-archive: shortcut commands went missing with the archive stream absent");
  }

  // ---- carrier E: no settingsSchema service ----
  // 0.2.1 does not compose `settingsSchema` at all. The panel's settings binding
  // is injected WITHOUT it, and must still reach `remote.settings.describe()`.
  // If those two are ever re-coupled, the panel hangs on "loading" — the same
  // silent shape as the original `settingsScope` bug.
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
  for (const ns of ["permissionPanel"]) {
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
    + " desktop-bound-scope=1 detection=[bridge,marker] locale-parity=1"
    + " web-defaults=0 restart-only=1 no-desktop-namespace-write=1"
    + " soft-workspaces=1",
  );
})().catch((error) => {
  console.error("platform FAILED:", error && error.stack ? error.stack : error);
  process.exit(1);
});