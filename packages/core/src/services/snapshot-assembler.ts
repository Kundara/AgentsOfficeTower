import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describeStoredAppearanceSettings } from "../app-settings";
import { findRoomForPaths, loadRoomConfig } from "../room-config";
import { resolveProjectIdentity } from "../project-identity";
import { applyCurrentWorkloadState } from "../domain/workload-policy";
import { buildWorkspaceActivitySnapshot } from "../domain/workspace-activity";
import { summarizeActivityByAgent } from "../snapshot-lib/activity-summary";
import type { AdapterSnapshot } from "../adapters";
import type { CloudTask, DashboardAgent, DashboardEvent, DashboardSnapshot } from "../types";
import { projectLabelFromRoot } from "./project-discovery";

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

function parseGitStatusPath(line: string): string | null {
  const rawPath = line.slice(3).trim();
  if (!rawPath) {
    return null;
  }
  const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
  return renamedPath?.replace(/^"|"$/g, "") || null;
}

async function changedProjectPaths(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectRoot, "status", "--porcelain=v1", "--untracked-files=no"],
      { timeout: 750, maxBuffer: 256 * 1024 }
    );
    return stdout
      .split(/\r?\n/)
      .map((line) => parseGitStatusPath(line))
      .filter((path): path is string => Boolean(path))
      .slice(0, 12);
  } catch {
    return [];
  }
}

const HOT_CHANGE_AGENT_DIAGNOSTIC_WINDOW_MS = 3 * 60 * 1000;

function normalizePathForMatch(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "") : "";
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
  return leftLower === rightLower
    || leftLower.endsWith(`/${rightLower}`)
    || rightLower.endsWith(`/${leftLower}`);
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
  const projectLabel = projectLabelFromRoot(projectRoot);
  const appearanceSettings = describeStoredAppearanceSettings();
  const [projectIdentity, roomConfig] = await Promise.all([
    resolveProjectIdentity(projectRoot),
    loadRoomConfig(projectRoot)
  ]);

  const now = input.currentnessNow ?? Date.now();
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
  const rawEvents = input.adapterSnapshots.flatMap((snapshot) => snapshot.events);
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
    notes: aggregateNotes(input.adapterSnapshots)
  }, now);
  const diagnostics = freshUnseatedHotChangeAgentDiagnostics(snapshot, now);
  return diagnostics.length > 0
    ? { ...snapshot, notes: [...snapshot.notes, ...diagnostics] }
    : snapshot;
}
