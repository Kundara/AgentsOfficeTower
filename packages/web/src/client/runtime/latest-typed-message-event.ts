import type { DashboardAgent, DashboardEvent, DashboardSnapshot } from "@codex-agents-office/core";

type MessageSnapshot = Pick<DashboardSnapshot, "events">;
type MessageAgent = Pick<DashboardAgent, "threadId">;

function isUserMessage(event: DashboardEvent): boolean {
  return event.itemType === "user_message"
    || event.itemType === "userMessage"
    || event.method === "cursor/local/prompt"
    || event.method === "userMessage"
    || event.method.endsWith("/userMessage");
}

export function latestTypedMessageEvent(
  snapshot: MessageSnapshot | null | undefined,
  agent: MessageAgent | null | undefined
): DashboardEvent | null {
  if (!snapshot || !agent?.threadId) {
    return null;
  }

  let latest: DashboardEvent | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const event of snapshot.events ?? []) {
    if (
      event.threadId !== agent.threadId
      || event.kind !== "message"
      || isUserMessage(event)
    ) {
      continue;
    }
    const parsedAt = Date.parse(event.createdAt);
    const eventAt = Number.isFinite(parsedAt) ? parsedAt : 0;
    if (!latest || eventAt > latestAt) {
      latest = event;
      latestAt = eventAt;
    }
  }
  return latest;
}
