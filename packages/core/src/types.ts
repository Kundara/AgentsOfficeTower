export type ActivityState =
  | "planning"
  | "scanning"
  | "thinking"
  | "editing"
  | "running"
  | "validating"
  | "delegating"
  | "waiting"
  | "blocked"
  | "done"
  | "idle"
  | "cloud";

export interface RoomDefinition {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: RoomDefinition[];
}

export interface RoomConfig {
  version: number;
  generated: boolean;
  filePath: string;
  rooms: RoomDefinition[];
}

export interface AppearanceProfile {
  id: string;
  label: string;
  body: string;
  accent: string;
  shadow: string;
}

export interface AsepriteHeader {
  fileSize: number;
  frames: number;
  width: number;
  height: number;
  colorDepth: number;
  flags: number;
  speed: number;
}

export interface AgentAppearanceEntry {
  appearanceId: string;
  updatedAt: string;
}

export interface AgentRoster {
  version: number;
  agents: Record<string, AgentAppearanceEntry>;
}

export interface PresenceEntry {
  id: string;
  label: string;
  role: string | null;
  state: ActivityState;
  detail: string;
  cwd: string | null;
  updatedAt: string;
  appearanceId?: string | null;
}

export interface PresenceRoster {
  version: number;
  agents: PresenceEntry[];
}

export interface GitInfo {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

export interface ProjectIdentity {
  key: string | null;
  source: "git" | "unknown";
  gitRoot: string | null;
  commonGitDir: string | null;
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  worktreeName: string | null;
}

export interface ThreadItem {
  type: string;
  [key: string]: unknown;
}

export type AgentActivityEventType =
  | "userMessage"
  | "agentMessage"
  | "plan"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "collabToolCall"
  | "collabAgentToolCall"
  | "webSearch"
  | "imageView"
  | "enteredReviewMode"
  | "exitedReviewMode"
  | "contextCompaction"
  | "other";

export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags?: string[] };

export interface CodexTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: { message?: string } | null;
  items: ThreadItem[];
}

export interface CodexThread {
  id: string;
  extra?: Record<string, unknown> | null;
  sessionId?: string;
  forkedFromId?: string | null;
  parentThreadId?: string | null;
  preview: string;
  ephemeral: boolean;
  historyMode?: string;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
  status: ThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: string | Record<string, unknown>;
  threadSource?: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: GitInfo | null;
  name: string | null;
  turns: CodexTurn[];
}

export interface CloudTask {
  id: string;
  url: string;
  title: string;
  status: string;
  updatedAt: string;
  environmentId: string | null;
  environmentLabel: string | null;
  summary: {
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
  };
  isReview: boolean;
  attemptTotal: number;
}

export interface AgentActivityEvent {
  type: AgentActivityEventType;
  action: "created" | "edited" | "deleted" | "moved" | "ran" | "said" | "updated";
  path: string | null;
  title: string;
  isImage: boolean;
  linesAdded?: number;
  linesRemoved?: number;
}

export type AgentProvenanceSource = "codex" | "claude" | "cloud" | "cursor" | "presence" | "openclaw" | "hermes";
export type AgentConfidence = "typed" | "inferred";

export type AgentGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete"
  | "unknown";

export type AgentGoalKind =
  | "codex"
  | "claudeSession"
  | "claudeCowork"
  | "claudeBackground"
  | "claudeSubagent";

export interface AgentGoalState {
  kind: AgentGoalKind;
  objective: string;
  status: AgentGoalStatus;
  confidence: AgentConfidence;
  createdAt: string | null;
  updatedAt: string | null;
  tokenBudget?: number | null;
  tokensUsed?: number | null;
  timeUsedSeconds?: number | null;
}

export interface NeedsUserQuestionOption {
  label: string;
  description: string;
}

export interface NeedsUserQuestion {
  header: string;
  id: string;
  question: string;
  required?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
  options?: NeedsUserQuestionOption[] | null;
}

// Stores live approval/input waits from app-server.
// Stores live approval/input waits from the app-server observer.
export interface NeedsUserState {
  kind: "approval" | "input";
  requestId: string;
  turnId?: string;
  itemId?: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  availableDecisions?: string[];
  questions?: NeedsUserQuestion[];
  networkApprovalContext?: Record<string, unknown> | null;
}

export interface DashboardEvent {
  id: string;
  source: AgentProvenanceSource;
  confidence: AgentConfidence;
  threadId: string | null;
  createdAt: string;
  method: string;
  turnId?: string;
  itemId?: string;
  itemType?: string;
  requestId?: string;
  kind: "turn" | "item" | "approval" | "input" | "command" | "fileChange" | "subagent" | "status" | "message" | "tool" | "other";
  phase: "started" | "completed" | "interrupted" | "failed" | "waiting" | "updated";
  title: string;
  detail: string;
  path: string | null;
  action?: "created" | "edited" | "deleted" | "moved" | "ran" | "said" | "updated";
  isImage?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  availableDecisions?: string[];
  networkApprovalContext?: Record<string, unknown> | null;
}

export interface AgentHotFileSummary {
  path: string | null;
  label: string;
  action: AgentActivityEvent["action"];
  count: number;
  lastUpdatedAt: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface AgentRunningCommandSummary {
  command: string;
  cwd: string | null;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  isLongRunning: boolean;
  outputEvents: number;
}

export interface AgentPhaseBlockerSummary {
  kind: "approval" | "input" | "failure" | "longCommand";
  title: string;
  detail: string;
  since: string;
}

export interface AgentActivitySummary {
  hotFiles: AgentHotFileSummary[];
  runningCommand: AgentRunningCommandSummary | null;
  blockers: AgentPhaseBlockerSummary[];
  updatedAt: string | null;
}

export interface DashboardAgent {
  id: string;
  label: string;
  source: "local" | "cloud" | "cursor" | "presence" | "claude" | "openclaw" | "hermes";
  sourceKind: string;
  parentThreadId: string | null;
  depth: number;
  isCurrent: boolean;
  isOngoing: boolean;
  statusText: string | null;
  role: string | null;
  nickname: string | null;
  isSubagent: boolean;
  state: ActivityState;
  detail: string;
  cwd: string | null;
  sourceProjectRoot?: string | null;
  roomId: string | null;
  appearance: AppearanceProfile;
  hatId?: string | null;
  updatedAt: string;
  stoppedAt: string | null;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
  activitySummary?: AgentActivitySummary;
  goal?: AgentGoalState | null;
  latestMessage: string | null;
  threadId: string | null;
  taskId: string | null;
  resumeCommand: string | null;
  url: string | null;
  git: GitInfo | null;
  provenance: AgentProvenanceSource;
  confidence: AgentConfidence;
  needsUser: NeedsUserState | null;
  liveSubscription: "subscribed" | "readOnly";
  network:
    | {
      transport: string;
      peerId: string;
      peerLabel: string;
      peerHost: string | null;
      peerRoom: string | null;
    }
    | null;
}

export interface HotChangeSummary {
  path: string;
  label: string;
  fileType: "script" | "doc" | "media";
  branch: string | null;
  branches: string[];
  users: string[];
  heat: number;
  score: number;
  changeCount: number;
  lastChangedAt: string;
  linesAdded: number;
  linesRemoved: number;
  agents: string[];
  provenance: AgentProvenanceSource;
  confidence: AgentConfidence;
}

export interface HotToolSummary {
  label: string;
  heat: number;
  score: number;
  useCount: number;
  lastUsedAt: string;
  itemType: string | null;
  agents: string[];
  provenance: AgentProvenanceSource;
  confidence: AgentConfidence;
}

export interface CommandProgressSummary {
  percent: number;
  label: string;
  confidence: "high";
  source: "explicit-percent" | "count";
}

export interface RunningCommandSummary {
  id: string;
  command: string;
  cwd: string | null;
  threadId: string | null;
  agentLabel: string | null;
  status: "running" | "quiet" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  durationMs: number;
  quietForMs: number;
  lastOutput: string | null;
  progress: CommandProgressSummary | null;
  provenance: AgentProvenanceSource;
  confidence: AgentConfidence;
}

export interface WorkspaceActivitySnapshot {
  generatedAt: string;
  hotChanges: HotChangeSummary[];
  hotTools: HotToolSummary[];
  runningCommands: RunningCommandSummary[];
}

export interface DashboardSnapshot {
  projectRoot: string;
  projectLabel: string;
  projectIdentity: ProjectIdentity | null;
  generatedAt: string;
  rooms: RoomConfig;
  agents: DashboardAgent[];
  cloudTasks: CloudTask[];
  events: DashboardEvent[];
  activity: WorkspaceActivitySnapshot;
  notes: string[];
}

export interface SnapshotOptions {
  projectRoot: string;
  includeCloud?: boolean;
  localLimit?: number;
  readThreads?: boolean;
}
