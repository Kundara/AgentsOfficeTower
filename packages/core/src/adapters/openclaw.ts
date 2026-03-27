import { discoverOpenClawProjects, loadOpenClawAgents } from "../openclaw";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot, degradedHealth } from "./helpers";
import { StaticProjectSource } from "./static-source";

export const openClawAdapter: ProjectAdapter = {
  id: "openclaw",
  source: "openclaw",
  capabilities: {
    discoverProjects: true
  },
  discoverProjects(limit) {
    return discoverOpenClawProjects(limit);
  },
  createSource(context) {
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const agents = await loadOpenClawAgents(context.projectRoot);
        return emptyAdapterSnapshot({
          adapterId: "openclaw",
          source: "openclaw",
          agents,
          generatedAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "openclaw",
          source: "openclaw",
          generatedAt,
          notes: [`OpenClaw gateway agents unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "openclaw", source: "openclaw" }));
  }
};

