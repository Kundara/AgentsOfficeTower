const test = require("node:test");
const assert = require("node:assert/strict");

const { emptyAdapterSnapshot, degradedHealth, errorHealth, readyHealth } = require("../dist/adapters/helpers.js");
const { assembleProjectSnapshot } = require("../dist/services/snapshot-assembler.js");

test("assembled snapshots carry one provider health row per adapter", async () => {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const snapshot = await assembleProjectSnapshot({
    projectRoot: "/tmp/health-fixture",
    generatedAt,
    currentnessNow: now,
    adapterSnapshots: [
      emptyAdapterSnapshot({
        adapterId: "codex-local",
        source: "local",
        generatedAt,
        health: readyHealth("app-server observer attached", generatedAt)
      }),
      emptyAdapterSnapshot({
        adapterId: "hermes",
        source: "hermes",
        generatedAt,
        health: degradedHealth("Hermes SQLite sessions unavailable", generatedAt)
      }),
      emptyAdapterSnapshot({
        adapterId: "cursor-cloud",
        source: "cursor",
        generatedAt,
        health: errorHealth("Cursor cloud auth rejected", generatedAt)
      })
    ]
  });

  assert.equal(snapshot.providerHealth.length, 3);

  const byAdapter = new Map(snapshot.providerHealth.map((row) => [row.adapterId, row]));
  assert.deepEqual(byAdapter.get("codex-local"), {
    adapterId: "codex-local",
    provider: "local",
    status: "ready",
    detail: "app-server observer attached",
    lastUpdatedAt: generatedAt,
    snapshotGeneratedAt: generatedAt
  });
  assert.equal(byAdapter.get("hermes").status, "degraded");
  assert.equal(byAdapter.get("hermes").detail, "Hermes SQLite sessions unavailable");
  assert.equal(byAdapter.get("cursor-cloud").status, "error");
  assert.equal(byAdapter.get("cursor-cloud").provider, "cursor");
});

test("adapter snapshots default to ready health with the snapshot timestamp", async () => {
  const generatedAt = new Date().toISOString();
  const adapterSnapshot = emptyAdapterSnapshot({
    adapterId: "presence",
    source: "presence",
    generatedAt
  });
  assert.equal(adapterSnapshot.health.status, "ready");
  assert.equal(adapterSnapshot.health.lastUpdatedAt, generatedAt);

  const snapshot = await assembleProjectSnapshot({
    projectRoot: "/tmp/health-default-fixture",
    generatedAt,
    adapterSnapshots: [adapterSnapshot]
  });
  assert.equal(snapshot.providerHealth.length, 1);
  assert.equal(snapshot.providerHealth[0].status, "ready");
});
