const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createEventPresentation
} = require("../dist/client/runtime/event-presentation.js");

function presentation() {
  const eventIconUrls = {
    exact: "/exact.png",
    "item/fileChange/outputDelta": "/file.png",
    "item/commandExecution/outputDelta": "/command.png",
    "item/tool/call": "/tool.png",
    "item/commandExecution/requestApproval": "/approval.png",
    "item/fileChange/requestApproval": "/file-approval.png",
    "item/tool/requestUserInput": "/input.png",
    "turn/completed": "/turn.png"
  };
  const threadItemIconUrls = {
    scriptEdit: "/script.png",
    mcpToolCall: "/mcp.png",
    fileChange: "/file-item.png"
  };
  return {
    eventIconUrls,
    threadItemIconUrls,
    helpers: createEventPresentation({ eventIconUrls, threadItemIconUrls })
  };
}

test("event presentation classifies file changes and resolves method aliases", () => {
  const { helpers } = presentation();
  assert.equal(helpers.notificationLabel({ action: "edited", isImage: false }), "Edited");
  assert.equal(helpers.notificationLabel({ action: "edited", isImage: true }), "Updated");
  assert.equal(helpers.notificationKindClassForFileChange("deleted"), "blocked");
  assert.equal(helpers.extensionForNotificationPath("/src/App.TSX?raw=1#x"), "tsx");
  assert.equal(helpers.isScriptFileChangeEvent({ kind: "fileChange", path: "/src/app.ts" }), true);
  assert.equal(helpers.isScriptFileChangeEvent({ kind: "fileChange", path: "/img/logo.png" }), false);
  assert.equal(helpers.scriptFileChangeIconUrl({ kind: "fileChange", path: "/src/app.ts" }), "/script.png");
  assert.equal(helpers.eventIconUrlForMethod("exact"), "/exact.png");
  assert.equal(helpers.eventIconUrlForMethod("item/fileChange/patchUpdated"), "/file.png");
  assert.equal(helpers.eventIconUrlForMethod("item/commandExecution/terminalInteraction"), "/command.png");
  assert.equal(helpers.eventIconUrlForMethod("hook/completed"), "/tool.png");
  assert.equal(helpers.eventIconUrlForMethod("item/autoApprovalReview/started"), "/approval.png");
  assert.equal(helpers.eventIconUrlForMethod("turn/failed"), "/turn.png");
});

test("dashboard and activity icons preserve semantic precedence", () => {
  const { helpers } = presentation();
  assert.equal(helpers.eventIconUrlForActivityType("approval"), "/approval.png");
  assert.equal(helpers.eventIconUrlForActivityType("approval", { approvalType: "fileChange" }), "/file-approval.png");
  assert.equal(helpers.eventIconUrlForActivityType("input"), "/input.png");
  assert.equal(helpers.eventIconUrlForActivityType("fileChange", { isCommand: true }), null);
  assert.equal(helpers.eventIconUrlForDashboardEvent({
    kind: "fileChange", path: "/src/app.ts", method: "exact", itemType: "mcpToolCall"
  }), "/script.png");
  assert.equal(helpers.eventIconUrlForDashboardEvent({
    kind: "tool", method: "exact", itemType: "mcpToolCall"
  }), "/mcp.png");
  assert.equal(helpers.eventIconUrlForDashboardEvent({
    kind: "status", method: "exact", itemType: "mcpToolCall"
  }), "/exact.png");
});

test("history presentation handles tones, fallbacks, dates, and expansion boundaries", () => {
  const { helpers } = presentation();
  assert.equal(helpers.threadHistoryEntryTimeMs({ createdAt: "invalid" }), 0);
  assert.equal(helpers.threadHistoryEntryTimeMs({ createdAt: "1970-01-01T00:00:01.000Z" }), 1000);
  assert.deepEqual(helpers.historyToneForEvent({ kind: "message", method: "item/reasoning/delta" }), { tone: "thinking", label: "Think" });
  assert.deepEqual(helpers.historyToneForEvent({ kind: "approval" }), { tone: "waiting", label: "Wait" });
  assert.deepEqual(helpers.historyToneForEvent({ kind: "command" }), { tone: "run", label: "Run" });
  assert.deepEqual(helpers.historyToneForEvent({ kind: "fileChange" }), { tone: "edit", label: "Edit" });
  assert.deepEqual(helpers.historyToneForEvent({ kind: "tool" }), { tone: "tool", label: "Tool" });
  assert.deepEqual(helpers.historyToneForEvent({ kind: "turn" }), { tone: "plan", label: "Turn" });
  assert.equal(helpers.historyBodyForEvent({ kind: "approval" }), "Waiting for input.");
  assert.equal(helpers.historyBodyForEvent({ kind: "command", method: "command/start" }), "command/start");
  assert.equal(helpers.threadEntryExpansionStateKey("thread", "entry"), "thread::entry");
  assert.equal(helpers.threadEntryLooksLong("x".repeat(520)), false);
  assert.equal(helpers.threadEntryLooksLong("x".repeat(521)), true);
  assert.equal(helpers.threadEntryLooksLong(Array(8).fill("x").join("\n")), false);
  assert.equal(helpers.threadEntryLooksLong(Array(9).fill("x").join("\n")), true);
});

test("event presentation does not mutate icon catalogs", () => {
  const { eventIconUrls, threadItemIconUrls, helpers } = presentation();
  const eventBefore = { ...eventIconUrls };
  const itemBefore = { ...threadItemIconUrls };
  helpers.eventIconUrlForDashboardEvent({ kind: "tool", method: "hook/started", itemType: "mcpToolCall" });
  assert.deepEqual(eventIconUrls, eventBefore);
  assert.deepEqual(threadItemIconUrls, itemBefore);
});
