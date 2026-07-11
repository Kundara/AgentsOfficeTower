import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { env, exit } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HEALTH_FETCH_TIMEOUT_MS = 3000;

export interface ServerTarget {
  serverBase: string;
  json: boolean;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface HealthProviderRollup {
  adapterId: string;
  provider: string;
  status: string;
  detail: string | null;
  degradedProjects: number;
}

interface HealthProjectSummary {
  projectRoot: string;
  projectLabel: string;
  snapshotAgeMs: number;
  status: string;
}

interface HealthPayload {
  status: string;
  version: string;
  buildAt: string;
  startedAt: string;
  pid: number;
  host: string;
  port: number;
  projectCount: number;
  projects: HealthProjectSummary[];
  providers: HealthProviderRollup[];
  notes: string[];
}

function normalizeHost(host: string): string {
  return host === "0.0.0.0" || host === "::" || host === "[::]" ? "127.0.0.1" : host;
}

export function resolveServerTarget(args: string[]): ServerTarget {
  const explicitServer = flagValue(args, "--server");
  const host = normalizeHost(flagValue(args, "--host") ?? env.CODEX_AGENTS_OFFICE_HOST ?? "127.0.0.1");
  const parsedPort = Number.parseInt(flagValue(args, "--port") ?? env.CODEX_AGENTS_OFFICE_PORT ?? "4181", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 4181;
  return {
    serverBase: explicitServer ?? `http://${host}:${port}`,
    json: args.includes("--json")
  };
}

function flagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

export function cliVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; payload: unknown } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_FETCH_TIMEOUT_MS) });
    return { ok: response.ok, status: response.status, payload: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) {
    return "unknown age";
  }
  if (ageMs < 1000) {
    return "just now";
  }
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.round(minutes / 60)}h ago`;
}

export function formatStatusLines(health: HealthPayload): string[] {
  const lines: string[] = [];
  lines.push(
    `Tower: ${health.status} — ${health.projectCount} project${health.projectCount === 1 ? "" : "s"}, `
    + `v${health.version}, pid ${health.pid} @ ${health.host}:${health.port}`
  );
  lines.push(`Build: ${health.buildAt} · started ${health.startedAt}`);

  if (health.providers.length > 0) {
    lines.push("", "Providers:");
    for (const provider of health.providers) {
      const detail = provider.status === "ready"
        ? ""
        : ` — ${provider.detail ?? "no detail"}${provider.degradedProjects > 1 ? ` (${provider.degradedProjects} projects)` : ""}`;
      lines.push(`  ${provider.status.padEnd(8)} ${provider.adapterId}${detail}`);
    }
  }

  if (health.projects.length > 0) {
    lines.push("", "Projects:");
    for (const project of health.projects) {
      lines.push(`  ${project.status.padEnd(8)} ${project.projectLabel} (${formatAge(project.snapshotAgeMs)})`);
    }
  }

  if (health.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of health.notes) {
      lines.push(`  ! ${note}`);
    }
  }

  return lines;
}

export function formatDoctorLines(checks: DoctorCheck[]): string[] {
  const badge: Record<DoctorCheck["status"], string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  return checks.map((check) => `${badge[check.status]}  ${check.name}: ${check.detail}`);
}

async function probeCommandVersion(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], { timeout: 3000, maxBuffer: 64 * 1024 });
    return stdout.trim().split(/\r?\n/)[0] || "available";
  } catch {
    return null;
  }
}

export async function collectDoctorChecks(target: ServerTarget): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  checks.push({ name: "aot CLI", status: "pass", detail: `v${cliVersion()} on node ${process.version}` });

  const live = await fetchJson(`${target.serverBase}/api/health/live`);
  if (!live) {
    checks.push({
      name: "tower server",
      status: "fail",
      detail: `not reachable at ${target.serverBase} — start it with \`aot web\` or \`npm start\``
    });
    return checks;
  }
  const livePid = (live.payload as { pid?: number } | null)?.pid;
  checks.push({ name: "tower server", status: "pass", detail: `live at ${target.serverBase}${livePid ? ` (pid ${livePid})` : ""}` });

  const ready = await fetchJson(`${target.serverBase}/api/health/ready`);
  checks.push(
    ready?.ok
      ? { name: "fleet readiness", status: "pass", detail: "fleet snapshot published" }
      : { name: "fleet readiness", status: "warn", detail: "server is live but has not published a fleet snapshot yet" }
  );

  const health = await fetchJson(`${target.serverBase}/api/health`);
  const payload = health?.payload as HealthPayload | null;
  if (payload) {
    const degraded = payload.providers.filter((provider) => provider.status !== "ready");
    checks.push({
      name: "fleet health",
      status: payload.status === "healthy" ? "pass" : "warn",
      detail: `${payload.status} across ${payload.projectCount} project${payload.projectCount === 1 ? "" : "s"}`
    });
    for (const provider of degraded) {
      checks.push({
        name: `provider ${provider.adapterId}`,
        status: provider.status === "error" ? "fail" : "warn",
        detail: provider.detail ?? provider.status
      });
    }
  }

  const codexVersion = await probeCommandVersion("codex");
  checks.push(
    codexVersion
      ? { name: "codex CLI", status: "pass", detail: codexVersion }
      : { name: "codex CLI", status: "warn", detail: "not found on PATH — local Codex visibility will rely on app bundles or logs" }
  );

  const home = homedir();
  checks.push(
    existsSync(join(home, ".claude"))
      ? { name: "claude data", status: "pass", detail: "~/.claude present" }
      : { name: "claude data", status: "warn", detail: "~/.claude not found — Claude sessions will not be visible" }
  );
  checks.push(
    existsSync(join(home, ".hermes"))
      ? { name: "hermes data", status: "pass", detail: "~/.hermes present" }
      : { name: "hermes data", status: "warn", detail: "~/.hermes not found — Hermes visibility disabled" }
  );

  return checks;
}

export async function runStatus(args: string[]): Promise<void> {
  const target = resolveServerTarget(args);
  const health = await fetchJson(`${target.serverBase}/api/health`);
  if (!health || !health.payload) {
    console.error(`Could not reach Agents Office Tower at ${target.serverBase}. Start it with \`aot web\` or \`npm start\`.`);
    exit(1);
  }
  if (target.json) {
    console.log(JSON.stringify(health.payload, null, 2));
    return;
  }
  for (const line of formatStatusLines(health.payload as HealthPayload)) {
    console.log(line);
  }
}

export async function runDoctor(args: string[]): Promise<void> {
  const target = resolveServerTarget(args);
  const checks = await collectDoctorChecks(target);
  if (target.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), checks }, null, 2));
  } else {
    for (const line of formatDoctorLines(checks)) {
      console.log(line);
    }
  }
  if (checks.some((check) => check.status === "fail")) {
    exit(1);
  }
}
