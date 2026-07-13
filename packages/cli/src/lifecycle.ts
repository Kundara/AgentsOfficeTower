import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { exit } from "node:process";

import { getAppDataDirectory, readAuditJournal } from "@agents-tower/core";

import { cliVersion } from "./status";

import { resolveServerTarget } from "./status";

const START_POLL_ATTEMPTS = 30;
const START_POLL_INTERVAL_MS = 500;

interface PidfileState {
  pid: number;
  port: number;
  startedAt: string;
}

function pidfilePath(): string {
  return join(getAppDataDirectory(), "web-server.pid.json");
}

function logFilePath(): string {
  return join(getAppDataDirectory(), "logs", "web-server.log");
}

function readPidfile(): PidfileState | null {
  try {
    const parsed = JSON.parse(readFileSync(pidfilePath(), "utf8")) as PidfileState;
    return Number.isFinite(parsed?.pid) ? parsed : null;
  } catch {
    return null;
  }
}

async function liveServerPid(serverBase: string): Promise<number | null> {
  try {
    const response = await fetch(`${serverBase}/api/health/live`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { pid?: number };
    return Number.isFinite(payload?.pid) ? (payload.pid as number) : null;
  } catch {
    return null;
  }
}

export type StopSafety = "safe" | "not-running" | "ownership-mismatch";

export function evaluateStopSafety(pidfilePid: number | null, livePid: number | null): StopSafety {
  if (livePid === null) {
    return "not-running";
  }
  if (pidfilePid === null || pidfilePid !== livePid) {
    return "ownership-mismatch";
  }
  return "safe";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function runStart(args: string[]): Promise<void> {
  const target = resolveServerTarget(args);
  const port = new URL(target.serverBase).port || "4181";
  const existingPid = await liveServerPid(target.serverBase);
  if (existingPid !== null) {
    console.log(`Agents Office Tower is already running at ${target.serverBase} (pid ${existingPid}).`);
    return;
  }

  mkdirSync(join(getAppDataDirectory(), "logs"), { recursive: true });
  const logFd = openSync(logFilePath(), "a");
  const entry = resolve(__dirname, "index.js");
  const child = spawn(process.execPath, [entry, "web", "--port", port], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  writeFileSync(pidfilePath(), `${JSON.stringify({ pid: child.pid, port: Number(port), startedAt: new Date().toISOString() }, null, 2)}\n`);

  for (let attempt = 0; attempt < START_POLL_ATTEMPTS; attempt += 1) {
    await delay(START_POLL_INTERVAL_MS);
    const livePid = await liveServerPid(target.serverBase);
    if (livePid !== null) {
      console.log(`Started Agents Office Tower at ${target.serverBase} (pid ${livePid}). Logs: ${logFilePath()}`);
      return;
    }
  }
  console.error(`Server did not become live within ${(START_POLL_ATTEMPTS * START_POLL_INTERVAL_MS) / 1000}s. Check logs: ${logFilePath()}`);
  exit(1);
}

export async function runStop(args: string[]): Promise<void> {
  const target = resolveServerTarget(args);
  const pidfile = readPidfile();
  const livePid = await liveServerPid(target.serverBase);
  const safety = evaluateStopSafety(pidfile?.pid ?? null, livePid);

  if (safety === "not-running") {
    console.log(`No live Agents Office Tower at ${target.serverBase}.`);
    rmSync(pidfilePath(), { force: true });
    return;
  }

  if (safety === "ownership-mismatch" && !args.includes("--force")) {
    console.error(
      `A server is live at ${target.serverBase} (pid ${livePid}) but it does not match the pidfile`
      + `${pidfile ? ` (pid ${pidfile.pid})` : " (no pidfile)"} — it may belong to another launcher. Pass --force to stop it anyway.`
    );
    exit(1);
  }

  process.kill(livePid as number, "SIGTERM");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(500);
    if (await liveServerPid(target.serverBase) === null) {
      rmSync(pidfilePath(), { force: true });
      console.log(`Stopped Agents Office Tower (pid ${livePid}).`);
      return;
    }
  }
  console.error(`Sent SIGTERM to pid ${livePid} but the server was still answering after 20s. It may still be draining observers; check again with \`aot status\` before forcing anything.`);
  exit(1);
}

export async function runRestart(args: string[]): Promise<void> {
  await runStop(args.filter((arg) => arg !== "--force").concat(args.includes("--force") ? ["--force"] : []));
  await runStart(args);
}

export function runLogs(args: string[]): void {
  const linesFlag = args.indexOf("--lines");
  const requested = linesFlag >= 0 ? Number.parseInt(args[linesFlag + 1] ?? "", 10) : 50;
  const lineCount = Number.isFinite(requested) && requested > 0 ? requested : 50;
  const path = logFilePath();
  if (!existsSync(path)) {
    console.log(`No server log at ${path} yet. Start the tower with \`aot start\`.`);
    return;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines.slice(-lineCount)) {
    console.log(line);
  }
}

export function runAudit(args: string[]): void {
  const linesFlag = args.indexOf("--lines");
  const requested = linesFlag >= 0 ? Number.parseInt(args[linesFlag + 1] ?? "", 10) : 20;
  const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
  const records = readAuditJournal(limit);
  if (args.includes("--json")) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  if (records.length === 0) {
    console.log("No audited operational actions recorded yet.");
    return;
  }
  for (const record of records) {
    const target = record.target.requestId ?? record.target.threadId ?? "";
    console.log(`${record.at} ${record.outcome.padEnd(5)} ${record.actor} ${record.action} ${record.target.projectRoot}${target ? ` ${target}` : ""}${record.detail ? ` — ${record.detail}` : ""}${record.error ? ` (${record.error})` : ""}`);
  }
}

export function buildServiceFile(platform: NodeJS.Platform, cliEntry: string, port: string): { path: string; contents: string; instructions: string } | null {
  if (platform === "darwin") {
    const path = join(homedir(), "Library", "LaunchAgents", "com.agents-tower.aot.plist");
    const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agents-tower.aot</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${cliEntry}</string>
    <string>web</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
    return { path, contents, instructions: `launchctl load ${path}` };
  }
  if (platform === "linux") {
    const path = join(homedir(), ".config", "systemd", "user", "agents-office-tower.service");
    const contents = `[Unit]
Description=Agents Office Tower

[Service]
ExecStart=${process.execPath} ${cliEntry} web --port ${port}
Restart=on-failure

[Install]
WantedBy=default.target
`;
    return { path, contents, instructions: `systemctl --user daemon-reload && systemctl --user enable --now agents-office-tower` };
  }
  return null;
}

export function runServiceInstall(args: string[]): void {
  const target = resolveServerTarget(args);
  const port = new URL(target.serverBase).port || "4181";
  const service = buildServiceFile(process.platform, resolve(__dirname, "index.js"), port);
  if (!service) {
    console.error(`Service files are not supported on ${process.platform} yet. Use \`aot start\` or your platform's task scheduler.`);
    exit(1);
  }
  mkdirSync(join(service.path, ".."), { recursive: true });
  writeFileSync(service.path, service.contents);
  console.log(`Wrote ${service.path}.`);
  console.log(`Enable it with: ${service.instructions}`);
  console.log("This command writes the service file only; loading it is left to you.");
}


export async function runUpgrade(args: string[]): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const current = cliVersion();
  let latest: string;
  try {
    const { stdout } = await execFileAsync("npm", ["view", "agents-office-tower", "version"], { timeout: 15_000 });
    latest = stdout.trim();
  } catch (error) {
    console.error(`Could not read the latest version from the registry: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  }

  if (latest === current) {
    console.log(`Already on the latest version (${current}).`);
    return;
  }

  console.log(`Upgrading agents-office-tower ${current} -> ${latest} …`);
  if (args.includes("--dry-run")) {
    console.log("Dry run: would execute `npm install -g agents-office-tower@latest`.");
    return;
  }
  try {
    await execFileAsync("npm", ["install", "-g", "agents-office-tower@latest"], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    console.error(`Upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Your current install (${current}) is untouched.`);
    exit(1);
  }
  console.log(`Upgraded to ${latest}. Roll back anytime with: npm install -g agents-office-tower@${current}`);
  console.log("Restart the tower to run the new build: aot restart");
}
