#!/usr/bin/env node

const { statSync } = require("node:fs");
const { join, relative } = require("node:path");
const { listSourceFiles } = require("./list-source-files");

const repoRoot = join(__dirname, "..");
const maxBytes = 65 * 1024;
const perFileMaxBytes = new Map([
  ["packages/web/src/client/app-runtime.ts", 0],
  ["packages/web/src/client/runtime/navigation-source.ts", 170 * 1024],
  ["packages/web/src/client/runtime/render-source.ts", 70 * 1024],
  ["packages/web/src/client/runtime/scene-source.ts", 85 * 1024],
  ["packages/web/src/client/styles.css", 75 * 1024]
]);

const files = listSourceFiles(
  repoRoot,
  [
    "packages/core/src",
    "packages/web/src",
    "packages/cli/src",
    "packages/vscode/src"
  ],
  [".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]
).map((filePath) => relative(repoRoot, filePath));

const violations = files
  .map((filePath) => ({
    filePath,
    size: statSync(join(repoRoot, filePath)).size,
    limit: perFileMaxBytes.has(filePath) ? perFileMaxBytes.get(filePath) : maxBytes
  }))
  .filter((entry) => entry.limit !== 0 && entry.size > entry.limit);

if (violations.length > 0) {
  console.error("Source files exceed the max-size guard:");
  for (const entry of violations) {
    console.error(`- ${relative(repoRoot, join(repoRoot, entry.filePath))}: ${entry.size} bytes (limit ${entry.limit})`);
  }
  process.exit(1);
}
