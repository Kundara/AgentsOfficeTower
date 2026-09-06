const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { PROJECT_ADAPTERS } = require("../dist/adapters/index.js");
const { runAdapterContractChecks, validateAdapterShape, PROVIDER_CONTRACT_VERSION } = require("../dist/adapters/contract-harness.js");

test("the provider contract version is stable and exported", () => {
  assert.equal(PROVIDER_CONTRACT_VERSION, 1);
});

test("every built-in adapter passes the golden provider contract checks", async () => {
  const home = mkdtempSync(join(tmpdir(), "agents-tower-contract-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agents-tower-contract-project-"));
  try {
    for (const adapter of PROJECT_ADAPTERS) {
      const failures = await runAdapterContractChecks(adapter, { projectRoot: fixtureRoot, refreshTimeoutMs: 30000 });
      assert.deepEqual(failures, [], `adapter ${adapter.id} violates the provider contract`);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previous;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the shape validator rejects malformed adapters with actionable failures", () => {
  const failures = validateAdapterShape({ id: "", capabilities: null });
  assert.ok(failures.some((failure) => failure.includes("adapter.id")));
  assert.ok(failures.some((failure) => failure.includes("capabilities")));
  assert.ok(failures.some((failure) => failure.includes("createSource")));
});

test("adapters that throw from refresh are reported as contract violations", async () => {
  const throwing = {
    id: "throwing-fixture",
    source: "local",
    capabilities: {},
    createSource() {
      return {
        async warm() {},
        async refresh() { throw new Error("boom"); },
        getCachedSnapshot() {
          return {
            adapterId: "throwing-fixture",
            source: "local",
            generatedAt: new Date().toISOString(),
            agents: [],
            events: [],
            notes: [],
            health: { status: "ready", detail: null, lastUpdatedAt: null }
          };
        },
        async dispose() {}
      };
    }
  };
  const failures = await runAdapterContractChecks(throwing);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /refresh\("manual"\) must resolve without throwing/);
});

function fixture(overrides = {}) {
  return {
    id: "fixture", source: "local", capabilities: {},
    createSource: () => ({
      async warm() {}, async refresh() {}, async dispose() {},
      getCachedSnapshot: () => ({
        adapterId: "fixture", source: "local", generatedAt: new Date().toISOString(),
        agents: [], events: [], notes: [], health: { status: "ready", detail: null, lastUpdatedAt: null }
      }),
      ...overrides
    })
  };
}

test("null sources return actionable failures", async () => {
  const adapter = fixture();
  adapter.createSource = () => null;
  assert.match((await runAdapterContractChecks(adapter))[0], /ProjectSource object/);
});

test("invalid methods and throwing snapshot getters still dispose", async () => {
  for (const overrides of [{ refresh: null }, { getCachedSnapshot() { throw new Error("getter failed"); } }]) {
    let disposed = 0;
    const failures = await runAdapterContractChecks(fixture({ ...overrides, async dispose() { disposed++; } }));
    assert.ok(failures.length > 0);
    assert.equal(disposed, 1);
  }
});

test("malformed snapshot entries and properties are reported without skipping cleanup", async () => {
  for (const value of [null, { agents: [null], get health() { throw new Error("health getter"); } }]) {
    let disposed = 0;
    const failures = await runAdapterContractChecks(fixture({ getCachedSnapshot: () => value, async dispose() { disposed++; } }));
    assert.ok(failures.length > 0);
    assert.equal(disposed, 1);
  }
});

test("warm, refresh and dispose are each bounded", async () => {
  const never = () => new Promise(() => {});
  const failures = await runAdapterContractChecks(fixture({ warm: never, refresh: never, dispose: never }), { refreshTimeoutMs: 10 });
  assert.equal(failures.length, 3);
  assert.ok(failures.every((failure) => failure.includes("timed out after 10ms")));
});

test("successful lifecycle calls clear their deadline timers", async () => {
  const originalSet = global.setTimeout;
  const originalClear = global.clearTimeout;
  const pending = new Set();
  global.setTimeout = (...args) => { const timer = originalSet(...args); pending.add(timer); return timer; };
  global.clearTimeout = (timer) => { pending.delete(timer); return originalClear(timer); };
  try {
    assert.deepEqual(await runAdapterContractChecks(fixture()), []);
    assert.equal(pending.size, 0);
  } finally {
    global.setTimeout = originalSet;
    global.clearTimeout = originalClear;
    for (const timer of pending) originalClear(timer);
  }
});

test("invalid timeout budgets fail before source creation", async () => {
  for (const refreshTimeoutMs of [0, -1, NaN, Infinity, 2147483648]) {
    const adapter = fixture();
    adapter.createSource = () => { throw new Error("must not create"); };
    assert.match((await runAdapterContractChecks(adapter, { refreshTimeoutMs }))[0], /refreshTimeoutMs/);
  }
});

test("the documented static source helper is available from the public core entrypoint", () => {
  assert.equal(typeof require("../dist/index.js").StaticProjectSource, "function");
});

test("null agents produce confidence failures instead of crashing snapshot inspection", async () => {
  const adapter = fixture();
  const source = adapter.createSource();
  const malformed = source.getCachedSnapshot();
  malformed.agents = [null];
  adapter.createSource = () => ({ ...source, getCachedSnapshot: () => malformed });
  const failures = await runAdapterContractChecks(adapter);
  assert.equal(failures.length, 3);
  assert.ok(failures.every((failure) => failure.includes("confidence must be typed or inferred")));
});
