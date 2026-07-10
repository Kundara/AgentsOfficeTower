import type { CodexTurn, ThreadItem } from "../types";

const NON_FINAL_WORK_ITEM_TYPES = new Set([
  "agentMessage",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "collabAgentToolCall",
  "webSearch",
  "imageView",
  "enteredReviewMode",
  "exitedReviewMode",
  "contextCompaction"
]);

function itemString(item: ThreadItem, key: string): string | null {
  const value = item[key];
  return typeof value === "string" ? value : null;
}

export function turnHasFinalAnswer(turn: CodexTurn): boolean {
  return turn.items.some((item) =>
    item.type === "agentMessage" && itemString(item, "phase") === "final_answer"
  );
}

export function turnHasNonFinalWorkSignal(turn: CodexTurn): boolean {
  return turn.items.some((item) => {
    if (!NON_FINAL_WORK_ITEM_TYPES.has(item.type)) {
      return false;
    }
    return item.type !== "agentMessage" || itemString(item, "phase") !== "final_answer";
  });
}

export function turnHasOpenWorkSignal(turn: CodexTurn): boolean {
  if (turn.status === "inProgress") {
    return true;
  }
  return turn.items.some((item) => {
    if (!NON_FINAL_WORK_ITEM_TYPES.has(item.type) || item.type === "agentMessage") {
      return false;
    }
    const status = itemString(item, "status");
    return status !== "completed" && status !== "failed" && status !== "declined";
  });
}
