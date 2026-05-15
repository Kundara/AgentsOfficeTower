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

  return applyCurrentWorkloadState({
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
}
