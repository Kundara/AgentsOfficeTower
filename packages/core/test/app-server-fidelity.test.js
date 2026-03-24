const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAppServerMessage } = require("../dist/app-server.js");
const {
  buildDashboardEventFromAppServerMessage,
  buildRolloutHookEvent,
  buildThreadReadAgentMessageEvent,
  parseApplyPatchInput,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
} = require("../dist/live-monitor.js");
const { buildDashboardSnapshotFromState } = require("../dist/snapshot.js");
const { isCurrentWorkloadAgent } = require("../dist/workload.js");

function sampleThread() {
  return {
    id: "thr_123",
    preview: "Fix tests",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1730831111,
    updatedAt: 1730832111,
    status: { type: "active", activeFlags: [] },
    path: "/tmp/thread.jsonl",
    cwd: "/mnt/f/AI/CodexAgentsOffice",
    cliVersion: "0.0.0",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Fix tests",
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "commandExecution",
            command: "npm test",
            cwd: "/mnt/f/AI/CodexAgentsOffice",
            status: "inProgress"
          }
        ]
      }
    ]
  };
}

test("parseAppServerMessage distinguishes response, notification, and server request", () => {
  assert.deepEqual(
    parseAppServerMessage(JSON.stringify({ id: 1, result: { ok: true } })),
    { kind: "response", message: { id: 1, result: { ok: true }, error: undefined } }
  );

  assert.deepEqual(
    parseAppServerMessage(JSON.stringify({ method: "turn/started", params: { threadId: "thr_1" } })),
    { kind: "notification", message: { method: "turn/started", params: { threadId: "thr_1" } } }
  );

  assert.deepEqual(
    parseAppServerMessage(JSON.stringify({ id: 7, method: "item/tool/requestUserInput", params: { threadId: "thr_1" } })),
    { kind: "serverRequest", message: { id: 7, method: "item/tool/requestUserInput", params: { threadId: "thr_1" } } }
  );
});

test("command approval requests become typed approval events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/mnt/f/AI/CodexAgentsOffice" },
    {
      id: 41,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_cmd",
        command: "npm publish",
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        reason: "needs publish access",
        availableDecisions: ["accept", "decline"]
      }
    }
  );

  assert.equal(event.kind, "approval");
  assert.equal(event.phase, "waiting");
  assert.equal(event.requestId, "41");
  assert.equal(event.itemId, "item_cmd");
  assert.equal(event.command, "npm publish");
  assert.equal(event.cwd, "/mnt/f/AI/CodexAgentsOffice");
  assert.deepEqual(event.availableDecisions, ["accept", "decline"]);
});

test("file change completion events keep final file metadata", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/mnt/f/AI/CodexAgentsOffice" },
    {
      method: "item/completed",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        item: {
          id: "item_file",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "/mnt/f/AI/CodexAgentsOffice/packages/core/src/live-monitor.ts",
              kind: "edit",
              linesAdded: 12,
              linesRemoved: 4
            }
          ]
        }
      }
    }
  );

  assert.equal(event.kind, "fileChange");
  assert.equal(event.phase, "completed");
  assert.equal(event.itemId, "item_file");
  assert.equal(event.action, "edited");
  assert.equal(event.linesAdded, 12);
  assert.equal(event.linesRemoved, 4);
  assert.match(event.path, /packages\/core\/src\/live-monitor\.ts$/);
});

test("resolved requests clear as completed events when pending request context is provided", () => {
  const event = buildDashboardEventFromAppServerMessage(
    {
      projectRoot: "/mnt/f/AI/CodexAgentsOffice",
      pendingRequest: {
        kind: "input",
        requestId: "55",
        threadId: "thr_123",
        createdAt: new Date().toISOString(),
        turnId: "turn_9",
        itemId: "item_prompt",
        reason: "Need confirmation"
      }
    },
    {
      method: "serverRequest/resolved",
      params: {
        threadId: "thr_123",
        requestId: "55"
      }
    }
  );

  assert.equal(event.kind, "input");
  assert.equal(event.phase, "completed");
  assert.equal(event.requestId, "55");
  assert.equal(event.title, "Input resolved");
});

test("observer unload notifications do not masquerade as thread completion", () => {
  assert.equal(shouldMarkThreadLiveFromAppServerNotification("thread/status/changed", "active"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("turn/completed"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/archived"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/closed"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/status/changed", "idle"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/status/changed", "notLoaded"), false);
});

test("tool call server requests become typed tool events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/mnt/f/AI/CodexAgentsOffice" },
    {
      id: 72,
      method: "item/tool/call",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_tool",
        tool: "browser_snapshot"
      }
    }
  );

  assert.equal(event.kind, "tool");
  assert.equal(event.phase, "started");
  assert.equal(event.requestId, "72");
  assert.equal(event.itemId, "item_tool");
  assert.equal(event.title, "MCP tool call");
  assert.equal(event.detail, "browser_snapshot");
});

test("thread rereads synthesize assistant message events for desktop replies", () => {
  const thread = {
    ...sampleThread(),
    updatedAt: 1730832999,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_msg_1",
            type: "agentMessage",
            phase: "commentary",
            text: "Preview bridge reply from the desktop thread."
          }
        ]
      }
    ]
  };

  const event = buildThreadReadAgentMessageEvent(
    { projectRoot: "/mnt/f/AI/CodexAgentsOffice" },
    thread
  );

  assert.ok(event);
  assert.equal(event.kind, "message");
  assert.equal(event.method, "item/agentMessage/delta");
  assert.equal(event.threadId, "thr_123");
  assert.equal(event.itemId, "item_msg_1");
  assert.equal(event.confidence, "inferred");
  assert.equal(event.detail, "Preview bridge reply from the desktop thread.");
});

test("snapshot carries typed needs-user and live subscription metadata", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [sampleThread()],
    events: [],
    needsUserByThreadId: new Map([
      ["thr_123", { kind: "approval", requestId: "88", reason: "Need approval" }]
    ]),
    subscribedThreadIds: new Set(["thr_123"])
  });

  assert.equal(snapshot.agents.length >= 1, true);
  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.deepEqual(agent.needsUser, { kind: "approval", requestId: "88", reason: "Need approval" });
  assert.equal(agent.liveSubscription, "subscribed");
});

test("fresh local thinking agents do not remain current without an ongoing turn", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_live",
    label: "Live worker",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "thinking",
    detail: "Reply updated",
    cwd: "/mnt/f/Unity/ChickenCoop",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:45.000Z",
    stoppedAt: null,
    paths: ["/mnt/f/Unity/ChickenCoop"],
    activityEvent: null,
    latestMessage: "Still working",
    threadId: "thr_live",
    taskId: null,
    resumeCommand: "codex resume thr_live",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("active local threads remain current even when the last update is stale", async () => {
  const staleThread = {
    ...sampleThread(),
    updatedAt: 1,
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "reasoning",
            text: "Still working"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [staleThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.statusText, "active");
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("notLoaded threads with an in-progress turn remain current", async () => {
  const activeButNotLoadedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: 1,
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "reasoning",
            text: "Still working from a read-only thread payload"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [activeButNotLoadedThread],
    events: [],
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.statusText, "notLoaded");
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isOngoing, true);
  assert.equal(agent.isCurrent, true);
});

test("recently finished local threads stay current for a short grace window", async () => {
  const recentDoneThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 2000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up the change.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [recentDoneThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, true);
});

test("explicit stop tracking keeps an ongoing quiet thread current", async () => {
  const ongoingQuietThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up this step, staying on thread.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [ongoingQuietThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set(["thr_123"])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.stoppedAt, null);
  assert.equal(agent.isCurrent, true);
});

test("quiet local threads without ongoing tracking are not kept current forever", async () => {
  const quietThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Done.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [quietThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.isOngoing, false);
  assert.equal(agent.isCurrent, false);
});

test("explicitly stopped threads leave only after the stop grace window", async () => {
  const stoppedThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 60_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Done.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [stoppedThread],
    events: [],
    stoppedAtByThreadId: new Map([["thr_123", Date.now() - 6_000]])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.notEqual(agent.stoppedAt, null);
  assert.equal(agent.isCurrent, false);
});

test("parseApplyPatchInput extracts file path and line deltas from apply_patch input", () => {
  const parsed = parseApplyPatchInput([
    "*** Begin Patch",
    "*** Update File: /mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts",
    "@@",
    "-const VALUE = 1;",
    "+const VALUE = 2;",
    "*** End Patch"
  ].join("\n"));

  assert.deepEqual(parsed, {
    path: "/mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts",
    action: "edited",
    title: "File edited",
    linesAdded: 1,
    linesRemoved: 1
  });
});

test("rollout apply_patch hooks become file-change events", () => {
  const event = buildRolloutHookEvent("/mnt/f/AI/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:00.000Z",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      status: "completed",
      call_id: "call_123",
      input: [
        "*** Begin Patch",
        "*** Update File: /mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts",
        "@@",
        "-const VALUE = 1;",
        "+const VALUE = 2;",
        "*** End Patch"
      ].join("\n")
    }
  });

  assert.ok(event);
  assert.equal(event.kind, "fileChange");
  assert.equal(event.phase, "completed");
  assert.equal(event.itemId, "call_123");
  assert.equal(event.path, "/mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts");
  assert.equal(event.linesAdded, 1);
  assert.equal(event.linesRemoved, 1);
});

test("rollout exec_command hooks become command events", () => {
  const pendingCommands = new Map();
  const started = buildRolloutHookEvent("/mnt/f/AI/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:00.000Z",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "call_cmd_123",
      arguments: JSON.stringify({
        cmd: "git status --short README.md",
        workdir: "/mnt/f/AI/CodexAgentsOffice"
      })
    }
  }, pendingCommands);

  const completed = buildRolloutHookEvent("/mnt/f/AI/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:01.000Z",
    payload: {
      type: "function_call_output",
      call_id: "call_cmd_123",
      output: "Command: /bin/bash -lc 'git status --short README.md'\nProcess exited with code 0\n"
    }
  }, pendingCommands);

  assert.ok(started);
  assert.equal(started.kind, "command");
  assert.equal(started.phase, "started");
  assert.equal(started.command, "git status --short README.md");
  assert.equal(started.title, "Command started");

  assert.ok(completed);
  assert.equal(completed.kind, "command");
  assert.equal(completed.phase, "completed");
  assert.equal(completed.command, "git status --short README.md");
  assert.equal(completed.title, "Command completed");
});

test("snapshot prefers recent file-change events over trailing summary messages", async () => {
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(Date.parse("2026-03-23T19:00:10.000Z") / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            id: "item_msg",
            text: "Patched the file and wrapped up.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/mnt/f/AI/CodexAgentsOffice",
    threads: [thread],
    events: [
      {
        id: "event_file",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: "2026-03-23T19:00:09.000Z",
        method: "rollout/apply_patch/completed",
        itemId: "call_123",
        kind: "fileChange",
        phase: "completed",
        title: "File edited",
        detail: "/mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts",
        path: "/mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts",
        action: "edited",
        linesAdded: 1,
        linesRemoved: 1
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.activityEvent.type, "fileChange");
  assert.equal(agent.activityEvent.path, "/mnt/f/AI/CodexAgentsOffice/packages/core/src/snapshot.ts");
  assert.match(agent.detail, /Edited .*snapshot\.ts$/);
});
