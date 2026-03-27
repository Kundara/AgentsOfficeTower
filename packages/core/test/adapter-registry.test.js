const test = require("node:test");
const assert = require("node:assert/strict");

const { PROJECT_ADAPTERS } = require("../dist/index.js");

test("project adapter registry exposes the built-in source set", () => {
  const ids = PROJECT_ADAPTERS.map((adapter) => adapter.id).sort();
  assert.deepEqual(ids, [
    "claude",
    "codex-cloud",
    "codex-local",
    "cursor-cloud",
    "cursor-local",
    "openclaw",
    "presence"
  ]);
});

test("every built-in adapter can create a project source with the shared contract", () => {
  for (const adapter of PROJECT_ADAPTERS) {
    const source = adapter.createSource({
      projectRoot: "/tmp/project",
      localLimit: 1,
      readThreads: false
    });
    assert.equal(typeof source.warm, "function");
    assert.equal(typeof source.refresh, "function");
    assert.equal(typeof source.getCachedSnapshot, "function");
    assert.equal(typeof source.dispose, "function");
  }
});

