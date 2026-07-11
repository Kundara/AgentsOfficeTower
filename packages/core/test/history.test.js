const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { diffFleetForHistory, appendHistoryEvents, readHistoryEvents } = require("../dist/history.js");

const NOW_MS = Date.parse("2026-07-11T12:00:00.000Z");

function agent(overrides = {}) {
  return {
    id: "a1",
    label: "Agent One",
    provenance: "codex",
    detail: "working",
    isCurrent: true,
    isOngoing: false,
    needsUser: null,
    updatedAt: new Date(NOW_MS - 60_000).toISOString(),
    ...overrides
  };
}

function fleet(agents) {
  return { projects: [{ projectLabel: "Project P", agents }] };
}

test("wait lifecycle produces opened and resolved events with wait duration", () => {
  const before = fleet([agent()]);
  const withWait = fleet([agent({ needsUser: { kind: "approval" }, updatedAt: new Date(NOW_MS - 5 * 60_000).toISOString() })]);
  const opened = diffFleetForHistory(before, withWait, NOW_MS);
  assert.deepEqual(opened.map((event) => event.kind), ["wait.opened"]);

  const resolved = diffFleetForHistory(withWait, fleet([agent()]), NOW_MS);
  assert.deepEqual(resolved.map((event) => event.kind), ["wait.resolved"]);
  assert.equal(resolved[0].waitMs, 5 * 60_000);
});

test("session start, finish, and disappearance are recorded; first observation is not a start", () => {
  const idle = fleet([agent({ isCurrent: false })]);
  const busy = fleet([agent()]);

  assert.deepEqual(diffFleetForHistory(null, busy, NOW_MS), []);
  assert.deepEqual(diffFleetForHistory(idle, busy, NOW_MS).map((e) => e.kind), ["session.started"]);
  assert.deepEqual(diffFleetForHistory(busy, idle, NOW_MS).map((e) => e.kind), ["session.finished"]);
  assert.deepEqual(diffFleetForHistory(busy, fleet([]), NOW_MS).map((e) => e.kind), ["session.finished"]);
});

test("journal appends and reads back within a time window", () => {
  const home = mkdtempSync(join(tmpdir(), "agents-tower-history-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    appendHistoryEvents([
      { at: new Date(NOW_MS - 3 * 3_600_000).toISOString(), kind: "session.started", projectLabel: "P", agentLabel: "Old", provenance: "codex", detail: null },
      { at: new Date(NOW_MS - 10 * 60_000).toISOString(), kind: "wait.opened", projectLabel: "P", agentLabel: "Recent", provenance: "codex", detail: "approval" }
    ]);
    const lastHour = readHistoryEvents(NOW_MS - 3_600_000, NOW_MS);
    assert.equal(lastHour.length, 1);
    assert.equal(lastHour[0].agentLabel, "Recent");
    const lastDay = readHistoryEvents(NOW_MS - 86_400_000, NOW_MS);
    assert.equal(lastDay.length, 2);
    assert.equal(lastDay[0].agentLabel, "Old");
  } finally {
    if (previous === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = previous; }
    rmSync(home, { recursive: true, force: true });
  }
});
