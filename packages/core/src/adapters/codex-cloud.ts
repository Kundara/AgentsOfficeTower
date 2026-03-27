import { ensureAgentAppearance } from "../appearance";
import { listCloudTasks } from "../cloud";
import { filterProjectCloudTasks } from "../snapshot";
import type { CloudTask, DashboardAgent } from "../types";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot, degradedHealth } from "./helpers";
import { StaticProjectSource } from "./static-source";

const DEFAULT_LIMIT = 10;

export async function cloudTasksToAgents(projectRoot: string, tasks: CloudTask[]): Promise<DashboardAgent[]> {
  return Promise.all(tasks.map(async (task) => ({
    id: task.id,
    label: task.title,
    source: "cloud",
    sourceKind: "cloud",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: task.status,
    role: null,
    nickname: null,
    isSubagent: false,
    state: "cloud",
    detail: `${task.status} · ${task.summary.filesChanged} files`,
    cwd: null,
    roomId: null,
    appearance: await ensureAgentAppearance(projectRoot, task.id),
    updatedAt: task.updatedAt,
    stoppedAt: null,
    paths: [],
    activityEvent: null,
    latestMessage: null,
    threadId: null,
    taskId: task.id,
    resumeCommand: null,
    url: task.url,
    git: null,
    provenance: "cloud",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly",
    network: null
  })));
}

export const codexCloudAdapter: ProjectAdapter = {
  id: "codex-cloud",
  source: "cloud",
  capabilities: {
    cloudTasks: true
  },
  createSource(context) {
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const listedCloudTasks = await listCloudTasks(DEFAULT_LIMIT);
        const cloudTasks = filterProjectCloudTasks(listedCloudTasks, context.projectRoot);
        return emptyAdapterSnapshot({
          adapterId: "codex-cloud",
          source: "cloud",
          agents: await cloudTasksToAgents(context.projectRoot, cloudTasks),
          cloudTasks,
          generatedAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "codex-cloud",
          source: "cloud",
          generatedAt,
          notes: [`Codex cloud list unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "codex-cloud", source: "cloud" }));
  }
};
