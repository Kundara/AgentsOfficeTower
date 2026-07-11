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
