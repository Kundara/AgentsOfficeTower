const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDashboardEventFromAppServerMessage,
  extractCollabReceiverThreadIds,
  isClientStateOnlyAppServerNotification,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
} = require("../dist/live-monitor.js");
const { summariseThread } = require("../dist/snapshot.js");
const { turnHasOpenWorkSignal, turnHasFinalAnswer, turnHasNonFinalWorkSignal } = require("../dist/domain/codex-turn-semantics.js");

const PROJECT = { projectRoot: "/tmp/CodexAgentsOffice" };

function thread(turn, overrides = {}) {
  return {
    id: "thr_v2",
    preview: "Fix tests",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: Math.floor(Date.now() / 1000) - 60,
    updatedAt: Math.floor(Date.now() / 1000) - 5,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp/CodexAgentsOffice",
    cliVersion: "0.163.0",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [{ id: "turn_1", error: null, ...turn }],
    ...overrides
  };
}

function itemEvent(method, item) {
  return buildDashboardEventFromAppServerMessage(PROJECT, {
    method,
    params: { threadId: "thr_v2", turnId: "turn_1", item }
  });
}

test("v2 userMessage content[] text becomes the prompt detail", () => {
  const summary = summariseThread(thread({
    status: "inProgress",
    items: [{ type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "Refactor the seating policy" }] }]
  }));
  assert.equal(summary.state, "planning");
  assert.equal(summary.detail, "Refactor the seating policy");
});

test("v2 reasoning summary arrays surface the latest summary line", () => {
  const summary = summariseThread(thread({
    status: "inProgress",
    items: [{ type: "reasoning", id: "r1", summary: ["Reading files", "Comparing seat rules"], content: [] }]
  }));
  assert.equal(summary.state, "thinking");
  assert.equal(summary.detail, "Comparing seat rules");

  const event = itemEvent("item/completed", { type: "reasoning", id: "r1", summary: ["Reading files", "Comparing seat rules"], content: [] });
  assert.equal(event.detail, "Comparing seat rules");
});

test("partial_answer is non-final and keeps the turn open for release rules", () => {
  const turn = { id: "t", status: "completed", error: null, items: [{ type: "agentMessage", text: "Half way", phase: "partial_answer" }] };
  assert.equal(turnHasFinalAnswer(turn), false);
  assert.equal(turnHasNonFinalWorkSignal(turn), true);
});

test("status-less items are work evidence but do not hold a settled turn open", () => {
  for (const type of ["reasoning", "plan", "webSearch", "sleep", "imageView"]) {
    const turn = { id: "t", status: "completed", error: null, items: [{ type }] };
    assert.equal(turnHasOpenWorkSignal(turn), false, type);
    assert.equal(turnHasNonFinalWorkSignal(turn), true, type);
  }
  assert.equal(turnHasOpenWorkSignal({ id: "t", status: "completed", error: null, items: [{ type: "imageGeneration", status: "generating" }] }), true);
  assert.equal(turnHasOpenWorkSignal({ id: "t", status: "completed", error: null, items: [{ type: "collabAgentToolCall", status: "interrupted" }] }), false);
});

test("subAgentActivity items delegate and wake only started or messaged children", () => {
  const summary = summariseThread(thread({
    status: "inProgress",
    items: [{ type: "subAgentActivity", id: "s1", kind: "started", agentThreadId: "thr_child", agentPath: "root/explorer", model: null, reasoningEffort: null }]
  }));
  assert.equal(summary.state, "delegating");
  assert.equal(summary.detail, "Started explorer");

  const started = { method: "item/started", params: { threadId: "thr_v2", item: { type: "subAgentActivity", kind: "started", agentThreadId: "thr_child", agentPath: "root/explorer" } } };
  const completed = { method: "item/completed", params: { threadId: "thr_v2", item: { type: "subAgentActivity", kind: "completed", agentThreadId: "thr_child", agentPath: "root/explorer" } } };
  assert.deepEqual(extractCollabReceiverThreadIds(started), ["thr_child"]);
  assert.deepEqual(extractCollabReceiverThreadIds(completed), []);

  const event = itemEvent("item/completed", completed.params.item);
  assert.equal(event.kind, "subagent");
  assert.equal(event.title, "Subagent finished");
});

test("imageGeneration items read as image creation with the saved path", () => {
  const inProgress = summariseThread(thread({
    status: "inProgress",
    items: [{ type: "imageGeneration", id: "g1", status: "generating", revisedPrompt: "pixel desk", result: "", failure: null }]
  }));
  assert.equal(inProgress.state, "editing");
  assert.match(inProgress.detail, /Generating image: pixel desk/);

  const event = itemEvent("item/completed", { type: "imageGeneration", id: "g1", status: "completed", revisedPrompt: "pixel desk", result: "", failure: null, savedPath: "/tmp/CodexAgentsOffice/out.png" });
  assert.equal(event.kind, "fileChange");
  assert.equal(event.action, "created");
  assert.equal(event.isImage, true);
  assert.equal(event.path, "/tmp/CodexAgentsOffice/out.png");
});

test("sleep, functionCallOutput, and hookPrompt items get typed summaries", () => {
  const sleeping = summariseThread(thread({ status: "inProgress", items: [{ type: "sleep", id: "z", durationMs: 30000 }] }));
  assert.equal(sleeping.state, "running");
  assert.equal(sleeping.detail, "Sleeping 30s");

  const tool = itemEvent("item/completed", { type: "functionCallOutput", id: "f", name: "read", namespace: "fs", output: "ok" });
  assert.equal(tool.kind, "tool");
  assert.equal(tool.detail, "fs.read");

  const hook = itemEvent("item/started", { type: "hookPrompt", id: "h", fragments: [{ text: "Run lint first", hookRunId: "run" }] });
  assert.equal(hook.title, "Hook prompt");
  assert.equal(hook.detail, "Run lint first");
});

test("async agent questions surface as waiting once the turn settles", () => {
  const summary = summariseThread(thread({
    status: "completed",
    items: [{
      type: "agentMessage",
      id: "m",
      text: "Need a decision",
      phase: "final_answer",
      delivery: "async",
      questions: [{ title: "Ship the migration now?", options: ["Yes", "No"] }]
    }]
  }));
  assert.equal(summary.state, "waiting");
  assert.equal(summary.detail, "Asked: Ship the migration now?");
});

test("new collab tools have readable details and interrupted calls settle", () => {
  const summary = summariseThread(thread({
    status: "completed",
    items: [{ type: "collabAgentToolCall", id: "c", tool: "interruptAgent", status: "interrupted", senderThreadId: "thr_v2", receiverThreadIds: ["a"], agentsStates: {} }]
  }));
  assert.equal(summary.state, "done");
  assert.equal(summary.detail, "Interrupting subagent");
});

test("client-state notifications are ignored and new live signals keep threads live", () => {
  for (const method of [
    "thread/readState/changed",
    "thread/attachment/updated",
    "thread/prediction/updated",
    "thread/queue/changed",
    "thread/project/updated",
    "account/gatewayOAuth/changed",
    "mcpServer/event/stream/notification",
    "thread/realtime/item/started"
  ]) {
    assert.equal(isClientStateOnlyAppServerNotification(method), true, method);
  }
  assert.equal(isClientStateOnlyAppServerNotification("thread/reverted"), false);
  assert.equal(shouldMarkThreadLiveFromAppServerNotification("autoApprovalReview/strictReviewRequired"), true);
  assert.equal(shouldMarkThreadLiveFromAppServerNotification("modelProvider/authRecoveryStarted"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/reverted"), false);

  const reverted = buildDashboardEventFromAppServerMessage(PROJECT, { method: "thread/reverted", params: { threadId: "thr_v2" } });
  assert.equal(reverted.title, "Thread reverted");
  const recovery = buildDashboardEventFromAppServerMessage(PROJECT, {
    method: "modelProvider/authRecoveryStarted",
    params: { threadId: "thr_v2", turnId: "turn_1", provider: "openai", message: "Refreshing token" }
  });
  assert.equal(recovery.detail, "openai: Refreshing token");
});

const { unwrapShellCommand } = require("../dist/utils/text.js");
const { CodexAppServerClient } = require("../dist/app-server.js");

test("Windows PowerShell and POSIX shell wrappers unwrap to the agent's script", () => {
  const ps = String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command '$p='"'"'Assets/a.xml'"'"'; Get-Content $p'`;
  assert.equal(unwrapShellCommand(ps), "$p='Assets/a.xml'; Get-Content $p");
  // Codex also concatenates double-quoted segments inside the word.
  const mixed = String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command '$p='"'Assets/b.xml'; "'$s=1'`;
  assert.equal(unwrapShellCommand(mixed), "$p='Assets/b.xml'; $s=1");
  assert.equal(unwrapShellCommand("bash -lc 'npm test -- --watch=false'"), "npm test -- --watch=false");
  assert.equal(unwrapShellCommand(String.raw`"C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -Command "rg -n foo"`), "rg -n foo");
  assert.equal(unwrapShellCommand("npm run build"), "npm run build");
  assert.equal(unwrapShellCommand("node -c script.js"), "node -c script.js");
});

test("command summaries and events show unwrapped Windows commands", () => {
  const raw = String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command 'npm test'`;
  const summary = summariseThread(thread({ status: "inProgress", items: [{ type: "commandExecution", id: "c", command: raw, cwd: "/tmp/CodexAgentsOffice", status: "inProgress" }] }));
  assert.equal(summary.detail, "npm test");
  assert.equal(summary.state, "validating");
  const event = itemEvent("item/started", { type: "commandExecution", id: "c", command: raw, cwd: "/tmp/CodexAgentsOffice", status: "inProgress" });
  assert.equal(event.command, "npm test");
});

test("a completed turn with a final answer does not stay blocked on an earlier failed command", () => {
  const summary = summariseThread(thread({
    status: "completed",
    items: [
      { type: "commandExecution", id: "c1", command: "rg missing", cwd: "/tmp/CodexAgentsOffice", status: "failed", exitCode: 1 },
      { type: "agentMessage", id: "m", text: "Review complete: no blocking issues.", phase: "final_answer" }
    ]
  }));
  assert.equal(summary.state, "done");

  const stillRunning = summariseThread(thread({
    status: "inProgress",
    items: [{ type: "commandExecution", id: "c1", command: "npm test", cwd: "/tmp/CodexAgentsOffice", status: "failed", exitCode: 1 }]
  }));
  assert.equal(stillRunning.state, "blocked");
});

test("cwd-scoped thread/list reads the state DB while unscoped discovery keeps repair scans", async () => {
  const requests = [];
  const client = Object.create(CodexAppServerClient.prototype);
  client.request = async (method, params) => {
    requests.push({ method, params });
    return { data: [] };
  };
  await client.listThreads({ cwd: "/tmp/CodexAgentsOffice", limit: 5 });
  await client.listThreads({ limit: 5 });
  assert.equal(requests[0].params.useStateDbOnly, true);
  assert.equal("useStateDbOnly" in requests[1].params, false);
});

test("project/list registry entries keep only well-formed projects with roots", async () => {
  const client = Object.create(CodexAppServerClient.prototype);
  client.request = async () => ({
    data: [
      { id: "p1", name: "PartyGame", roots: [{ path: "F:/Unity/OopsGame" }], updatedAt: 10 },
      { id: "p2", name: "Empty", roots: [] },
      { name: "No id", roots: [{ path: "F:/x" }] }
    ]
  });
  const projects = await client.listProjects();
  assert.deepEqual(projects, [{ id: "p1", name: "PartyGame", roots: ["F:/Unity/OopsGame"], updatedAt: 10 }]);
});
