import { defineConfig } from "tsup";

/**
 * Build 1 of 2 — the ESM build. **Run `npm run build`, not `tsup`.**
 *
 * The two builds used to be two entries in one array in `tsup.config.ts`, and
 * that was a bug (BUG-026). tsup maps over an array config with `Promise.all`,
 * so array entries run **concurrently**, not in order — and this entry's
 * `clean: true` therefore raced the other one's declaration step and deleted
 * `dist/index.d.cts` after it had been written. tsup even logged
 * `DTS dist/index.d.cts 76.33 KB` on its way out. `package.json` points
 * `exports.require.types` at that file, so every `require()` consumer on
 * `node16`/`nodenext` resolution silently got implicit `any` for the whole SDK.
 *
 * Splitting the array into two config files and chaining them with `&&` is what
 * makes the order real: this build runs first and cleans, the CJS build runs
 * second and does not. `clean: false` on both would also have stopped the
 * deletion, and would have left yesterday's modules in `dist` forever — a
 * renamed or deleted source file keeps shipping. One clean, at the front, is
 * the version of this that stays honest.
 *
 * There is deliberately no `tsup.config.ts`: a bare `tsup` has no config to
 * find and fails loudly, rather than half-building `dist` and looking finished.
 *
 * # The ESM build is deliberately **not** bundled
 *
 * SDK-W5 requires that a customer importing only `searchFoods` does not ship
 * the diary client. `sideEffects: false` in package.json is necessary for that
 * and is not sufficient: a bundler can only drop what it can see as separate,
 * and once tsup has flattened fourteen modules into one `dist/index.js` the
 * boundaries are gone.
 *
 * It is worse than "less effective". Several classes here carry a computed
 * method key — `[Symbol.for("nodejs.util.inspect.custom")]`, which is what
 * makes a credential print as `tc_sk_live_…kM3` instead of leaking into a log.
 * esbuild cannot prove a computed key is side-effect-free, so inside a flat
 * bundle those class declarations are retained, and everything they reference
 * is retained with them. Measured: importing `searchFoods` alone from the
 * bundled build kept `TrackCore`, `batchFoods` and the whole ETag cache —
 * 26.8 KB against 28.6 KB for importing the entire SDK, which is no
 * tree-shaking at all. From unbundled source the same import drops every one
 * of them.
 *
 * So the ESM build emits one file per module and lets the customer's own
 * bundler do the work, which is the only place it can be done properly anyway.
 */
export default defineConfig({
  name: "esm",
  entry: ["src/**/*.ts"],
  format: ["esm"],
  bundle: false,
  dts: true,
  sourcemap: true,
  // The one clean in the whole build, and it has to be in the build that runs
  // first. See the note above before moving it.
  clean: true,
  target: "es2022",
  outDir: "dist",
});
