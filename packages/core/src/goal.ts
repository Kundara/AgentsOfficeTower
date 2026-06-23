import type { ActivityState, AgentConfidence, AgentGoalKind, AgentGoalState, AgentGoalStatus } from "./types";

const GOAL_STATUSES = new Set<AgentGoalStatus>([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
  "unknown"
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unixSecondsToIso(value: unknown): string | null {
  const seconds = numberValue(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

function goalStatus(value: unknown): AgentGoalStatus {
  const status = stringValue(value);
  return status && GOAL_STATUSES.has(status as AgentGoalStatus) ? status as AgentGoalStatus : "unknown";
}

export function codexGoalToAgentGoal(value: unknown): AgentGoalState | null {
  const record = asRecord(value);
  const objective = stringValue(record?.objective);
  if (!record || !objective) {
    return null;
  }

  return {
    kind: "codex",
    objective,
    status: goalStatus(record.status),
    confidence: "typed",
    createdAt: unixSecondsToIso(record.createdAt),
    updatedAt: unixSecondsToIso(record.updatedAt),
    tokenBudget: numberValue(record.tokenBudget),
    tokensUsed: numberValue(record.tokensUsed),
    timeUsedSeconds: numberValue(record.timeUsedSeconds)
  };
}

export function goalStatusFromActivityState(state: ActivityState): AgentGoalStatus {
  if (state === "blocked") {
    return "blocked";
  }
  if (state === "done") {
    return "complete";
  }
  if (state === "idle" || state === "cloud") {
    return "unknown";
  }
  return "active";
}

export function inferredGoalFromText(input: {
  kind: AgentGoalKind;
  objective: string | null;
  state: ActivityState;
  updatedAt: string | null;
  createdAt?: string | null;
  confidence?: AgentConfidence;
}): AgentGoalState | null {
  const objective = stringValue(input.objective);
  if (!objective) {
    return null;
  }

  return {
    kind: input.kind,
    objective,
    status: goalStatusFromActivityState(input.state),
    confidence: input.confidence ?? "inferred",
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt
  };
}
