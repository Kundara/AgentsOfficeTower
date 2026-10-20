const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  applyClaudeRegistryStatus,
  parseClaudeSessionRegistryEntry,
  readClaudeSessionRegistry
} = require("../dist/claude-session-registry.js");
const {
  extractClaudeSessionTitle,
  isClaudeHumanUserRecord,
  isSyntheticClaudeUserText
} = require("../dist/claude-transcript-signals.js");
const { claudeSdkSessionListOptions } = require("../dist/claude-session-ownership.js");

const DONE_WINDOW_MS = 15 * 60 * 1000;

function summary(overrides = {}) {
  return {
    label: "Claude opus 5 5",
    state: "done",
    detail: "Finished the refactor",
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    activityEvent: null,
    confidence: "inferred",
    needsUser: null,
    isOngoing: false,
    ...overrides
  };
}

function entry(status, overrides = {}) {
  return {
    pid: 1,
    sessionId: "s1",
    cwd: "F:\\AI\\CodexAgentsOffice",
    status,
    waitingFor: null,
    name: null,
    kind: "interactive",
    entrypoint: "claude-desktop",
    statusUpdatedAt: Date.now() - 1000,
    ...overrides
  };
}

test("registry entries parse only typed statuses and never need key files", () => {
  assert.equal(parseClaudeSessionRegistryEntry({ pid: 4, sessionId: "s", status: "busy" }).status, "busy");
  assert.equal(parseClaudeSessionRegistryEntry({ pid: 4, sessionId: "s", status: "mystery" }), null);
  assert.equal(parseClaudeSessionRegistryEntry({ sessionId: "s", status: "idle" }), null);
});

test("registry reader skips exited pids and non-json siblings", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-registry-"));
  try {
    mkdirSync(join(root, "sessions"));
    writeFileSync(join(root, "sessions", "10.json"), JSON.stringify({ pid: 10, sessionId: "live", status: "busy", statusUpdatedAt: 5 }));
    writeFileSync(join(root, "sessions", "11.json"), JSON.stringify({ pid: 11, sessionId: "dead", status: "busy" }));
    writeFileSync(join(root, "sessions", "10.abc.key"), "secret");
    const registry = await readClaudeSessionRegistry([root], { isAlive: (pid) => pid === 10 });
    assert.deepEqual([...registry.keys()], ["live"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("busy registry status keeps a transcript-aged lead session ongoing with typed confidence", () => {
  const result = applyClaudeRegistryStatus(summary(), entry("busy", { name: "Seating audit" }), DONE_WINDOW_MS);
  assert.equal(result.isOngoing, true);
  assert.equal(result.state, "thinking");
  assert.equal(result.confidence, "typed");
  assert.equal(result.label, "Seating audit");

  const live = applyClaudeRegistryStatus(summary({ state: "editing", detail: "Editing claude.ts", isOngoing: true }), entry("busy"), DONE_WINDOW_MS);
  assert.equal(live.state, "editing");
  assert.equal(live.detail, "Editing claude.ts");
});

test("idle registry status settles a stale mid-work transcript tail", () => {
  const result = applyClaudeRegistryStatus(
    summary({ state: "running", isOngoing: true, updatedAt: new Date(Date.now() - 30 * 1000).toISOString() }),
    entry("idle"),
    DONE_WINDOW_MS
  );
  assert.equal(result.state, "done");
  assert.equal(result.isOngoing, false);
});

test("waiting registry status surfaces a read-only needs-user wait", () => {
  const result = applyClaudeRegistryStatus(summary(), entry("waiting", { waitingFor: "input needed" }), DONE_WINDOW_MS);
  assert.equal(result.state, "waiting");
  assert.equal(result.needsUser.kind, "input");
  assert.equal(result.needsUser.requestId, "claude-registry:s1");
  const approval = applyClaudeRegistryStatus(summary(), entry("waiting", { waitingFor: "sandbox request" }), DONE_WINDOW_MS);
  assert.equal(approval.needsUser.kind, "approval");
});

test("injected user records are not treated as human prompts", () => {
  assert.equal(isClaudeHumanUserRecord({ type: "user", origin: { kind: "human" } }), true);
  assert.equal(isClaudeHumanUserRecord({ type: "user" }), true);
  assert.equal(isClaudeHumanUserRecord({ type: "user", isMeta: true }), false);
  assert.equal(isClaudeHumanUserRecord({ type: "user", origin: { kind: "task-notification" } }), false);
  assert.equal(isClaudeHumanUserRecord({ type: "user", origin: { kind: "peer" } }), false);
  assert.equal(isSyntheticClaudeUserText("<task-notification><task-id>b1</task-id></task-notification>"), true);
  assert.equal(isSyntheticClaudeUserText("[Request interrupted by user for tool use]"), true);
  assert.equal(isSyntheticClaudeUserText("Fix the seating bug"), false);
});

test("session titles prefer custom-title, then agent-name, then ai-title", () => {
  assert.equal(extractClaudeSessionTitle([
    { type: "ai-title", aiTitle: "Generated" },
    { type: "agent-name", agentName: "seating-audit" },
    { type: "custom-title", customTitle: "Seating audit" }
  ]), "Seating audit");
  assert.equal(extractClaudeSessionTitle([
    { type: "ai-title", aiTitle: "Generated" },
    { type: "agent-name", agentName: "seating-audit" }
  ]), "seating-audit");
  assert.equal(extractClaudeSessionTitle([{ type: "ai-title", aiTitle: "Generated" }]), "Generated");
});

test("SDK session listing receives host-native project paths", () => {
  const options = claudeSdkSessionListOptions("/mnt/f/AI/CodexAgentsOffice", 5);
  if (process.platform === "win32") {
    assert.equal(options.dir, "F:\\AI\\CodexAgentsOffice");
  } else {
    assert.equal(options.dir, "/mnt/f/AI/CodexAgentsOffice");
  }
});
