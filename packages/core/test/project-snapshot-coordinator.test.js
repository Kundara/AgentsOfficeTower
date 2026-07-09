const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ProjectSnapshotCoordinator
} = require("../dist/services/project-snapshot-coordinator.js");

function adapterSnapshot(adapterId, marker = adapterId) {
  return {
    adapterId,
    source: "local",
    generatedAt: marker,
    agents: [],
    events: [],
    notes: [],
    health: { status: "ready", detail: null, lastUpdatedAt: marker }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeSource(overrides = {}) {
  const calls = { warm: 0, refresh: [], dispose: 0 };
  return {
    calls,
    source: {
      async warm() { calls.warm += 1; },
      async refresh(reason) {
        calls.refresh.push(reason);
        await overrides.refresh?.(reason);
      },
      getCachedSnapshot() { return adapterSnapshot("secondary"); },
      async dispose() { calls.dispose += 1; }
    }
  };
}

function createCoordinator(source, overrides = {}) {
  return new ProjectSnapshotCoordinator("/project", {
    secondarySources: [source],
    async buildLocalSnapshot(input) {
      return adapterSnapshot("codex-local", input.notes?.[0] ?? "local");
    },
    async cloudTasksToAgents() { return []; },
    async assemble(input) {
      return overrides.assemble
        ? overrides.assemble(input)
        : { projectRoot: input.projectRoot, marker: input.adapterSnapshots[0].generatedAt };
    },
    now: overrides.now
  });
}

test("snapshot builds reuse warm cached sources without refreshing them", async () => {
  const fake = fakeSource();
  const coordinator = createCoordinator(fake.source);

  await coordinator.buildSnapshot({ threads: [] });
  await coordinator.buildSnapshot({ threads: [] });

  assert.equal(fake.calls.warm, 1);
  assert.deepEqual(fake.calls.refresh, []);
  await coordinator.dispose();
  assert.equal(fake.calls.dispose, 1);
});

test("secondary refreshes never overlap and preserve a stronger queued reason", async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const gates = [firstGate, secondGate];
  let active = 0;
  let maxActive = 0;
  const fake = fakeSource({
    async refresh() {
      const gate = gates.shift();
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    }
  });
  const coordinator = createCoordinator(fake.source);

  const interval = coordinator.refresh("interval");
  await new Promise((resolve) => setImmediate(resolve));
  const manual = coordinator.refresh("manual");
  firstGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  secondGate.resolve();
  await Promise.all([interval, manual]);

  assert.equal(maxActive, 1);
  assert.deepEqual(fake.calls.refresh, ["interval", "manual"]);
  await coordinator.dispose();
});

test("serialized assembly publishes only the newest requested snapshot", async () => {
  const fake = fakeSource();
  const firstAssembly = deferred();
  let active = 0;
  let maxActive = 0;
  let assemblyCount = 0;
  const coordinator = createCoordinator(fake.source, {
    async assemble(input) {
      assemblyCount += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (assemblyCount === 1) {
        await firstAssembly.promise;
      }
      active -= 1;
      return { marker: input.adapterSnapshots[0].generatedAt };
    }
  });

  const older = coordinator.buildSnapshot({ threads: [], notes: ["older"] });
  await new Promise((resolve) => setImmediate(resolve));
  const newer = coordinator.buildSnapshot({ threads: [], notes: ["newer"] });
  firstAssembly.resolve();

  assert.equal(await older, null);
  assert.deepEqual(await newer, { marker: "newer" });
  assert.equal(maxActive, 1);
  await coordinator.dispose();
});

test("dispose is idempotent and rejects later work", async () => {
  const fake = fakeSource();
  const coordinator = createCoordinator(fake.source);
  await coordinator.dispose();
  await coordinator.dispose();

  assert.equal(fake.calls.dispose, 1);
  assert.throws(() => coordinator.buildSnapshot({ threads: [] }), /disposed/);
});
