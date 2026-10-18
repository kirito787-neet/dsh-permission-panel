/**
 * Compose the web profile with the real DSH CLI and report whether this plugin
 * is mounted, without booting the app.
 *
 * `dsh --dump-config` prints the fully composed loader tree (every bundle layer
 * plus the user's own patch layer) and exits. Running it here proves the
 * installed plugin actually resolves into the profile rather than merely sitting
 * in package.json.
 *
 * The child's stdout is captured through a temporary FILE rather than a pipe:
 * under the DSH file sandbox a child process cannot open a named pipe, so
 * `execFileSync` with the default piped stdio fails with EPERM. `stdio: 'ignore'`
 * plus `-o` redirection is not available here either (it is the CLI's stdout),
 * so the dump is written with `stdio: ['ignore', fd, 'ignore']`.
 *
 * Usage: node tools/verify-profile.cjs [profile]
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const profile = process.argv[2] ?? "web";
const DSH = "C:/Users/Kirito787/AppData/Local/Programs/deepseek-harness";
const bin = path.join(DSH, "apps", "cli", "lib", "bin.js");

// Write the child's stdout straight to a file descriptor: no pipe is involved,
// so the sandbox's pipe restriction does not apply.
const dumpPath = path.join(os.tmpdir(), "dsh-dump-config-" + process.pid + ".yaml");
const errPath = path.join(os.tmpdir(), "dsh-dump-config-" + process.pid + ".err");
const fd = fs.openSync(dumpPath, "w");
const errFd = fs.openSync(errPath, "w");
let status;
try {
  const result = spawnSync(process.execPath, [bin, "--profile", profile, "--dump-config"], {
    stdio: ["ignore", fd, errFd],
  });
  status = result.status;
} finally {
  fs.closeSync(fd);
  fs.closeSync(errFd);
}

let dumped = "";
let stderr = "";
try {
  dumped = fs.readFileSync(dumpPath, "utf8");
  stderr = fs.readFileSync(errPath, "utf8");
} catch { /* handled by the emptiness check below */ }
fs.rmSync(dumpPath, { force: true });
fs.rmSync(errPath, { force: true });

if (status !== 0 || dumped.trim() === "") {
  console.error("could not compose profile " + profile + " (exit=" + status + ", bytes=" + dumped.length + ")");
  if (stderr.trim() !== "") console.error(stderr.trim());
  process.exit(1);
}

// The composed tree is YAML; look for the plugin's loader row by id and name.
const lines = dumped.split(/\r?\n/u);
const rows = [];
for (let i = 0; i < lines.length; i++) {
  if (!/dsh-permission-panel/u.test(lines[i])) continue;
  // Capture the row this line belongs to: walk back to the nearest "- id:".
  let id = null;
  for (let back = i; back >= 0 && back > i - 12; back--) {
    const match = /^\s*-\s*id:\s*(\S+)/u.exec(lines[back]);
    if (match) { id = match[1]; break; }
  }
  rows.push({ line: lines[i].trim(), id });
}

if (rows.length === 0) {
  console.error("FAILED: dsh-permission-panel does not appear in the composed " + profile + " profile");
  process.exit(1);
}

// The plugin must appear as a loader row (id + name), not only as a stray string.
const rowIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];
if (!rowIds.includes("dsh-permission-panel")) {
  console.error("FAILED: found the name but no loader row with id 'dsh-permission-panel'; saw " + JSON.stringify(rowIds));
  process.exit(1);
}

// The client half must be reachable through the package's exports map.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const clientExport = pkg.exports["./client"];
const clientPath = typeof clientExport === "string" ? clientExport : clientExport?.default;
if (typeof clientPath !== "string") {
  console.error("FAILED: package.json has no resolvable exports['./client']");
  process.exit(1);
}
if (!fs.existsSync(path.join(__dirname, "..", clientPath))) {
  console.error("FAILED: exports['./client'] points at " + clientPath + " which does not exist");
  process.exit(1);
}
if (pkg.dsh?.client?.platform !== "web") {
  console.error("FAILED: dsh.client.platform must be \"web\"; saw " + JSON.stringify(pkg.dsh?.client?.platform));
  process.exit(1);
}
if (!pkg.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-shortcuts")) {
  console.error("FAILED: dsh.client.inject does not list @deepseek-ai/dsh-client-shortcuts");
  process.exit(1);
}

console.log(
  "profile-verify ok: " + profile + " mounts row id=dsh-permission-panel"
  + " client=" + clientPath + " platform=web"
  + " shortcuts-inject=1",
);