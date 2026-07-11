const test = require("node:test");
const assert = require("node:assert/strict");

const { buildFleetPulse, CHURN_CHANGE_COUNT_THRESHOLD, REPEATED_FAILURE_THRESHOLD } = require("../dist/server/pulse.js");

const NOW_MS = Date.parse("2026-07-11T12:00:00.000Z");

function snapshot(overrides = {}) {
  return {
    projectRoot: "/tmp/p",
    projectLabel: "Project P",
    generatedAt: new Date(NOW_MS).toISOString(),
    agents: [],
    events: [],
    notes: [],
    providerHealth: [],
    claims: [],
    activity: { generatedAt: new Date(NOW_MS).toISOString(), hotChanges: [], hotTools: [], runningCommands: [] },
    ...overrides
  };
}

test("pulse surfaces human waits ordered oldest first", () => {
  const fleet = { generatedAt: new Date(NOW_MS).toISOString(), accountAgents: [], projects: [snapshot({
    agents: [
      { label: "Fast", needsUser: { kind: "approval" }, updatedAt: new Date(NOW_MS - 60 * 1000).toISOString() },
      { label: "Slow", needsUser: { kind: "input" }, updatedAt: new Date(NOW_MS - 22 * 60 * 1000).toISOString() },
      { label: "Busy", needsUser: null, updatedAt: new Date(NOW_MS).toISOString() }
    ]
  })] };
  const pulse = buildFleetPulse(fleet, NOW_MS);
  assert.equal(pulse.waitingForHuman.count, 2);
  assert.equal(pulse.waitingForHuman.waits[0].agentLabel, "Slow");
  assert.equal(pulse.waitingForHuman.oldestWaitMs, 22 * 60 * 1000);
});

test("pulse flags churn hotspots and repeated failures above thresholds", () => {
  const failedEvent = (threadId) => ({ phase: "failed", threadId, createdAt: new Date(NOW_MS).toISOString() });
  const fleet = { generatedAt: new Date(NOW_MS).toISOString(), accountAgents: [], projects: [snapshot({
    activity: {
      generatedAt: new Date(NOW_MS).toISOString(),
      hotTools: [],
      runningCommands: [],
      hotChanges: [
        { label: "hot.ts", path: "src/hot.ts", changeCount: CHURN_CHANGE_COUNT_THRESHOLD + 2 },
        { label: "cool.ts", path: "src/cool.ts", changeCount: 2 }
      ]
    },
    events: [
      ...Array.from({ length: REPEATED_FAILURE_THRESHOLD }, () => failedEvent("t-1")),
      failedEvent("t-2")
    ]
  })] };
  const pulse = buildFleetPulse(fleet, NOW_MS);
  assert.equal(pulse.churnHotspots.length, 1);
  assert.equal(pulse.churnHotspots[0].label, "hot.ts");
  assert.equal(pulse.repeatedFailures.length, 1);
  assert.equal(pulse.repeatedFailures[0].threadId, "t-1");
});

test("pulse collects instability notes without duplicates and stays empty on a quiet fleet", () => {
  const fleet = { generatedAt: new Date(NOW_MS).toISOString(), accountAgents: [], projects: [
    snapshot({ notes: ["Local Codex app-server unavailable: ECONNREFUSED", "ordinary note"] }),
    snapshot({ projectRoot: "/tmp/q", notes: ["Local Codex app-server unavailable: ECONNREFUSED"] })
  ] };
  const pulse = buildFleetPulse(fleet, NOW_MS);
  assert.equal(pulse.instabilityNotes.length, 1);

  const quiet = buildFleetPulse({ generatedAt: new Date(NOW_MS).toISOString(), accountAgents: [], projects: [snapshot()] }, NOW_MS);
  assert.equal(quiet.waitingForHuman.count, 0);
  assert.equal(quiet.churnHotspots.length, 0);
  assert.equal(quiet.repeatedFailures.length, 0);
  assert.equal(quiet.instabilityNotes.length, 0);
});
