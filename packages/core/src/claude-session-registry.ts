import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActivityState, AgentConfidence, NeedsUserState } from "./types";

// Claude Code keeps one `<config>/sessions/<pid>.json` per running process with
// typed lifecycle state (`busy`, `shell`, `idle`, `waiting`). It is the same data
// `claude agents --json` prints. Sibling `.key` files are secrets and are never read.
export type ClaudeRegistryStatus = "busy" | "shell" | "idle" | "waiting";

export interface ClaudeSessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string | null;
  status: ClaudeRegistryStatus;
  waitingFor: string | null;
  name: string | null;
  kind: string | null;
  entrypoint: string | null;
  statusUpdatedAt: number | null;
}

const REGISTRY_STATUSES = new Set<ClaudeRegistryStatus>(["busy", "shell", "idle", "waiting"]);

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function parseClaudeSessionRegistryEntry(raw: unknown): ClaudeSessionRegistryEntry | null {
  if (typeof raw !== "object" || !raw) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const pid = numberField(record, "pid");
  const sessionId = stringField(record, "sessionId");
  const status = stringField(record, "status");
  if (pid === null || !sessionId || !status || !REGISTRY_STATUSES.has(status as ClaudeRegistryStatus)) {
    return null;
  }
  return {
    pid,
    sessionId,
    cwd: stringField(record, "cwd"),
    status: status as ClaudeRegistryStatus,
    waitingFor: stringField(record, "waitingFor"),
    name: stringField(record, "name"),
    kind: stringField(record, "kind"),
    entrypoint: stringField(record, "entrypoint"),
    statusUpdatedAt: numberField(record, "statusUpdatedAt") ?? numberField(record, "updatedAt")
  };
}

const REGISTRY_CACHE_MS = 1500;
let registryCache: { key: string; at: number; value: Promise<Map<string, ClaudeSessionRegistryEntry>> } | null = null;

async function readRegistryDir(dir: string, isAlive: (pid: number) => boolean): Promise<ClaudeSessionRegistryEntry[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries = await Promise.all(
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        try {
          return parseClaudeSessionRegistryEntry(JSON.parse(await readFile(join(dir, name), "utf8")));
        } catch {
          return null;
        }
      })
  );
  return entries.filter((entry): entry is ClaudeSessionRegistryEntry => Boolean(entry) && isAlive(entry!.pid));
}

// Live registry entries keyed by sessionId. Entries whose pid has exited are
// dropped: a crashed session can leave its last `busy` status behind.
export async function readClaudeSessionRegistry(
  configDirs: string[],
  options: { isAlive?: (pid: number) => boolean; now?: number } = {}
): Promise<Map<string, ClaudeSessionRegistryEntry>> {
  const now = options.now ?? Date.now();
  const key = configDirs.join("\n");
  if (!options.isAlive && registryCache && registryCache.key === key && now - registryCache.at < REGISTRY_CACHE_MS) {
    return registryCache.value;
  }
  const value = Promise.all(configDirs.map((dir) => readRegistryDir(join(dir, "sessions"), options.isAlive ?? isProcessAlive)))
    .then((lists) => {
      const bySession = new Map<string, ClaudeSessionRegistryEntry>();
      for (const entry of lists.flat()) {
        const existing = bySession.get(entry.sessionId);
        if (!existing || (entry.statusUpdatedAt ?? 0) > (existing.statusUpdatedAt ?? 0)) {
          bySession.set(entry.sessionId, entry);
        }
      }
      return bySession;
    });
  if (!options.isAlive) {
    registryCache = { key, at: now, value };
  }
  return value;
}

interface RegistrySummaryShape {
  label: string;
  state: ActivityState;
  detail: string;
  updatedAt: string;
  activityEvent: unknown;
  confidence: AgentConfidence;
  needsUser: NeedsUserState | null;
  isOngoing: boolean;
}

const LIVE_TRANSCRIPT_STATES = new Set<ActivityState>([
  "planning", "scanning", "thinking", "editing", "running", "validating", "delegating"
]);

function waitingKind(waitingFor: string | null): NeedsUserState["kind"] {
  return waitingFor && /input|question|answer|reply/i.test(waitingFor) ? "input" : "approval";
}

// The registry is authoritative for whether the lead process is working; the
// transcript still supplies the detail of what it is doing.
export function applyClaudeRegistryStatus<T extends RegistrySummaryShape>(
  summary: T,
  entry: ClaudeSessionRegistryEntry | null | undefined,
  recentDoneWindowMs: number,
  now = Date.now()
): T {
  if (!entry) {
    return summary;
  }
  const statusAt = entry.statusUpdatedAt ?? Date.parse(summary.updatedAt);
  const updatedAt = new Date(Math.max(Date.parse(summary.updatedAt) || 0, statusAt || 0)).toISOString();
  const label = entry.name ? entry.name.replace(/\s+/g, " ").trim().slice(0, 42) || summary.label : summary.label;

  if (entry.status === "busy" || entry.status === "shell") {
    const live = LIVE_TRANSCRIPT_STATES.has(summary.state);
    return {
      ...summary,
      label,
      state: live ? summary.state : entry.status === "shell" ? "running" : "thinking",
      detail: live ? summary.detail : entry.status === "shell" ? "Running shell command" : "Working",
      updatedAt,
      needsUser: null,
      confidence: "typed",
      isOngoing: true
    };
  }

  if (entry.status === "waiting") {
    const reason = entry.waitingFor ?? "Waiting on you";
    return {
      ...summary,
      label,
      state: "waiting",
      detail: summary.needsUser ? summary.detail : reason,
      updatedAt,
      needsUser: summary.needsUser ?? {
        kind: waitingKind(entry.waitingFor),
        requestId: `claude-registry:${entry.sessionId}`,
        reason
      },
      confidence: "typed",
      isOngoing: true
    };
  }

  // idle: the turn is over even if the transcript tail still looks mid-work.
  if (!summary.isOngoing && !LIVE_TRANSCRIPT_STATES.has(summary.state) && summary.state !== "waiting") {
    return { ...summary, label, confidence: "typed" };
  }
  const recent = now - (Date.parse(updatedAt) || 0) <= recentDoneWindowMs;
  return {
    ...summary,
    label,
    state: recent ? "done" : "idle",
    detail: recent ? summary.detail : "Idle",
    needsUser: null,
    activityEvent: recent ? summary.activityEvent : null,
    confidence: "typed",
    isOngoing: false
  };
}
