import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, open, readFile, readdir, readlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { platform } from "node:process";
import { promisify } from "node:util";

import { ensureAgentAppearance } from "./appearance";
import { getHermesHooksDir } from "./hermes-hook-install";
import {
  canonicalizeProjectPath,
  projectLabelFromRoot,
  projectPathIdentityKey,
  sameProjectPath,
  type DiscoveredProject
} from "./project-paths";
import type {
  ActivityState,
  AgentActivityEvent,
  DashboardAgent,
  DashboardEvent,
  GitInfo
} from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_HERMES_SESSION_LIMIT = 12;
const HERMES_SESSION_SCAN_LIMIT = 30;
const HERMES_PROJECT_DISCOVERY_HOOK_WINDOW_MS = 2 * 60 * 60 * 1000;
const HERMES_RECENT_DONE_WINDOW_MS = 5 * 60 * 1000;
const HERMES_RECENT_OPEN_WINDOW_MS = 20 * 60 * 1000;
const HERMES_SQLITE_MESSAGE_LIMIT = 10;
const HERMES_SQLITE_TEXT_LIMIT = 2000;
const HERMES_SQLITE_TIMEOUT_MS = 5000;
const HERMES_SQLITE_MAX_BUFFER = 8 * 1024 * 1024;
const HERMES_HOOK_FILE_BYTE_LIMIT = 1024 * 1024;
const HERMES_HOOK_LINE_BYTE_LIMIT = 64 * 1024;
const HERMES_HOOK_RECORD_LIMIT = 80;
// Keep a project relation through 20 rootless hook actions, then treat the stream as projectless.
const HERMES_PROJECT_RELATION_ACTION_WINDOW = 21;
const HERMES_HOOK_TEXT_LIMIT = 1500;
const HERMES_HOOK_PATH_LIMIT = 32;
const HERMES_TRANSIENT_PROJECT_ROOTS = new Set(["/tmp", "/var/tmp", "/dev/shm"]);
const HERMES_CRON_SESSION_ID_RE = /^cron_[A-Za-z0-9_-]+_\d{8}_\d{6}$/i;

interface HermesSqliteExport {
  sessions: HermesStoredSession[];
}

interface HermesStoredSession {
  id: string;
  source: string | null;
  model: string | null;
  parentSessionId: string | null;
  parentEndedAt: number | null;
  parentEndReason: string | null;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  title: string | null;
  systemPrompt: string | null;
  lastActive: number;
  home: string;
  storage: "sqlite";
  messages: HermesStoredMessage[];
}

interface HermesStoredMessage {
  id: number | string;
  role: string | null;
  content: unknown;
  toolCalls: unknown;
  toolName: string | null;
  toolCallId: string | null;
  timestamp: number;
  finishReason: string | null;
  reasoning: string | null;
  reasoningContent: string | null;
}

interface HermesProcessInfo {
  pid: number;
  cwd: string | null;
  hermesHome: string | null;
  command: string;
  updatedAtMs: number;
}

interface HermesSessionSummary {
  state: ActivityState;
  isOngoing: boolean;
  detail: string;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
  latestMessage: string | null;
  updatedAtMs: number;
  stoppedAtMs: number | null;
}

interface HermesToolCallSummary {
  name: string;
  args: Record<string, unknown>;
}

interface HermesHookRecord {
  sessionId: string;
  eventName: string;
  timestampMs: number;
  cwd: string | null;
  processCwd: string | null;
  payload: Record<string, unknown>;
  raw: Record<string, unknown>;
}

function hermesLocalSessionLimit(): number {
  const raw = Number.parseInt(process.env.HERMES_LOCAL_SESSION_LIMIT ?? "", 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_HERMES_SESSION_LIMIT;
  }
  return Math.max(1, Math.min(50, raw));
}

function hermesScanLimit(limit: number): number {
  return Math.max(1, Math.min(HERMES_SESSION_SCAN_LIMIT, limit));
}

async function looksLikeHermesRuntimeProjectRoot(root: string): Promise<boolean> {
  const normalized = root.replace(/\\/g, "/").toLowerCase();
  if (!normalized.endsWith("/hermes-agent")) {
    return false;
  }
  return await pathExists(join(root, "hermes_cli", "main.py"))
    && await pathExists(join(root, "gateway"))
    && await pathExists(join(root, "pyproject.toml"));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(hostFilesystemPath(path), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function expandHomePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function normalizeFilesystemPath(path: string | null | undefined): string | null {
  if (typeof path !== "string" || path.trim().length === 0) {
    return null;
  }
  return canonicalizeProjectPath(expandHomePath(path)) ?? null;
}

function hostFilesystemPath(path: string): string {
  const canonical = canonicalizeProjectPath(path) ?? path;
  const match = canonical.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (platform !== "win32" || !match) {
    return path;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/\//g, "\\");
  return `${drive}:\\${rest}`;
}

function hermesHookDirectories(): string[] {
  const explicit = normalizeFilesystemPath(process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR);
  if (explicit) {
    return [explicit];
  }

  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (path: string | null | undefined): void => {
    const normalized = normalizeFilesystemPath(path);
    const key = projectPathIdentityKey(normalized);
    if (!normalized || !key || seen.has(key)) {
      return;
    }
    seen.add(key);
    dirs.push(normalized);
  };

  add(getHermesHooksDir());
  add(join(homedir(), ".codex", "codex-agents-office", "hermes-hooks"));
  return dirs;
}

async function hermesHomeCandidatesFromDisk(): Promise<string[]> {
  const roots = new Set<string>();
  const explicitHome = normalizeFilesystemPath(process.env.HERMES_HOME);
  if (explicitHome) {
    roots.add(explicitHome);
  }

  const defaultRoot = normalizeFilesystemPath(join(homedir(), ".hermes"));
  if (defaultRoot) {
    roots.add(defaultRoot);
  }

  const rootCandidates = [...roots];
  for (const root of rootCandidates) {
    const profilesDir = join(root, "profiles");
    const profiles = await readdir(hostFilesystemPath(profilesDir), { withFileTypes: true }).catch(() => []);
    for (const entry of profiles) {
      if (!entry.isDirectory()) {
        continue;
      }
      const profileHome = normalizeFilesystemPath(join(profilesDir, entry.name));
      if (profileHome) {
        roots.add(profileHome);
      }
    }
  }

  const explicitStateDb = normalizeFilesystemPath(process.env.HERMES_STATE_DB);
  if (explicitStateDb) {
    roots.add(resolve(explicitStateDb, ".."));
  }

  return [...roots];
}

async function readProcFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function splitNulFile(raw: Buffer | null): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .toString("utf8")
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseProcEnviron(raw: Buffer | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of splitNulFile(raw)) {
    const equalsIndex = entry.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    env[entry.slice(0, equalsIndex)] = entry.slice(equalsIndex + 1);
  }
  return env;
}

function looksLikeHermesProcess(argv: string[]): boolean {
  if (argv.length === 0) {
    return false;
  }
  return argv.some((arg) => {
    const normalized = arg.replace(/\\/g, "/").toLowerCase();
    const base = basename(normalized);
    return base === "hermes"
      || base === "hermes.exe"
      || base === "hermes.cmd"
      || normalized.endsWith("/hermes_cli/main.py")
      || normalized.endsWith("/gateway/run.py")
      || normalized.endsWith("/run_agent.py")
      || (normalized.endsWith("/cli.py") && normalized.includes("hermes"));
  });
}

function looksLikeHermesGatewayDaemon(argv: string[]): boolean {
  const normalized = argv.map((arg) => arg.replace(/\\/g, "/").toLowerCase());
  const usesHermesEntrypoint = normalized.some((arg) => {
    const base = basename(arg);
    return base === "hermes"
      || base === "hermes.exe"
      || base === "hermes.cmd"
      || arg.endsWith("/hermes_cli/main.py")
      || arg === "hermes_cli.main";
  });
  return usesHermesEntrypoint
    && normalized.includes("gateway")
    && normalized.includes("run");
}

function looksLikeHermesRuntimeHomeProcess(argv: string[], cwd: string | null): boolean {
  const normalizedCwd = (cwd ?? "").replace(/\\/g, "/").toLowerCase();
  if (!normalizedCwd.endsWith("/hermes-agent")) {
    return false;
  }
  const normalized = argv.map((arg) => arg.replace(/\\/g, "/").toLowerCase());
  const launcherIndex = normalized.findIndex((arg) => {
    const base = basename(arg);
    return base === "hermes"
      || base === "hermes.exe"
      || base === "hermes.cmd";
  });
  return launcherIndex >= 0 && launcherIndex === normalized.length - 1;
}

async function scanHermesProcesses(): Promise<HermesProcessInfo[]> {
  if (process.platform !== "linux") {
    return [];
  }

  const procEntries = await readdir("/proc", { withFileTypes: true }).catch(() => []);
  const processes: HermesProcessInfo[] = [];

  for (const entry of procEntries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }
    const pid = Number.parseInt(entry.name, 10);
    if (!Number.isFinite(pid) || pid === process.pid) {
      continue;
    }

    const procRoot = join("/proc", entry.name);
    const argv = splitNulFile(await readProcFile(join(procRoot, "cmdline")));
    const env = parseProcEnviron(await readProcFile(join(procRoot, "environ")));
    if (looksLikeHermesGatewayDaemon(argv)) {
      continue;
    }
    if (!looksLikeHermesProcess(argv)) {
      continue;
    }

    const cwd = await readlink(join(procRoot, "cwd")).catch(() => null);
    const normalizedCwd =
      normalizeFilesystemPath(env.TERMINAL_CWD)
      ?? normalizeFilesystemPath(env.HERMES_CWD)
      ?? normalizeFilesystemPath(cwd);
    if (looksLikeHermesRuntimeHomeProcess(argv, normalizedCwd)) {
      continue;
    }
    const normalizedHome = normalizeFilesystemPath(env.HERMES_HOME);
    const procStats = await stat(procRoot).catch(() => null);

    processes.push({
      pid,
      cwd: normalizedCwd,
      hermesHome: normalizedHome,
      command: argv.join(" "),
      updatedAtMs: procStats?.mtimeMs ?? Date.now()
    });
  }

  return processes;
}

function pythonCandidates(): string[] {
  const candidates = [
    process.env.HERMES_SQLITE_PYTHON,
    "python3",
    "python"
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return Array.from(new Set(candidates));
}

const HERMES_SQLITE_EXPORT_SCRIPT = `
import json
import sqlite3
import sys
import urllib.parse

db_path = sys.argv[1]
limit = int(sys.argv[2])
message_limit = int(sys.argv[3])
text_limit = int(sys.argv[4])
uri = "file:" + urllib.parse.quote(db_path) + "?mode=ro"
conn = sqlite3.connect(uri, uri=True, timeout=1.0)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA busy_timeout=1000")
sessions = conn.execute("""
  SELECT
    s.id,
    substr(s.source, 1, ?) AS source,
    substr(s.model, 1, ?) AS model,
    s.parent_session_id,
    p.ended_at AS parent_ended_at,
    substr(p.end_reason, 1, ?) AS parent_end_reason,
    s.started_at,
    s.ended_at,
    substr(s.end_reason, 1, ?) AS end_reason,
    s.message_count,
    s.tool_call_count,
    substr(s.title, 1, ?) AS title,
    substr(s.system_prompt, 1, ?) AS system_prompt,
    COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS last_active
  FROM sessions s
  LEFT JOIN sessions p ON p.id = s.parent_session_id
  ORDER BY last_active DESC
  LIMIT ?
""", (text_limit, text_limit, text_limit, text_limit, text_limit, text_limit, limit)).fetchall()

result = []
for session in sessions:
    messages = conn.execute("""
      SELECT
        id,
        role,
        substr(content, 1, ?) AS content,
        substr(tool_calls, 1, ?) AS tool_calls,
        tool_name,
        tool_call_id,
        timestamp,
        finish_reason,
        NULL AS reasoning,
        NULL AS reasoning_content
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    """, (text_limit, text_limit, session["id"], message_limit)).fetchall()
    result.append({
      "id": session["id"],
      "source": session["source"],
      "model": session["model"],
      "parentSessionId": session["parent_session_id"],
      "parentEndedAt": session["parent_ended_at"],
      "parentEndReason": session["parent_end_reason"],
      "startedAt": session["started_at"],
      "endedAt": session["ended_at"],
      "endReason": session["end_reason"],
      "messageCount": session["message_count"],
      "toolCallCount": session["tool_call_count"],
      "title": session["title"],
      "systemPrompt": session["system_prompt"],
      "lastActive": session["last_active"],
      "messages": [dict(row) for row in reversed(messages)],
    })
print(json.dumps({"sessions": result}, ensure_ascii=False))
`;

async function exportHermesSqlite(dbPath: string, limit: number): Promise<HermesSqliteExport> {
  let lastError: Error | null = null;
  for (const python of pythonCandidates()) {
    try {
      const { stdout } = await execFileAsync(
        python,
        ["-c", HERMES_SQLITE_EXPORT_SCRIPT, dbPath, String(limit), String(HERMES_SQLITE_MESSAGE_LIMIT), String(HERMES_SQLITE_TEXT_LIMIT)],
        {
          timeout: HERMES_SQLITE_TIMEOUT_MS,
          maxBuffer: HERMES_SQLITE_MAX_BUFFER
        }
      );
      return JSON.parse(stdout) as HermesSqliteExport;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code !== "ENOENT") {
        break;
      }
    }
  }
  throw lastError ?? new Error("No Python executable available for Hermes SQLite reads");
}

function normalizeSqliteMessage(raw: Record<string, unknown>): HermesStoredMessage {
  return {
    id: typeof raw.id === "number" || typeof raw.id === "string" ? raw.id : "",
    role: typeof raw.role === "string" ? raw.role : null,
    content: raw.content,
    toolCalls: raw.tool_calls,
    toolName: typeof raw.tool_name === "string" ? raw.tool_name : null,
    toolCallId: typeof raw.tool_call_id === "string" ? raw.tool_call_id : null,
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : 0,
    finishReason: typeof raw.finish_reason === "string" ? raw.finish_reason : null,
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : null,
    reasoningContent: typeof raw.reasoning_content === "string" ? raw.reasoning_content : null
  };
}

async function loadHermesSqliteSessions(home: string, limit: number): Promise<HermesStoredSession[]> {
  const explicitDb = normalizeFilesystemPath(process.env.HERMES_STATE_DB);
  const dbPath = explicitDb ?? join(home, "state.db");
  if (!await pathExists(dbPath)) {
    return [];
  }
  const exported = await exportHermesSqlite(hostFilesystemPath(dbPath), limit);
  return exported.sessions.map((session) => ({
    ...session,
    startedAt: Number(session.startedAt) || 0,
    endedAt: typeof session.endedAt === "number" && Number.isFinite(session.endedAt) && session.endedAt > 0
      ? session.endedAt
      : null,
    parentEndedAt: typeof session.parentEndedAt === "number" && Number.isFinite(session.parentEndedAt) && session.parentEndedAt > 0
      ? session.parentEndedAt
      : null,
    parentEndReason: typeof session.parentEndReason === "string" ? session.parentEndReason : null,
    messageCount: Number(session.messageCount) || 0,
    toolCallCount: Number(session.toolCallCount) || 0,
    systemPrompt: typeof session.systemPrompt === "string" ? session.systemPrompt : null,
    lastActive: Number(session.lastActive) || Number(session.startedAt) || 0,
    home,
    storage: "sqlite" as const,
    messages: session.messages.map((message) => normalizeSqliteMessage(message as unknown as Record<string, unknown>))
  }));
}

async function loadHermesSessions(home: string, limit: number, notes: string[]): Promise<HermesStoredSession[]> {
  try {
    const sqliteSessions = await loadHermesSqliteSessions(home, limit);
    return sqliteSessions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Hermes SQLite sessions unavailable for ${home}: ${message}`);
    return [];
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function textFromContent(value: unknown): string {
  const parsed = parseMaybeJson(value);
  if (typeof parsed === "string") {
    return parsed.replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && "text" in entry) {
          return String((entry as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    for (const key of ["output", "error", "content", "message", "text"]) {
      const candidate = object[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.replace(/\s+/g, " ").trim();
      }
    }
  }
  return "";
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseToolCalls(value: unknown): HermesToolCallSummary[] {
  const parsed = parseMaybeJson(value);
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const calls: HermesToolCallSummary[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const functionRecord = record.function && typeof record.function === "object"
      ? record.function as Record<string, unknown>
      : null;
    const name = typeof record.name === "string"
      ? record.name
      : typeof functionRecord?.name === "string"
        ? functionRecord.name
        : typeof record.tool_name === "string"
          ? record.tool_name
          : "";
    const rawArgs = record.arguments ?? functionRecord?.arguments ?? record.args ?? {};
    const args = parseMaybeJson(rawArgs);
    calls.push({
      name,
      args: args && typeof args === "object" && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {}
    });
  }

  return calls.filter((call) => call.name.length > 0);
}

function latestAssistantText(messages: HermesStoredMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }
    const text = textFromContent(message.content);
    if (text) {
      return shorten(text, 240);
    }
  }
  return null;
}

function latestUserContent(messages: HermesStoredMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") {
      continue;
    }
    const text = textFromContent(message.content);
    if (text) {
      return text;
    }
  }
  return null;
}

function hermesProjectDisplayLabel(projectRoot: string): string {
  const label = projectLabelFromRoot(projectRoot) || "Hermes";
  return label === "Ika Bot" ? "IkaBot" : label;
}

function titleCaseHermesWord(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "ikabot") {
    return "IkaBot";
  }
  if (["api", "cli", "ui", "sdk", "mcp"].includes(lower)) {
    return lower.toUpperCase();
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function humanizeHermesSkillName(skillName: string): string {
  const normalized = skillName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.split(" ").map(titleCaseHermesWord).join(" ");
}

function hermesSkillNameFromText(text: string): string | null {
  const invoked = text.match(/invoked the "([^"]+)" skill/i)?.[1];
  if (invoked && invoked.trim()) {
    return invoked.trim();
  }
  const frontmatter = text.match(/^name:\s*([A-Za-z0-9_-]+)\s*$/m)?.[1];
  return frontmatter && frontmatter.trim() ? frontmatter.trim() : null;
}

function hermesTitleFromText(text: string, maxLength = 54): string | null {
  let normalized = text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }

  const skillName = hermesSkillNameFromText(normalized);
  if (skillName) {
    return shorten(humanizeHermesSkillName(skillName), maxLength);
  }

  normalized = normalized
    .replace(/^got it\s*[-:\u2014]\s*/i, "")
    .replace(/^done\s*[-:\u2014]\s*/i, "")
    .replace(/^updated\s*[-:\u2014]\s*/i, "Updated: ")
    .replace(/^\s*[-*]\s+/, "");
  const firstBoundary = [
    normalized.indexOf(" - "),
    normalized.indexOf(" \u2014 "),
    normalized.indexOf(". "),
    normalized.indexOf("; ")
  ].filter((index) => index > 12);
  const boundary = firstBoundary.length > 0 ? Math.min(...firstBoundary) : -1;
  let title = boundary > 0 ? normalized.slice(0, boundary) : normalized;
  title = title.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  return shorten(title.replace(/\s+/g, " ").trim(), maxLength) || null;
}

function hermesTitleLooksGenericPrompt(title: string): boolean {
  return /^review the conversation above\b/i.test(title)
    || /^continue\b/i.test(title)
    || /^please continue\b/i.test(title);
}

function isHermesCronSessionId(sessionId: string): boolean {
  return HERMES_CRON_SESSION_ID_RE.test(sessionId);
}

function isHermesCronSession(session: HermesStoredSession): boolean {
  const source = (session.source ?? "").trim().toLowerCase();
  return isHermesCronSessionId(session.id) || source === "cron";
}

function hermesCronPromptText(text: string): string | null {
  let normalized = text
    .replace(/^\[IMPORTANT:\s*You are running as a scheduled cron job\.[\s\S]*?\]\s*/i, "")
    .replace(/^Cronjob Response:[\s\S]*?-------------\s*/i, "")
    .trim();
  if (!normalized || normalized === "[SILENT]") {
    return null;
  }
  normalized = normalized.replace(/^#\s*Cron Job:\s*/i, "").trim();
  return normalized || null;
}

function latestHermesSessionUserText(session: HermesStoredSession, maxLength = 160): string | null {
  const text = latestUserContent(session.messages);
  if (!text) {
    return null;
  }
  const displayText = isHermesCronSession(session) ? hermesCronPromptText(text) : text;
  return displayText ? shorten(displayText, maxLength) : null;
}

function hermesFallbackSessionLabel(projectRoot: string, sessionId: string): string {
  const projectLabel = hermesProjectDisplayLabel(projectRoot);
  if (isHermesCronSessionId(sessionId)) {
    return `${projectLabel} tick`;
  }
  return `${projectLabel} Hermes`;
}

function hermesHookSessionLabel(records: HermesHookRecord[], projectRoot: string, latestMessage: string | null): string {
  const latest = records[records.length - 1];
  const sessionId = latest?.sessionId ?? "";
  if (isHermesCronSessionId(sessionId)) {
    return hermesFallbackSessionLabel(projectRoot, sessionId);
  }

  const messageTitle = latestMessage ? hermesTitleFromText(latestMessage) : null;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    const userText = hermesHookText(record, ["user_message"]);
    const userTitle = userText ? hermesTitleFromText(userText) : null;
    if (userTitle) {
      if (messageTitle && hermesTitleLooksGenericPrompt(userTitle)) {
        return messageTitle;
      }
      return userTitle;
    }
  }

  if (messageTitle) {
    return messageTitle;
  }

  return hermesFallbackSessionLabel(projectRoot, sessionId);
}

function toolKind(toolName: string): {
  state: ActivityState;
  eventType: AgentActivityEvent["type"];
  eventKind: DashboardEvent["kind"];
} {
  const normalized = toolName.toLowerCase();
  if (normalized === "todo") {
    return { state: "planning", eventType: "plan", eventKind: "turn" };
  }
  if (
    normalized === "terminal"
    || normalized === "process"
    || normalized === "execute_code"
    || normalized.includes("shell")
    || normalized.includes("bash")
  ) {
    return { state: "running", eventType: "commandExecution", eventKind: "command" };
  }
  if (normalized.startsWith("mcp_")) {
    return { state: "running", eventType: "mcpToolCall", eventKind: "tool" };
  }
  if (normalized === "write_file" || normalized === "patch") {
    return { state: "editing", eventType: "fileChange", eventKind: "fileChange" };
  }
  if (normalized.includes("delegate") || normalized.includes("subagent")) {
    return { state: "delegating", eventType: "collabAgentToolCall", eventKind: "subagent" };
  }
  if (normalized === "web_search" || normalized.includes("browser_search")) {
    return { state: "scanning", eventType: "webSearch", eventKind: "tool" };
  }
  if (
    normalized === "read_file"
    || normalized === "search_files"
    || normalized === "skills_list"
    || normalized === "skill_view"
    || normalized === "web_extract"
    || normalized.includes("search")
    || normalized.includes("read")
    || normalized.includes("list")
  ) {
    return { state: "scanning", eventType: "dynamicToolCall", eventKind: "tool" };
  }
  return { state: "running", eventType: "dynamicToolCall", eventKind: "tool" };
}

function toolTitle(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "terminal" && typeof args.command === "string") {
    return shorten(args.command, 120);
  }
  if (toolName === "process") {
    const action = typeof args.action === "string" && args.action.trim() ? args.action.trim() : "manage";
    const sessionId = typeof args.session_id === "string" && args.session_id.trim()
      ? ` ${shorten(args.session_id.trim(), 40)}`
      : "";
    return `process ${action}${sessionId}`;
  }
  if (toolName === "todo") {
    const todos = Array.isArray(args.todos) ? args.todos : null;
    if (!todos) {
      return "todo: reading task list";
    }
    return `todo: ${args.merge === true ? "updating" : "planning"} ${todos.length} task(s)`;
  }
  for (const key of ["path", "file_path", "filepath", "workdir", "query", "pattern", "name", "category"]) {
    if (typeof args[key] === "string" && String(args[key]).trim()) {
      return `${toolName}: ${shorten(String(args[key]), 90)}`;
    }
  }
  return toolName;
}

function toolPath(projectRoot: string, cwd: string | null, args: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filepath", "workdir", "cwd", "dir", "directory"]) {
    const value = args[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    const normalized = normalizeCandidatePath(value, cwd ?? projectRoot);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function toolActivityEvent(
  projectRoot: string,
  cwd: string | null,
  call: HermesToolCallSummary
): AgentActivityEvent {
  const kind = toolKind(call.name);
  const path = toolPath(projectRoot, cwd, call.args);
  return {
    type: kind.eventType,
    action:
      kind.eventKind === "command" ? "ran"
      : kind.eventKind === "fileChange" ? "edited"
      : "updated",
    path,
    title: toolTitle(call.name, call.args),
    isImage: false
  };
}

function messageLooksFailed(message: HermesStoredMessage): boolean {
  const parsed = parseMaybeJson(message.content);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.exit_code === "number" && record.exit_code !== 0) {
      return true;
    }
    if (typeof record.returncode === "number" && record.returncode !== 0) {
      return true;
    }
    if (typeof record.error === "string" && record.error.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function latestMessageToolCall(message: HermesStoredMessage | null): HermesToolCallSummary | null {
  if (!message) {
    return null;
  }
  const calls = parseToolCalls(message.toolCalls);
  if (calls.length > 0) {
    return calls[calls.length - 1];
  }
  return null;
}

function normalizeCandidatePath(value: string, cwd: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^["'`]+|["'`),.;:]+$/g, "");
  if (!cleaned || cleaned.length > 400) {
    return null;
  }
  const absolute = /^([a-zA-Z]:[\\/]|\/)/.test(cleaned)
    ? cleaned
    : cleaned.startsWith("./") || cleaned.startsWith("../")
      ? join(cwd, cleaned)
      : null;
  return normalizeFilesystemPath(absolute);
}

function extractAbsolutePathCandidates(text: string): string[] {
  const matches = text.match(/(?:[a-zA-Z]:[\\/][^\s"'`<>]+|\/(?:mnt\/[a-zA-Z]|home|Users|workspace|tmp|var|opt|srv)\/[^\s"'`<>]+)/g);
  return matches ?? [];
}

function cwdFromSystemPrompt(systemPrompt: string | null): string | null {
  if (!systemPrompt) {
    return null;
  }
  for (const pattern of [
    /^Current working directory:\s*(.+)$/im,
    /^Working directory:\s*(.+)$/im,
    /^cwd\s*[:=]\s*(.+)$/im
  ]) {
    const match = systemPrompt.match(pattern);
    if (!match) {
      continue;
    }
    const value = match[1]
      .trim()
      .split(/\s+/)[0]
      ?.replace(/^["'`]+|["'`),.;:]+$/g, "");
    const normalized = normalizeFilesystemPath(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function collectSessionPathCandidates(session: HermesStoredSession, fallbackCwd: string | null): string[] {
  const paths = new Set<string>();
  const promptCwd = cwdFromSystemPrompt(session.systemPrompt);
  if (promptCwd) {
    paths.add(promptCwd);
  }
  for (const message of session.messages) {
    for (const candidate of collectMessagePathCandidates(message, fallbackCwd)) {
      paths.add(candidate);
    }
  }
  if (fallbackCwd) {
    paths.add(fallbackCwd);
  }
  return [...paths];
}

function collectMessagePathCandidates(message: HermesStoredMessage, fallbackCwd: string | null): string[] {
  const paths = new Set<string>();
  for (const call of parseToolCalls(message.toolCalls)) {
    const fromTool = toolPath("/", fallbackCwd, call.args);
    if (fromTool) {
      paths.add(fromTool);
    }
    for (const candidate of extractAbsolutePathCandidates(JSON.stringify(call.args))) {
      const normalized = normalizeCandidatePath(candidate, fallbackCwd ?? "/");
      if (normalized) {
        paths.add(normalized);
      }
    }
  }
  const text = textFromContent(message.content);
  for (const candidate of extractAbsolutePathCandidates(text)) {
    const normalized = normalizeCandidatePath(candidate, fallbackCwd ?? "/");
    if (normalized) {
      paths.add(normalized);
    }
  }
  return [...paths];
}

function sortedLatestMessages(messages: HermesStoredMessage[]): HermesStoredMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const timeDelta = right.message.timestamp - left.message.timestamp;
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return right.index - left.index;
    })
    .map((entry) => entry.message);
}

async function currentProjectRootForHermesSession(
  session: HermesStoredSession,
  activeProcess: HermesProcessInfo | null
): Promise<string | null> {
  if (activeProcess?.cwd) {
    const activeRoot = await resolveProjectRootForPath(activeProcess.cwd);
    if (activeRoot) {
      return activeRoot;
    }
  }

  const sessionCwd = cwdFromSystemPrompt(session.systemPrompt);
  for (const message of sortedLatestMessages(session.messages)) {
    for (const candidate of collectMessagePathCandidates(message, sessionCwd)) {
      const root = await resolveProjectRootForPath(candidate);
      if (root) {
        return root;
      }
    }
  }

  if (sessionCwd) {
    return resolveProjectRootForPath(sessionCwd);
  }
  return null;
}

function pathWithinProject(projectRoot: string, candidate: string | null | undefined): boolean {
  if (!candidate) {
    return false;
  }
  if (sameProjectPath(projectRoot, candidate)) {
    return true;
  }
  const rootKey = projectPathIdentityKey(projectRoot);
  const candidateKey = projectPathIdentityKey(candidate);
  return Boolean(rootKey && candidateKey && candidateKey.startsWith(`${rootKey}/`));
}

async function resolveProjectRootForPath(path: string): Promise<string | null> {
  const normalized = normalizeFilesystemPath(path);
  if (!normalized) {
    return null;
  }

  const statResult = await stat(hostFilesystemPath(normalized)).catch(() => null);
  let current = statResult && statResult.isDirectory() ? normalized : dirname(normalized);
  current = canonicalizeProjectPath(current) ?? current;
  while (current && current !== dirname(current)) {
    if (await pathExists(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  return statResult ? canonicalizeProjectPath(normalized) : null;
}

function sessionLabel(session: HermesStoredSession, projectRoot: string): string {
  if (session.title && session.title.trim()) {
    return shorten(session.title, 42);
  }
  if (isHermesCronSession(session)) {
    return hermesFallbackSessionLabel(projectRoot, session.id);
  }
  const prompt = latestHermesSessionUserText(session, 160);
  if (prompt) {
    return shorten(prompt, 42);
  }
  const model = session.model ? session.model.replace(/[-_]+/g, " ") : "";
  return model ? `Hermes ${shorten(model, 24)}` : `Hermes ${session.id.slice(0, 8)}`;
}

function sessionSourceKind(session: HermesStoredSession): string {
  if (isHermesCronSession(session)) {
    return "hermes:cron";
  }
  const source = session.source && session.source.trim() ? session.source.trim() : "local";
  return session.model ? `hermes:${source}:${session.model}` : `hermes:${source}`;
}

function sessionRole(session: HermesStoredSession): string {
  return isHermesCronSession(session) ? "temporary" : "hermes";
}

function sessionStatusText(session: HermesStoredSession, isOngoing: boolean): string {
  if (isOngoing) {
    return "active";
  }
  if (isHermesCronSession(session)) {
    return "temporary";
  }
  return session.endReason ?? (session.endedAt ? "ended" : "open");
}

function isCliLikeHermesSource(session: HermesStoredSession): boolean {
  const source = (session.source ?? "").toLowerCase();
  return source === "" || source === "cli" || source === "local" || source === "unknown";
}

function isHermesCompressionContinuation(session: HermesStoredSession): boolean {
  return Boolean(
    session.parentSessionId
    && session.parentEndReason === "compression"
    && session.parentEndedAt !== null
    && session.startedAt >= session.parentEndedAt
  );
}

function hermesHookRecordTimestampMs(record: Record<string, unknown>, fallback: number): number {
  const value = record.timestamp;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function hermesHookString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hermesHookPayloadString(record: HermesHookRecord, key: string): string | null {
  const value = record.payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function limitHermesHookValue(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return typeof value === "string" ? shorten(value, HERMES_HOOK_TEXT_LIMIT) : String(value);
  }
  if (typeof value === "string") {
    return value.length <= HERMES_HOOK_TEXT_LIMIT
      ? value
      : `${value.slice(0, HERMES_HOOK_TEXT_LIMIT)}...[truncated]`;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((entry) => limitHermesHookValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 60)
        .map(([key, entry]) => [key, limitHermesHookValue(entry, depth + 1)])
    );
  }
  return undefined;
}

async function readHermesHookFileTail(path: string, size: number): Promise<string> {
  const hostPath = hostFilesystemPath(path);
  if (size <= HERMES_HOOK_FILE_BYTE_LIMIT) {
    return readFile(hostPath, "utf8").catch(() => "");
  }

  const handle = await open(hostPath, "r").catch(() => null);
  if (!handle) {
    return "";
  }
  try {
    const length = HERMES_HOOK_FILE_BYTE_LIMIT;
    const position = Math.max(0, size - length);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const firstNewline = text.indexOf("\n");
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function normalizeHermesHookRecord(raw: Record<string, unknown>, fallback: {
  sessionId: string;
  updatedAtMs: number;
}): HermesHookRecord {
  const payload = raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
    ? limitHermesHookValue(raw.payload) as Record<string, unknown>
    : {};
  const sessionId =
    hermesHookString(raw, "session_id")
    ?? hermesHookString(payload, "session_id")
    ?? fallback.sessionId;
  return {
    sessionId,
    eventName: hermesHookString(raw, "hook_event_name") ?? "unknown",
    timestampMs: hermesHookRecordTimestampMs(raw, fallback.updatedAtMs),
    cwd: normalizeFilesystemPath(hermesHookString(raw, "cwd")),
    processCwd: normalizeFilesystemPath(hermesHookString(raw, "process_cwd")),
    payload,
    raw: {}
  };
}

async function loadHermesHookSessions(limit: number): Promise<Map<string, HermesHookRecord[]>> {
  const files: Array<{ sessionId: string; path: string; updatedAtMs: number; size: number }> = [];

  for (const hooksDir of hermesHookDirectories()) {
    const entries = await readdir(hostFilesystemPath(hooksDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      const filePath = join(hooksDir, entry.name);
      const fileStats = await stat(hostFilesystemPath(filePath)).catch(() => null);
      if (!fileStats?.isFile()) {
        continue;
      }
      files.push({
        sessionId: entry.name.replace(/\.jsonl$/i, ""),
        path: filePath,
        updatedAtMs: fileStats.mtimeMs,
        size: fileStats.size
      });
    }
  }

  const groups = new Map<string, HermesHookRecord[]>();
  for (const file of files
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, Math.max(limit, HERMES_SESSION_SCAN_LIMIT))) {
    const raw = await readHermesHookFileTail(file.path, file.size);
    const records = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-HERMES_HOOK_RECORD_LIMIT)
      .map((line) => {
        if (Buffer.byteLength(line, "utf8") > HERMES_HOOK_LINE_BYTE_LIMIT) {
          return null;
        }
        try {
          return normalizeHermesHookRecord(JSON.parse(line) as Record<string, unknown>, file);
        } catch {
          return null;
        }
      })
      .filter((record): record is HermesHookRecord => record !== null)
      .sort((left, right) => left.timestampMs - right.timestampMs);
    if (records.length > 0) {
      const sessionId = records[records.length - 1].sessionId;
      const existing = groups.get(sessionId) ?? [];
      groups.set(sessionId, [...existing, ...records].sort((left, right) => left.timestampMs - right.timestampMs));
    }
  }
  return groups;
}

function collectHermesHookPathCandidates(records: HermesHookRecord[]): string[] {
  const paths = new Set<string>();
  for (const record of records) {
    for (const candidate of hermesHookPayloadPathCandidates(record)) {
      paths.add(candidate);
    }
    if (record.cwd) {
      paths.add(record.cwd);
    }
    if (record.processCwd) {
      paths.add(record.processCwd);
    }
  }
  return [...paths].slice(0, HERMES_HOOK_PATH_LIMIT);
}

function hermesHookPayloadPathCandidates(record: HermesHookRecord): string[] {
  const paths = new Set<string>();
  const text = JSON.stringify(record.payload).slice(0, HERMES_HOOK_TEXT_LIMIT * 4);
  for (const candidate of extractAbsolutePathCandidates(text)) {
    const normalized = normalizeCandidatePath(candidate, record.cwd ?? record.processCwd ?? "/");
    if (normalized) {
      paths.add(normalized);
    }
    if (paths.size >= HERMES_HOOK_PATH_LIMIT) {
      break;
    }
  }
  return [...paths];
}

function recentHermesHookRecordsForProjectRelation(records: HermesHookRecord[]): HermesHookRecord[] {
  return records.slice(-HERMES_PROJECT_RELATION_ACTION_WINDOW);
}

async function currentProjectRootForHermesHookSession(records: HermesHookRecord[]): Promise<string | null> {
  const recentRecords = recentHermesHookRecordsForProjectRelation(records);
  for (const record of [...recentRecords].reverse()) {
    const candidates = hermesHookPayloadPathCandidates(record);
    for (const candidate of candidates) {
      const root = await resolveProjectRootForPath(candidate);
      if (root) {
        return root;
      }
    }
  }
  for (const record of [...recentRecords].reverse()) {
    const candidates = [record.cwd, record.processCwd].filter((entry): entry is string => Boolean(entry));
    for (const candidate of candidates) {
      const root = await resolveProjectRootForPath(candidate);
      if (root) {
        return root;
      }
    }
  }
  return null;
}

function hermesHookNestedString(record: HermesHookRecord, path: string[]): string | null {
  let value: unknown = record.payload;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value.trim() ? shorten(value, 240) : null;
}

function hermesHookText(record: HermesHookRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record.payload[key];
    if (typeof value === "string" && value.trim()) {
      return shorten(value, 240);
    }
  }
  if (keys.includes("user_message")) {
    return hermesHookNestedString(record, ["event", "text"])
      ?? hermesHookNestedString(record, ["event", "message"]);
  }
  return null;
}

function hermesHookToolName(record: HermesHookRecord): string {
  const value = record.payload.tool_name;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (record.eventName === "transform_terminal_output") {
    return "terminal";
  }
  return "tool";
}

function hermesHookPlatform(record: HermesHookRecord): string | null {
  return hermesHookPayloadString(record, "platform");
}

function isNonSessionHermesHookId(sessionId: string): boolean {
  return sessionId === "default"
    || sessionId.startsWith("process-")
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
}

function isDurableHermesHookSessionId(sessionId: string): boolean {
  return /^\d{8}_\d{6}_[0-9a-f]+$/i.test(sessionId)
    || isHermesCronSessionId(sessionId);
}

function hermesHookSourceKind(sessionId: string): string {
  return isHermesCronSessionId(sessionId) ? "hermes:cron" : "hermes:hook";
}

function hermesHookRole(sessionId: string): string {
  return isHermesCronSessionId(sessionId) ? "temporary" : "hermes";
}

function hermesHookStatusText(sessionId: string, isOngoing: boolean): string {
  if (isOngoing) {
    return "active";
  }
  return isHermesCronSessionId(sessionId) ? "temporary" : "hook";
}

function canonicalHermesSessionIdForHookRecords(
  records: HermesHookRecord[],
  sessions: HermesStoredSession[]
): string | null {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  for (const record of [...records].reverse()) {
    if (sessionById.has(record.sessionId)) {
      return record.sessionId;
    }
    for (const key of ["session_id", "parent_session_id", "conversation_id"]) {
      const candidate = hermesHookPayloadString(record, key);
      if (candidate && sessionById.has(candidate)) {
        return candidate;
      }
    }
  }

  const latest = records[records.length - 1];
  if (!latest || !isNonSessionHermesHookId(latest.sessionId)) {
    return null;
  }

  const latestSeconds = latest.timestampMs / 1000;
  const platform = hermesHookPlatform(latest);
  const candidates = sessions
    .filter((session) => {
      const started = Number(session.startedAt);
      const ended = session.endedAt === null ? Number.POSITIVE_INFINITY : Number(session.endedAt);
      return Number.isFinite(started)
        && latestSeconds >= started - 60
        && latestSeconds <= ended + 10 * 60;
    })
    .sort((left, right) => {
      const leftPlatformScore = platform && left.source === platform ? 1 : 0;
      const rightPlatformScore = platform && right.source === platform ? 1 : 0;
      if (rightPlatformScore !== leftPlatformScore) {
        return rightPlatformScore - leftPlatformScore;
      }
      const leftDistance = Math.min(
        Math.abs(left.lastActive - latestSeconds),
        Math.abs(left.startedAt - latestSeconds),
        left.endedAt === null ? Number.POSITIVE_INFINITY : Math.abs(left.endedAt - latestSeconds)
      );
      const rightDistance = Math.min(
        Math.abs(right.lastActive - latestSeconds),
        Math.abs(right.startedAt - latestSeconds),
        right.endedAt === null ? Number.POSITIVE_INFINITY : Math.abs(right.endedAt - latestSeconds)
      );
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return right.lastActive - left.lastActive;
    });

  return candidates[0]?.id ?? null;
}

function hermesHookToolArgs(record: HermesHookRecord): Record<string, unknown> {
  const value = record.payload.args;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (record.eventName === "transform_terminal_output" && typeof record.payload.command === "string") {
    return { command: record.payload.command };
  }
  return {};
}

function hermesHookIsToolActivity(eventName: string): boolean {
  return eventName === "pre_tool_call"
    || eventName === "post_tool_call"
    || eventName === "transform_tool_result"
    || eventName === "transform_terminal_output";
}

function hermesHookIsToolCompletion(eventName: string): boolean {
  return eventName === "post_tool_call"
    || eventName === "transform_tool_result"
    || eventName === "transform_terminal_output";
}

function hermesHookResponseText(record: HermesHookRecord): string | null {
  return hermesHookText(record, ["assistant_response", "response_text"]);
}

function hermesHookTerminalOutput(record: HermesHookRecord): string | null {
  return hermesHookText(record, ["output", "result"]);
}

function hermesHookApiDetail(record: HermesHookRecord): string {
  const provider = typeof record.payload.provider === "string" ? record.payload.provider : "";
  const model = typeof record.payload.model === "string" ? record.payload.model : "";
  const finishReason = typeof record.payload.finish_reason === "string" ? record.payload.finish_reason : "";
  const modelLabel = model.trim() || provider.trim();
  if (record.eventName === "pre_api_request") {
    return modelLabel ? `Thinking with ${modelLabel}` : "Thinking with model";
  }
  if (/tool/i.test(finishReason)) {
    return modelLabel ? `Using tools after ${modelLabel}` : "Using tools";
  }
  if (/stop|complete|success/i.test(finishReason)) {
    return modelLabel ? `Answered with ${modelLabel}` : "Answered";
  }
  return modelLabel ? `Model request ${modelLabel}` : "Model request";
}

function hermesHookResultLooksFailed(record: HermesHookRecord): boolean {
  if (
    typeof record.payload.returncode === "number"
    && record.payload.returncode !== 0
  ) {
    return true;
  }
  if (
    typeof record.payload.status === "string"
    && /fail|error/i.test(record.payload.status)
  ) {
    return true;
  }
  const result = parseMaybeJson(record.payload.result ?? record.payload.output);
  if (result && typeof result === "object") {
    const object = result as Record<string, unknown>;
    if (typeof object.error === "string" && object.error.trim()) {
      return true;
    }
    if (typeof object.exit_code === "number" && object.exit_code !== 0) {
      return true;
    }
    if (typeof object.returncode === "number" && object.returncode !== 0) {
      return true;
    }
    if (typeof object.status === "string" && /fail|error/i.test(object.status)) {
      return true;
    }
  }
  return false;
}

function hermesHookToolActivityEvent(input: {
  record: HermesHookRecord;
  projectRoot: string;
  paths: string[];
  failed: boolean;
}): AgentActivityEvent {
  const toolName = hermesHookToolName(input.record);
  const args = hermesHookToolArgs(input.record);
  const kind = toolKind(toolName);
  const title = input.failed ? `${toolName} failed` : toolTitle(toolName, args);
  return {
    type: kind.eventType,
    action:
      kind.eventKind === "command" ? "ran"
      : kind.eventKind === "fileChange" ? "edited"
      : "updated",
    path: toolPath(input.projectRoot, input.record.cwd, args) ?? input.paths[0] ?? input.projectRoot,
    title,
    isImage: false
  };
}

function hermesHookSubagentStatus(record: HermesHookRecord): string | null {
  const value = record.payload.child_status;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function hermesHookToolSummary(record: HermesHookRecord): {
  toolName: string;
  args: Record<string, unknown>;
  failed: boolean;
  kind: ReturnType<typeof toolKind>;
  title: string;
  latestMessage: string | null;
} {
  const toolName = hermesHookToolName(record);
  const args = hermesHookToolArgs(record);
  const failed = hermesHookIsToolCompletion(record.eventName) && hermesHookResultLooksFailed(record);
  const kind = toolKind(toolName);
  return {
    toolName,
    args,
    failed,
    kind,
    title: failed ? `${toolName} failed` : toolTitle(toolName, args),
    latestMessage: hermesHookResponseText(record) ?? hermesHookTerminalOutput(record)
  };
}

function hermesHookMeaningfulText(record: HermesHookRecord): string | null {
  const assistantText = hermesHookResponseText(record);
  if (assistantText) {
    return assistantText;
  }
  const childSummary = hermesHookText(record, ["child_summary"]);
  if (childSummary) {
    return childSummary;
  }
  const terminalOutput = hermesHookTerminalOutput(record);
  if (terminalOutput) {
    return terminalOutput;
  }
  if (hermesHookIsToolActivity(record.eventName)) {
    return hermesHookToolSummary(record).title;
  }
  return null;
}

function hermesHookDisplayUserText(record: HermesHookRecord): string | null {
  const userText = hermesHookText(record, ["user_message"]);
  if (!userText) {
    return null;
  }
  if (/^\[IMPORTANT:/i.test(userText) && hermesSkillNameFromText(userText)) {
    return null;
  }
  const title = hermesTitleFromText(userText);
  if (title && hermesTitleLooksGenericPrompt(title)) {
    return null;
  }
  return userText;
}

function hermesHookConversationText(record: HermesHookRecord): string | null {
  return hermesHookResponseText(record)
    ?? hermesHookText(record, ["child_summary"]);
}

function latestHermesHookMeaningfulText(records: HermesHookRecord[]): string | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const text = hermesHookMeaningfulText(records[index]);
    if (text) {
      return text;
    }
  }
  return null;
}

function latestHermesHookConversationText(records: HermesHookRecord[]): string | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const text = hermesHookConversationText(records[index]);
    if (text) {
      return text;
    }
  }
  return null;
}

function summarizeHermesHookSession(input: {
  records: HermesHookRecord[];
  projectRoot: string;
  paths: string[];
  now: number;
}): HermesSessionSummary {
  const latest = input.records[input.records.length - 1];
  const ageMs = input.now - latest.timestampMs;
  const recentOpen = ageMs <= HERMES_RECENT_OPEN_WINDOW_MS;
  const recentDone = ageMs <= HERMES_RECENT_DONE_WINDOW_MS;
  const isFinalized = latest.eventName === "on_session_finalize";
  const assistantText = hermesHookResponseText(latest);
  const userText = hermesHookText(latest, ["user_message"]);
  const conversationText = latestHermesHookConversationText(input.records);

  if (hermesHookIsToolActivity(latest.eventName)) {
    const toolSummary = hermesHookToolSummary(latest);
    return {
      state: toolSummary.failed ? "blocked" : toolSummary.kind.state,
      isOngoing: recentOpen && !isFinalized,
      detail: toolSummary.title,
      paths: input.paths,
      activityEvent: hermesHookToolActivityEvent({
        record: latest,
        projectRoot: input.projectRoot,
        paths: input.paths,
        failed: toolSummary.failed
      }),
      latestMessage: conversationText,
      updatedAtMs: latest.timestampMs,
      stoppedAtMs: toolSummary.failed || isFinalized ? latest.timestampMs : null
    };
  }

  if (latest.eventName === "post_llm_call" || latest.eventName === "transform_llm_output") {
    return {
      state: recentDone ? "done" : "idle",
      isOngoing: recentDone && !isFinalized,
      detail: assistantText ?? "Hermes reply",
      paths: input.paths,
      activityEvent: assistantText
        ? {
          type: "agentMessage",
          action: "said",
          path: input.paths[0] ?? input.projectRoot,
          title: assistantText,
          isImage: false
        }
        : null,
      latestMessage: conversationText ?? assistantText,
      updatedAtMs: latest.timestampMs,
      stoppedAtMs: recentDone || isFinalized ? latest.timestampMs : null
    };
  }

  if (latest.eventName === "pre_api_request" || latest.eventName === "post_api_request") {
    const detail = hermesHookApiDetail(latest);
    return {
      state: latest.eventName === "pre_api_request" ? "thinking" : (recentOpen ? "thinking" : "idle"),
      isOngoing: recentOpen && !isFinalized,
      detail,
      paths: input.paths,
      activityEvent: {
        type: "reasoning",
        action: "updated",
        path: input.paths[0] ?? input.projectRoot,
        title: detail,
        isImage: false
      },
      latestMessage: conversationText,
      updatedAtMs: latest.timestampMs,
      stoppedAtMs: recentOpen && !isFinalized ? null : latest.timestampMs
    };
  }

  if (latest.eventName === "subagent_stop") {
    const childRole = hermesHookText(latest, ["child_role"]);
    const childSummary = hermesHookText(latest, ["child_summary"]);
    const status = hermesHookSubagentStatus(latest);
    const failed = status ? /fail|error|interrupt/.test(status) : false;
    const title = childRole ? `Subagent ${childRole}` : "Subagent";
    return {
      state: failed ? "blocked" : "delegating",
      isOngoing: recentOpen && !isFinalized,
      detail: childSummary ?? (status ? `${title} ${status}` : `${title} stopped`),
      paths: input.paths,
      activityEvent: {
        type: "collabAgentToolCall",
        action: "updated",
        path: input.paths[0] ?? input.projectRoot,
        title: childSummary ?? title,
        isImage: false
      },
      latestMessage: conversationText ?? childSummary,
      updatedAtMs: latest.timestampMs,
      stoppedAtMs: failed || !recentOpen ? latest.timestampMs : null
    };
  }

  if (latest.eventName === "on_session_end" || latest.eventName === "on_session_finalize") {
    const meaningfulText = conversationText ?? latestHermesHookMeaningfulText(input.records);
    return {
      state: "done",
      isOngoing: false,
      detail: meaningfulText ?? (latest.eventName === "on_session_end" ? "Hermes session ended" : "Hermes session finalized"),
      paths: input.paths,
      activityEvent: null,
      latestMessage: meaningfulText ?? assistantText,
      updatedAtMs: latest.timestampMs,
      stoppedAtMs: latest.timestampMs
    };
  }

  return {
    state: "planning",
    isOngoing: recentOpen,
    detail: userText ?? "Hermes session activity",
    paths: input.paths,
    activityEvent: {
      type: latest.eventName === "pre_gateway_dispatch" ? "userMessage" : "plan",
      action: "updated",
      path: input.paths[0] ?? input.projectRoot,
      title: userText ?? latest.eventName,
      isImage: false
    },
    latestMessage: conversationText ?? assistantText,
    updatedAtMs: latest.timestampMs,
    stoppedAtMs: recentOpen ? null : latest.timestampMs
  };
}

function buildHermesHookEvents(input: {
  records: HermesHookRecord[];
  projectRoot: string;
  threadId?: string;
}): DashboardEvent[] {
  const records = input.records.slice(-20);
  const startIndex = input.records.length - records.length;
  return records.map((record, index) => {
    const toolName = hermesHookToolName(record);
    const kind = hermesHookIsToolActivity(record.eventName) ? toolKind(toolName) : null;
    const args = kind ? hermesHookToolArgs(record) : {};
    const toolEventTitle = kind ? toolTitle(toolName, args) : "";
    const toolEventPath = kind
      ? toolPath(input.projectRoot, record.cwd, args) ?? input.projectRoot
      : input.projectRoot;
    const command = kind?.eventKind === "command"
      ? (
        typeof args.command === "string" && args.command.trim()
          ? shorten(args.command, 240)
          : toolName === "process" ? toolEventTitle : undefined
      )
      : undefined;
    const assistantText = hermesHookResponseText(record) ?? hermesHookTerminalOutput(record);
    const userText = hermesHookText(record, ["user_message"]);
    const lifecycleText = record.eventName === "on_session_end" || record.eventName === "on_session_finalize"
      ? latestHermesHookMeaningfulText(input.records.slice(0, startIndex + index + 1))
      : null;
    const method =
      kind?.eventType === "plan"
        ? "turn/plan/updated"
      : kind?.eventKind === "command"
        ? record.eventName === "pre_tool_call" ? "item/started" : "item/commandExecution/outputDelta"
        : kind?.eventKind === "fileChange"
          ? record.eventName === "pre_tool_call" ? "item/started" : "item/fileChange/outputDelta"
          : kind?.eventKind === "tool"
            ? toolName.startsWith("mcp_") && record.eventName !== "pre_tool_call" ? "item/mcpToolCall/progress" : "item/tool/call"
            : record.eventName === "pre_llm_call" || record.eventName === "pre_gateway_dispatch"
              ? "hermes/userMessage"
              : record.eventName === "post_llm_call" || record.eventName === "transform_llm_output"
                ? "hermes/agentMessage"
                : `hermes/${record.eventName}`;
    const eventKind: DashboardEvent["kind"] =
      kind?.eventKind
        ?? (record.eventName === "pre_api_request" || record.eventName === "post_api_request" ? "status" : "message");
    const detail =
      kind ? toolEventTitle
      : record.eventName === "pre_api_request" || record.eventName === "post_api_request" ? hermesHookApiDetail(record)
      : lifecycleText ?? assistantText ?? userText ?? record.eventName;
    const action: DashboardEvent["action"] =
      kind?.eventKind === "command" ? "ran"
      : kind?.eventKind === "fileChange" ? "edited"
      : kind?.eventType === "plan" ? "updated"
      : eventKind === "message" ? "said"
      : "updated";
    return {
      id: `${input.projectRoot}::hermes-hook::${record.sessionId}::${record.timestampMs}::${index}`,
      source: "hermes",
      confidence: "typed",
      threadId: input.threadId ?? record.sessionId,
      createdAt: new Date(record.timestampMs).toISOString(),
      method,
      itemType:
        kind?.eventType === "mcpToolCall" ? "mcpToolCall"
        : kind?.eventType === "dynamicToolCall" ? "dynamicToolCall"
        : eventKind === "message" && (record.eventName === "pre_llm_call" || record.eventName === "pre_gateway_dispatch") ? "userMessage"
        : eventKind === "message" ? "agentMessage"
        : undefined,
      kind: eventKind,
      phase: kind?.eventType === "plan"
        ? "updated"
        : hermesHookIsToolCompletion(record.eventName)
        ? hermesHookResultLooksFailed(record) ? "failed" : "completed"
        : record.eventName === "pre_tool_call" ? "started" : "updated",
      title: kind ? toolEventTitle : record.eventName,
      detail,
      path: toolEventPath,
      action,
      command,
      isImage: false
    };
  });
}

function summarizeHermesSession(input: {
  session: HermesStoredSession;
  projectRoot: string;
  cwd: string | null;
  activeProcess: HermesProcessInfo | null;
  paths: string[];
  now: number;
}): HermesSessionSummary {
  const { session, projectRoot, cwd, activeProcess, paths, now } = input;
  const latest = [...session.messages].reverse().find((message) => message.role) ?? null;
  const latestCall = latestMessageToolCall(latest);
  const latestMessage = latestAssistantText(session.messages);
  const latestUser = latestHermesSessionUserText(session);
  const promptDetail = latestUser ?? (isHermesCronSession(session) ? "Scheduled cron job" : "Hermes prompt");
  const lastActiveMs = Math.max(session.lastActive * 1000, session.startedAt * 1000);
  const ageMs = now - lastActiveMs;
  const isEnded = session.endedAt !== null;
  const active = Boolean(activeProcess);
  const freshOpen = !isEnded && ageMs <= HERMES_RECENT_OPEN_WINDOW_MS;
  const hasUnfinishedTurn = latest?.role === "user"
    || latest?.role === "tool"
    || (latest?.role === "assistant" && latestCall !== null);
  const isOngoing = !isEnded && (freshOpen || (hasUnfinishedTurn && active));

  if (latest?.role === "tool" && messageLooksFailed(latest)) {
    const toolName = latest.toolName ?? "tool";
    return {
      state: "blocked",
      isOngoing,
      detail: `${toolName} failed`,
      paths,
      activityEvent: {
        type: toolKind(toolName).eventType,
        action: "updated",
        path: paths[0] ?? projectRoot,
        title: `${toolName} failed`,
        isImage: false
      },
      latestMessage,
      updatedAtMs: lastActiveMs,
      stoppedAtMs: isOngoing ? null : lastActiveMs
    };
  }

  if (latestCall && isOngoing) {
    const kind = toolKind(latestCall.name);
    return {
      state: kind.state,
      isOngoing: true,
      detail: toolTitle(latestCall.name, latestCall.args),
      paths,
      activityEvent: toolActivityEvent(projectRoot, cwd, latestCall),
      latestMessage,
      updatedAtMs: lastActiveMs,
      stoppedAtMs: null
    };
  }

  if (latest?.role === "tool" && isOngoing) {
    const toolName = latest.toolName ?? "tool";
    return {
      state: "thinking",
      isOngoing: true,
      detail: `${toolName} result`,
      paths,
      activityEvent: {
        type: toolKind(toolName).eventType,
        action: "updated",
        path: paths[0] ?? projectRoot,
        title: `${toolName} result`,
        isImage: false
      },
      latestMessage,
      updatedAtMs: lastActiveMs,
      stoppedAtMs: null
    };
  }

  if (latest?.role === "user" && isOngoing) {
    return {
      state: "planning",
      isOngoing: true,
      detail: promptDetail,
      paths,
      activityEvent: {
        type: "userMessage",
        action: "said",
        path: paths[0] ?? projectRoot,
        title: promptDetail,
        isImage: false
      },
      latestMessage,
      updatedAtMs: lastActiveMs,
      stoppedAtMs: null
    };
  }

  if (active && session.messages.length === 0) {
    return {
      state: "thinking",
      isOngoing: true,
      detail: latestMessage ?? latestUser ?? "Hermes is active",
      paths,
      activityEvent: latestMessage
        ? {
          type: "agentMessage",
          action: "said",
          path: paths[0] ?? projectRoot,
          title: latestMessage,
          isImage: false
        }
        : null,
      latestMessage,
      updatedAtMs: lastActiveMs,
      stoppedAtMs: null
    };
  }

  if (freshOpen) {
    return {
      state: "waiting",
      isOngoing: true,
      detail: latestMessage ?? latestUser ?? (isHermesCronSession(session) ? "Scheduled cron job open" : "Hermes session open"),
      paths,
      activityEvent: latestMessage
        ? {
          type: "agentMessage",
          action: "said",
          path: paths[0] ?? projectRoot,
          title: latestMessage,
          isImage: false
        }
        : null,
      latestMessage,
      updatedAtMs: lastActiveMs,
      stoppedAtMs: null
    };
  }

  const recentlyDone = ageMs <= HERMES_RECENT_DONE_WINDOW_MS;
  return {
    state: recentlyDone ? "done" : "idle",
    isOngoing: false,
    detail: latestMessage ?? latestUser ?? (isEnded ? "Finished" : isHermesCronSession(session) ? "Scheduled cron job" : "Hermes session"),
    paths,
    activityEvent: latestMessage
      ? {
        type: "agentMessage",
        action: "said",
        path: paths[0] ?? projectRoot,
        title: latestMessage,
        isImage: false
      }
      : null,
    latestMessage,
    updatedAtMs: lastActiveMs,
    stoppedAtMs: isEnded || recentlyDone ? lastActiveMs : null
  };
}

function buildHermesMessageEvents(input: {
  session: HermesStoredSession;
  projectRoot: string;
  cwd: string | null;
}): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  for (const message of input.session.messages) {
    const createdAt = new Date((message.timestamp || input.session.lastActive) * 1000).toISOString();
    const baseId = `${input.projectRoot}::hermes::${input.session.id}::${message.id}`;

    if (message.role === "user") {
      const detail = textFromContent(message.content);
      if (!detail) {
        continue;
      }
      events.push({
        id: `${baseId}::user`,
        source: "hermes",
        confidence: "inferred",
        threadId: input.session.id,
        createdAt,
        method: "hermes/userMessage",
        kind: "message",
        phase: "updated",
        title: "Hermes prompt",
        detail: shorten(detail, 240),
        path: input.projectRoot,
        action: "said",
        isImage: false
      });
      continue;
    }

    if (message.role === "assistant") {
      const calls = parseToolCalls(message.toolCalls);
      calls.forEach((call, index) => {
        const kind = toolKind(call.name);
        const path = toolPath(input.projectRoot, input.cwd, call.args);
        events.push({
          id: `${baseId}::tool-${index}`,
          source: "hermes",
          confidence: "inferred",
          threadId: input.session.id,
          createdAt,
          method: "item/started",
          kind: kind.eventKind,
          phase: "started",
          title: call.name,
          detail: toolTitle(call.name, call.args),
          path,
          command: typeof call.args.command === "string" ? call.args.command : undefined,
          action: kind.eventKind === "command" ? "ran" : "updated",
          isImage: false
        });
      });

      const detail = textFromContent(message.content);
      if (detail) {
        events.push({
          id: `${baseId}::assistant`,
          source: "hermes",
          confidence: "inferred",
          threadId: input.session.id,
          createdAt,
          method: "hermes/agentMessage",
          kind: "message",
          phase: "updated",
          title: "Hermes reply",
          detail: shorten(detail, 240),
          path: input.projectRoot,
          action: "said",
          isImage: false
        });
      }
      continue;
    }

    if (message.role === "tool" && message.toolName) {
      const kind = toolKind(message.toolName);
      const failed = messageLooksFailed(message);
      const detail = textFromContent(message.content);
      events.push({
        id: `${baseId}::tool-result`,
        source: "hermes",
        confidence: "inferred",
        threadId: input.session.id,
        createdAt,
        method: "item/completed",
        kind: kind.eventKind,
        phase: failed ? "failed" : "completed",
        title: message.toolName,
        detail: shorten(detail || message.toolName, 240),
        path: input.projectRoot,
        action: kind.eventKind === "command" ? "ran" : "updated",
        isImage: false
      });
    }
  }

  return events;
}

async function gitInfoForProject(projectRoot: string): Promise<GitInfo> {
  void projectRoot;
  return {
    sha: null,
    branch: null,
    originUrl: null
  };
}

async function allHermesHomes(processes: HermesProcessInfo[]): Promise<string[]> {
  const homes = new Set(await hermesHomeCandidatesFromDisk());
  for (const processInfo of processes) {
    if (processInfo.hermesHome) {
      homes.add(processInfo.hermesHome);
    }
  }
  return [...homes].filter(Boolean);
}

function latestActiveSessionForHome(
  sessions: HermesStoredSession[],
  home: string | null
): HermesStoredSession | null {
  if (!home) {
    return null;
  }
  return sessions
    .filter((session) =>
      session.home === home
      && !session.endedAt
      && isCliLikeHermesSource(session)
    )
    .sort((left, right) => right.lastActive - left.lastActive)[0] ?? null;
}

export async function loadHermesProjectSnapshotData(projectRoot: string, limit = hermesLocalSessionLimit()): Promise<{
  agents: DashboardAgent[];
  events: DashboardEvent[];
  notes: string[];
}> {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return { agents: [], events: [], notes: [] };
  }

  const notes: string[] = [];
  const processes = await scanHermesProcesses();
  const projectProcesses = processes.filter((processInfo) => pathWithinProject(canonicalRoot, processInfo.cwd));
  const scanLimit = hermesScanLimit(limit);
  const hookSessions = await loadHermesHookSessions(scanLimit);
  const homes = await allHermesHomes(processes);
  const sessionGroups = await Promise.all(homes.map((home) =>
    loadHermesSessions(home, scanLimit, notes)
  ));
  const sessions = sessionGroups.flat().sort((left, right) => right.lastActive - left.lastActive);
  const activeSessionIds = new Set<string>();
  for (const processInfo of projectProcesses) {
    const activeSession = latestActiveSessionForHome(sessions, processInfo.hermesHome);
    if (activeSession) {
      activeSessionIds.add(activeSession.id);
    }
  }

  const now = Date.now();
  const git = await gitInfoForProject(canonicalRoot);
  const agents: DashboardAgent[] = [];
  const events: DashboardEvent[] = [];
  const includedSessionIds = new Set<string>();
  const hookRecordsBySessionId = new Map<string, HermesHookRecord[]>();

  for (const records of hookSessions.values()) {
    const currentRoot = await currentProjectRootForHermesHookSession(records);
    if (!currentRoot || !sameProjectPath(currentRoot, canonicalRoot)) {
      continue;
    }
    const canonicalSessionId = canonicalHermesSessionIdForHookRecords(records, sessions);
    const latest = records[records.length - 1];
    const hookOnlySessionId = latest && isDurableHermesHookSessionId(latest.sessionId)
      ? latest.sessionId
      : null;
    const visibleSessionId = canonicalSessionId ?? hookOnlySessionId;
    if (!visibleSessionId) {
      continue;
    }
    const existing = hookRecordsBySessionId.get(visibleSessionId) ?? [];
    hookRecordsBySessionId.set(visibleSessionId, [...existing, ...records].sort((left, right) => left.timestampMs - right.timestampMs));
  }

  for (const session of sessions) {
    if (includedSessionIds.has(session.id)) {
      continue;
    }
    const activeProcess = projectProcesses.find((processInfo) =>
      processInfo.hermesHome === session.home && activeSessionIds.has(session.id)
    ) ?? null;
    const sessionCwd = cwdFromSystemPrompt(session.systemPrompt);
    const fallbackCwd = activeProcess?.cwd ?? sessionCwd;
    const currentRoot = await currentProjectRootForHermesSession(session, activeProcess);
    if (!currentRoot || !sameProjectPath(currentRoot, canonicalRoot)) {
      continue;
    }
    const candidatePaths = collectSessionPathCandidates(session, fallbackCwd);
    const projectPaths = candidatePaths.filter((candidate) => pathWithinProject(canonicalRoot, candidate));

    const cwd = activeProcess?.cwd ?? (pathWithinProject(canonicalRoot, sessionCwd) ? sessionCwd : null) ?? currentRoot;
    const paths = projectPaths.length > 0 ? projectPaths : [cwd];
    const summary = summarizeHermesSession({
      session,
      projectRoot: canonicalRoot,
      cwd,
      activeProcess,
      paths,
      now
    });
    const hookRecords = hookRecordsBySessionId.get(session.id) ?? [];
    const hookPaths = collectHermesHookPathCandidates(hookRecords).filter((candidate) => pathWithinProject(canonicalRoot, candidate));
    const hookSummary = hookRecords.length > 0
      ? summarizeHermesHookSession({
        records: hookRecords,
        projectRoot: canonicalRoot,
        paths: hookPaths.length > 0 ? hookPaths : paths,
        now
      })
      : null;
    const visibleSummary = hookSummary && hookSummary.updatedAtMs >= summary.updatedAtMs
      ? {
        ...hookSummary,
        latestMessage: hookSummary.latestMessage ?? summary.latestMessage,
        paths: [...new Set([...hookSummary.paths, ...summary.paths])].slice(0, HERMES_HOOK_PATH_LIMIT)
      }
      : summary;

    if (visibleSummary.state === "idle" && !visibleSummary.isOngoing) {
      continue;
    }

    const appearance = await ensureAgentAppearance(canonicalRoot, `hermes:${session.id}`);
    const isContinuation = isHermesCompressionContinuation(session);
    agents.push({
      id: `hermes:${session.id}`,
      label: sessionLabel(session, canonicalRoot),
      source: "hermes",
      sourceKind: sessionSourceKind(session),
      parentThreadId: !isContinuation && session.parentSessionId ? `hermes:${session.parentSessionId}` : null,
      depth: !isContinuation && session.parentSessionId ? 1 : 0,
      isCurrent: visibleSummary.isOngoing,
      isOngoing: visibleSummary.isOngoing,
      statusText: sessionStatusText(session, visibleSummary.isOngoing),
      role: sessionRole(session),
      nickname: null,
      isSubagent: Boolean(!isContinuation && session.parentSessionId),
      state: visibleSummary.state,
      detail: visibleSummary.detail,
      cwd,
      roomId: null,
      appearance,
      updatedAt: new Date(visibleSummary.updatedAtMs).toISOString(),
      stoppedAt: visibleSummary.stoppedAtMs ? new Date(visibleSummary.stoppedAtMs).toISOString() : null,
      paths: visibleSummary.paths,
      activityEvent: visibleSummary.activityEvent,
      latestMessage: visibleSummary.latestMessage,
      threadId: session.id,
      taskId: null,
      resumeCommand: null,
      url: null,
      git,
      provenance: "hermes",
      confidence: hookSummary ? "typed" : "inferred",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
    includedSessionIds.add(session.id);
    events.push(...buildHermesMessageEvents({
      session,
      projectRoot: canonicalRoot,
      cwd
    }));
    if (hookRecords.length > 0) {
      events.push(...buildHermesHookEvents({ records: hookRecords, projectRoot: canonicalRoot, threadId: session.id }));
    }
  }

  for (const [sessionId, hookRecords] of hookRecordsBySessionId) {
    if (includedSessionIds.has(sessionId) || !isDurableHermesHookSessionId(sessionId)) {
      continue;
    }
    const hookPaths = collectHermesHookPathCandidates(hookRecords).filter((candidate) => pathWithinProject(canonicalRoot, candidate));
    const latest = hookRecords[hookRecords.length - 1];
    const cwd = pathWithinProject(canonicalRoot, latest?.cwd) ? latest?.cwd ?? canonicalRoot : canonicalRoot;
    const paths = hookPaths.length > 0 ? hookPaths : [cwd];
    const summary = summarizeHermesHookSession({
      records: hookRecords,
      projectRoot: canonicalRoot,
      paths,
      now
    });
    if (summary.state === "idle" && !summary.isOngoing) {
      continue;
    }

    const appearance = await ensureAgentAppearance(canonicalRoot, `hermes:${sessionId}`);
    agents.push({
      id: `hermes:${sessionId}`,
      label: hermesHookSessionLabel(hookRecords, canonicalRoot, summary.latestMessage),
      source: "hermes",
      sourceKind: hermesHookSourceKind(sessionId),
      parentThreadId: null,
      depth: 0,
      isCurrent: summary.isOngoing,
      isOngoing: summary.isOngoing,
      statusText: hermesHookStatusText(sessionId, summary.isOngoing),
      role: hermesHookRole(sessionId),
      nickname: null,
      isSubagent: false,
      state: summary.state,
      detail: summary.detail,
      cwd,
      roomId: null,
      appearance,
      updatedAt: new Date(summary.updatedAtMs).toISOString(),
      stoppedAt: summary.stoppedAtMs ? new Date(summary.stoppedAtMs).toISOString() : null,
      paths: summary.paths,
      activityEvent: summary.activityEvent,
      latestMessage: summary.latestMessage,
      threadId: sessionId,
      taskId: null,
      resumeCommand: null,
      url: null,
      git,
      provenance: "hermes",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
    includedSessionIds.add(sessionId);
    events.push(...buildHermesHookEvents({ records: hookRecords, projectRoot: canonicalRoot, threadId: sessionId }));
  }

  for (const processInfo of projectProcesses) {
    const hasIncludedSession = sessions.some((session) =>
      includedSessionIds.has(session.id)
      && session.home === processInfo.hermesHome
      && activeSessionIds.has(session.id)
    );
    if (hasIncludedSession || !processInfo.cwd) {
      continue;
    }
    const appearance = await ensureAgentAppearance(canonicalRoot, `hermes-process:${processInfo.pid}`);
    agents.push({
      id: `hermes-process:${processInfo.pid}`,
      label: "Hermes CLI",
      source: "hermes",
      sourceKind: "hermes:process",
      parentThreadId: null,
      depth: 0,
      isCurrent: true,
      isOngoing: true,
      statusText: "active",
      role: "hermes",
      nickname: null,
      isSubagent: false,
      state: "planning",
      detail: "Hermes process in workspace",
      cwd: processInfo.cwd,
      roomId: null,
      appearance,
      updatedAt: new Date(processInfo.updatedAtMs).toISOString(),
      stoppedAt: null,
      paths: [processInfo.cwd],
      activityEvent: null,
      latestMessage: null,
      threadId: `process:${processInfo.pid}`,
      taskId: null,
      resumeCommand: null,
      url: null,
      git,
      provenance: "hermes",
      confidence: "inferred",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
  }

  return {
    agents: agents
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit),
    events: events.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    notes
  };
}

export async function discoverHermesProjects(limit = 20): Promise<DiscoveredProject[]> {
  const projects = new Map<string, DiscoveredProject>();
  const processes = await scanHermesProcesses();
  const scanLimit = hermesScanLimit(limit);
  const hookSessions = await loadHermesHookSessions(scanLimit);
  const now = Date.now();
  const notes: string[] = [];

  const upsertProject = async (root: string | null, updatedAtSeconds: number): Promise<void> => {
    const key = projectPathIdentityKey(root);
    if (!root || !key) {
      return;
    }
    if (HERMES_TRANSIENT_PROJECT_ROOTS.has(root.replace(/\\/g, "/").toLowerCase())) {
      return;
    }
    if (await looksLikeHermesRuntimeProjectRoot(root)) {
      return;
    }
    if (!await pathExists(join(root, ".git"))) {
      return;
    }
    const existing = projects.get(key);
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt, updatedAtSeconds);
      existing.count += 1;
      return;
    }
    projects.set(key, {
      root,
      label: projectLabelFromRoot(root),
      updatedAt: updatedAtSeconds,
      count: 1
    });
  };

  for (const processInfo of processes) {
    if (!processInfo.cwd) {
      continue;
    }
    const root = await resolveProjectRootForPath(processInfo.cwd);
    await upsertProject(root, Math.floor(processInfo.updatedAtMs / 1000));
  }

  for (const records of hookSessions.values()) {
    const latest = records[records.length - 1];
    if (!latest || now - latest.timestampMs > HERMES_PROJECT_DISCOVERY_HOOK_WINDOW_MS) {
      continue;
    }
    const summary = summarizeHermesHookSession({
      records,
      projectRoot: latest.cwd ?? latest.processCwd ?? "/",
      paths: collectHermesHookPathCandidates(records),
      now
    });
    if (summary.state === "idle" && !summary.isOngoing) {
      continue;
    }
    const currentRoot = await currentProjectRootForHermesHookSession(records);
    await upsertProject(currentRoot, Math.floor(latest.timestampMs / 1000));
  }

  const homes = await allHermesHomes(processes);
  const sessionGroups = await Promise.all(homes.map((home) =>
    loadHermesSessions(home, scanLimit, notes)
  ));
  for (const session of sessionGroups.flat()) {
    if (session.endedAt !== null) {
      continue;
    }
    const lastActiveMs = Math.max(session.lastActive * 1000, session.startedAt * 1000);
    if (now - lastActiveMs > HERMES_RECENT_OPEN_WINDOW_MS) {
      continue;
    }
    const root = await currentProjectRootForHermesSession(session, null);
    await upsertProject(root, Math.floor(lastActiveMs / 1000));
  }

  return [...projects.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

export async function loadRoamingHermesSnapshotData(input: {
  anchorProjectRoot: string;
  knownProjectRoots: string[];
  limit?: number;
}): Promise<{
  agents: DashboardAgent[];
  events: DashboardEvent[];
  notes: string[];
}> {
  const anchorRoot = canonicalizeProjectPath(input.anchorProjectRoot);
  if (!anchorRoot) {
    return { agents: [], events: [], notes: [] };
  }

  const knownRoots = input.knownProjectRoots
    .map((root) => canonicalizeProjectPath(root))
    .filter((root): root is string => Boolean(root));
  const limit = input.limit ?? 4;
  const hookSessions = await loadHermesHookSessions(hermesScanLimit(limit));
  const now = Date.now();
  const gitByRoot = new Map<string, GitInfo>();
  const gitForRoot = async (root: string): Promise<GitInfo> => {
    const key = projectPathIdentityKey(root) ?? root;
    const existing = gitByRoot.get(key);
    if (existing) {
      return existing;
    }
    const git = await gitInfoForProject(root);
    gitByRoot.set(key, git);
    return git;
  };
  const agents: DashboardAgent[] = [];
  const events: DashboardEvent[] = [];

  for (const [sessionId, records] of hookSessions.entries()) {
    if (isNonSessionHermesHookId(sessionId)) {
      continue;
    }
    const currentRoot = await currentProjectRootForHermesHookSession(records);
    const candidatePaths = collectHermesHookPathCandidates(records);
    const isInsideKnownWorkspace = Boolean(
      currentRoot
      && knownRoots.some((root) => sameProjectPath(root, currentRoot) || pathWithinProject(root, currentRoot))
    );
    if (isInsideKnownWorkspace) {
      continue;
    }
    const sourceRoot = currentRoot ?? anchorRoot;

    const summary = summarizeHermesHookSession({
      records,
      projectRoot: sourceRoot,
      paths: candidatePaths,
      now
    });
    if (summary.state === "idle" && !summary.isOngoing) {
      continue;
    }

    const latest = records[records.length - 1];
    const appearance = await ensureAgentAppearance(sourceRoot, `hermes:${sessionId}`);
    const statusText = isHermesCronSessionId(sessionId)
      ? hermesHookStatusText(sessionId, summary.isOngoing)
      : summary.isOngoing ? "roaming" : summary.state;
    agents.push({
      id: `hermes:${sessionId}`,
      label: hermesHookSessionLabel(records, sourceRoot, summary.latestMessage),
      source: "hermes",
      sourceKind: "hermes:roaming",
      parentThreadId: null,
      depth: 0,
      isCurrent: false,
      isOngoing: summary.isOngoing,
      statusText,
      role: hermesHookRole(sessionId),
      nickname: null,
      isSubagent: false,
      state: summary.state,
      detail: summary.detail,
      cwd: latest.cwd ?? latest.processCwd ?? null,
      sourceProjectRoot: sourceRoot,
      roomId: null,
      appearance,
      updatedAt: new Date(summary.updatedAtMs).toISOString(),
      stoppedAt: summary.stoppedAtMs ? new Date(summary.stoppedAtMs).toISOString() : null,
      paths: [],
      activityEvent: summary.activityEvent,
      latestMessage: summary.latestMessage,
      threadId: sessionId,
      taskId: null,
      resumeCommand: null,
      url: null,
      git: await gitForRoot(sourceRoot),
      provenance: "hermes",
      confidence: "typed",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    });
    events.push(...buildHermesHookEvents({ records, projectRoot: sourceRoot }));
  }

  return {
    agents: agents
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit),
    events: events.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    notes: []
  };
}

export function summarizeHermesSessionForTest(input: {
  session: HermesStoredSession;
  projectRoot: string;
  cwd?: string | null;
  active?: boolean;
  paths?: string[];
  now?: number;
}): HermesSessionSummary {
  return summarizeHermesSession({
    session: input.session,
    projectRoot: input.projectRoot,
    cwd: input.cwd ?? input.projectRoot,
    activeProcess: input.active
      ? {
        pid: 1,
        cwd: input.cwd ?? input.projectRoot,
        hermesHome: input.session.home,
        command: "hermes",
        updatedAtMs: input.now ?? Date.now()
      }
      : null,
    paths: input.paths ?? [input.projectRoot],
    now: input.now ?? Date.now()
  });
}

export function summarizeHermesHookSessionForTest(input: {
  records: Array<Partial<HermesHookRecord> & { eventName: string; payload: Record<string, unknown>; }>;
  projectRoot: string;
  paths?: string[];
  now?: number;
}): HermesSessionSummary {
  const now = input.now ?? Date.now();
  return summarizeHermesHookSession({
    records: input.records.map((record, index) => ({
      sessionId: record.sessionId ?? "test-session",
      eventName: record.eventName,
      timestampMs: record.timestampMs ?? now + index,
      cwd: record.cwd ?? input.projectRoot,
      processCwd: record.processCwd ?? input.projectRoot,
      payload: record.payload,
      raw: record.raw ?? {}
    })),
    projectRoot: input.projectRoot,
    paths: input.paths ?? [input.projectRoot],
    now
  });
}

export function isHermesGatewayDaemonForTest(argv: string[]): boolean {
  return looksLikeHermesGatewayDaemon(argv);
}

export function isHermesRuntimeHomeProcessForTest(argv: string[], cwd: string | null): boolean {
  return looksLikeHermesRuntimeHomeProcess(argv, cwd);
}

export function isHermesCompressionContinuationForTest(input: {
  parentSessionId?: string | null;
  parentEndedAt?: number | null;
  parentEndReason?: string | null;
  startedAt?: number;
}): boolean {
  return isHermesCompressionContinuation({
    id: "test-session",
    source: "cli",
    model: null,
    parentSessionId: input.parentSessionId ?? null,
    parentEndedAt: input.parentEndedAt ?? null,
    parentEndReason: input.parentEndReason ?? null,
    startedAt: input.startedAt ?? 0,
    endedAt: null,
    endReason: null,
    messageCount: 0,
    toolCallCount: 0,
    title: null,
    systemPrompt: null,
    lastActive: input.startedAt ?? 0,
    home: "/tmp/hermes",
    storage: "sqlite",
    messages: []
  });
}

export async function currentHermesSessionProjectRootForTest(input: {
  session: HermesStoredSession;
  activeCwd?: string | null;
}): Promise<string | null> {
  return currentProjectRootForHermesSession(
    input.session,
    input.activeCwd
      ? {
        pid: 1,
        cwd: input.activeCwd,
        hermesHome: input.session.home,
        command: "hermes",
        updatedAtMs: Date.now()
      }
      : null
  );
}
