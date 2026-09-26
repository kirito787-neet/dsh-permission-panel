/**
 * Apply one textual mutation to client.js and report whether it landed.
 *
 * Written as a file rather than an inline `node -e`: PowerShell mangles the
 * nested quotes and backslashes an inline script needs, which silently turned a
 * mutation into a no-op and made a passing test look meaningful.
 *
 * Usage: node tools/mutate.cjs <source> <target> <from> <to>
 */
const fs = require("fs");
const [source, target, from, to] = process.argv.slice(2);
if (!source || !target || from === undefined || to === undefined) {
  console.error("usage: node tools/mutate.cjs <source> <target> <from> <to>");
  process.exit(2);
}
const text = fs.readFileSync(source, "utf8");
const count = text.split(from).length - 1;
if (count === 0) {
  console.error("mutation NOT APPLIED: the 'from' text does not occur in " + source);
  process.exit(3);
}
fs.writeFileSync(target, text.split(from).join(to));
console.log("mutation applied (" + count + " occurrence" + (count === 1 ? "" : "s") + ")");
