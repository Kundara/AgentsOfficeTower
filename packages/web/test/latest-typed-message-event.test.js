const test = require("node:test");
const assert = require("node:assert/strict");

const {
  latestTypedMessageEvent
} = require("../dist/client/runtime/latest-typed-message-event.js");

function event(overrides = {}) {
  return {
    id: overrides.id ?? "event",
    source: "codex",
    confidence: "typed",
    threadId: "thread-1",
    createdAt: "2026-07-09T10:00:00.000Z",
    method: "item/agentMessage/completed",
    kind: "message",
    phase: "completed",
    title: "Message",
    detail: "Message",
    path: null,
    ...overrides
  };
}

test("returns the newest assistant message for the selected thread", () => {
  const older = event({ id: "older", createdAt: "2026-07-09T10:00:00.000Z" });
  const newer = event({ id: "newer", createdAt: "2026-07-09T10:01:00.000Z" });

  assert.equal(
    latestTypedMessageEvent({ events: [older, newer] }, { threadId: "thread-1" }),
    newer
  );
});

test("ignores other threads, event kinds, and every supported user-message spelling", () => {
  const assistant = event({ id: "assistant", createdAt: "2026-07-09T10:00:00.000Z" });
  const ignored = [
    event({ id: "thread", threadId: "thread-2", createdAt: "2026-07-09T10:10:00.000Z" }),
    event({ id: "status", kind: "status", createdAt: "2026-07-09T10:10:00.000Z" }),
    event({ id: "snake", itemType: "user_message", createdAt: "2026-07-09T10:10:00.000Z" }),
    event({ id: "camel", itemType: "userMessage", createdAt: "2026-07-09T10:10:00.000Z" }),
    event({ id: "cursor", method: "cursor/local/prompt", createdAt: "2026-07-09T10:10:00.000Z" }),
    event({ id: "direct", method: "userMessage", createdAt: "2026-07-09T10:10:00.000Z" }),
    event({ id: "suffix", method: "item/userMessage", createdAt: "2026-07-09T10:10:00.000Z" })
  ];

  assert.equal(
    latestTypedMessageEvent({ events: [assistant, ...ignored] }, { threadId: "thread-1" }),
    assistant
  );
});

test("handles absent input and invalid dates without mutating event order", () => {
  const invalid = event({ id: "invalid", createdAt: "not-a-date" });
  const epoch = event({ id: "epoch", createdAt: "1970-01-01T00:00:00.000Z" });
  const events = [invalid, epoch];
  const originalOrder = [...events];

  assert.equal(latestTypedMessageEvent(null, { threadId: "thread-1" }), null);
  assert.equal(latestTypedMessageEvent({ events }, null), null);
  assert.equal(latestTypedMessageEvent({ events }, { threadId: null }), null);
  assert.equal(latestTypedMessageEvent({ events }, { threadId: "thread-1" }), invalid);
  assert.deepEqual(events, originalOrder);
});
