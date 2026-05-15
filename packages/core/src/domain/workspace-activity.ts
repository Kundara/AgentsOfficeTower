import type {
  AgentConfidence,
  AgentProvenanceSource,
  DashboardAgent,
  DashboardEvent,
  HotChangeSummary,
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
    hotTools: [],
    runningCommands: []
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
