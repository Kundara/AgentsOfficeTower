import type {
  AgentConfidence,
  AgentProvenanceSource,
  DashboardAgent,
  DashboardEvent,
  CommandProgressSummary,
  HotChangeSummary,
  HotToolSummary,
  RunningCommandSummary,
  WorkspaceActivitySnapshot
} from "../types";

const HOT_CHANGE_WINDOW_MS = 20 * 60 * 1000;
const HOT_CHANGE_HALF_LIFE_MS = 3 * 60 * 1000;
const HOT_CHANGE_MIN_SCORE = 1.2;
const HOT_CHANGE_LINE_SCORE_FACTOR = 1.25;
const HOT_CHANGE_MAX_LINE_SCORE = 10;
const HOT_CHANGE_HEAT_PER_SCORE = 2;
const HOT_CHANGE_FALLBACK_SCORE = 2.5;
const HOT_CHANGE_FALLBACK_HEAT = 6;
const MAX_HOT_CHANGES_PER_TYPE = 3;
const HOT_TOOL_WINDOW_MS = 20 * 60 * 1000;
const MAX_HOT_TOOLS = 5;
const COMMAND_QUIET_AFTER_MS = 15 * 1000;
const RUNNING_COMMAND_WINDOW_MS = 5 * 60 * 1000;

function parseTimeMs(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function ageMs(createdAtMs: number, now: number): number {
  if (!Number.isFinite(createdAtMs)) {
    return Number.NaN;
  }
  return Math.max(0, now - createdAtMs);
}

function pathLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function extensionForPath(path: string): string {
  const label = pathLabel(path).toLowerCase();
  const match = label.match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

function hotFileType(path: string): HotChangeSummary["fileType"] | null {
  const extension = extensionForPath(path);
  if (!extension) {
    return null;
  }
  if ([
    "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "sass", "less", "html",
    "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "cc", "cpp", "h",
    "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql",
    "graphql", "gql", "vue", "svelte", "astro", "lua", "pl", "r"
  ].includes(extension)) {
    return "script";
  }
  if ([
    "md", "mdx", "txt", "rst", "adoc", "tex", "pdf", "doc", "docx", "rtf", "csv",
    "tsv", "yml", "yaml", "toml", "ini"
  ].includes(extension)) {
    return "doc";
  }
  if ([
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff",
    "mp3", "wav", "ogg", "flac", "mp4", "webm", "mov", "m4v", "avi", "aseprite",
    "psd", "ai", "sketch", "fig", "woff", "woff2", "ttf", "otf"
  ].includes(extension)) {
    return "media";
  }
  return null;
}

function combineConfidence(left: AgentConfidence, right: AgentConfidence): AgentConfidence {
  return left === "typed" || right === "typed" ? "typed" : "inferred";
}

function cleanLabel(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function addUnique(set: Set<string>, value: string | null | undefined): void {
  const normalized = cleanLabel(value);
  if (normalized) {
    set.add(normalized);
  }
}

function lineDelta(event: DashboardEvent): number {
  const added = Number.isFinite(event.linesAdded) ? Math.max(0, Number(event.linesAdded)) : 0;
  const removed = Number.isFinite(event.linesRemoved) ? Math.max(0, Number(event.linesRemoved)) : 0;
  return added + removed;
}

function fileChangeWeight(event: DashboardEvent): number {
  const base =
    event.action === "created" || event.action === "deleted" ? 7
    : event.action === "moved" ? 6
    : event.phase === "completed" ? 6
    : event.phase === "started" ? 4
    : 3;
  const changedLines = lineDelta(event);
  return base + Math.min(HOT_CHANGE_MAX_LINE_SCORE, Math.log2(changedLines + 1) * HOT_CHANGE_LINE_SCORE_FACTOR);
}

function buildHotChanges(input: {
  events: DashboardEvent[];
  agentByThreadId: Map<string, DashboardAgent>;
  now: number;
  changedPaths?: string[];
  projectBranch?: string | null;
}): HotChangeSummary[] {
  type HotChangeAccumulator = {
    path: string;
    score: number;
    changeCount: number;
    lastChangedAtMs: number;
    linesAdded: number;
    linesRemoved: number;
    agents: Set<string>;
    branches: Set<string>;
    users: Set<string>;
    provenance: AgentProvenanceSource;
    confidence: AgentConfidence;
  };

  const changes = new Map<string, HotChangeAccumulator>();

  for (const event of input.events) {
    if (event.kind !== "fileChange" || !event.path) {
      continue;
    }
    const fileType = hotFileType(event.path);
    if (!fileType) {
      continue;
    }

    const createdAtMs = parseTimeMs(event.createdAt);
    const eventAgeMs = ageMs(createdAtMs, input.now);
    if (!Number.isFinite(eventAgeMs) || eventAgeMs > HOT_CHANGE_WINDOW_MS) {
      continue;
    }

    const decay = Math.pow(0.5, eventAgeMs / HOT_CHANGE_HALF_LIFE_MS);
    const score = fileChangeWeight(event) * decay;
    const existing = changes.get(event.path);
    const next = existing ?? {
      path: event.path,
      score: 0,
      changeCount: 0,
      lastChangedAtMs: createdAtMs,
      linesAdded: 0,
      linesRemoved: 0,
      agents: new Set<string>(),
      branches: new Set<string>(),
      users: new Set<string>(),
      provenance: event.source,
      confidence: event.confidence
    };

    next.score += score;
    next.changeCount += 1;
    next.lastChangedAtMs = Math.max(next.lastChangedAtMs, createdAtMs);
    next.linesAdded += Number.isFinite(event.linesAdded) ? Math.max(0, Number(event.linesAdded)) : 0;
    next.linesRemoved += Number.isFinite(event.linesRemoved) ? Math.max(0, Number(event.linesRemoved)) : 0;
    next.confidence = combineConfidence(next.confidence, event.confidence);

    const agent = event.threadId ? input.agentByThreadId.get(event.threadId) ?? null : null;
    addUnique(next.agents, agent?.label);
    addUnique(next.branches, agent?.git?.branch ?? input.projectBranch);
    if (agent?.network?.peerLabel) {
      addUnique(next.users, agent.network.peerLabel);
    }

    changes.set(event.path, next);
  }

  const hotChanges = [...changes.values()]
    .map((entry) => {
      const repeatedMultiplier = 1 + Math.min(0.8, Math.max(0, entry.changeCount - 1) * 0.12);
      const score = entry.score * repeatedMultiplier;
      const branches = [...entry.branches].slice(0, 4);
      return {
        path: entry.path,
        label: pathLabel(entry.path),
        fileType: hotFileType(entry.path) ?? "script",
        branch: branches[0] ?? null,
        branches,
        users: [...entry.users].slice(0, 4),
        heat: Math.min(100, Math.max(1, Math.round(score * HOT_CHANGE_HEAT_PER_SCORE))),
        score: Math.round(score * 10) / 10,
        changeCount: entry.changeCount,
        lastChangedAt: new Date(entry.lastChangedAtMs).toISOString(),
        linesAdded: entry.linesAdded,
        linesRemoved: entry.linesRemoved,
        agents: [...entry.agents].slice(0, 4),
        provenance: entry.provenance,
        confidence: entry.confidence
      } satisfies HotChangeSummary;
    })
    .filter((entry) => entry.score >= HOT_CHANGE_MIN_SCORE)
    .sort((left, right) =>
      right.score - left.score
      || right.lastChangedAt.localeCompare(left.lastChangedAt)
      || left.path.localeCompare(right.path)
    )
    .reduce((selected, entry) => {
      const countForType = selected.filter((candidate) => candidate.fileType === entry.fileType).length;
      if (countForType < MAX_HOT_CHANGES_PER_TYPE) {
        selected.push(entry);
      }
      return selected;
    }, [] as HotChangeSummary[]);

  if (hotChanges.length >= 3 || !Array.isArray(input.changedPaths) || input.changedPaths.length === 0) {
    return hotChanges;
  }

  const existingPaths = new Set(hotChanges.map((entry) => entry.path));
  const fallbackChanges = input.changedPaths
    .filter((path) => path && !existingPaths.has(path) && hotFileType(path))
    .slice(0, 3 - hotChanges.length)
    .map((path): HotChangeSummary => ({
      path,
      label: pathLabel(path),
      fileType: hotFileType(path) ?? "script",
      branch: cleanLabel(input.projectBranch),
      branches: cleanLabel(input.projectBranch) ? [cleanLabel(input.projectBranch) as string] : [],
      users: [],
      heat: HOT_CHANGE_FALLBACK_HEAT,
      score: HOT_CHANGE_FALLBACK_SCORE,
      changeCount: 1,
      lastChangedAt: new Date(input.now).toISOString(),
      linesAdded: 0,
      linesRemoved: 0,
      agents: [],
      provenance: "codex",
      confidence: "inferred"
    }));

  return [...hotChanges, ...fallbackChanges];
}

function agentLabelForEvent(event: DashboardEvent, agentByThreadId: Map<string, DashboardAgent>): string | null {
  return event.threadId ? cleanLabel(agentByThreadId.get(event.threadId)?.label) : null;
}

function buildHotTools(input: {
  events: DashboardEvent[];
  agentByThreadId: Map<string, DashboardAgent>;
  now: number;
}): HotToolSummary[] {
  type ToolAccumulator = {
    label: string;
    itemType: string | null;
    uses: Set<string>;
    lastUsedAtMs: number;
    agents: Set<string>;
    provenance: AgentProvenanceSource;
    confidence: AgentConfidence;
  };

  const tools = new Map<string, ToolAccumulator>();
  for (const event of input.events) {
    if (event.kind !== "tool") {
      continue;
    }
    const createdAtMs = parseTimeMs(event.createdAt);
    const eventAgeMs = ageMs(createdAtMs, input.now);
    if (!Number.isFinite(eventAgeMs) || eventAgeMs > HOT_TOOL_WINDOW_MS) {
      continue;
    }
    const label = cleanLabel(event.detail) ?? cleanLabel(event.title);
    if (!label) {
      continue;
    }
    const key = `${event.itemType ?? "tool"}\u0000${label}`;
    const accumulator = tools.get(key) ?? {
      label,
      itemType: event.itemType ?? null,
      uses: new Set<string>(),
      lastUsedAtMs: createdAtMs,
      agents: new Set<string>(),
      provenance: event.source,
      confidence: event.confidence
    };
    accumulator.uses.add(event.itemId ?? event.id);
    accumulator.lastUsedAtMs = Math.max(accumulator.lastUsedAtMs, createdAtMs);
    accumulator.confidence = combineConfidence(accumulator.confidence, event.confidence);
    addUnique(accumulator.agents, agentLabelForEvent(event, input.agentByThreadId));
    tools.set(key, accumulator);
  }

  return [...tools.values()]
    .map((entry): HotToolSummary => {
      const ageMinutes = ageMs(entry.lastUsedAtMs, input.now) / 60_000;
      const score = entry.uses.size * 4 + Math.max(0, 6 - ageMinutes);
      return {
        label: entry.label,
        heat: Math.min(100, Math.max(1, Math.round(score * 2))),
        score: Math.round(score * 10) / 10,
        useCount: entry.uses.size,
        lastUsedAt: new Date(entry.lastUsedAtMs).toISOString(),
        itemType: entry.itemType,
        agents: [...entry.agents].slice(0, 4),
        provenance: entry.provenance,
        confidence: entry.confidence
      };
    })
    .sort((left, right) => right.score - left.score || right.lastUsedAt.localeCompare(left.lastUsedAt))
    .slice(0, MAX_HOT_TOOLS);
}

function commandProgress(detail: string | null): CommandProgressSummary | null {
  if (!detail) {
    return null;
  }
  const percentMatch = detail.match(/(?:^|\s)(100|\d{1,2}(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const percent = Math.max(0, Math.min(100, Number(percentMatch[1])));
    return { percent, label: `${percent}%`, confidence: "high", source: "explicit-percent" };
  }
  const countMatch = detail.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/);
  if (!countMatch) {
    return null;
  }
  const completed = Number(countMatch[1]);
  const total = Number(countMatch[2]);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || completed > total) {
    return null;
  }
  return {
    percent: Math.round((completed / total) * 100),
    label: `${completed}/${total}`,
    confidence: "high",
    source: "count"
  };
}

function buildRunningCommands(input: {
  events: DashboardEvent[];
  agentByThreadId: Map<string, DashboardAgent>;
  now: number;
}): RunningCommandSummary[] {
  type CommandAccumulator = {
    id: string;
    command: string;
    cwd: string | null;
    threadId: string | null;
    agentLabel: string | null;
    startedAtMs: number;
    updatedAtMs: number;
    completedAtMs: number | null;
    lastOutput: string | null;
    progress: CommandProgressSummary | null;
    provenance: AgentProvenanceSource;
    confidence: AgentConfidence;
  };

  const commands = new Map<string, CommandAccumulator>();
  const orderedEvents = [...input.events].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const event of orderedEvents) {
    if (event.kind !== "command") {
      continue;
    }
    const eventAtMs = parseTimeMs(event.createdAt);
    if (!Number.isFinite(eventAtMs)) {
      continue;
    }
    const id = event.itemId ?? event.id;
    const existing = commands.get(id);
    if (!existing) {
      const command = cleanLabel(event.command) ?? cleanLabel(event.detail);
      if (!command) {
        continue;
      }
      commands.set(id, {
        id,
        command,
        cwd: cleanLabel(event.cwd) ?? cleanLabel(event.path),
        threadId: event.threadId,
        agentLabel: agentLabelForEvent(event, input.agentByThreadId),
        startedAtMs: eventAtMs,
        updatedAtMs: eventAtMs,
        completedAtMs: event.phase === "completed" || event.phase === "failed" || event.phase === "interrupted" ? eventAtMs : null,
        lastOutput: null,
        progress: commandProgress(event.detail),
        provenance: event.source,
        confidence: event.confidence
      });
      continue;
    }
    existing.updatedAtMs = Math.max(existing.updatedAtMs, eventAtMs);
    existing.confidence = combineConfidence(existing.confidence, event.confidence);
    if (event.phase === "completed" || event.phase === "failed" || event.phase === "interrupted") {
      existing.completedAtMs = eventAtMs;
    }
    if (event.method.includes("output") || event.phase === "updated") {
      existing.lastOutput = cleanLabel(event.detail) ?? existing.lastOutput;
      existing.progress = commandProgress(event.detail) ?? existing.progress;
    }
  }

  return [...commands.values()]
    .filter((entry) => entry.completedAtMs === null && input.now - entry.updatedAtMs <= RUNNING_COMMAND_WINDOW_MS)
    .map((entry): RunningCommandSummary => {
      const quietForMs = Math.max(0, input.now - entry.updatedAtMs);
      return {
        id: entry.id,
        command: entry.command,
        cwd: entry.cwd,
        threadId: entry.threadId,
        agentLabel: entry.agentLabel,
        status: quietForMs >= COMMAND_QUIET_AFTER_MS ? "quiet" : "running",
        startedAt: new Date(entry.startedAtMs).toISOString(),
        updatedAt: new Date(entry.updatedAtMs).toISOString(),
        completedAt: null,
        durationMs: Math.max(0, input.now - entry.startedAtMs),
        quietForMs,
        lastOutput: entry.lastOutput,
        progress: entry.progress,
        provenance: entry.provenance,
        confidence: entry.confidence
      };
    })
    .sort((left, right) => right.durationMs - left.durationMs);
}

export function buildWorkspaceActivitySnapshot(input: {
  events: DashboardEvent[];
  agents: DashboardAgent[];
  generatedAt?: string;
  now?: number;
  changedPaths?: string[];
  projectBranch?: string | null;
}): WorkspaceActivitySnapshot {
  const now = input.now ?? Date.now();
  const agentByThreadId = new Map<string, DashboardAgent>();
  for (const agent of input.agents) {
    if (agent.threadId) {
      agentByThreadId.set(agent.threadId, agent);
    }
  }

  return {
    generatedAt: input.generatedAt ?? new Date(now).toISOString(),
    hotChanges: buildHotChanges({
      events: input.events,
      agentByThreadId,
      now,
      changedPaths: input.changedPaths,
      projectBranch: input.projectBranch
    }),
    hotTools: buildHotTools({ events: input.events, agentByThreadId, now }),
    runningCommands: buildRunningCommands({ events: input.events, agentByThreadId, now })
  };
}

export function emptyWorkspaceActivitySnapshot(generatedAt = new Date().toISOString()): WorkspaceActivitySnapshot {
  return {
    generatedAt,
    hotChanges: [],
    hotTools: [],
    runningCommands: []
  };
}
