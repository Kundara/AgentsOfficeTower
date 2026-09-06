const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDashboardEventFromAppServerMessage,
  buildAppServerDiagnosticNote,
  isFinalAgentMessageNotification,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
} = require("../dist/live-monitor-lib/events.js");

for (const method of ["thread/environment/connected", "thread/environment/disconnected", "rawResponse/completed"]) {
  test(`${method} stays telemetry and cannot create presence, completion or toasts`, () => {
    const params = method === "rawResponse/completed"
      ? { threadId: "thread", turnId: "turn", responseId: "response", usage: { inputTokens: 12, outputTokens: 3 } }
      : { threadId: "thread", environmentId: "environment" };
    const notification = { method, params };
    assert.equal(buildDashboardEventFromAppServerMessage({ projectRoot: "/fixture" }, notification), null);
    assert.equal(buildAppServerDiagnosticNote(notification), null);
    assert.equal(shouldMarkThreadLiveFromAppServerNotification(method), false);
    assert.equal(shouldMarkThreadStoppedFromAppServerNotification(method), false);
    assert.equal(isFinalAgentMessageNotification(notification), false);
  });
}
