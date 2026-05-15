const PIXEL_OFFICE_SPRITES_DIR = "/assets/pixel-office/sprites";
import PIXEL_OFFICE_MANIFEST_JSON from "./config/pixel-office-manifest.json";

export const PIXEL_OFFICE_EVENT_ICON_METHODS = [
  "thread/started",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/requestApproval",
  "item/fileChange/outputDelta",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
  "serverRequest/resolved"
] as const;

export const PIXEL_OFFICE_EVENT_ICON_URLS = Object.fromEntries(
  PIXEL_OFFICE_EVENT_ICON_METHODS.map((method) => [method, `${PIXEL_OFFICE_SPRITES_DIR}/icons/${method}.svg`])
) as Record<(typeof PIXEL_OFFICE_EVENT_ICON_METHODS)[number], string>;

export const OFFICIAL_CODEX_THREAD_ITEM_TYPES = [
  "userMessage",
  "agentMessage",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "webSearch",
  "imageView",
  "enteredReviewMode",
  "exitedReviewMode",
  "contextCompaction"
] as const;

export const PIXEL_OFFICE_THREAD_ITEM_ICON_URLS = {
  userMessage: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/userMessage.png`,
  agentMessage: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/agentMessage.png`,
  plan: PIXEL_OFFICE_EVENT_ICON_URLS["item/plan/delta"],
  reasoning: PIXEL_OFFICE_EVENT_ICON_URLS["item/reasoning/summaryTextDelta"],
  commandExecution: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/commandExecution.png`,
  fileChange: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/fileChange.png`,
  mcpToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/mcpToolCall.png`,
  dynamicToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/dynamicToolCall.png`,
  collabToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/collabToolCall.png`,
  collabAgentToolCall: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/collabToolCall.png`,
  webSearch: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/webSearch.png`,
  imageView: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/imageView.png`,
  enteredReviewMode: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/enteredReviewMode.png`,
  exitedReviewMode: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/exitedReviewMode.svg`,
  contextCompaction: `${PIXEL_OFFICE_SPRITES_DIR}/icons/thread-item/contextCompaction.svg`
} as const;

export const PIXEL_OFFICE_MANIFEST = PIXEL_OFFICE_MANIFEST_JSON;
