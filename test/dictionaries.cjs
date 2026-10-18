/**
 * Dictionary integrity test.
 *
 * The Host's localization does NOT fall back across namespaces: a key that is
 * missing from the namespace it is looked up in renders as its own raw key name
 * in the UI. A missing `zh`/`en` counterpart is equally visible — one language
 * silently shows the other's string.
 *
 * So this suite asserts three things about the real client.js:
 *   1. `zh` and `en` carry identical key sets;
 *   2. every key the code looks up at runtime actually exists;
 *   3. every key the shortcut commands use for their official-list labels exists
 *      (these are built dynamically, so a typo would otherwise only surface as a
 *      raw key inside 设置 → 快捷键).
 *
 * The seat's own namespace (`permissionPanel.seat`) used to be checked here as
 * well. The searchable model seat moved to `dsh-client-ui-effort-slider` and took
 * its dictionary with it, so that namespace no longer exists in this plugin.
 *
 * Usage: node test/dictionaries.cjs [path/to/client.js]
 */
const fs = require("fs");
const path = require("path");

const clientPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "client.js"));
const source = fs.readFileSync(clientPath, "utf8");

/** Evaluate one dictionary literal out of the module source. */
const grabObject = (name) => {
  const start = source.indexOf("const " + name + " = {");
  if (start < 0) throw new Error("missing dictionary: " + name);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return Function("return " + source.slice(open, i + 1))();
    }
  }
  throw new Error("unterminated dictionary: " + name);
};

const zh = grabObject("zh");
const en = grabObject("en");

// ---- 1. key-set parity between locales ----
{
  const a = Object.keys(zh).sort();
  const b = Object.keys(en).sort();
  if (a.join(",") !== b.join(",")) {
    const onlyA = a.filter((key) => !b.includes(key));
    const onlyB = b.filter((key) => !a.includes(key));
    throw new Error("zh/en key sets differ (zh-only=" + JSON.stringify(onlyA)
      + " en-only=" + JSON.stringify(onlyB) + ")");
  }
  if (a.length === 0) throw new Error("zh is empty");
}

const known = new Set(Object.keys(zh));

// ---- 2. every literal t("key") / text("key") lookup exists ----
// Only genuine dictionary lookups: `t(...)` / `text(...)` calls whose argument is
// a bare string literal. `createElement("div")` must not be mistaken for `t("div")`,
// so the call is anchored on a non-identifier character before `t`.
const used = new Set(
  [...source.matchAll(/(?:^|[^\w$])(?:text|t)\("([A-Za-z0-9_.]+)"\)/gmu)].map((match) => match[1]),
);
const missing = [...used].filter((key) => !known.has(key)).sort();
if (missing.length > 0) {
  throw new Error("these keys are looked up but absent from every dictionary: " + JSON.stringify(missing));
}

// ---- 3. every shortcut label key exists ----
// `contribute(...)` receives `labelKey` as either a literal or a concatenation
// whose suffix is derived from a mode id at runtime
// (`"cmdMode" + mode.charAt(0).toUpperCase() + mode.slice(1)`), so both
// spellings are expanded here.
const labelKeys = new Set();
// Literal form only — the negative lookahead keeps `"cmdMode" + …` out of this pass
// so it is expanded by the dynamic rule below instead of being checked as-is.
for (const match of source.matchAll(/labelKey:\s*"([A-Za-z0-9_]+)"(?!\s*\+)/gu)) labelKeys.add(match[1]);
for (const match of source.matchAll(/labelKey:\s*"([A-Za-z0-9_]+)"\s*\+\s*\w+\.charAt\(0\)\.toUpperCase\(\)\s*\+\s*\w+\.slice\(1\)/gu)) {
  for (const mode of ["compatibility", "extended", "advanced"]) {
    labelKeys.add(match[1] + mode.charAt(0).toUpperCase() + mode.slice(1));
  }
}
const missingLabels = [...labelKeys].filter((key) => !known.has(key)).sort();
if (missingLabels.length > 0) {
  throw new Error("shortcut label keys absent from every dictionary: " + JSON.stringify(missingLabels));
}

console.log(
  "dictionaries ok: zh/en parity=" + Object.keys(zh).length
  + " lookups=" + used.size
  + " shortcut-labels=" + labelKeys.size,
);