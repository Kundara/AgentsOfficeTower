import { discoverClaudeProjects, loadClaudeProjectSnapshotData } from "../claude";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot, degradedHealth } from "./helpers";
import { StaticProjectSource } from "./static-source";

export const claudeAdapter: ProjectAdapter = {
  id: "claude",
  source: "claude",
  capabilities: {
    discoverProjects: true,
    typedNeedsUser: true
  },
  discoverProjects(limit) {
    return discoverClaudeProjects(limit);
  },
  createSource(context) {
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const data = await loadClaudeProjectSnapshotData(context.projectRoot);
        return emptyAdapterSnapshot({
          adapterId: "claude",
          source: "claude",
          agents: data.agents,
          events: data.events,
          generatedAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "claude",
          source: "claude",
          generatedAt,
          notes: [`Claude sessions unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "claude", source: "claude" }));
  }
};

