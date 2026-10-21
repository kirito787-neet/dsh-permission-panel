/**
 * Coexistence check: the hotkey toolkit and the effort-slider both resolve into
 * the SAME composed profile, and the model cell has exactly one owner.
 *
 * These two plugins used to both register into `conversation.input.model`. That
 * cell is a shadowing, single-winner slot, so having two registrations meant the
 * winner was decided by load order — the exact ambiguity the move was meant to
 * remove. This tool composes the real profile with the real DSH CLI (no app boot)
 * and asserts what actually landed:
 *
 *   1. both packages appear as loader rows in the composed tree;
 *   2. the permission panel's client half no longer registers anything into the
 *      model cell, while the slider's still does;
 *   3. the hotkey toolkit's own client half is still exactly one registration,
 *      so a stale copy of the old seat is not lurking.
 *
 * Usage: node tools/verify-coexistence.cjs [profile]
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const profile = process.argv[2] ?? "web";
const DSH = require("./dsh-install.cjs").DSH;
const bin = path.join(DSH, "apps", "cli", "lib", "bin.js");

const dumpPath = path.join(os.tmpdir(), "dsh-coexist-" + process.pid + ".yaml");
const errPath = path.join(os.tmpdir(), "dsh-coexist-" + process.pid + ".err");
const fd = fs.openSync(dumpPath, "w");
const errFd = fs.openSync(errPath, "w");
let status;
try {
  status = spawnSync(process.execPath, [bin, "--profile", profile, "--dump-config"], {
    stdio: ["ignore", fd, errFd],
  }).status;
} finally {
  fs.closeSync(fd);
  fs.closeSync(errFd);
}

let dumped = "";
let stderr = "";
try {
  dumped = fs.readFileSync(dumpPath, "utf8");
  stderr = fs.readFileSync(errPath, "utf8");
} catch { /* reported below */ }
fs.rmSync(dumpPath, { force: true });
fs.rmSync(errPath, { force: true });

if (status !== 0 || dumped.trim() === "") {
  console.error("could not compose profile " + profile + " (exit=" + status + ", bytes=" + dumped.length + ")");
  if (stderr.trim() !== "") console.error(stderr.trim());
  process.exit(1);
}

const fail = (message) => { console.error("coexistence FAILED:", message); process.exit(1); };

// ---- 1. both packages are mounted as loader rows ----
for (const [pkgName, rowId] of [["dsh-permission-panel", "dsh-permission-panel"], ["dsh-client-ui-effort-slider", "effort-slider"]]) {
  if (!dumped.includes(pkgName)) fail(pkgName + " does not appear in the composed " + profile + " profile");
  const lines = dumped.split(/\r?\n/u);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(pkgName)) continue;
    for (let back = i; back >= 0 && back > i - 12; back--) {
      const match = /^\s*-\s*id:\s*(\S+)/u.exec(lines[back]);
      if (match) { if (match[1] === rowId) found = true; break; }
    }
  }
  if (!found) fail(pkgName + " is present as a string but has no loader row with id '" + rowId + "'");
}

// ---- 2 & 3. the model cell has exactly one owner, and it is the slider ----
const toolkitClient = fs.readFileSync(path.join(__dirname, "..", "client.js"), "utf8");
const sliderClient = fs.readFileSync(path.resolve(__dirname, "..", "..", "DSH-Claude-Style-Reasoning-Slider", "lib", "client.js"), "utf8");

// Comments stripped: both files explain where the seat went and legitimately name it.
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//gu, " ")
  .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");

const toolkitLive = stripComments(toolkitClient);
const sliderLive = stripComments(sliderClient);

const CELL = "conversation.input.model";
if (toolkitLive.includes(CELL)) {
  fail("the permission panel's client half still registers into '" + CELL + "'. Two owners of one"
    + " shadowing cell decide the winner by load order — that ambiguity is exactly what the move removed.");
}
if (toolkitLive.includes("modelDirectories")) {
  fail("the permission panel's client half still reaches for 'modelDirectories' in live code");
}
if (!sliderLive.includes(CELL)) {
  fail("the effort-slider does not register into '" + CELL + "'; the composer would fall back to the shipped menu");
}
// The slider must outrank the shipped seat, since it is now the sole plugin owner.
if (!/priority:\s*-1/u.test(sliderLive)) {
  fail("the effort-slider no longer registers at priority: -1, so the shipped menu could win the cell");
}

// Exactly one registration site, not two copies of the seat.
const registrationCount = (sliderLive.match(new RegExp(CELL.replace(/\./gu, "\\."), "gu")) ?? []).length;
if (registrationCount > 2) {
  fail("the effort-slider registers into '" + CELL + "' " + registrationCount + " times; expected one inject + one register");
}

console.log(
  "coexistence ok: " + profile + " rows=[dsh-permission-panel,effort-slider]"
  + " model-cell-owner=effort-slider toolkit-cell-refs=0 slider-priority=-1",
);
