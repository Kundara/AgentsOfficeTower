import { basename } from "node:path";

import { looksLikeValidationCommand, shortenText } from "../utils/text";
import type {
  AgentActivitySummary,
  AgentHotFileSummary,
  AgentPhaseBlockerSummary,
  AgentRunningCommandSummary,
  DashboardAgent,
  DashboardEvent
} from "../types";

const HOT_FILE_WINDOW_MS = 2 * 60 * 1000;
const RUNNING_COMMAND_WINDOW_MS = 5 * 60 * 1000;
const LONG_RUNNING_COMMAND_MS = 30 * 1000;

function eventTimeMs(event: Pick<DashboardEvent, "createdAt">): number {
  const createdAtMs = Date.parse(event.createdAt);
  return Number.isFinite(createdAtMs) ? createdAtMs : 0;
}

function isoFromMs(value: number): string {
  return new Date(value).toISOString();
}

function displayFileLabel(path: string | null, fallback: string): string {
  if (!path) {
    return shortenText(fallback || "Files", 48);
  }
  return shortenText(basename(path) || path, 48);
}

function summarizeHotFiles(events: DashboardEvent[], now: number): AgentHotFileSummary[] {
  const byPath = new Map<string, AgentHotFileSummary & { latestMs: number }>();
  for (const event of events) {
    if (event.kind !== "fileChange") {
      continue;
    }
    const createdAtMs = eventTimeMs(event);
    if (createdAtMs <= 0 || now - createdAtMs > HOT_FILE_WINDOW_MS) {
      continue;
    }
    const key = event.path || event.detail || event.title || "files";
    const existing = byPath.get(key);
    const linesAdded = typeof event.linesAdded === "number" && Number.isFinite(event.linesAdded)
      ? event.linesAdded
      : undefined;
    const linesRemoved = typeof event.linesRemoved === "number" && Number.isFinite(event.linesRemoved)
      ? event.linesRemoved
      : undefined;
    if (!existing) {
      byPath.set(key, {
        path: event.path,
        label: displayFileLabel(event.path, event.detail || event.title),
        action: event.action ?? "edited",
        count: 1,
        lastUpdatedAt: event.createdAt,
        latestMs: createdAtMs,
        linesAdded,
        linesRemoved
      });
      continue;
    }
    existing.count += 1;
    if (linesAdded !== undefined) {
      existing.linesAdded = (existing.linesAdded ?? 0) + linesAdded;
    }
    if (linesRemoved !== undefined) {
      existing.linesRemoved = (existing.linesRemoved ?? 0) + linesRemoved;
    }
    if (createdAtMs >= existing.latestMs) {
      existing.path = event.path;
      existing.label = displayFileLabel(event.path, event.detail || event.title);
      existing.action = event.action ?? existing.action;
      existing.lastUpdatedAt = event.createdAt;
      existing.latestMs = createdAtMs;
    }
  }

  return [...byPath.values()]
    .sort((left, right) => right.count - left.count || right.latestMs - left.latestMs)
    .slice(0, 3)
    .map(({ latestMs: _latestMs, ...entry }) => entry);
}

function commandKey(event: DashboardEvent): string {
  return event.itemId || event.command || event.detail || event.title || event.id;
}

function summarizeRunningCommandFromEvents(events: DashboardEvent[], now: number): AgentRunningCommandSummary | null {
  const commandEvents = events
    .filter((event) => event.kind === "command")
    .filter((event) => {
      const createdAtMs = eventTimeMs(event);
      return createdAtMs > 0 && now - createdAtMs <= RUNNING_COMMAND_WINDOW_MS;
    })
    .sort((left, right) => eventTimeMs(left) - eventTimeMs(right));
  if (commandEvents.length === 0) {
    return null;
  }

  const groups = new Map<string, DashboardEvent[]>();
  for (const event of commandEvents) {
    const key = commandKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const summaries = [...groups.values()]
    .map((group): AgentRunningCommandSummary | null => {
      const sorted = [...group].sort((left, right) => eventTimeMs(left) - eventTimeMs(right));
      const last = sorted[sorted.length - 1];
      if (!last) {
        return null;
      }
      if (sorted.some((event) => event.phase === "completed" || event.phase === "failed" || event.phase === "interrupted")) {
        return null;
      }
      const firstStarted = sorted.find((event) => event.phase === "started") ?? sorted[0];
      const startedAtMs = eventTimeMs(firstStarted);
      const updatedAtMs = eventTimeMs(last);
      const command = last.command || last.detail || last.title;
      if (!command) {
        return null;
      }
      return {
        command: shortenText(command, 140),
        cwd: last.cwd ?? last.path,
        startedAt: isoFromMs(startedAtMs),
        updatedAt: isoFromMs(updatedAtMs),
        elapsedMs: Math.max(0, now - startedAtMs),
        isLongRunning: now - startedAtMs >= LONG_RUNNING_COMMAND_MS,
        outputEvents: sorted.filter((event) => event.phase === "updated").length
      };
    })
    .filter((entry): entry is AgentRunningCommandSummary => Boolean(entry));

  return summaries.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
}

function summarizeRunningCommandFromAgent(agent: DashboardAgent, now: number): AgentRunningCommandSummary | null {
  if (agent.activityEvent?.type !== "commandExecution") {
    return null;
  }
  if (agent.state !== "running" && agent.state !== "validating") {
    return null;
  }
  const updatedAtMs = Date.parse(agent.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return null;
  }
  const command = agent.activityEvent.title || agent.detail;
  return {
    command: shortenText(command || "Command", 140),
    cwd: agent.activityEvent.path ?? agent.cwd,
    startedAt: isoFromMs(updatedAtMs),
    updatedAt: isoFromMs(updatedAtMs),
    elapsedMs: Math.max(0, now - updatedAtMs),
    isLongRunning: now - updatedAtMs >= LONG_RUNNING_COMMAND_MS,
    outputEvents: 0
  };
}

function summarizeBlockers(
  agent: DashboardAgent,
  runningCommand: AgentRunningCommandSummary | null
): AgentPhaseBlockerSummary[] {
  const blockers: AgentPhaseBlockerSummary[] = [];
  if (agent.needsUser?.kind === "approval") {
    blockers.push({
      kind: "approval",
      title: agent.needsUser.networkApprovalContext ? "Network approval" : "Needs approval",
      detail: shortenText(agent.needsUser.command || agent.needsUser.reason || agent.detail || "Approval required", 120),
      since: agent.updatedAt
    });
  } else if (agent.needsUser?.kind === "input") {
    const questionCount = Array.isArray(agent.needsUser.questions) ? agent.needsUser.questions.length : 0;
    blockers.push({
      kind: "input",
      title: "Needs input",
      detail: shortenText(agent.needsUser.reason || (questionCount > 0 ? `${questionCount} question${questionCount === 1 ? "" : "s"}` : agent.detail || "Input required"), 120),
      since: agent.updatedAt
    });
  } else if (agent.state === "blocked") {
    blockers.push({
      kind: "failure",
      title: "Blocked",
      detail: shortenText(agent.detail || agent.statusText || "Blocked", 120),
      since: agent.updatedAt
    });
  }

  if (runningCommand?.isLongRunning) {
    blockers.push({
      kind: "longCommand",
      title: looksLikeValidationCommand(runningCommand.command) ? "Long validation" : "Long command",
      detail: runningCommand.command,
      since: runningCommand.startedAt
    });
  }

  return blockers.slice(0, 3);
}

export function summarizeAgentActivity(
  agent: DashboardAgent,
  events: DashboardEvent[],
  now = Date.now()
): AgentActivitySummary {
  const hotFiles = summarizeHotFiles(events, now);
  const runningCommand =
    summarizeRunningCommandFromEvents(events, now)
    ?? summarizeRunningCommandFromAgent(agent, now);
  const blockers = summarizeBlockers(agent, runningCommand);
  const updatedAtValues = [
    ...hotFiles.map((file) => Date.parse(file.lastUpdatedAt)),
    runningCommand ? Date.parse(runningCommand.updatedAt) : 0,
    ...blockers.map((blocker) => Date.parse(blocker.since))
  ].filter((value) => Number.isFinite(value) && value > 0);

  return {
    hotFiles,
    runningCommand,
    blockers,
    updatedAt: updatedAtValues.length > 0 ? isoFromMs(Math.max(...updatedAtValues)) : null
  };
}

export function summarizeActivityByAgent(
  agents: DashboardAgent[],
  events: DashboardEvent[],
  now = Date.now()
): DashboardAgent[] {
  const eventsByThreadId = new Map<string, DashboardEvent[]>();
  for (const event of events) {
    if (!event.threadId) {
      continue;
    }
    eventsByThreadId.set(event.threadId, [...(eventsByThreadId.get(event.threadId) ?? []), event]);
  }

  return agents.map((agent) => {
    const summary = summarizeAgentActivity(
      agent,
      agent.threadId ? eventsByThreadId.get(agent.threadId) ?? [] : [],
      now
    );
    if (
      summary.hotFiles.length === 0
      && !summary.runningCommand
      && summary.blockers.length === 0
    ) {
      return agent;
    }
    return {
      ...agent,
      activitySummary: summary
    };
  });
}
