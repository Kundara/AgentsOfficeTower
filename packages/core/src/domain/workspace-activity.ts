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
const MAX_HOT_CHANGES_PER_FAMILY = 3;
const MAX_HOT_CHANGES = 9;
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

type HotFileDescriptor = Pick<HotChangeSummary, "fileType" | "fileFamily" | "fileFormat" | "formatColor">;

const LEGACY_SCRIPT_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss", "sass", "less", "html",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "cc", "cpp", "h",
  "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql",
  "graphql", "gql", "vue", "svelte", "astro", "lua", "pl", "r"
]);
const LEGACY_DOC_EXTENSIONS = new Set([
  "md", "mdx", "txt", "rst", "adoc", "tex", "pdf", "doc", "docx", "rtf", "csv",
  "tsv", "yml", "yaml", "toml", "ini"
]);
const LEGACY_MEDIA_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff",
  "mp3", "wav", "ogg", "flac", "mp4", "webm", "mov", "m4v", "avi", "aseprite",
  "psd", "ai", "sketch", "fig", "woff", "woff2", "ttf", "otf"
]);

const HOT_FILE_FORMATS: Record<string, Omit<HotFileDescriptor, "fileType">> = {
  js: { fileFamily: "code", fileFormat: "JS", formatColor: "#f7df1e" },
  jsx: { fileFamily: "code", fileFormat: "JSX", formatColor: "#61dafb" },
  ts: { fileFamily: "code", fileFormat: "TS", formatColor: "#3178c6" },
  tsx: { fileFamily: "code", fileFormat: "TSX", formatColor: "#3178c6" },
  mjs: { fileFamily: "code", fileFormat: "MJS", formatColor: "#f7df1e" },
  cjs: { fileFamily: "code", fileFormat: "CJS", formatColor: "#f7df1e" },
  cs: { fileFamily: "code", fileFormat: "C#", formatColor: "#512bd4" },
  py: { fileFamily: "code", fileFormat: "PY", formatColor: "#3776ab" },
  rb: { fileFamily: "code", fileFormat: "RB", formatColor: "#cc342d" },
  go: { fileFamily: "code", fileFormat: "GO", formatColor: "#00add8" },
  rs: { fileFamily: "code", fileFormat: "RS", formatColor: "#dea584" },
  java: { fileFamily: "code", fileFormat: "JAVA", formatColor: "#e76f00" },
  kt: { fileFamily: "code", fileFormat: "KT", formatColor: "#7f52ff" },
  kts: { fileFamily: "code", fileFormat: "KTS", formatColor: "#7f52ff" },
  swift: { fileFamily: "code", fileFormat: "SWIFT", formatColor: "#f05138" },
  c: { fileFamily: "code", fileFormat: "C", formatColor: "#5c6bc0" },
  cc: { fileFamily: "code", fileFormat: "C++", formatColor: "#00599c" },
  cpp: { fileFamily: "code", fileFormat: "C++", formatColor: "#00599c" },
  h: { fileFamily: "code", fileFormat: "H", formatColor: "#659ad2" },
  hpp: { fileFamily: "code", fileFormat: "H++", formatColor: "#659ad2" },
  php: { fileFamily: "code", fileFormat: "PHP", formatColor: "#777bb4" },
  sh: { fileFamily: "code", fileFormat: "SH", formatColor: "#4eaa25" },
  bash: { fileFamily: "code", fileFormat: "BASH", formatColor: "#4eaa25" },
  zsh: { fileFamily: "code", fileFormat: "ZSH", formatColor: "#4eaa25" },
  fish: { fileFamily: "code", fileFormat: "FISH", formatColor: "#4eaa25" },
  ps1: { fileFamily: "code", fileFormat: "PS1", formatColor: "#5391fe" },
  bat: { fileFamily: "code", fileFormat: "BAT", formatColor: "#4d4d4d" },
  cmd: { fileFamily: "code", fileFormat: "CMD", formatColor: "#4d4d4d" },
  lua: { fileFamily: "code", fileFormat: "LUA", formatColor: "#000080" },
  r: { fileFamily: "code", fileFormat: "R", formatColor: "#276dc3" },
  pl: { fileFamily: "code", fileFormat: "PL", formatColor: "#39457e" },
  sql: { fileFamily: "data", fileFormat: "SQL", formatColor: "#336791" },
  graphql: { fileFamily: "data", fileFormat: "GQL", formatColor: "#e10098" },
  gql: { fileFamily: "data", fileFormat: "GQL", formatColor: "#e10098" },
  html: { fileFamily: "markup", fileFormat: "HTML", formatColor: "#e34f26" },
  htm: { fileFamily: "markup", fileFormat: "HTML", formatColor: "#e34f26" },
  xml: { fileFamily: "markup", fileFormat: "XML", formatColor: "#f36f20" },
  uxml: { fileFamily: "markup", fileFormat: "UXML", formatColor: "#53a4ff" },
  vue: { fileFamily: "markup", fileFormat: "VUE", formatColor: "#42b883" },
  svelte: { fileFamily: "markup", fileFormat: "SVELTE", formatColor: "#ff3e00" },
  astro: { fileFamily: "markup", fileFormat: "ASTRO", formatColor: "#bc52ee" },
  css: { fileFamily: "style", fileFormat: "CSS", formatColor: "#1572b6" },
  scss: { fileFamily: "style", fileFormat: "SCSS", formatColor: "#cc6699" },
  sass: { fileFamily: "style", fileFormat: "SASS", formatColor: "#cc6699" },
  less: { fileFamily: "style", fileFormat: "LESS", formatColor: "#1d365d" },
  uss: { fileFamily: "style", fileFormat: "USS", formatColor: "#7a8bff" },
  json: { fileFamily: "data", fileFormat: "JSON", formatColor: "#f5c518" },
  jsonl: { fileFamily: "data", fileFormat: "JSONL", formatColor: "#f5c518" },
  csv: { fileFamily: "data", fileFormat: "CSV", formatColor: "#217346" },
  tsv: { fileFamily: "data", fileFormat: "TSV", formatColor: "#217346" },
  db: { fileFamily: "data", fileFormat: "DB", formatColor: "#003b57" },
  sqlite: { fileFamily: "data", fileFormat: "SQLITE", formatColor: "#003b57" },
  yml: { fileFamily: "config", fileFormat: "YAML", formatColor: "#cb171e" },
  yaml: { fileFamily: "config", fileFormat: "YAML", formatColor: "#cb171e" },
  toml: { fileFamily: "config", fileFormat: "TOML", formatColor: "#9c4121" },
  ini: { fileFamily: "config", fileFormat: "INI", formatColor: "#6b7280" },
  cfg: { fileFamily: "config", fileFormat: "CFG", formatColor: "#6b7280" },
  conf: { fileFamily: "config", fileFormat: "CONF", formatColor: "#6b7280" },
  env: { fileFamily: "config", fileFormat: "ENV", formatColor: "#ecd53f" },
  lock: { fileFamily: "config", fileFormat: "LOCK", formatColor: "#a6a6a6" },
  gitignore: { fileFamily: "config", fileFormat: "GIT", formatColor: "#f05032" },
  gitattributes: { fileFamily: "config", fileFormat: "GIT", formatColor: "#f05032" },
  editorconfig: { fileFamily: "config", fileFormat: "EDITOR", formatColor: "#e0efef" },
  npmrc: { fileFamily: "config", fileFormat: "NPM", formatColor: "#cb3837" },
  nvmrc: { fileFamily: "config", fileFormat: "NODE", formatColor: "#5fa04e" },
  md: { fileFamily: "docs", fileFormat: "MD", formatColor: "#519aba" },
  mdx: { fileFamily: "docs", fileFormat: "MDX", formatColor: "#fcb32c" },
  txt: { fileFamily: "docs", fileFormat: "TXT", formatColor: "#8a9ba8" },
  rst: { fileFamily: "docs", fileFormat: "RST", formatColor: "#4b8bbe" },
  adoc: { fileFamily: "docs", fileFormat: "ADOC", formatColor: "#e40046" },
  tex: { fileFamily: "docs", fileFormat: "TEX", formatColor: "#008080" },
  pdf: { fileFamily: "docs", fileFormat: "PDF", formatColor: "#f40f02" },
  doc: { fileFamily: "docs", fileFormat: "DOC", formatColor: "#2b579a" },
  docx: { fileFamily: "docs", fileFormat: "DOCX", formatColor: "#2b579a" },
  rtf: { fileFamily: "docs", fileFormat: "RTF", formatColor: "#2b579a" },
  xls: { fileFamily: "data", fileFormat: "XLS", formatColor: "#217346" },
  xlsx: { fileFamily: "data", fileFormat: "XLSX", formatColor: "#217346" },
  ppt: { fileFamily: "docs", fileFormat: "PPT", formatColor: "#d24726" },
  pptx: { fileFamily: "docs", fileFormat: "PPTX", formatColor: "#d24726" },
  png: { fileFamily: "image", fileFormat: "PNG", formatColor: "#4caf50" },
  jpg: { fileFamily: "image", fileFormat: "JPG", formatColor: "#d4a017" },
  jpeg: { fileFamily: "image", fileFormat: "JPEG", formatColor: "#d4a017" },
  gif: { fileFamily: "image", fileFormat: "GIF", formatColor: "#ff69b4" },
  webp: { fileFamily: "image", fileFormat: "WEBP", formatColor: "#00a5ff" },
  avif: { fileFamily: "image", fileFormat: "AVIF", formatColor: "#00a5ff" },
  svg: { fileFamily: "image", fileFormat: "SVG", formatColor: "#ffb13b" },
  ico: { fileFamily: "image", fileFormat: "ICO", formatColor: "#5c6bc0" },
  bmp: { fileFamily: "image", fileFormat: "BMP", formatColor: "#607d8b" },
  tif: { fileFamily: "image", fileFormat: "TIFF", formatColor: "#607d8b" },
  tiff: { fileFamily: "image", fileFormat: "TIFF", formatColor: "#607d8b" },
  aseprite: { fileFamily: "image", fileFormat: "ASE", formatColor: "#7d929e" },
  psd: { fileFamily: "image", fileFormat: "PSD", formatColor: "#31a8ff" },
  ai: { fileFamily: "image", fileFormat: "AI", formatColor: "#ff9a00" },
  sketch: { fileFamily: "image", fileFormat: "SKETCH", formatColor: "#f7b500" },
  fig: { fileFamily: "image", fileFormat: "FIG", formatColor: "#f24e1e" },
  mp3: { fileFamily: "audio", fileFormat: "MP3", formatColor: "#1db954" },
  wav: { fileFamily: "audio", fileFormat: "WAV", formatColor: "#8e44ad" },
  ogg: { fileFamily: "audio", fileFormat: "OGG", formatColor: "#f06292" },
  flac: { fileFamily: "audio", fileFormat: "FLAC", formatColor: "#7e57c2" },
  mp4: { fileFamily: "video", fileFormat: "MP4", formatColor: "#e91e63" },
  webm: { fileFamily: "video", fileFormat: "WEBM", formatColor: "#00897b" },
  mov: { fileFamily: "video", fileFormat: "MOV", formatColor: "#999999" },
  m4v: { fileFamily: "video", fileFormat: "M4V", formatColor: "#999999" },
  avi: { fileFamily: "video", fileFormat: "AVI", formatColor: "#3f51b5" },
  woff: { fileFamily: "font", fileFormat: "WOFF", formatColor: "#f4a261" },
  woff2: { fileFamily: "font", fileFormat: "WOFF2", formatColor: "#f4a261" },
  ttf: { fileFamily: "font", fileFormat: "TTF", formatColor: "#f4a261" },
  otf: { fileFamily: "font", fileFormat: "OTF", formatColor: "#f4a261" },
  zip: { fileFamily: "archive", fileFormat: "ZIP", formatColor: "#f4c430" },
  "7z": { fileFamily: "archive", fileFormat: "7Z", formatColor: "#5a5aff" },
  tar: { fileFamily: "archive", fileFormat: "TAR", formatColor: "#d4a017" },
  gz: { fileFamily: "archive", fileFormat: "GZ", formatColor: "#d4a017" },
  rar: { fileFamily: "archive", fileFormat: "RAR", formatColor: "#7e57c2" },
  unity: { fileFamily: "project", fileFormat: "SCENE", formatColor: "#53a4ff" },
  prefab: { fileFamily: "project", fileFormat: "PREFAB", formatColor: "#53a4ff" },
  asset: { fileFamily: "project", fileFormat: "ASSET", formatColor: "#53a4ff" },
  spriteatlas: { fileFamily: "project", fileFormat: "ATLAS", formatColor: "#53a4ff" },
  spriteatlasv2: { fileFamily: "project", fileFormat: "ATLAS", formatColor: "#53a4ff" },
  anim: { fileFamily: "project", fileFormat: "ANIM", formatColor: "#c586c0" },
  controller: { fileFamily: "project", fileFormat: "ANIM", formatColor: "#c586c0" },
  overridecontroller: { fileFamily: "project", fileFormat: "ANIM", formatColor: "#c586c0" },
  mat: { fileFamily: "project", fileFormat: "MAT", formatColor: "#53a4ff" },
  rendertexture: { fileFamily: "project", fileFormat: "RTEX", formatColor: "#53a4ff" },
  terrainlayer: { fileFamily: "project", fileFormat: "TERRAIN", formatColor: "#53a4ff" },
  lighting: { fileFamily: "project", fileFormat: "LIGHT", formatColor: "#53a4ff" },
  inputactions: { fileFamily: "project", fileFormat: "INPUT", formatColor: "#53a4ff" },
  playable: { fileFamily: "project", fileFormat: "TIMELINE", formatColor: "#53a4ff" },
  guiskin: { fileFamily: "project", fileFormat: "GUISKIN", formatColor: "#53a4ff" },
  shadergraph: { fileFamily: "project", fileFormat: "SHADER", formatColor: "#5b3fd6" },
  shadersubgraph: { fileFamily: "project", fileFormat: "SHADER", formatColor: "#5b3fd6" },
  vfx: { fileFamily: "project", fileFormat: "VFX", formatColor: "#5b3fd6" },
  meta: { fileFamily: "project", fileFormat: "META", formatColor: "#9aa5b1" },
  asmdef: { fileFamily: "project", fileFormat: "ASM", formatColor: "#512bd4" },
  shader: { fileFamily: "project", fileFormat: "SHADER", formatColor: "#5b3fd6" },
  compute: { fileFamily: "project", fileFormat: "GPU", formatColor: "#5b3fd6" },
  csproj: { fileFamily: "project", fileFormat: "CSPROJ", formatColor: "#512bd4" },
  sln: { fileFamily: "project", fileFormat: "SLN", formatColor: "#5c2d91" },
  dll: { fileFamily: "binary", fileFormat: "DLL", formatColor: "#6b7280" },
  exe: { fileFamily: "binary", fileFormat: "EXE", formatColor: "#0078d4" },
  bin: { fileFamily: "binary", fileFormat: "BIN", formatColor: "#6b7280" }
};

export interface HotFileFormatCatalogEntry extends Omit<HotFileDescriptor, "fileType"> {
  extension: string;
}

export function listHotFileFormats(): HotFileFormatCatalogEntry[] {
  return Object.entries(HOT_FILE_FORMATS).map(([extension, descriptor]) => ({
    extension,
    ...descriptor
  }));
}

function legacyFileTypeForFamily(fileFamily: HotChangeSummary["fileFamily"]): HotChangeSummary["fileType"] {
  if (["code", "markup", "style", "data", "config", "project"].includes(fileFamily)) {
    return "script";
  }
  if (fileFamily === "docs") {
    return "doc";
  }
  return "media";
}

function legacyFileTypeForExtension(
  extension: string,
  fileFamily: HotChangeSummary["fileFamily"]
): HotChangeSummary["fileType"] {
  if (LEGACY_SCRIPT_EXTENSIONS.has(extension)) return "script";
  if (LEGACY_DOC_EXTENSIONS.has(extension)) return "doc";
  if (LEGACY_MEDIA_EXTENSIONS.has(extension)) return "media";
  return legacyFileTypeForFamily(fileFamily);
}

export function describeHotFile(path: string): HotFileDescriptor {
  const label = pathLabel(path);
  const extension = extensionForPath(path);
  const known = HOT_FILE_FORMATS[extension];
  if (known) {
    return { ...known, fileType: legacyFileTypeForExtension(extension, known.fileFamily) };
  }

  const normalizedName = label.toLowerCase();
  const special =
    normalizedName === "dockerfile" ? { fileFamily: "config" as const, fileFormat: "DOCKER", formatColor: "#2496ed" }
    : normalizedName === "makefile" ? { fileFamily: "config" as const, fileFormat: "MAKE", formatColor: "#6d8086" }
    : normalizedName === "license" ? { fileFamily: "docs" as const, fileFormat: "LICENSE", formatColor: "#d4a017" }
    : normalizedName === "readme" ? { fileFamily: "docs" as const, fileFormat: "README", formatColor: "#519aba" }
    : null;
  if (special) {
    return { ...special, fileType: legacyFileTypeForFamily(special.fileFamily) };
  }

  const fallbackFormat = (extension || "FILE").slice(0, 8).toUpperCase();
  return { fileType: "media", fileFamily: "other", fileFormat: fallbackFormat, formatColor: "#8a9ba8" };
}

function eventChangeKind(action: string | null | undefined): HotChangeSummary["changeKind"] {
  const normalized = String(action || "").toLowerCase();
  if (normalized === "created" || normalized === "added") return "added";
  if (normalized === "deleted" || normalized === "removed") return "deleted";
  if (normalized === "moved" || normalized === "renamed") return "renamed";
  return "modified";
}

function normalizedHotFilePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").toLowerCase();
  const windowsDrive = normalized.match(/^([a-z]):\/(.*)$/);
  return windowsDrive ? `/mnt/${windowsDrive[1]}/${windowsDrive[2]}` : normalized;
}

function hotFilePathsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizedHotFilePath(left);
  const normalizedRight = normalizedHotFilePath(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const leftAbsolute = normalizedLeft.startsWith("/");
  const rightAbsolute = normalizedRight.startsWith("/");
  if (leftAbsolute === rightAbsolute) {
    return false;
  }
  const absolutePath = leftAbsolute ? normalizedLeft : normalizedRight;
  const relativePath = leftAbsolute ? normalizedRight : normalizedLeft;
  return absolutePath.endsWith(`/${relativePath}`);
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
  changedPaths?: Array<string | { path: string; action?: string }>;
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
    changeKinds: Set<HotChangeSummary["changeKind"]>;
    provenance: AgentProvenanceSource;
    confidence: AgentConfidence;
  };

  const changes = new Map<string, HotChangeAccumulator>();

  for (const event of input.events) {
    if (event.kind !== "fileChange" || !event.path) {
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
      changeKinds: new Set<HotChangeSummary["changeKind"]>(),
      provenance: event.source,
      confidence: event.confidence
    };

    next.score += score;
    next.changeCount += 1;
    next.lastChangedAtMs = Math.max(next.lastChangedAtMs, createdAtMs);
    next.linesAdded += Number.isFinite(event.linesAdded) ? Math.max(0, Number(event.linesAdded)) : 0;
    next.linesRemoved += Number.isFinite(event.linesRemoved) ? Math.max(0, Number(event.linesRemoved)) : 0;
    next.changeKinds.add(eventChangeKind(event.action));
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
      const file = describeHotFile(entry.path);
      const changeKinds = [...entry.changeKinds];
      return {
        path: entry.path,
        label: pathLabel(entry.path),
        ...file,
        changeKind: changeKinds.length === 1 ? changeKinds[0] : "mixed",
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
      const countForFamily = selected.filter((candidate) => candidate.fileFamily === entry.fileFamily).length;
      if (selected.length < MAX_HOT_CHANGES && countForFamily < MAX_HOT_CHANGES_PER_FAMILY) {
        selected.push(entry);
      }
      return selected;
    }, [] as HotChangeSummary[]);

  if (hotChanges.length >= MAX_HOT_CHANGES || !Array.isArray(input.changedPaths) || input.changedPaths.length === 0) {
    return hotChanges;
  }

  const selected = [...hotChanges];
  const branch = cleanLabel(input.projectBranch);
  const candidates = input.changedPaths
    .map((rawEntry) => typeof rawEntry === "string" ? { path: rawEntry, action: "edited" } : rawEntry)
    .filter((entry, index, entries) => entry.path
      && !selected.some((candidate) => hotFilePathsMatch(candidate.path, entry.path))
      && entries.findIndex((candidate) => hotFilePathsMatch(candidate.path, entry.path)) === index)
    .map((entry) => ({ ...entry, file: describeHotFile(entry.path) }));
  let fallbackCount = 0;
  const addFallback = (entry: (typeof candidates)[number]): boolean => {
    if (selected.length >= MAX_HOT_CHANGES || fallbackCount >= 3) {
      return false;
    }
    const countForFamily = selected.filter((candidate) => candidate.fileFamily === entry.file.fileFamily).length;
    if (countForFamily >= MAX_HOT_CHANGES_PER_FAMILY) {
      return false;
    }
    selected.push({
      ...entry.file,
      changeKind: eventChangeKind(entry.action),
      path: entry.path,
      label: pathLabel(entry.path),
      branch,
      branches: branch ? [branch] : [],
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
    });
    fallbackCount += 1;
    return true;
  };

  const representedFamilies = new Set(selected.map((entry) => entry.fileFamily));
  for (const entry of candidates) {
    if (!representedFamilies.has(entry.file.fileFamily) && addFallback(entry)) {
      representedFamilies.add(entry.file.fileFamily);
    }
  }
  for (const entry of candidates) {
    if (selected.some((candidate) => hotFilePathsMatch(candidate.path, entry.path))) {
      continue;
    }
    addFallback(entry);
  }

  return selected;
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
  changedPaths?: Array<string | { path: string; action?: string }>;
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
