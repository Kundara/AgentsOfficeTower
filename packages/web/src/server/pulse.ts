import type { DashboardSnapshot } from "@agents-tower/core";

import type { FleetResponse } from "./server-types";

export const CHURN_CHANGE_COUNT_THRESHOLD = 8;
export const REPEATED_FAILURE_THRESHOLD = 3;

export interface FleetPulseWait {
  projectLabel: string;
  agentLabel: string;
  kind: string;
  waitMs: number;
}

export interface FleetPulseChurn {
  projectLabel: string;
  label: string;
  path: string;
  changeCount: number;
}

export interface FleetPulseFailure {
  projectLabel: string;
  threadId: string;
  failures: number;
}

export interface FleetPulse {
  generatedAt: string;
  waitingForHuman: {
    count: number;
    oldestWaitMs: number | null;
    waits: FleetPulseWait[];
  };
  churnHotspots: FleetPulseChurn[];
  repeatedFailures: FleetPulseFailure[];
  instabilityNotes: string[];
}

const INSTABILITY_PATTERNS = [/unavailable/i, /degraded/i, /connection reset/i, /timed? ?out/i];

function waitAgeMs(updatedAt: string, nowMs: number): number {
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : 0;
}

function collectWaits(snapshot: DashboardSnapshot, nowMs: number): FleetPulseWait[] {
  return snapshot.agents
    .filter((agent) => agent.needsUser)
    .map((agent) => ({
      projectLabel: snapshot.projectLabel,
      agentLabel: agent.label,
      kind: agent.needsUser?.kind ?? "wait",
      waitMs: waitAgeMs(agent.updatedAt, nowMs)
    }));
}

function collectChurn(snapshot: DashboardSnapshot): FleetPulseChurn[] {
  return snapshot.activity.hotChanges
    .filter((change) => change.changeCount >= CHURN_CHANGE_COUNT_THRESHOLD)
    .map((change) => ({
      projectLabel: snapshot.projectLabel,
      label: change.label,
      path: change.path,
      changeCount: change.changeCount
    }));
}

function collectRepeatedFailures(snapshot: DashboardSnapshot): FleetPulseFailure[] {
  const failuresByThread = new Map<string, number>();
  for (const event of snapshot.events) {
    if (event.phase !== "failed" || !event.threadId) {
      continue;
    }
    failuresByThread.set(event.threadId, (failuresByThread.get(event.threadId) ?? 0) + 1);
  }
  return Array.from(failuresByThread.entries())
    .filter(([, count]) => count >= REPEATED_FAILURE_THRESHOLD)
    .map(([threadId, failures]) => ({ projectLabel: snapshot.projectLabel, threadId, failures }));
}

export function buildFleetPulse(fleet: FleetResponse | null, nowMs = Date.now()): FleetPulse {
  const snapshots = fleet?.projects ?? [];
  const waits = snapshots.flatMap((snapshot) => collectWaits(snapshot, nowMs))
    .sort((left, right) => right.waitMs - left.waitMs);
  const instabilityNotes = Array.from(new Set(
    snapshots.flatMap((snapshot) => snapshot.notes)
      .filter((note) => INSTABILITY_PATTERNS.some((pattern) => pattern.test(note)))
  )).slice(0, 6);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    waitingForHuman: {
      count: waits.length,
      oldestWaitMs: waits.length > 0 ? waits[0].waitMs : null,
      waits: waits.slice(0, 6)
    },
    churnHotspots: snapshots.flatMap(collectChurn)
      .sort((left, right) => right.changeCount - left.changeCount)
      .slice(0, 6),
    repeatedFailures: snapshots.flatMap(collectRepeatedFailures).slice(0, 6),
    instabilityNotes
  };
}
