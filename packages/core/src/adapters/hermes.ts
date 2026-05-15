import { discoverHermesProjects, loadHermesProjectSnapshotData } from "../hermes";
import type { ProjectAdapter } from "./types";
import { degradedHealth, emptyAdapterSnapshot } from "./helpers";
import { StaticProjectSource } from "./static-source";

export const hermesAdapter: ProjectAdapter = {
  id: "hermes",
  source: "hermes",
  capabilities: { discoverProjects: true },
  discoverProjects(limit) {
    return discoverHermesProjects(limit);
  },
  createSource(context) {
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const data = await loadHermesProjectSnapshotData(context.projectRoot, context.localLimit);
        return emptyAdapterSnapshot({
          adapterId: "hermes",
          source: "hermes",
          agents: data.agents,
          events: data.events,
          notes: data.notes,
          generatedAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "hermes",
          source: "hermes",
          generatedAt,
          notes: [`Hermes sessions unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "hermes", source: "hermes" }));
  }
};
