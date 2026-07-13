import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describeStoredAppearanceSettings } from "../app-settings";
import { findRoomForPaths, loadRoomConfig } from "../room-config";
import { resolveProjectIdentity } from "../project-identity";
import { applyCurrentWorkloadState } from "../domain/workload-policy";
import { listCoordinationClaims } from "../coordination";
import { buildWorkspaceActivitySnapshot } from "../domain/workspace-activity";
import { summarizeActivityByAgent } from "../snapshot-lib/activity-summary";
import type { AdapterSnapshot } from "../adapters";
import type { CloudTask, DashboardAgent, DashboardEvent, DashboardSnapshot, ProviderHealth } from "../types";
import { canonicalizeProjectPath, filesystemPathForProjectRoot, projectLabelFromRoot } from "../project-paths";

const execFileAsync = promisify(execFile);

function normalizeAgentRoomIds(
  agents: DashboardAgent[],
  input: { projectRoot: string; roomConfig: Awaited<ReturnType<typeof loadRoomConfig>> }
): DashboardAgent[] {
  return agents.map((agent) => ({
    ...agent,
    roomId: findRoomForPaths(input.roomConfig, input.projectRoot, agent.paths)
  }));
}

function aggregateEvents(snapshots: AdapterSnapshot[]): DashboardEvent[] {
  return snapshots
    .flatMap((snapshot) => snapshot.events)
    .filter((event) => {
      const createdAtMs = Date.parse(event.createdAt);
      return Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= 2 * 60 * 1000;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function aggregateNotes(snapshots: AdapterSnapshot[]): string[] {
  return Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.notes).filter(Boolean)));
}

function aggregateCloudTasks(snapshots: AdapterSnapshot[]): CloudTask[] {
  return snapshots.flatMap((snapshot) => snapshot.cloudTasks ?? []);
}

function aggregateProviderHealth(snapshots: AdapterSnapshot[]): ProviderHealth[] {
  return snapshots.map((snapshot) => ({
    adapterId: snapshot.adapterId,
    provider: snapshot.source,
    status: snapshot.health.status,
    detail: snapshot.health.detail,
    lastUpdatedAt: snapshot.health.lastUpdatedAt,
    snapshotGeneratedAt: snapshot.generatedAt
  }));
}

function parseGitStatusChange(line: string): { path: string; action: DashboardEvent["action"] } | null {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  if (!rawPath) {
    return null;
  }
  const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
  const path = renamedPath?.replace(/^"|"$/g, "") || null;
  if (!path) {
    return null;
  }
  const action: DashboardEvent["action"] =
    status.includes("R") ? "moved"
    : status.includes("D") ? "deleted"
    : status.includes("A") || status === "??" ? "created"
    : "edited";
  return { path, action };
}

async function changedProjectPaths(projectRoot: string): Promise<Array<{ path: string; action: DashboardEvent["action"] }>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", filesystemPathForProjectRoot(projectRoot), "status", "--porcelain=v1", "--untracked-files=all"],
      { timeout: 750, maxBuffer: 256 * 1024, windowsHide: true }
    );
    return stdout
      .split(/\r?\n/)
      .map((line) => parseGitStatusChange(line))
      .filter((change): change is { path: string; action: DashboardEvent["action"] } => Boolean(change))
      .slice(0, 48);
  } catch {
    return [];
  }
}

function addAgentHotFileEvents(
  events: DashboardEvent[],
  agents: DashboardAgent[],
  projectRoot: string
): DashboardEvent[] {
  const result = [...events];
  const existing = events
    .filter((event): event is DashboardEvent & { path: string } => event.kind === "fileChange" && Boolean(event.path))
    .map((event) => ({ threadId: event.threadId, path: event.path, createdAtMs: Date.parse(event.createdAt) }));
  const freshestExistingAt = (threadId: string, path: string): number => existing.reduce((freshest, entry) =>
    entry.threadId === threadId
      && pathsReferToSameFile(entry.path, path, projectRoot)
      && Number.isFinite(entry.createdAtMs)
      ? Math.max(freshest, entry.createdAtMs)
      : freshest
  , Number.NEGATIVE_INFINITY);
  const remember = (threadId: string, path: string, createdAtMs: number): void => {
    existing.push({ threadId, path, createdAtMs });
  };

  for (const agent of agents) {
    if (!agent.threadId) {
      continue;
    }
    for (const hotFile of agent.activitySummary?.hotFiles ?? []) {
      const hotFileUpdatedAtMs = Date.parse(hotFile.lastUpdatedAt);
      if (!hotFile.path || !Number.isFinite(hotFileUpdatedAtMs)) {
        continue;
      }
      if (freshestExistingAt(agent.threadId, hotFile.path) >= hotFileUpdatedAtMs) {
        continue;
      }
      remember(agent.threadId, hotFile.path, hotFileUpdatedAtMs);
      result.push({
        id: `agent-hot-file::${agent.threadId}::${normalizePathForMatch(hotFile.path)}`,
        source: agent.provenance,
        confidence: agent.confidence,
        threadId: agent.threadId,
        createdAt: hotFile.lastUpdatedAt,
        method: "agent/activitySummary/hotFile",
        kind: "fileChange",
        phase: "updated",
        title: hotFile.label,
        detail: hotFile.path,
        path: hotFile.path,
        action: hotFile.action,
        linesAdded: hotFile.linesAdded,
        linesRemoved: hotFile.linesRemoved,
        isImage: false
      });
    }
    const latest = agent.activityEvent;
    const agentUpdatedAtMs = Date.parse(agent.updatedAt);
    if (latest?.type === "fileChange" && latest.path && Number.isFinite(agentUpdatedAtMs)) {
      if (freshestExistingAt(agent.threadId, latest.path) < agentUpdatedAtMs) {
        remember(agent.threadId, latest.path, agentUpdatedAtMs);
        result.push({
          id: `agent-latest-file::${agent.threadId}::${normalizePathForMatch(latest.path)}`,
          source: agent.provenance,
          confidence: agent.confidence,
          threadId: agent.threadId,
          createdAt: agent.updatedAt,
          method: "agent/activityEvent/fileChange",
          kind: "fileChange",
          phase: "updated",
          title: latest.title,
          detail: latest.path,
          path: latest.path,
          action: latest.action,
          linesAdded: latest.linesAdded,
          linesRemoved: latest.linesRemoved,
          isImage: latest.isImage
        });
      }
    }
  }
  return result;
}

const HOT_CHANGE_AGENT_DIAGNOSTIC_WINDOW_MS = 3 * 60 * 1000;

function normalizePathForMatch(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const canonical = canonicalizeProjectPath(value) ?? value;
  return canonical.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function pathRelativeToProject(path: string, projectRoot: string): string {
  const normalizedPath = normalizePathForMatch(path);
  const normalizedRoot = normalizePathForMatch(projectRoot);
  if (!normalizedPath || !normalizedRoot) {
    return normalizedPath;
  }
  const lowerPath = normalizedPath.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();
  if (lowerPath === lowerRoot) {
    return "";
  }
  if (lowerPath.startsWith(`${lowerRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

function pathsReferToSameFile(left: string, right: string, projectRoot: string): boolean {
  const leftRelative = pathRelativeToProject(left, projectRoot);
  const rightRelative = pathRelativeToProject(right, projectRoot);
  if (!leftRelative || !rightRelative) {
    return false;
  }
  const leftLower = leftRelative.toLowerCase();
  const rightLower = rightRelative.toLowerCase();
  return leftLower === rightLower;
}

function freshUnseatedHotChangeAgentDiagnostics(snapshot: DashboardSnapshot, now: number): string[] {
  const notes: string[] = [];
  const hotChanges = snapshot.activity.hotChanges.filter((entry) => entry.agents.length === 0);
  if (hotChanges.length === 0) {
    return notes;
  }

  for (const hotChange of hotChanges) {
    const matchingAgent = snapshot.agents.find((agent) => {
      if (
        agent.source !== "local"
        || agent.isCurrent
        || agent.isOngoing
        || agent.statusText === "active"
        || agent.threadId === null
      ) {
        return false;
      }
      const updatedAtMs = Date.parse(agent.updatedAt);
      if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > HOT_CHANGE_AGENT_DIAGNOSTIC_WINDOW_MS) {
        return false;
      }
      return agent.paths.some((path) => pathsReferToSameFile(path, hotChange.path, snapshot.projectRoot));
    });

    if (!matchingAgent) {
      continue;
    }

    notes.push(
      `Hot change ${hotChange.label} has no agent attribution, but fresh local Codex thread ${matchingAgent.threadId} matches the path and is not current (status=${matchingAgent.statusText ?? "unknown"}, state=${matchingAgent.state}, ongoing=${matchingAgent.isOngoing}).`
    );
    if (notes.length >= 3) {
      break;
    }
  }

  return notes;
}

export async function assembleProjectSnapshot(input: {
  projectRoot: string;
  adapterSnapshots: AdapterSnapshot[];
  generatedAt?: string;
  currentnessNow?: number;
}): Promise<DashboardSnapshot> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectRoot = input.projectRoot;
  const appearanceSettings = describeStoredAppearanceSettings();
  const [projectIdentity, roomConfig] = await Promise.all([
    resolveProjectIdentity(projectRoot),
    loadRoomConfig(projectRoot)
  ]);

  const now = input.currentnessNow ?? Date.now();
  const projectLabel = projectIdentity?.worktreeName && projectIdentity.gitRoot
    ? projectLabelFromRoot(projectIdentity.gitRoot)
    : projectLabelFromRoot(projectRoot);
  const events = aggregateEvents(input.adapterSnapshots);
  const agents = normalizeAgentRoomIds(
    input.adapterSnapshots
      .flatMap((snapshot) => snapshot.agents)
      .map((agent) => ({
        ...agent,
        hatId: appearanceSettings.hatId
      })),
    { projectRoot, roomConfig }
  );
  const agentsWithActivitySummary = summarizeActivityByAgent(agents, events, now);
  const cloudTasks = aggregateCloudTasks(input.adapterSnapshots);
  const rawEvents = addAgentHotFileEvents(
    input.adapterSnapshots.flatMap((snapshot) => snapshot.events),
    agentsWithActivitySummary,
    projectRoot
  );
  const changedPaths = await changedProjectPaths(projectRoot);
  const activity = buildWorkspaceActivitySnapshot({
    events: rawEvents,
    agents: agentsWithActivitySummary,
    generatedAt,
    now,
    changedPaths,
    projectBranch: projectIdentity?.branch ?? null
  });

  const snapshot = applyCurrentWorkloadState({
    projectRoot,
    projectLabel,
    projectIdentity,
    generatedAt,
    rooms: roomConfig,
    agents: agentsWithActivitySummary,
    cloudTasks,
    events,
    activity,
    notes: aggregateNotes(input.adapterSnapshots),
    providerHealth: aggregateProviderHealth(input.adapterSnapshots),
    claims: listCoordinationClaims(projectRoot, now)
  }, now);
  const diagnostics = freshUnseatedHotChangeAgentDiagnostics(snapshot, now);
  return diagnostics.length > 0
    ? { ...snapshot, notes: [...snapshot.notes, ...diagnostics] }
    : snapshot;
}
