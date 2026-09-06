const test = require("node:test");
const assert = require("node:assert/strict");
const appServer = require("../dist/app-server.js");
const appearance = require("../dist/appearance.js");
const { codexLocalAdapter } = require("../dist/adapters/codex-local.js");

test("Codex local transport failure is error before data and degraded after a successful read", async (t) => {
  let failure = true;
  t.mock.method(appServer, "withAppServerClient", async () => {
    if (failure) throw new Error("fixture transport unavailable");
    return [{
      id: "fixture-thread", preview: "Fixture work", ephemeral: false,
      modelProvider: "openai", createdAt: 1730831111, updatedAt: 1730832111,
      status: { type: "active", activeFlags: [] }, path: null,
      cwd: "/fixture", cliVersion: "fixture", source: "vscode",
      agentNickname: null, agentRole: null, gitInfo: null, name: "Fixture work", turns: []
    }];
  });
  t.mock.method(appearance, "ensureAgentAppearance", async () => ({}));
  const source = codexLocalAdapter.createSource({ projectRoot: "/fixture" });
  try {
    const initial = source.getCachedSnapshot();
    assert.equal(initial.health.status, "unconfigured");
    await source.warm();
    const failed = source.getCachedSnapshot();
    assert.equal(failed.health.status, "error");
    assert.match(failed.health.detail, /fixture transport unavailable/);
    assert.equal(failed.health.lastUpdatedAt, null);
    assert.equal(failed.generatedAt, initial.generatedAt);

    failure = false;
    await source.refresh("manual");
    const ready = source.getCachedSnapshot();
    assert.equal(ready.health.status, "ready");
    assert.equal(ready.agents.length, 1);
    assert.equal(ready.agents[0].id, "fixture-thread");

    failure = true;
    await source.refresh("manual");
    const degraded = source.getCachedSnapshot();
    assert.equal(degraded.health.status, "degraded");
    assert.match(degraded.health.detail, /fixture transport unavailable/);
    assert.equal(degraded.agents, ready.agents);
    assert.equal(degraded.generatedAt, ready.generatedAt);
    assert.equal(degraded.health.lastUpdatedAt, ready.health.lastUpdatedAt);
  } finally {
    await source.dispose();
  }
});
