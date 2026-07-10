import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { APPEARANCES } from "./appearance";
import type { ActivityState, DashboardAgent } from "./types";

const CACHE_MAGIC = Buffer.from("305c72a71b6dfbfc", "hex");
const CACHE_HEADER_BYTES = 24;
const WATCH_CACHE_KEY = "1/0/https://claude.ai/v1/code/sessions/watch";
const DEFAULT_MAX_CACHE_FILES = 96;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_CACHE_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1_000;
const DEFAULT_SESSION_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1_000;
const DEFAULT_ACTIVE_WINDOW_MS = 3 * 60 * 1_000;
const DEFAULT_RECENT_DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ClaudeHomeRemoteSession {
  id: string;
  title: string | null;
  createdAt: string | null;
  lastEventAt: string;
  environmentKind: string;
  model: string | null;
  origin: string | null;
  tags: string[];
  selectedFolders: string[];
  status: string | null;
  statusBucket: string | null;
  workerStatus: string | null;
  postTurnSummary: {
    needsAction: string | null;
    statusCategory: string | null;
  } | null;
}

export interface ClaudeHomeAccountAgent extends DashboardAgent {
  interactionMode: "work";
  conversationKey: string;
  accountObserved: true;
}

export interface ClaudeHomeCacheOptions {
  cacheDirs?: string[];
  now?: number;
  maxCacheFiles?: number;
  maxFileBytes?: number;
  maxBodyBytes?: number;
  cacheFreshnessMs?: number;
  sessionFreshnessMs?: number;
  activeWindowMs?: number;
  recentDoneWindowMs?: number;
  limit?: number;
}

interface ClaudeHomeRemoteSessionPatch {
  id: string;
  title?: string | null;
  createdAt?: string | null;
  lastEventAt?: string | null;
  environmentKind?: string;
  model?: string | null;
  origin?: string | null;
  tags?: string[];
  selectedFolders?: string[];
  status?: string | null;
  statusBucket?: string | null;
  workerStatus?: string | null;
  postTurnSummary?: ClaudeHomeRemoteSession["postTurnSummary"];
}

interface ClaudeHomeWatchEvent {
  type: "added" | "changed" | "removed";
  session: ClaudeHomeRemoteSessionPatch;
}

interface CacheCandidate {
  path: string;
  mtimeMs: number;
}

function defaultClaudeCacheDirs(): string[] {
  const home = homedir();
  const dirs = [join(home, "Library", "Application Support", "Claude", "Cache", "Cache_Data")];
  if (process.env.APPDATA) {
    dirs.push(join(process.env.APPDATA, "Claude", "Cache", "Cache_Data"));
  }
  dirs.push(join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "Cache", "Cache_Data"));
  return Array.from(new Set(dirs));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isoTimestamp(value: unknown): string | null {
  const text = boundedString(value, 64);
  if (!text) {
    return null;
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stringList(value: unknown, limit: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return Array.from(new Set(value
    .map((entry) => boundedString(entry, maxLength))
    .filter((entry): entry is string => Boolean(entry))))
    .slice(0, limit);
}

function selectedFolderNames(config: Record<string, unknown> | null): string[] | undefined {
  const candidates = config?.selected_folders ?? config?.selectedFolders ?? config?.sources;
  if (!Array.isArray(candidates)) {
    return undefined;
  }

  const names = candidates.flatMap((candidate) => {
    if (typeof candidate === "string") {
      const value = boundedString(basename(candidate), 80);
      return value ? [value] : [];
    }
    const source = recordValue(candidate);
    const value = boundedString(source?.name ?? source?.label, 80)
      ?? (typeof source?.path === "string" ? boundedString(basename(source.path), 80) : null);
    return value ? [value] : [];
  });
  return Array.from(new Set(names)).slice(0, 12);
}

function sanitizeSessionPatch(value: unknown): ClaudeHomeRemoteSessionPatch | null {
  const raw = recordValue(value);
  if (!raw) {
    return null;
  }
  const id = boundedString(raw.id ?? raw.session_id, 160);
  if (!id || !/^cse_[A-Za-z0-9_-]+$/.test(id)) {
    return null;
  }

  const config = recordValue(raw?.config);
  const external = recordValue(raw?.external_metadata);
  const summary = recordValue(external?.post_turn_summary ?? raw?.post_turn_summary);
  const patch: ClaudeHomeRemoteSessionPatch = { id };

  if (Object.hasOwn(raw, "title")) patch.title = boundedString(raw.title, 160);
  if (Object.hasOwn(raw, "created_at") || Object.hasOwn(raw, "createdAt")) {
    patch.createdAt = isoTimestamp(raw.created_at ?? raw.createdAt);
  }
  if (Object.hasOwn(raw, "last_event_at") || Object.hasOwn(raw, "lastEventAt")) {
    patch.lastEventAt = isoTimestamp(raw.last_event_at ?? raw.lastEventAt);
  }
  if (Object.hasOwn(raw, "environment_kind") || Object.hasOwn(raw, "environmentKind")) {
    patch.environmentKind = boundedString(raw.environment_kind ?? raw.environmentKind, 64) ?? "";
  }
  if (config && Object.hasOwn(config, "model")) patch.model = boundedString(config.model, 96);
  else if (Object.hasOwn(raw, "model")) patch.model = boundedString(raw.model, 96);
  if (config && Object.hasOwn(config, "origin")) patch.origin = boundedString(config.origin, 64);
  else if (Object.hasOwn(raw, "origin")) patch.origin = boundedString(raw.origin, 64);
  const tags = stringList(raw.tags, 32, 96);
  if (tags) patch.tags = tags;
  const folders = selectedFolderNames(config);
  if (folders) patch.selectedFolders = folders;
  if (Object.hasOwn(raw, "status")) patch.status = boundedString(raw.status, 64);
  if (Object.hasOwn(raw, "status_bucket") || Object.hasOwn(raw, "statusBucket")) {
    patch.statusBucket = boundedString(raw.status_bucket ?? raw.statusBucket, 64);
  }
  if (Object.hasOwn(raw, "worker_status") || Object.hasOwn(raw, "workerStatus")) {
    patch.workerStatus = boundedString(raw.worker_status ?? raw.workerStatus, 64);
  }
  if (summary) {
    patch.postTurnSummary = {
      needsAction: boundedString(summary.needs_action ?? summary.needsAction, 32),
      statusCategory: boundedString(summary.status_category ?? summary.statusCategory, 64)
    };
  }
  return patch;
}

/** Parse only the already-isolated response body and discard every unrecognized field. */
export function parseClaudeHomeWatchSse(body: Buffer | string): ClaudeHomeWatchEvent[] {
  const text = typeof body === "string" ? body : body.toString("utf8");
  const events: ClaudeHomeWatchEvent[] = [];
  let eventType = "";
  let dataLines: string[] = [];

  const flush = (): void => {
    const type = eventType;
    const data = dataLines.join("\n");
    eventType = "";
    dataLines = [];
    if (
      !(type === "added" || type === "changed" || type === "removed")
      || !data
      || Buffer.byteLength(data, "utf8") > 256 * 1024
    ) {
      return;
    }
    try {
      const parsed = JSON.parse(data) as unknown;
      const record = recordValue(parsed);
      const patch = sanitizeSessionPatch(record?.session ?? parsed);
      if (patch) {
        events.push({ type, session: patch });
      }
    } catch {
      // Cache entries are opportunistic and may end mid-event.
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  flush();
  return events;
}

export async function readClaudeHomeWatchCacheFile(
  filePath: string,
  options: Pick<ClaudeHomeCacheOptions, "maxFileBytes" | "maxBodyBytes"> = {}
): Promise<ClaudeHomeWatchEvent[]> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    return [];
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < CACHE_HEADER_BYTES || info.size > maxFileBytes) {
      return [];
    }
    const header = Buffer.alloc(CACHE_HEADER_BYTES);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (headerRead.bytesRead !== header.length || !header.subarray(0, 8).equals(CACHE_MAGIC)) {
      return [];
    }

    const keyLength = header.readUInt32LE(12);
    if (keyLength < WATCH_CACHE_KEY.length || keyLength > 4_096) {
      return [];
    }
    const keyProbeLength = Math.min(keyLength, Buffer.byteLength(WATCH_CACHE_KEY) + 1);
    const keyProbe = Buffer.alloc(keyProbeLength);
    const keyRead = await handle.read(keyProbe, 0, keyProbe.length, CACHE_HEADER_BYTES);
    if (keyRead.bytesRead !== keyProbe.length) {
      return [];
    }
    const keyProbeText = keyProbe.toString("utf8");
    if (!keyProbeText.startsWith(WATCH_CACHE_KEY)) {
      return [];
    }
    if (keyLength > WATCH_CACHE_KEY.length && keyProbeText[WATCH_CACHE_KEY.length] !== "?") {
      return [];
    }

    const bodyOffset = CACHE_HEADER_BYTES + keyLength;
    const bodyLength = info.size - bodyOffset;
    if (bodyLength <= 0 || bodyLength > maxBodyBytes) {
      return [];
    }
    const body = Buffer.alloc(bodyLength);
    const bodyRead = await handle.read(body, 0, body.length, bodyOffset);
    if (bodyRead.bytesRead !== body.length) {
      return [];
    }
    return parseClaudeHomeWatchSse(body);
  } catch {
    return [];
  } finally {
    await handle.close();
  }
}

async function isClaudeHomeWatchCacheFile(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    return false;
  }
  try {
    const header = Buffer.alloc(CACHE_HEADER_BYTES);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (headerRead.bytesRead !== header.length || !header.subarray(0, 8).equals(CACHE_MAGIC)) {
      return false;
    }
    const keyLength = header.readUInt32LE(12);
    if (keyLength < WATCH_CACHE_KEY.length || keyLength > 4_096) {
      return false;
    }
    // Probe exactly the public endpoint plus one delimiter byte. The resume query is never read.
    const probeLength = Math.min(keyLength, Buffer.byteLength(WATCH_CACHE_KEY) + 1);
    const probe = Buffer.alloc(probeLength);
    const probeRead = await handle.read(probe, 0, probe.length, CACHE_HEADER_BYTES);
    if (probeRead.bytesRead !== probe.length || !probe.toString("utf8").startsWith(WATCH_CACHE_KEY)) {
      return false;
    }
    return keyLength === WATCH_CACHE_KEY.length || probe[WATCH_CACHE_KEY.length] === "?".charCodeAt(0);
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

async function cacheCandidates(options: ClaudeHomeCacheOptions): Promise<CacheCandidate[]> {
  const now = options.now ?? Date.now();
  const freshnessMs = options.cacheFreshnessMs ?? DEFAULT_CACHE_FRESHNESS_MS;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const candidates: CacheCandidate[] = [];
  for (const dir of options.cacheDirs ?? defaultClaudeCacheDirs()) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith("_0")) continue;
        const path = join(dir, entry.name);
        const info = await stat(path);
        if (
          info.size <= maxFileBytes
          && now - info.mtimeMs <= freshnessMs
          && info.mtimeMs <= now + 60_000
          && await isClaudeHomeWatchCacheFile(path)
        ) {
          candidates.push({ path, mtimeMs: info.mtimeMs });
        }
      }
    } catch {
      // Claude Desktop may be absent, not running, or have no cache yet.
    }
  }
  return candidates
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path))
    .slice(0, options.maxCacheFiles ?? DEFAULT_MAX_CACHE_FILES)
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
}

export async function discoverClaudeHomeRemoteSessions(
  options: ClaudeHomeCacheOptions = {}
): Promise<ClaudeHomeRemoteSession[]> {
  const sessions = new Map<string, ClaudeHomeRemoteSessionPatch>();
  for (const candidate of await cacheCandidates(options)) {
    const events = await readClaudeHomeWatchCacheFile(candidate.path, options);
    for (const event of events) {
      if (event.type === "removed") {
        sessions.delete(event.session.id);
      } else {
        sessions.set(event.session.id, { ...sessions.get(event.session.id), ...event.session });
      }
    }
  }

  const now = options.now ?? Date.now();
  const sessionFreshnessMs = options.sessionFreshnessMs ?? DEFAULT_SESSION_FRESHNESS_MS;
  return Array.from(sessions.values())
    .filter((session) => session.environmentKind === "anthropic_cloud")
    .filter((session) => session.tags?.includes("product:cowork-remote"))
    .flatMap((session): ClaudeHomeRemoteSession[] => {
      const lastEventAt = session.lastEventAt ?? session.createdAt;
      if (!lastEventAt || now - Date.parse(lastEventAt) > sessionFreshnessMs) {
        return [];
      }
      return [{
        id: session.id,
        title: session.title ?? null,
        createdAt: session.createdAt ?? null,
        lastEventAt,
        environmentKind: session.environmentKind ?? "",
        model: session.model ?? null,
        origin: session.origin ?? null,
        tags: session.tags ?? [],
        selectedFolders: session.selectedFolders ?? [],
        status: session.status ?? null,
        statusBucket: session.statusBucket ?? null,
        workerStatus: session.workerStatus ?? null,
        postTurnSummary: session.postTurnSummary ?? null
      }];
    })
    .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt))
    .slice(0, options.limit ?? 12);
}

function normalizedStatus(session: ClaudeHomeRemoteSession): string {
  return [session.status, session.statusBucket, session.workerStatus, session.postTurnSummary?.statusCategory]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function needsAction(session: ClaudeHomeRemoteSession): boolean {
  const value = session.postTurnSummary?.needsAction?.toLowerCase();
  return value === "true" || value === "yes" || value === "required" || value === "needs_action";
}

function sessionState(
  session: ClaudeHomeRemoteSession,
  now: number,
  activeWindowMs: number,
  recentDoneWindowMs: number
): ActivityState {
  const ageMs = Math.max(0, now - Date.parse(session.lastEventAt));
  const status = normalizedStatus(session);
  if (status.includes("blocked") || status.includes("error") || status.includes("failed")) return "blocked";
  if (needsAction(session) || status.includes("need_input") || status.includes("waiting")) return "waiting";
  if (status.includes("review_ready") || status.includes("complete") || status.includes("done")) return "done";
  if (ageMs <= activeWindowMs && (status.includes("active") || status.includes("working") || status.includes("running"))) {
    return "thinking";
  }
  if (ageMs <= recentDoneWindowMs) {
    return "done";
  }
  return "idle";
}

function deterministicAppearance(key: string): DashboardAgent["appearance"] {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return APPEARANCES[(hash >>> 0) % APPEARANCES.length];
}

function statusDetail(session: ClaudeHomeRemoteSession, state: ActivityState): string {
  if (state === "thinking") return "Claude Home remote work is active";
  if (state === "waiting") return "Claude Home remote work is waiting";
  if (state === "blocked") return "Claude Home remote work is blocked";
  if (state === "done") return "Claude Home remote work is ready to review";
  return "Claude Home remote work session";
}

export async function loadClaudeHomeAccountAgents(
  options: ClaudeHomeCacheOptions = {}
): Promise<ClaudeHomeAccountAgent[]> {
  const now = options.now ?? Date.now();
  const activeWindowMs = options.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
  const recentDoneWindowMs = options.recentDoneWindowMs ?? DEFAULT_RECENT_DONE_WINDOW_MS;
  const sessions = await discoverClaudeHomeRemoteSessions(options);
  return sessions.map((session) => {
    const state = sessionState(session, now, activeWindowMs, recentDoneWindowMs);
    const isOngoing = state === "thinking" || state === "waiting" || state === "blocked";
    const label = session.title?.trim() || "Claude Home";
    return {
      id: `claude:home-remote:${session.id}`,
      label,
      source: "claude",
      sourceKind: session.model ? `claude:cowork-remote:${session.model}` : "claude:cowork-remote",
      parentThreadId: null,
      depth: 0,
      isCurrent: state === "thinking",
      isOngoing,
      statusText: "home · remote",
      role: "home work",
      nickname: null,
      isSubagent: false,
      state,
      detail: statusDetail(session, state),
      cwd: null,
      sourceProjectRoot: null,
      roomId: null,
      appearance: deterministicAppearance(session.id),
      updatedAt: session.lastEventAt,
      stoppedAt: isOngoing ? null : session.lastEventAt,
      paths: [],
      activityEvent: null,
      goal: {
        kind: "claudeCowork",
        objective: session.title || "Claude Home remote work",
        status: state === "done" ? "complete" : state === "blocked" ? "blocked" : isOngoing ? "active" : "unknown",
        confidence: "inferred",
        createdAt: session.createdAt,
        updatedAt: session.lastEventAt
      },
      latestMessage: null,
      threadId: null,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: null,
      provenance: "claude",
      confidence: "inferred",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null,
      interactionMode: "work",
      conversationKey: `claude-home:${session.id}`,
      accountObserved: true
    };
  });
}
