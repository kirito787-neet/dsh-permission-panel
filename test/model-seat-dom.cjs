/**
 * Real-DOM check for the model seat's second-level search box (optional suite).
 *
 * Renders the plugin's ModelSelect through real React + jsdom — not a stub — and
 * drives it the way a user does: click the trigger, confirm the root level holds
 * the shipped Model / Effort rows, drill into "Model", confirm the search box sits
 * above the model options there, type a query, press Enter.
 *
 * Requires react, react-dom and jsdom to be resolvable from DSH_DOMTEST_DIR.
 * Skips itself (exit 0) when they are absent, so `npm test` stays dependency-free.
 *
 *   DSH_DOMTEST_DIR=<dir with node_modules> node test/model-seat-dom.cjs [client.js]
 *
 * Note: jsdom does not deliver React's synthetic onChange for dispatched input
 * events, so the typing step invokes the input's own onChange prop — the same
 * handler a real keystroke runs in Chromium.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const TEMP = process.env.DSH_DOMTEST_DIR;
const CLIENT = process.argv[2] ?? path.join(__dirname, "..", "client.js");
if (TEMP === undefined || TEMP === "") {
  console.log("model-seat-dom skipped: set DSH_DOMTEST_DIR to a directory with react/react-dom/jsdom");
  process.exit(0);
}
let req;
try {
  req = Module.createRequire(path.join(TEMP, "noop.js"));
  req.resolve("jsdom");
  req.resolve("react");
  req.resolve("react-dom/client");
} catch (error) {
  console.log("model-seat-dom skipped: " + error.message);
  process.exit(0);
}
const { JSDOM } = req("jsdom");
const React = req("react");
const ReactDOMClient = req("react-dom/client");
const act = React.act ?? req("react-dom/test-utils").act;
/**
 * Real-DOM verification of the model seat's second-level search box.
 *
 * Renders the plugin's ModelSelect through real React 18 + jsdom (not a stub),
 * then drives it the way a user does: click the trigger, confirm the root level
 * holds the Model / Effort rows, drill into "Model", confirm the search box sits
 * above the model options there, type a query, and press Enter to switch models.
 */

// React 18.3 exports act directly; fall back for older minors.

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom implements neither of these legacy hooks; React's input polyfill probes
// for them on focus and would otherwise crash. No-ops keep that path inert.
dom.window.HTMLElement.prototype.attachEvent = function attachEvent() {};
dom.window.HTMLElement.prototype.detachEvent = function detachEvent() {};

const source = fs.readFileSync(CLIENT, "utf8");

// ---- capture the module definition through the plugin loader ----
let captured = null;
const originalLoad = dom.window.__ModuleLoader__ && dom.window.__ModuleLoader__.load;
dom.window.__ModuleLoader__ = { load: (definition) => { captured = definition; } };
const requireStub = (id) => {
  if (id === "react") return React;
  if (id === "react-dom") return { createPortal: req("react-dom").createPortal };
  throw new Error("unexpected require: " + id);
};
new Function("require", "window", "document", source)(requireStub, global.window, global.document);
if (captured === null) throw new Error("client.js never registered with the loader");

// ---- host stubs ----
const MODELS = [
  { id: "alpha-1", name: "Alpha One", reasoning: { defaultEffort: "low", efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] } },
  { id: "beta-2", name: "Beta Two" },
  { id: "gamma-3", name: "Gamma Three" },
];
const snapshot = {
  status: "ready",
  current: { provider: "prov-a", model: "alpha-1" },
  groups: [
    { id: "prov-a", name: "Provider A", models: [MODELS[0], MODELS[1]] },
    { id: "prov-b", name: "Provider B", models: [MODELS[2]] },
  ],
  failures: [],
  error: null,
};
const listeners = new Set();
const directory = {
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot: () => snapshot,
};
const selectCalls = [];
const seatProps = {
  locked: false,
  available: true,
  directory,
  load: () => {},
  select: (selection) => { selectCalls.push(selection); return Promise.resolve(true); },
};

// The seat's own namespace, exactly as the plugin registers it.
const seatDicts = {};
for (const name of ["seatZh", "seatEn"]) {
  const start = source.indexOf("const " + name + " = {");
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") { depth -= 1; if (depth === 0) { seatDicts[name] = Function("return " + source.slice(open, i + 1))(); break; } }
  }
}
// Faithful to the Host: namespace-only lookup, no cross-namespace fallback.
const seatT = (key, params) => {
  const template = seatDicts.seatZh[key];
  if (template === undefined) return key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
};

const registrations = new Map();
const noopStore = { subscribe: () => () => {}, getSnapshot: () => ({ ids: [], byId: {}, phase: "ready" }) };
const fakeScope = {
  settingsScope: { bind: () => ({ set: async () => {} }), describe: () => ({ subscribe: () => () => {}, ensure: async () => {}, getSnapshot: () => ({ status: "unavailable", error: null }), acceptView: () => {} }) },
  remote: { settings: { mutate: async () => ({ ok: true, value: {} }) } },
  settingsSchema: { describe: () => ({ namespaces: [] }), rehydrate: (v) => v, nodeAtPath: () => undefined },
  sessions: { list: noopStore, binding: () => undefined, refresh: async () => {}, subagentAddress: () => undefined },
  modelDirectories: { directoryFor: () => ({ store: directory, load: () => Promise.resolve(), select: seatProps.select }) },
  slots: { inject: (name, factory) => factory(), register: (options, component) => { registrations.set(options.name, component); return () => {}; } },
};
const ctx = {
  effect: (body) => { const dispose = body(); return typeof dispose === "function" ? dispose : () => {}; },
  inject: (names, callback) => { callback(fakeScope); },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: fakeScope.slots,
  get: () => undefined,
};
captured.factory(requireStub).apply(ctx);
const ModelSeat = registrations.get("conversation.input.model");
if (ModelSeat === undefined) throw new Error("the model seat was never registered");

const container = document.getElementById("root");
const root = ReactDOMClient.createRoot(container);
const Seat = () => React.createElement(ModelSeat, { ...seatProps, t: seatT });

const fail = (message) => { console.error("DOM CHECK FAILED:", message); process.exit(1); };

(async () => {
  await act(async () => { root.render(React.createElement(Seat)); });

  const trigger = document.querySelector(".dshk-trigger");
  if (trigger === null) fail("no model trigger rendered");
  if (document.querySelector(".dshk-searchInput") !== null) fail("the search box rendered while the menu was closed");

  // open the menu — the root level the user sees first
  await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

  const cells = [...document.querySelectorAll(".dshk-cell")];
  if (cells.length !== 2) fail("the root level should hold the Model and Effort rows, saw " + cells.length);
  if (document.querySelector(".dshk-searchInput") !== null) fail("the root level renders the search box");

  // drill into the model list — the level that carries the search field
  const modelCell = cells.find((node) => node.textContent.includes("模型"));
  if (modelCell === undefined) fail("the root menu offers no model drill-in row");
  await act(async () => { modelCell.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

  const input = document.querySelector(".dshk-searchInput");
  if (input === null) fail("the model list has no search box");
  const menu = document.querySelector(".dshk-menu");
  if (menu === null) fail("the menu did not render");

  // The search box must come BEFORE every model option in document order.
  const controls = [...menu.querySelectorAll(".dshk-searchInput, [role=menuitemradio]")];
  if (controls[0] !== input) fail("the search box is not above the model options, order=" + controls.map((n) => n.className).join(","));
  const optionCount = menu.querySelectorAll("[role=menuitemradio]").length;
  if (optionCount !== 3) fail("expected 3 model options, saw " + optionCount);

  // placeholder must be a real translation, not a raw key
  if (input.getAttribute("placeholder") === "searchPlaceholder") fail("the placeholder is a raw dictionary key");
  const placeholder = input.getAttribute("placeholder");

  // Typing filters the list. NOTE: under jsdom, React's synthetic onChange does
  // not fire for dispatched input events (only onInput does), so the harness
  // drives the controlled input through React's own onChange prop — the same
  // handler a real keystroke invokes in Chromium.
  await act(async () => {
    const reactPropsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
    if (reactPropsKey === undefined) fail("could not reach the input's React props");
    input[reactPropsKey].onChange({ target: { value: "beta" } });
  });
  const visible = [...menu.querySelectorAll("[role=menuitemradio]")].map((n) => n.textContent.trim());
  if (visible.length !== 1 || !visible[0].includes("Beta Two")) fail("filtering by 'beta' produced " + JSON.stringify(visible));

  // Enter switches to the first match
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  if (selectCalls.length !== 1) fail("Enter did not switch models, calls=" + JSON.stringify(selectCalls));
  if (selectCalls[0].model !== "beta-2") fail("Enter selected " + JSON.stringify(selectCalls[0]));

  console.log("DOM CHECK OK: search box is first in the model list, placeholder=" + JSON.stringify(placeholder) +
    ", filter narrowed 3 -> 1, Enter selected " + selectCalls[0].model);
  process.exit(0);
})().catch((error) => fail(error.message));