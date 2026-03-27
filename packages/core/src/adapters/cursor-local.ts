import { loadCursorLocalProjectSnapshotData } from "../cursor";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot, degradedHealth } from "./helpers";
import { StaticProjectSource } from "./static-source";

export const cursorLocalAdapter: ProjectAdapter = {
  id: "cursor-local",
  source: "cursor",
  capabilities: {},
  createSource(context) {
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const data = await loadCursorLocalProjectSnapshotData(context.projectRoot);
        return emptyAdapterSnapshot({
          adapterId: "cursor-local",
          source: "cursor",
          agents: data.agents,
          events: data.events,
          generatedAt
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "cursor-local",
          source: "cursor",
          generatedAt,
          notes: [`Cursor local sessions unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "cursor-local", source: "cursor" }));
  }
};

