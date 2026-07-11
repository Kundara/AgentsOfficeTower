import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { getAppDataDirectory } from "./app-settings";
import type { DashboardAgent, DashboardSnapshot } from "./types";

export type HistoryEventKind = "wait.opened" | "wait.resolved" | "session.started" | "session.finished";

export interface HistoryEvent {
  at: string;
  kind: HistoryEventKind;
  projectLabel: string;
  agentLabel: string;
  provenance: string;
  detail: string | null;
  waitMs?: number;
}

export interface HistoryFleetView {
  projects: Pick<DashboardSnapshot, "projectLabel" | "agents">[];
}

const HISTORY_JOURNAL_MAX_BYTES = 2 * 1024 * 1024;

function historyDirectory(): string {
  return join(getAppDataDirectory(), "history");
}

function historyJournalPath(): string {
  return join(historyDirectory(), "journal.jsonl");
}

function isBusy(agent: DashboardAgent): boolean {
  return agent.isCurrent === true || agent.isOngoing === true;
}

interface TrackedAgent {
  agent: DashboardAgent;
  projectLabel: string;
}

function trackedAgents(fleet: HistoryFleetView): Map<string, TrackedAgent> {
  const tracked = new Map<string, TrackedAgent>();
  for (const project of fleet.projects) {
    for (const agent of project.agents) {
      tracked.set(agent.id, { agent, projectLabel: project.projectLabel });
    }
  }
  return tracked;
}

export function diffFleetForHistory(
  previous: HistoryFleetView | null,
  next: HistoryFleetView,
  nowMs = Date.now()
): HistoryEvent[] {
  const at = new Date(nowMs).toISOString();
  const events: HistoryEvent[] = [];
  const before = previous ? trackedAgents(previous) : new Map<string, TrackedAgent>();
  const after = trackedAgents(next);

  for (const [id, { agent, projectLabel }] of after) {
    const prior = before.get(id);
    if (agent.needsUser && !prior?.agent.needsUser) {
      events.push({
        at,
        kind: "wait.opened",
        projectLabel,
        agentLabel: agent.label,
        provenance: agent.provenance,
        detail: agent.needsUser.kind
      });
    }
    if (!agent.needsUser && prior?.agent.needsUser) {
      const openedMs = Date.parse(prior.agent.updatedAt);
      events.push({
        at,
        kind: "wait.resolved",
        projectLabel,
        agentLabel: agent.label,
        provenance: agent.provenance,
        detail: prior.agent.needsUser?.kind ?? null,
        waitMs: Number.isFinite(openedMs) ? Math.max(0, nowMs - openedMs) : undefined
      });
    }
    if (previous && isBusy(agent) && (!prior || !isBusy(prior.agent))) {
      events.push({
        at,
        kind: "session.started",
        projectLabel,
        agentLabel: agent.label,
        provenance: agent.provenance,
        detail: agent.detail || null
      });
    }
    if (prior && isBusy(prior.agent) && !isBusy(agent)) {
      events.push({
        at,
        kind: "session.finished",
        projectLabel,
        agentLabel: agent.label,
        provenance: agent.provenance,
        detail: agent.detail || null
      });
    }
  }

  for (const [id, { agent, projectLabel }] of before) {
    if (after.has(id)) {
      continue;
    }
    if (isBusy(agent)) {
      events.push({
        at,
        kind: "session.finished",
        projectLabel,
        agentLabel: agent.label,
        provenance: agent.provenance,
        detail: agent.detail || null
      });
    }
    if (agent.needsUser) {
      const openedMs = Date.parse(agent.updatedAt);
      events.push({
        at,
        kind: "wait.resolved",
        projectLabel,
        agentLabel: agent.label,
        provenance: agent.provenance,
        detail: agent.needsUser.kind,
        waitMs: Number.isFinite(openedMs) ? Math.max(0, nowMs - openedMs) : undefined
      });
    }
  }

  return events;
}

export function appendHistoryEvents(events: HistoryEvent[]): void {
  if (events.length === 0) {
    return;
  }
  mkdirSync(historyDirectory(), { recursive: true });
  const path = historyJournalPath();
  try {
    if (existsSync(path) && statSync(path).size > HISTORY_JOURNAL_MAX_BYTES) {
      renameSync(path, join(historyDirectory(), "journal.previous.jsonl"));
    }
  } catch {
    // Rotation is best-effort; appending still proceeds.
  }
  appendFileSync(path, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

export function readHistoryEvents(sinceMs: number, nowMs = Date.now()): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  for (const file of ["journal.previous.jsonl", "journal.jsonl"]) {
    const path = join(historyDirectory(), file);
    if (!existsSync(path)) {
      continue;
    }
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line) {
        continue;
      }
      try {
        const event = JSON.parse(line) as HistoryEvent;
        const atMs = Date.parse(event.at);
        if (Number.isFinite(atMs) && atMs >= sinceMs && atMs <= nowMs) {
          events.push(event);
        }
      } catch {
        // Skip corrupted lines.
      }
    }
  }
  return events.sort((left, right) => left.at.localeCompare(right.at));
}
