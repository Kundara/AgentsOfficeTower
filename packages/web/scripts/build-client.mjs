import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");

await build({
  entryPoints: [resolve(packageRoot, "src/client/index.ts")],
  outfile: resolve(packageRoot, "dist/client/app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  sourcemap: true,
  logLevel: "info"
});

