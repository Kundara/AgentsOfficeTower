const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listCodexProjectThreadCandidates
} = require("../dist/codex-thread-query.js");

function thread(overrides = {}) {
  return {
    id: "thr_1",
    preview: "Work",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 100,
    updatedAt: 200,
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd: "F:\\AI\\CodexAgentsOffice",
    cliVersion: "0.0.0",
    source: "cli",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Work",
    turns: [],
    ...overrides
  };
}

test("Codex project thread query falls back when cwd-scoped Windows listing misses threads", async () => {
  const calls = [];
  const client = {
    async listThreads(params) {
      calls.push(params);
      if (params.cwd) {
        return [thread({ id: "other", cwd: "F:\\AI\\OtherProject" })];
      }
      return [
        thread({ id: "match", cwd: "F:\\AI\\CodexAgentsOffice" }),
        thread({ id: "other", cwd: "F:\\AI\\OtherProject" })
      ];
    }
  };

  const result = await listCodexProjectThreadCandidates({
    client,
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    localLimit: 10
  });

  assert.equal(result.usedUnscopedFallback, true);
  assert.deepEqual(result.trackedThreads.map((entry) => entry.id), ["match"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cwd, "/mnt/f/AI/CodexAgentsOffice");
  assert.equal(calls[1].cwd, undefined);
});

test("Codex project thread query falls back when cwd-scoped Windows listing is empty", async () => {
  const calls = [];
  const client = {
    async listThreads(params) {
      calls.push(params);
      if (params.cwd) {
        return [];
      }
      return [thread({ id: "match", cwd: "F:\\AI\\CodexAgentsOffice" })];
    }
  };

  const result = await listCodexProjectThreadCandidates({
    client,
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    localLimit: 10
  });

  assert.equal(result.usedUnscopedFallback, true);
  assert.deepEqual(result.trackedThreads.map((entry) => entry.id), ["match"]);
  assert.equal(calls.length, 2);
});

test("Codex project thread query returns empty when both scoped and fallback miss", async () => {
  const client = {
    async listThreads(params) {
      return params.cwd
        ? []
        : [thread({ id: "other", cwd: "F:\\AI\\OtherProject" })];
    }
  };

  const result = await listCodexProjectThreadCandidates({
    client,
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    localLimit: 10
  });

  assert.equal(result.usedUnscopedFallback, false);
  assert.deepEqual(result.trackedThreads, []);
});

test("Codex project thread query keeps scoped results when they match", async () => {
  const calls = [];
  const client = {
    async listThreads(params) {
      calls.push(params);
      return [thread({ id: "match", cwd: "F:\\AI\\CodexAgentsOffice" })];
    }
  };

  const result = await listCodexProjectThreadCandidates({
    client,
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    localLimit: 10
  });

  assert.equal(result.usedUnscopedFallback, false);
  assert.deepEqual(result.trackedThreads.map((entry) => entry.id), ["match"]);
  assert.equal(calls.length, 1);
});
