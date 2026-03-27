import { loadFreshPresenceAgents } from "../presence";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot, degradedHealth } from "./helpers";
import { StaticProjectSource } from "./static-source";

export const presenceAdapter: ProjectAdapter = {
  id: "presence",
  source: "presence",
  capabilities: {},
  createSource(context) {
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const agents = await loadFreshPresenceAgents(context.projectRoot);
        return emptyAdapterSnapshot({
          adapterId: "presence",
          source: "presence",
          agents,
          generatedAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "presence",
          source: "presence",
          generatedAt,
          notes: [`Presence unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "presence", source: "presence" }));
  }
};

