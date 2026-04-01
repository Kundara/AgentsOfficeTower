import { describeStoredAppearanceSettings } from "../app-settings";
import { findRoomForPaths, loadRoomConfig } from "../room-config";
import { resolveProjectIdentity } from "../project-identity";
import { applyCurrentWorkloadState } from "../domain/workload-policy";
import type { AdapterSnapshot } from "../adapters";
import type { CloudTask, DashboardAgent, DashboardEvent, DashboardSnapshot } from "../types";
import { projectLabelFromRoot } from "./project-discovery";

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

  const agents = normalizeAgentRoomIds(
    input.adapterSnapshots
      .flatMap((snapshot) => snapshot.agents)
      .map((agent) => ({
        ...agent,
        hatId: appearanceSettings.hatId
      })),
    { projectRoot, roomConfig }
  );
  const cloudTasks = aggregateCloudTasks(input.adapterSnapshots);

  return applyCurrentWorkloadState({
    projectRoot,
    projectLabel,
    projectIdentity,
    generatedAt,
    rooms: roomConfig,
    agents,
    cloudTasks,
    events: aggregateEvents(input.adapterSnapshots),
    notes: aggregateNotes(input.adapterSnapshots)
  }, input.currentnessNow ?? Date.now());
}
