import { defineConfig } from "tsup";

/**
 * Build 2 of 2 — the CJS build. **Run `npm run build`, not `tsup`.**
 *
 * This one runs second, after `tsup.esm.config.ts` has finished and cleaned
 * `dist`, which is the whole point of the split: see the long note in that file
 * for why the two used to be one array and why that deleted this build's
 * `index.d.cts` (BUG-026). `clean` is `false` here because the ESM build has
 * already done it; nothing in `dist` at this point is stale.
 *
 * # The CJS build is bundled
 *
 * `require()` cannot be tree-shaken, so preserving module structure there would
 * buy nothing and cost a directory of files.
 *
 * `dts: true` with a `cjs` format in a `"type": "module"` package emits
 * `dist/index.d.cts`, which is what `exports.require.types` resolves to.
 */
export default defineConfig({
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
});
