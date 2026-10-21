/**
 * Locate the DeepSeek Harness installation for the verification tools.
 *
 * Hard-coding one developer's home directory in a public repository is both a
 * portability bug and a small privacy leak, so the location is resolved instead:
 *
 *   1. `DSH_INSTALL_DIR` — set this when the app lives somewhere unusual.
 *      (Not `DSH_HOME`: DSH itself uses that name for the user profile folder,
 *      which is a different thing — this helper wants the INSTALL root, the one
 *      that contains `apps/` and `vendor/`.)
 *   2. The platform's standard install root:
 *        - Windows: %LOCALAPPDATA%/Programs/deepseek-harness
 *        - macOS:   /Applications/DeepSeek Harness.app/Contents/Resources
 *        - Linux:   /opt/deepseek-harness
 *
 * Nothing here talks to the app; it only builds a path.
 */
const os = require("os");
const path = require("path");

const windowsDefault = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
  "Programs",
  "deepseek-harness",
);
const macDefault = "/Applications/DeepSeek Harness.app/Contents/Resources";
const linuxDefault = "/opt/deepseek-harness";

const DSH = process.env.DSH_INSTALL_DIR
  ?? (process.platform === "win32" ? windowsDefault : process.platform === "darwin" ? macDefault : linuxDefault);

module.exports = { DSH };
