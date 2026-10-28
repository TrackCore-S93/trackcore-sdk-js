import { defineConfig } from "tsup";

/**
 * Two builds, for two different consumers.
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
 *
 * # The CJS build is bundled
 *
 * `require()` cannot be tree-shaken, so preserving module structure there would
 * buy nothing and cost a directory of files.
 */
export default defineConfig([
  {
    name: "esm",
    entry: ["src/**/*.ts"],
    format: ["esm"],
    bundle: false,
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    outDir: "dist",
  },
  {
    name: "cjs",
    entry: ["src/index.ts"],
    format: ["cjs"],
    bundle: true,
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    splitting: false,
    target: "es2022",
    outDir: "dist",
    outExtension() {
      return { js: ".cjs" };
    },
  },
]);
