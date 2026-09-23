/**
 * dsh-hotkey-toolkit — host half.
 *
 * No-op: every feature (global hotkeys, mode switching, the model-search seat)
 * lives in the browser half at ./client.js. The node half exists only so the
 * loader has a row to mount, which is also what makes client-modules scan the
 * package for its `dsh.client` declaration.
 */

/** Plugin entry — no-op apply for the loader to mount. */
function apply() {}

export { apply };
