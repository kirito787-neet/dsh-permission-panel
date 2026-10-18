/**
 * Binding audit: prove the plugin's declared shortcut defaults are registrable.
 *
 * This is the guard for the single most dangerous failure mode in the whole
 * plugin. `ShortcutRegistry.register()` validates EVERY declared default against
 * all six `runtime:platform` profiles at once — not just the device in front of
 * the user — and throws on a reserved key, a web-illegal combination, or an
 * overlap with another command's default. That throw escapes through
 * `ctx.effect` and takes the entire plugin activation down with it.
 *
 * So the defaults are not a cosmetic choice; they are a load-bearing invariant.
 * Rather than trusting a comment, this suite re-implements the official
 * validators (`normalizeBinding`, `isWebBindingAllowed`, `bindingIssue`,
 * `overlappingBindings`) faithfully from
 * `packages/client/shortcuts/src/{binding,configuration}.ts`, extracts the real
 * tables out of client.js, and asserts every combination passes — including
 * against the official core defaults that are already registered.
 *
 * Usage: node test/binding-audit.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

// ---- extract the real tables out of the module source ----
const grabObject = (name) => {
  const start = source.indexOf("const " + name + " = {");
  if (start < 0) throw new Error("missing table: " + name);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return Function("return " + source.slice(open, i + 1))();
    }
  }
  throw new Error("unterminated table: " + name);
};

const desktopBindings = grabObject("DESKTOP_BINDINGS");

// ---- official validators, mirrored from the checkout ----
// packages/client/shortcuts/src/binding.ts:27-33
const keyNames = {
  Slash: "/", Comma: ",", Period: ".", Backslash: "\\", Backquote: "`", Minus: "-", Equal: "=",
  BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Enter: "Enter",
  Escape: "Esc", Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
  ArrowUp: "\u2191", ArrowDown: "\u2193", ArrowLeft: "\u2190", ArrowRight: "\u2192",
};
const modifierOrder = ["control", "alt", "shift", "meta"];

// binding.ts:41-53
function normalizeBinding(binding, platform) {
  const codes = [binding.code, ...(binding.secondCode === undefined ? [] : [binding.secondCode])];
  codes.sort();
  for (const code of codes) {
    if (!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4]))$/u.test(code)
      && !Object.prototype.hasOwnProperty.call(keyNames, code)) {
      throw new Error("Unsupported shortcut code: " + code);
    }
  }
  if (codes.length === 2 && codes[0] === codes[1]) throw new Error("Shortcut keys must be distinct");
  const modifiers = new Set(binding.modifiers.map((value) =>
    value === "primary" ? (platform === "macos" ? "meta" : "control") : value));
  return {
    code: codes[0],
    ...(codes[1] === undefined ? {} : { secondCode: codes[1] }),
    modifiers: modifierOrder.filter((value) => modifiers.has(value)),
  };
}

// binding.ts:60-63
function bindingKey(binding) {
  const codes = binding.secondCode === undefined ? [binding.code] : [binding.code, binding.secondCode].sort();
  return [...binding.modifiers, ...codes].join("+");
}

// binding.ts:96-112
function isWebBindingAllowed(binding, platform) {
  if (binding.secondCode !== undefined) return false;
  if (platform === "windows" || platform === "macos") {
    if (binding.modifiers.length >= 3) return true;
    const primary = platform === "macos" ? "meta" : "control";
    if (binding.modifiers.length === 1
      && ((["Comma", "Backslash"].includes(binding.code) && binding.modifiers[0] === primary)
        || (binding.code === "Backquote" && binding.modifiers[0] === "control"))) return true;
    if (binding.modifiers.length === 2 && binding.modifiers.includes(primary)
      && (binding.modifiers.includes("alt") || binding.modifiers.includes("shift"))) return true;
  }
  return [
    { code: "Slash", modifiers: ["primary"] },
    { code: "Comma", modifiers: ["primary", "shift"] },
    { code: "Period", modifiers: ["primary", "shift"] },
  ].some((candidate) => bindingKey(binding) === bindingKey(normalizeBinding(candidate, platform)));
}

// configuration.ts:96-113
function bindingIssue(binding, runtime, platform) {
  const { code, modifiers } = binding;
  if (runtime === "desktop" && (platform === "windows" || platform === "macos")) return null;
  if (binding.secondCode !== undefined) return "unsupported-key";
  if (modifiers.length === 0 || modifiers.every((modifier) => modifier === "shift")) return "modifier-required";
  if ((platform === "windows" || platform === "macos") && modifiers.length >= 3) return null;
  if (runtime === "web" && (platform === "windows" || platform === "macos") && isWebBindingAllowed(binding, platform)) return null;
  const primary = modifiers.includes(platform === "macos" ? "meta" : "control");
  if (["Escape", "Tab", "Space", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)
    || (code === "Enter" && !modifiers.includes("alt"))
    || (primary && ["KeyC", "KeyV", "KeyX", "KeyZ", "KeyY", "KeyQ", "KeyH"].includes(code))
    || (primary && code === "KeyA" && !modifiers.includes("shift"))
    || (platform !== "macos" && (modifiers.includes("meta") || (modifiers.includes("alt") && ["F4", "F2"].includes(code))))
    || (platform === "macos" && modifiers.includes("control") && modifiers.includes("meta"))
    || (platform === "macos" && modifiers.includes("alt") && !primary)) return "reserved";
  if (runtime === "web" && !isWebBindingAllowed(binding, platform)) return "unsupported-browser";
  return null;
}

// configuration.ts:160-164
function overlappingBindings(left, right) {
  if (left.modifiers.join("+") !== right.modifiers.join("+")) return false;
  if (left.secondCode !== undefined && right.secondCode !== undefined) return bindingKey(left) === bindingKey(right);
  return [left.code, left.secondCode].some((code) => code !== undefined && (code === right.code || code === right.secondCode));
}

// ---- the official core defaults this plugin must not collide with ----
// Every default registered by the shipped client packages, transcribed from
// ui-layout, ui-workspace, ui-open-in-app, ui-shortcuts, ui-settings-general,
// ui-sidebar-{right,browser,files,terminal}. The audit checks real overlap
// against these, so adding a colliding default fails here instead of at runtime.
const primary = (code) => ({ code, modifiers: ["primary"] });
const CORE_DEFAULTS = {
  "sidebar.left.toggle": {
    "desktop:macos": primary("KeyB"), "desktop:windows": primary("KeyB"), "desktop:linux": primary("KeyB"),
    "web:macos": { code: "KeyB", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyB", modifiers: ["primary", "alt"] },
  },
  "session.new": {
    "desktop:macos": primary("KeyN"), "desktop:windows": primary("KeyN"), "desktop:linux": primary("KeyN"),
    "web:macos": { code: "KeyN", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyN", modifiers: ["primary", "alt"] },
  },
  "session.search": {
    "desktop:macos": primary("KeyK"), "desktop:windows": primary("KeyK"), "desktop:linux": primary("KeyK"),
    "web:macos": { code: "KeyK", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyK", modifiers: ["primary", "alt"] },
  },
  "workspace.add": {
    "desktop:macos": primary("KeyO"), "desktop:windows": primary("KeyO"), "desktop:linux": primary("KeyO"),
    "web:macos": { code: "KeyO", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyO", modifiers: ["primary", "alt"] },
  },
  "session.rename": {
    "desktop:macos": { code: "KeyR", modifiers: ["primary", "alt"] },
    "desktop:windows": { code: "KeyR", modifiers: ["primary", "alt"] },
    "desktop:linux": { code: "KeyR", modifiers: ["primary", "alt"] },
    "web:macos": { code: "KeyR", modifiers: ["primary", "shift"] },
    "web:windows": { code: "KeyR", modifiers: ["primary", "shift"] },
  },
  "session.fork": {
    "desktop:macos": { code: "KeyF", modifiers: ["primary", "alt"] },
    "desktop:windows": { code: "KeyF", modifiers: ["primary", "alt"] },
    "desktop:linux": { code: "KeyF", modifiers: ["primary", "alt"] },
    "web:macos": { code: "KeyF", modifiers: ["primary", "shift"] },
    "web:windows": { code: "KeyF", modifiers: ["primary", "shift"] },
  },
  "session.archive": {
    "desktop:macos": { code: "KeyA", modifiers: ["primary", "shift"] },
    "desktop:windows": { code: "KeyA", modifiers: ["primary", "shift"] },
    "desktop:linux": { code: "KeyA", modifiers: ["primary", "shift"] },
    "web:macos": { code: "KeyA", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyA", modifiers: ["primary", "alt"] },
  },
  "workspace.openLocal": {
    "desktop:macos": { code: "KeyO", modifiers: ["primary", "alt"] },
    "desktop:windows": { code: "KeyO", modifiers: ["primary", "alt"] },
    "desktop:linux": { code: "KeyO", modifiers: ["primary", "alt"] },
    "web:macos": { code: "KeyO", modifiers: ["primary", "shift"] },
    "web:windows": { code: "KeyO", modifiers: ["primary", "shift"] },
  },
  "shortcuts.open": {
    "desktop:macos": primary("Slash"), "desktop:windows": primary("Slash"), "desktop:linux": primary("Slash"),
    "web:macos": primary("Slash"), "web:windows": primary("Slash"), "web:linux": primary("Slash"),
  },
  "settings.open": {
    "desktop:macos": primary("Comma"), "desktop:windows": primary("Comma"), "desktop:linux": primary("Comma"),
    "web:macos": primary("Comma"), "web:windows": primary("Comma"),
  },
  "sidebar.right.toggle": {
    "desktop:macos": { code: "KeyB", modifiers: ["primary", "alt"] },
    "desktop:windows": { code: "KeyB", modifiers: ["primary", "alt"] },
    "desktop:linux": { code: "KeyB", modifiers: ["primary", "alt"] },
    "web:macos": { code: "KeyB", modifiers: ["primary", "shift"] },
    "web:windows": { code: "KeyB", modifiers: ["primary", "shift"] },
  },
  "pane.split": {
    "desktop:macos": primary("Backslash"), "desktop:windows": primary("Backslash"), "desktop:linux": primary("Backslash"),
    "web:macos": primary("Backslash"), "web:windows": primary("Backslash"),
  },
  "pane.fullscreen.toggle": {
    "desktop:macos": { code: "Enter", modifiers: ["primary", "alt"] },
    "desktop:windows": { code: "Enter", modifiers: ["primary", "alt"] },
    "desktop:linux": { code: "Enter", modifiers: ["primary", "alt"] },
    "web:macos": { code: "Enter", modifiers: ["primary", "alt"] },
    "web:windows": { code: "Enter", modifiers: ["primary", "alt"] },
  },
  "page.close": {
    "desktop:macos": primary("KeyW"), "desktop:windows": primary("KeyW"), "desktop:linux": primary("KeyW"),
    "web:macos": { code: "KeyW", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyW", modifiers: ["primary", "alt"] },
  },
  "page.refresh": {
    "desktop:macos": primary("KeyR"), "desktop:windows": primary("KeyR"), "desktop:linux": primary("KeyR"),
    "web:windows": { code: "KeyR", modifiers: ["primary", "alt"] },
  },
  "workspace.files": {
    "desktop:macos": primary("KeyP"), "desktop:windows": primary("KeyP"), "desktop:linux": primary("KeyP"),
    "web:macos": { code: "KeyP", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyP", modifiers: ["primary", "alt"] },
  },
  "browser.new": {
    "desktop:macos": primary("KeyT"), "desktop:windows": primary("KeyT"), "desktop:linux": primary("KeyT"),
    "web:macos": { code: "KeyT", modifiers: ["primary", "alt"] },
    "web:windows": { code: "KeyT", modifiers: ["primary", "alt"] },
  },
  "terminal.new": {
    "desktop:macos": { code: "Backquote", modifiers: ["control"] },
    "desktop:windows": { code: "Backquote", modifiers: ["control"] },
    "desktop:linux": { code: "Backquote", modifiers: ["control"] },
    "web:macos": { code: "Backquote", modifiers: ["control"] },
    "web:windows": { code: "Backquote", modifiers: ["control"] },
  },
};

const RUNTIMES = ["desktop", "web"];
const PLATFORMS = ["macos", "windows", "linux"];

// ---- the plugin's own declared commands, rebuilt exactly as client.js builds them ----
// Desktop profiles only, by design; the Web profiles are intentionally unbound.
const ACTIONS = ["restart"];
const own = {};
for (const action of ACTIONS) {
  const binding = desktopBindings[action];
  own["permissionPanel." + action] = {
    "desktop:macos": binding, "desktop:windows": binding, "desktop:linux": binding,
  };
}

let checks = 0;

// 1. Every declared default must survive the full official validation sweep.
for (const [id, defaults] of Object.entries(own)) {
  for (const runtime of RUNTIMES) {
    for (const platform of PLATFORMS) {
      const candidate = defaults[runtime + ":" + platform];
      if (candidate === undefined) continue;
      checks++;
      let binding;
      try {
        binding = normalizeBinding(candidate, platform);
      } catch (error) {
        throw new Error(id + " (" + runtime + ":" + platform + "): normalizeBinding threw: " + error.message);
      }
      if (runtime === "web" && !isWebBindingAllowed(binding, platform)) {
        throw new Error(id + " (" + runtime + ":" + platform + "): not web-legal; register() would throw 'Unsupported Web shortcut'");
      }
      const issue = bindingIssue(binding, runtime, platform);
      if (issue !== null) {
        throw new Error(id + " (" + runtime + ":" + platform + "): reserved/unsupported (" + issue + "); register() would throw 'Reserved shortcut default'");
      }
    }
  }
}

// 2. No overlap with any official core default, on any profile.
for (const [id, defaults] of Object.entries(own)) {
  for (const runtime of RUNTIMES) {
    for (const platform of PLATFORMS) {
      const candidate = defaults[runtime + ":" + platform];
      if (candidate === undefined) continue;
      const mine = normalizeBinding(candidate, platform);
      for (const [coreId, coreDefaults] of Object.entries(CORE_DEFAULTS)) {
        const theirs = coreDefaults[runtime + ":" + platform];
        if (theirs === undefined) continue;
        checks++;
        if (overlappingBindings(mine, normalizeBinding(theirs, platform))) {
          throw new Error(id + " (" + runtime + ":" + platform + ") collides with official " + coreId
            + "; register() would throw 'Conflicting shortcut defaults'");
        }
      }
    }
  }
}

// 3. No overlap among the plugin's own commands.
const ownIds = Object.keys(own);
for (let i = 0; i < ownIds.length; i++) {
  for (let j = i + 1; j < ownIds.length; j++) {
    for (const runtime of RUNTIMES) {
      for (const platform of PLATFORMS) {
        const a = own[ownIds[i]][runtime + ":" + platform];
        const b = own[ownIds[j]][runtime + ":" + platform];
        if (a === undefined || b === undefined) continue;
        checks++;
        if (overlappingBindings(normalizeBinding(a, platform), normalizeBinding(b, platform))) {
          throw new Error(ownIds[i] + " and " + ownIds[j] + " overlap on " + runtime + ":" + platform);
        }
      }
    }
  }
}

// 4. The audit itself must be able to FAIL — prove the validators reject a bad default.
// Without this, a silently-broken mirror would make every assertion above vacuous.
// Each validator signals rejection differently, so each is probed on its own terms:
// `isWebBindingAllowed` returns false, `bindingIssue` returns a reason, and
// `normalizeBinding` throws.
const mustBeWebIllegal = (label, binding, platform) => {
  if (isWebBindingAllowed(normalizeBinding(binding, platform), platform)) {
    throw new Error("the audit is not actually validating: " + label + " was admitted as web-legal");
  }
};
const mustHaveIssue = (label, binding, runtime, platform) => {
  if (bindingIssue(normalizeBinding(binding, platform), runtime, platform) === null) {
    throw new Error("the audit is not actually validating: " + label + " passed the reservation table");
  }
};
const mustThrowCode = (label, binding) => {
  let threw = false;
  try { normalizeBinding(binding, "windows"); } catch { threw = true; }
  if (!threw) throw new Error("the audit is not actually validating: " + label + " was accepted as a code");
};

mustBeWebIllegal("Ctrl+R (the official page.refresh desktop binding)", { code: "KeyR", modifiers: ["primary"] }, "windows");
mustBeWebIllegal("Ctrl+Shift+R on web:linux", { code: "KeyR", modifiers: ["primary", "shift"] }, "linux");
mustHaveIssue("bare Escape", { code: "Escape", modifiers: [] }, "web", "windows");
mustHaveIssue("Ctrl+C (reserved editor key)", { code: "KeyC", modifiers: ["primary"] }, "web", "windows");
mustThrowCode("an unsupported code", { code: "Numpad0", modifiers: ["primary"] });

// 5. The ids must satisfy the official commandPattern.
const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u;
for (const id of Object.keys(own)) {
  if (!COMMAND_ID_PATTERN.test(id)) {
    throw new Error("command id " + JSON.stringify(id) + " violates the official commandPattern; "
      + "it would register but corrupt the shortcut document on first edit");
  }
}

// 6. The Web profiles must stay UNBOUND — that is the deliberate design, not an
// oversight, and a future edit that "helpfully" adds web defaults should fail
// here. This is the exact trap the audit was written for: `web:linux` admits only
// Mod+/, Mod+Shift+, and Mod+Shift+., and on Web Ctrl+Shift+R / Ctrl+Alt+R are
// already session.rename / page.refresh.
for (const [id, defaults] of Object.entries(own)) {
  for (const profile of Object.keys(defaults)) {
    if (profile.startsWith("web:")) {
      throw new Error(id + " declares a Web default (" + profile + "); Desktop-only actions must omit Web profiles");
    }
  }
}
checks++;

console.log(
  "binding-audit ok: " + checks + " default/profile combinations validated against "
  + Object.keys(CORE_DEFAULTS).length + " official core defaults; "
  + Object.keys(own).length + " commands (restart only); "
  + "web profiles unbound; negative controls reject Ctrl+R/bare-Escape/Ctrl+C/Numpad0",
);