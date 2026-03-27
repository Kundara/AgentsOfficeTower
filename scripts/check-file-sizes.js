#!/usr/bin/env node

const { statSync } = require("node:fs");
const { join, relative } = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = join(__dirname, "..");
const maxBytes = 65 * 1024;

const files = execFileSync("rg", [
  "--files",
  "packages/core/src",
  "packages/web/src",
  "packages/cli/src",
  "packages/vscode/src"
], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim().split("\n").filter(Boolean);

const violations = files
  .filter((filePath) => /\.(ts|tsx|js|mjs|cjs|css)$/.test(filePath))
  .map((filePath) => ({
    filePath,
    size: statSync(join(repoRoot, filePath)).size
  }))
  .filter((entry) => entry.size > maxBytes);

if (violations.length > 0) {
  console.error("Source files exceed the max-size guard:");
  for (const entry of violations) {
    console.error(`- ${relative(repoRoot, join(repoRoot, entry.filePath))}: ${entry.size} bytes (limit ${maxBytes})`);
  }
  process.exit(1);
}
