import { describeCursorAgentAvailability, loadCursorCloudProjectSnapshotData } from "../cursor";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot, degradedHealth } from "./helpers";
import { StaticProjectSource } from "./static-source";

export const cursorCloudAdapter: ProjectAdapter = {
  id: "cursor-cloud",
  source: "cursor",
  capabilities: {},
  createSource(context) {
    const knownConversationMessageIds = new Map<string, Set<string>>();
    let emitConversationEvents = false;
    return new StaticProjectSource(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const availabilityNote = await describeCursorAgentAvailability(context.projectRoot);
        if (availabilityNote) {
          return emptyAdapterSnapshot({
            adapterId: "cursor-cloud",
            source: "cursor",
            notes: [availabilityNote],
            generatedAt,
            health: degradedHealth(availabilityNote, generatedAt)
          });
        }

        const snapshotData = await loadCursorCloudProjectSnapshotData(context.projectRoot, {
          knownConversationMessageIds,
          emitConversationEvents
        });
        emitConversationEvents = true;
        return emptyAdapterSnapshot({
          adapterId: "cursor-cloud",
          source: "cursor",
          agents: snapshotData.agents,
          events: snapshotData.events,
          generatedAt
        });
      } catch (error) {
        emitConversationEvents = true;
        const message = error instanceof Error ? error.message : String(error);
        return emptyAdapterSnapshot({
          adapterId: "cursor-cloud",
          source: "cursor",
          generatedAt,
          notes: [`Cursor background agents unavailable: ${message}`],
          health: degradedHealth(message, generatedAt)
        });
      }
    }, emptyAdapterSnapshot({ adapterId: "cursor-cloud", source: "cursor" }));
  }
};
