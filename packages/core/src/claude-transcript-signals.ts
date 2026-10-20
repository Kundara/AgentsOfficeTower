// Claude Code transcript record semantics shared by the Claude adapter.
// Kept out of claude.ts so record-shape drift can be fixed in one small place.

export function isMeaningfulTranscriptText(text: string | null | undefined): text is string {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return !/^[.\-_~`"'!,;:|/\\()[\]{}]+$/.test(normalized);
}

// Harness-injected user text: slash-command echoes, background task
// notifications, system reminders, peer/channel envelopes, and interrupt markers.
export function isSyntheticClaudeUserText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/i.test(normalized)
    || /^<local-command-caveat>/i.test(normalized)
    || /^<command-name>[\s\S]*<\/command-name>/i.test(normalized)
    || /^<command-message>[\s\S]*<\/command-message>/i.test(normalized)
    || /^<command-args>[\s\S]*<\/command-args>/i.test(normalized)
    || /^<task-notification>/i.test(normalized)
    || /^<system-reminder>/i.test(normalized)
    || /^\[Request interrupted by user[^\]]*\]$/i.test(normalized)
  );
}

function originKind(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value) {
    const kind = (value as Record<string, unknown>).kind;
    return typeof kind === "string" ? kind : null;
  }
  return null;
}

// Current Claude Code marks injected user records with `isMeta` and tags the
// author with `origin` (`human`, `task-notification`, `peer`, ...). Records
// written before `origin` existed are treated as human.
export function isClaudeHumanUserRecord(record: Record<string, unknown>): boolean {
  if (record.type !== "user" || record.isMeta === true) {
    return false;
  }
  const origin = originKind(record.origin) ?? originKind(record.turnOrigin);
  return origin === null || origin === "human";
}

export function normalizeClaudeSessionTitle(title: string | null): string | null {
  if (!title) {
    return null;
  }
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized || !isMeaningfulTranscriptText(normalized) || isSyntheticClaudeUserText(normalized)) {
    return null;
  }
  return normalized;
}

function recordString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

const TITLE_RECORD_KEYS: Record<string, string[]> = {
  // A user rename wins over generated names.
  "custom-title": ["customTitle", "custom_title", "title"],
  "agent-name": ["agentName", "agent_name", "name"],
  "ai-title": ["aiTitle", "ai_title", "title", "name"],
  "session-title": ["title", "name", "summary"],
  session_title: ["title", "name", "summary"]
};

const TITLE_RECORD_PRIORITY = ["custom-title", "agent-name", "ai-title", "session-title", "session_title"];

export function extractClaudeSessionTitle(records: Array<Record<string, unknown>>): string | null {
  const latestByType = new Map<string, string>();
  for (const record of [...records].reverse()) {
    const type = typeof record.type === "string" ? record.type : "";
    const keys = TITLE_RECORD_KEYS[type];
    if (!keys || latestByType.has(type)) {
      continue;
    }
    const title = normalizeClaudeSessionTitle(recordString(record, ...keys));
    if (title) {
      latestByType.set(type, title);
    }
  }
  for (const type of TITLE_RECORD_PRIORITY) {
    const title = latestByType.get(type);
    if (title) {
      return title;
    }
  }
  return null;
}
