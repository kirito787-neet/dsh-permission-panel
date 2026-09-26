/**
 * Empirical check: does a nested `ctx.inject([...], cb)` need its OWN dotted
 * `remote.*` entries, or do the parent fiber's entries cover it?
 *
 * This decides whether the permission panel — which binds its settings scope
 * inside `ctx.inject(['remote', 'settingsSchema'], …)` and then reads
 * `scope.remote.settings` — actually works with the plugin's top-level inject
 * list. The plugin's fix assumed the top-level array suffices; this runs REAL
 * cordis to confirm it instead of trusting a stub.
 *
 * HOW THE REAL SYSTEM WORKS (and what this probe must reproduce):
 * the Gateway mounts each namespace as its OWN service named `remote.<ns>`
 * (`remoteServiceKey`). Reading `ctx.remote.settings` therefore goes through the
 * `remote` service's tracker, whose `associate` is `remote`: the traceable proxy
 * sees that `remote.settings` exists in `ctx.reflect.props` and REDIRECTS the
 * read to `ctx['remote.settings']`. That redirect is resolved against the
 * READING fiber's inject set — which is exactly why a plain `remote` entry does
 * not cover its children.
 *
 * Usage: node tools/probe-inject.cjs
 */
const CORDIS = "C:/Users/Kirito787/AppData/Local/Programs/deepseek-harness/vendor/cordis/lib/index.js";

(async () => {
  const { Context, Service } = await import("file://" + CORDIS);

  /** Stand-in for `ctx.remote`: a real Service that owns nested namespace children. */
  class FakeRemote extends Service {
    constructor(ctx) {
      super(ctx, "remote");
      // The Gateway installs these as separate services; the probe registers
      // them in the plugin's own scope so the redirect target exists.
      ctx.provide("remote.settings", { describe: () => "described" });
      ctx.provide("remote.permissionPresets", { catalog: () => "cataloged" });
      ctx.provide("remote.session", { noop: () => "session" });
    }
  }

  /**
   * Run one scenario.
   * @param topInject - names for the OUTER inject (the plugin's own fiber).
   * @param nestedInject - names for the INNER inject (the panel's binding).
   * @param read - invoked with the inner scope.
   * @returns a description of what happened.
   */
  const scenario = (topInject, nestedInject, read) => new Promise((resolve) => {
    const root = new Context();
    root.plugin({
      inject: [],
      apply(ctx) { new FakeRemote(ctx); },
    });

    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    root.inject(topInject, (ctx) => {
      ctx.inject(nestedInject, (inner) => {
        try {
          done("value=" + read(inner));
        } catch (error) {
          done("THREW: " + error.message);
        }
      });
      setTimeout(() => done("inner-never-ran"), 40);
    });
    setTimeout(() => done("top-never-ran"), 80);
  });

  const readSettings = (inner) => inner.remote.settings.describe();

  console.log("A parent=[remote,remote.settings] nested=[remote]         ->",
    await scenario(["remote", "remote.settings"], ["remote"], readSettings));
  console.log("B parent=[remote]                 nested=[remote]         ->",
    await scenario(["remote"], ["remote"], readSettings));
  console.log("C parent=[remote,remote.settings] nested=[]                ->",
    await scenario(["remote", "remote.settings"], [], readSettings));
  console.log("D parent=[remote,remote.settings] nested=[remote.settings] ->",
    await scenario(["remote", "remote.settings"], ["remote.settings"], readSettings));
  console.log("E parent=[remote]                 nested=[remote.settings]->",
    await scenario(["remote"], ["remote.settings"], readSettings));
  console.log("F nested=[workspaces] (absent service)                    ->",
    await scenario(["remote"], ["workspaces"], (inner) => inner.workspaces));
  console.log("G parent=[remote,remote.settings] nested=[remote] read permissionPresets ->",
    await scenario(["remote", "remote.settings"], ["remote"], (inner) => inner.remote.permissionPresets.catalog()));
  console.log("H parent=[remote,remote.session,remote.settings] nested=[remote] read session ->",
    await scenario(["remote", "remote.session", "remote.settings"], ["remote"], (inner) => inner.remote.session.noop()));
  /*
   * I is the DECISIVE case: it models the plugin exactly. The top-level inject
   * array is the plugin's own; the panel then binds its scope inside a NESTED
   * `ctx.inject(['remote', 'settingsSchema'], …)`. Both namespaces must be
   * readable from that inner scope, and they are — because cordis walks UP the
   * fiber chain, so the plugin's own array covers the nested fiber.
   */
  console.log("I parent=[remote,remote.settings,remote.permissionPresets] nested=[remote] read BOTH ->",
    await scenario(
      ["remote", "remote.settings", "remote.permissionPresets"],
      ["remote"],
      (inner) => inner.remote.settings.describe() + "/" + inner.remote.permissionPresets.catalog(),
    ));
  /*
   * J: the SAME nested scope, but with the plugin array missing
   * `remote.permissionPresets` — the shipped bug. Reading the catalog must
   * throw, which is what the panel swallowed into "unavailable".
   */
  console.log("J parent=[remote,remote.settings] (missing permissionPresets) nested=[remote] read catalog ->",
    await scenario(
      ["remote", "remote.settings"],
      ["remote"],
      (inner) => inner.remote.permissionPresets.catalog(),
    ));
})();
