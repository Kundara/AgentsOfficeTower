#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { join } = require("node:path");

const repoRoot = join(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const defaultPort = "4181";
const requiredBuildOutputs = [
  join(repoRoot, "packages", "core", "dist", "index.js"),
  join(repoRoot, "packages", "web", "dist", "server.js"),
  join(repoRoot, "packages", "cli", "dist", "index.js"),
  join(repoRoot, "packages", "vscode", "dist", "extension.js")
];

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function printUsage() {
  console.log("Usage: npm start -- [web args]");
  console.log("");
  console.log("Examples:");
  console.log("  npm start");
  console.log("  npm start -- --port 4190");
  console.log("  npm start -- /abs/project/path --port 4181");
}

function runSync(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
}

function ensureDefaultPort(args) {
  const hasExplicitPort = args.some((arg, index) => arg === "--port" || (index > 0 && args[index - 1] === "--port") || arg.startsWith("--port="));
  if (hasExplicitPort) {
    return args;
  }
  return [...args, "--port", defaultPort];
}

async function main() {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const forwardArgs = process.argv.slice(2).filter((arg) => arg !== "--help");
  const needsInstall = !existsSync(join(repoRoot, "node_modules"));
  const needsBootstrapBuild = requiredBuildOutputs.some((path) => !existsSync(path));

  if (needsInstall) {
    console.log("Installing workspace dependencies...");
    runSync(npmCommand, ["install"]);
  }

  console.log(needsBootstrapBuild ? "Building workspace..." : "Refreshing build...");
  runSync(npmCommand, ["run", "build"]);

  const webArgs = ["packages/cli/dist/index.js", "web", ...ensureDefaultPort(forwardArgs)];
  const child = spawn(process.execPath, webArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
