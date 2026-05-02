const test = require("node:test");
const assert = require("node:assert/strict");

const { appServerCwdParam, CodexAppServerClient, parseAppServerMessage } = require("../dist/app-server.js");
const {
  buildDashboardEventFromAppServerMessage,
  buildRolloutHookEvent,
  buildThreadReadAgentMessageEvent,
  parseApplyPatchInput,
  ProjectLiveMonitor,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
} = require("../dist/live-monitor.js");
const {
  applyRecentActivityEvent,
  buildDashboardSnapshotFromState,
  inferThreadAgentRole,
  parentThreadIdForThread,
  parseThreadSourceMeta,
  pickThreadLabel,
  summariseThread
} = require("../dist/snapshot.js");
const { applyCurrentWorkloadState, isCurrentWorkloadAgent } = require("../dist/workload.js");
const {
  buildCodexLocalAdapterSnapshotFromState,
  selectProjectThreadsWithParents
} = require("../dist/adapters/codex-local.js");

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
    cwd: "/tmp/CodexAgentsOffice",
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
            cwd: "/tmp/CodexAgentsOffice",
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

test("app-server cwd filters use Windows paths for Windows-backed WSL project roots", () => {
  assert.equal(
    appServerCwdParam("/mnt/c/Users/User/AgentsOfficeTower"),
    process.platform === "win32"
      ? "C:\\Users\\User\\AgentsOfficeTower"
      : "/mnt/c/Users/User/AgentsOfficeTower"
  );
});

test("thread/list requests current workload ordering explicitly", async () => {
  const requests = [];
  const client = Object.create(CodexAppServerClient.prototype);
  client.request = async (method, params) => {
    requests.push({ method, params });
    return { data: [] };
  };

  await client.listThreads({ cwd: "/tmp/CodexAgentsOffice", limit: 5 });

  assert.equal(requests[0].method, "thread/list");
  assert.equal(requests[0].params.sortKey, "updated_at");
  assert.equal(requests[0].params.sortDirection, "desc");
  assert.equal(requests[0].params.limit, 5);
});

test("command approval requests become typed approval events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      id: 41,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_cmd",
        command: "npm publish",
        cwd: "/tmp/CodexAgentsOffice",
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
  assert.equal(event.cwd, "/tmp/CodexAgentsOffice");
  assert.deepEqual(event.availableDecisions, ["accept", "decline"]);
});

test("approval responses use the current app-server response envelope", async () => {
  const sent = [];
  const client = Object.create(CodexAppServerClient.prototype);
  client.send = (payload) => {
    sent.push(payload);
  };
  client.respondToApprovalRequest(41, "accept");
  assert.deepEqual(sent, [{ id: 41, result: { decision: "accept" } }]);
});

test("monitor routes command approval decisions through the app-server approval helper", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const capturedResponses = [];

  monitor.client = {
    respondToApprovalRequest(requestId, decision) {
      capturedResponses.push({ requestId, decision });
    }
  };
  monitor.threads.set("thr_123", {
    ...sampleThread(),
    id: "thr_123",
    cwd: "/tmp/CodexAgentsOffice"
  });
  monitor.scheduleThreadRefresh = () => {};
  monitor.rebuildSnapshot = async () => {};

  monitor.handleAppServerServerRequest({
    id: 41,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thr_123",
      turnId: "turn_9",
      itemId: "item_cmd",
      command: "npm publish",
      cwd: "/tmp/CodexAgentsOffice",
      reason: "needs publish access"
    }
  });

  await monitor.respondToApprovalRequest("41", "accept");

  assert.deepEqual(capturedResponses, [
    {
      requestId: 41,
      decision: "accept"
    }
  ]);
});

test("turn replies send Codex UserInput text_elements required by current app-server", async () => {
  const capturedRequests = [];
  const client = Object.create(CodexAppServerClient.prototype);
  client.request = async (method, params) => {
    capturedRequests.push({ method, params });
    return method === "turn/start"
      ? { turn: { id: "turn_123", status: "inProgress", items: [], error: null } }
      : { turnId: "turn_123" };
  };

  await client.startTurn("thr_123", "Follow up", "/tmp/CodexAgentsOffice");
  await client.steerTurn("thr_123", "turn_123", "Nudge");

  assert.deepEqual(capturedRequests, [
    {
      method: "turn/start",
      params: {
        threadId: "thr_123",
        input: [{ type: "text", text: "Follow up", text_elements: [] }],
        cwd: "/tmp/CodexAgentsOffice"
      }
    },
    {
      method: "turn/steer",
      params: {
        threadId: "thr_123",
        input: [{ type: "text", text: "Nudge", text_elements: [] }],
        expectedTurnId: "turn_123"
      }
    }
  ]);
});

test("turn replies can dispatch without waiting for slow app-server turn responses", () => {
  const capturedFrames = [];
  const client = Object.create(CodexAppServerClient.prototype);
  client.nextId = 11;
  client.send = (payload) => {
    capturedFrames.push(payload);
  };

  assert.equal(client.startTurnNoWait("thr_123", "Follow up", "/tmp/CodexAgentsOffice"), 11);
  assert.equal(client.steerTurnNoWait("thr_123", "turn_123", "Nudge"), 12);

  assert.deepEqual(capturedFrames, [
    {
      id: 11,
      method: "turn/start",
      params: {
        threadId: "thr_123",
        input: [{ type: "text", text: "Follow up", text_elements: [] }],
        cwd: "/tmp/CodexAgentsOffice"
      }
    },
    {
      id: 12,
      method: "turn/steer",
      params: {
        threadId: "thr_123",
        input: [{ type: "text", text: "Nudge", text_elements: [] }],
        expectedTurnId: "turn_123"
      }
    }
  ]);
});

test("thread replies hydrate active listed threads before steering", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const listedThread = {
    ...sampleThread(),
    id: "thr_active",
    source: "appServer",
    status: { type: "active", activeFlags: [] },
    turns: []
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        items: []
      }
    ]
  };
  const capturedCalls = [];
  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async (threadId) => {
      capturedCalls.push(["readThread", threadId]);
      return hydratedThread;
    },
    steerTurnNoWait: (threadId, turnId, text) => {
      capturedCalls.push(["steerTurnNoWait", threadId, turnId, text]);
    },
    startTurnNoWait: () => {
      capturedCalls.push(["startTurnNoWait"]);
      throw new Error("startTurnNoWait should not run for an active thread");
    }
  };

  await monitor.sendThreadReply(listedThread.id, "Keep going");

  assert.deepEqual(capturedCalls.slice(0, 2), [
    ["readThread", listedThread.id],
    ["steerTurnNoWait", listedThread.id, "turn_live", "Keep going"]
  ]);
  assert.equal(capturedCalls.some(([method]) => method === "startTurnNoWait"), false);
});

test("thread replies refuse to start detached turns for active threads without a steerable turn", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const activeThread = {
    ...sampleThread(),
    id: "thr_active",
    source: "appServer",
    status: { type: "active", activeFlags: [] },
    turns: []
  };
  const capturedCalls = [];
  monitor.threads.set(activeThread.id, activeThread);
  monitor.client = {
    readThread: async (threadId) => {
      capturedCalls.push(["readThread", threadId]);
      return activeThread;
    },
    steerTurnNoWait: () => {
      capturedCalls.push(["steerTurnNoWait"]);
    },
    startTurnNoWait: () => {
      capturedCalls.push(["startTurnNoWait"]);
    }
  };

  await assert.rejects(
    () => monitor.sendThreadReply(activeThread.id, "Do not split this thread"),
    /no steerable turn/
  );
  assert.deepEqual(capturedCalls, [["readThread", activeThread.id]]);
});

test("thread replies start idle app-server-owned threads without waiting for a slow turn response", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const observedThread = {
    ...sampleThread(),
    id: "thr_app_server_idle",
    source: "appServer",
    status: { type: "idle" },
    turns: []
  };
  const capturedCalls = [];
  monitor.threads.set(observedThread.id, observedThread);
  monitor.client = {
    readThread: async () => {
      capturedCalls.push(["readThread"]);
      throw new Error("readThread should not run for a loaded idle thread");
    },
    steerTurnNoWait: () => capturedCalls.push(["steerTurnNoWait"]),
    startTurnNoWait: (threadId, text, cwd) => capturedCalls.push(["startTurnNoWait", threadId, text, cwd])
  };

  await monitor.sendThreadReply(observedThread.id, "Start this idle thread");

  assert.deepEqual(capturedCalls, [
    ["startTurnNoWait", observedThread.id, "Start this idle thread", observedThread.cwd]
  ]);
});

test("thread replies reject observed desktop threads instead of creating side turns", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const observedThread = {
    ...sampleThread(),
    id: "thr_desktop",
    source: "vscode",
    status: { type: "idle" },
    turns: []
  };
  const capturedCalls = [];
  monitor.threads.set(observedThread.id, observedThread);
  monitor.client = {
    readThread: async () => {
      capturedCalls.push(["readThread"]);
      throw new Error("readThread should not run for a loaded observed thread");
    },
    steerTurnNoWait: () => capturedCalls.push(["steerTurnNoWait"]),
    startTurnNoWait: () => capturedCalls.push(["startTurnNoWait"])
  };

  await assert.rejects(
    () => monitor.sendThreadReply(observedThread.id, "This should stay in Codex desktop"),
    /app-server-owned threads/
  );
  assert.deepEqual(capturedCalls, []);
});

test("turn started notifications keep active reply steering attached to the live turn", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const activeThread = {
    ...sampleThread(),
    id: "thr_active",
    source: "appServer",
    status: { type: "active", activeFlags: [] },
    turns: []
  };
  const capturedCalls = [];
  monitor.threads.set(activeThread.id, activeThread);
  monitor.handleAppServerNotification({
    method: "turn/started",
    params: {
      threadId: activeThread.id,
      turn: {
        id: "turn_live",
        status: "inProgress",
        error: null,
        items: []
      }
    }
  });
  monitor.client = {
    readThread: async () => {
      capturedCalls.push(["readThread"]);
      throw new Error("readThread should not be needed after turn/started");
    },
    steerTurnNoWait: (threadId, turnId, text) => {
      capturedCalls.push(["steerTurnNoWait", threadId, turnId, text]);
    },
    startTurnNoWait: () => {
      capturedCalls.push(["startTurnNoWait"]);
      throw new Error("startTurnNoWait should not run for an active thread");
    }
  };

  await monitor.sendThreadReply(activeThread.id, "Nudge the live turn");

  assert.deepEqual(capturedCalls, [
    ["steerTurnNoWait", activeThread.id, "turn_live", "Nudge the live turn"]
  ]);
});

test("file change completion events keep final file metadata", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
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
              path: "/tmp/CodexAgentsOffice/packages/core/src/live-monitor.ts",
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
  assert.equal(event.title, "File edited");
  assert.equal(event.itemId, "item_file");
  assert.equal(event.action, "edited");
  assert.equal(event.linesAdded, 12);
  assert.equal(event.linesRemoved, 4);
  assert.match(event.path, /packages\/core\/src\/live-monitor\.ts$/);
});

test("agent message deltas become typed streaming message events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        itemId: "item_msg",
        delta: "Checking the live snapshot."
      }
    }
  );

  assert.equal(event.kind, "message");
  assert.equal(event.phase, "updated");
  assert.equal(event.itemId, "item_msg");
  assert.equal(event.title, "Reply updated");
  assert.equal(event.detail, "Checking the live snapshot.");
});

test("resolved requests clear as completed events when pending request context is provided", () => {
  const event = buildDashboardEventFromAppServerMessage(
    {
      projectRoot: "/tmp/CodexAgentsOffice",
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

test("requestUserInput server requests preserve typed questions and allow optional answers to be omitted", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const capturedResponses = [];
  const scheduledThreadRefreshes = [];

  monitor.client = {
    respondToToolRequestUserInput(requestId, response) {
      capturedResponses.push({ requestId, response });
    }
  };
  monitor.threads.set("thr_123", {
    ...sampleThread(),
    id: "thr_123",
    cwd: "/tmp/CodexAgentsOffice"
  });
  monitor.scheduleThreadRefresh = (threadId) => {
    scheduledThreadRefreshes.push(threadId);
  };
  monitor.rebuildSnapshot = async () => {};

  monitor.handleAppServerServerRequest({
    id: 77,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thr_123",
      turnId: "turn_9",
      itemId: "item_prompt",
      questions: [
        {
          header: "Mode",
          id: "mode",
          question: "Choose a mode",
          options: [
            { label: "Fast", description: "Finish quickly" },
            { label: "Safe", description: "Take the safer path" }
          ]
        },
        {
          header: "Notes",
          id: "notes",
          question: "Add any extra context",
          required: false,
          isOther: true,
          options: null
        }
      ]
    }
  });

  const pending = monitor.pendingUserRequests.get("77");
  assert.equal(pending.kind, "input");
  assert.equal(pending.questions.length, 2);
  assert.equal(pending.questions[0].header, "Mode");
  assert.equal(pending.questions[0].options[0].label, "Fast");
  assert.equal(pending.questions[1].required, false);
  assert.equal(pending.questions[1].isOther, true);

  await monitor.respondToInputRequest("77", {
    mode: { answers: ["Fast"] }
  });

  assert.deepEqual(capturedResponses, [
    {
      requestId: 77,
      response: {
        answers: {
          mode: { answers: ["Fast"] }
        }
      }
    }
  ]);
  assert.deepEqual(scheduledThreadRefreshes, ["thr_123", "thr_123"]);
  assert.equal(monitor.pendingUserRequests.has("77"), false);
});

test("requestUserInput accepts an empty answer payload when every question is optional", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const capturedResponses = [];

  monitor.client = {
    respondToToolRequestUserInput(requestId, response) {
      capturedResponses.push({ requestId, response });
    }
  };
  monitor.threads.set("thr_123", {
    ...sampleThread(),
    id: "thr_123",
    cwd: "/tmp/CodexAgentsOffice"
  });
  monitor.scheduleThreadRefresh = () => {};
  monitor.rebuildSnapshot = async () => {};

  monitor.handleAppServerServerRequest({
    id: 78,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thr_123",
      turnId: "turn_10",
      itemId: "item_prompt_optional",
      questions: [
        {
          header: "Notes",
          id: "notes",
          question: "Add any extra context",
          required: false,
          isOther: true,
          options: null
        }
      ]
    }
  });

  await monitor.respondToInputRequest("78", {});

  assert.deepEqual(capturedResponses, [
    {
      requestId: 78,
      response: {
        answers: {}
      }
    }
  ]);
});

test("MCP elicitation requests become actionable typed input and respond with MCP content", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const capturedResponses = [];

  monitor.client = {
    respondToServerRequest(requestId, response) {
      capturedResponses.push({ requestId, response });
    }
  };
  monitor.threads.set("thr_123", {
    ...sampleThread(),
    id: "thr_123",
    cwd: "/tmp/CodexAgentsOffice"
  });
  monitor.scheduleThreadRefresh = () => {};
  monitor.rebuildSnapshot = async () => {};

  monitor.handleAppServerServerRequest({
    id: 79,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thr_123",
      turnId: "turn_11",
      serverName: "test-server",
      mode: "form",
      message: "Pick deployment settings",
      requestedSchema: {
        type: "object",
        required: ["environment", "dryRun"],
        properties: {
          environment: {
            type: "string",
            title: "Environment",
            enum: ["staging", "production"]
          },
          dryRun: {
            type: "boolean",
            title: "Dry run"
          },
          retries: {
            type: "integer",
            title: "Retries"
          }
        }
      }
    }
  });

  const pending = monitor.pendingUserRequests.get("79");
  assert.equal(pending.kind, "input");
  assert.equal(pending.responseKind, "mcpElicitation");
  assert.deepEqual(pending.questions.map((question) => question.id), ["environment", "dryRun", "retries"]);
  assert.deepEqual(pending.questions[1].options.map((option) => option.label), ["true", "false"]);

  await monitor.respondToInputRequest("79", {
    environment: { answers: ["staging"] },
    dryRun: { answers: ["true"] },
    retries: { answers: ["2"] }
  });

  assert.deepEqual(capturedResponses, [
    {
      requestId: 79,
      response: {
        action: "accept",
        content: {
          environment: "staging",
          dryRun: true,
          retries: 2
        },
        _meta: null
      }
    }
  ]);
});

test("permission-profile approvals grant the requested permissions for the chosen scope", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const capturedResponses = [];
  const permissions = {
    network: { enabled: true },
    fileSystem: { read: ["/tmp/CodexAgentsOffice"], write: ["/tmp/CodexAgentsOffice"], globScanMaxDepth: 3 }
  };

  monitor.client = {
    respondToServerRequest(requestId, response) {
      capturedResponses.push({ requestId, response });
    }
  };
  monitor.threads.set("thr_123", {
    ...sampleThread(),
    id: "thr_123",
    cwd: "/tmp/CodexAgentsOffice"
  });
  monitor.scheduleThreadRefresh = () => {};
  monitor.rebuildSnapshot = async () => {};

  monitor.handleAppServerServerRequest({
    id: 80,
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thr_123",
      turnId: "turn_12",
      itemId: "item_permissions",
      cwd: "/tmp/CodexAgentsOffice",
      reason: "Need broader workspace access",
      permissions
    }
  });

  const pending = monitor.pendingUserRequests.get("80");
  assert.equal(pending.kind, "approval");
  assert.equal(pending.responseKind, "permissionsApproval");
  assert.deepEqual(pending.availableDecisions, ["accept", "acceptForSession"]);

  await monitor.respondToApprovalRequest("80", "acceptForSession");

  assert.deepEqual(capturedResponses, [
    {
      requestId: 80,
      response: {
        permissions,
        scope: "session"
      }
    }
  ]);
});

test("observer unload notifications do not masquerade as thread completion", () => {
  assert.equal(shouldMarkThreadLiveFromAppServerNotification("thread/status/changed", "active"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("turn/completed"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("turn/interrupted"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("turn/failed"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/archived"), true);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/closed"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/status/changed", "idle"), false);
  assert.equal(shouldMarkThreadStoppedFromAppServerNotification("thread/status/changed", "notLoaded"), false);
});

test("thread closed does not stop an ongoing monitored thread by itself", () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.handleAppServerNotification({
    method: "thread/closed",
    params: {
      threadId: thread.id
    }
  });

  assert.equal(monitor.ongoingThreadIds.has(thread.id), true);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), false);
});

test("final agent message notification stops an ongoing monitored thread", () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.handleAppServerNotification({
    method: "item/completed",
    params: {
      threadId: thread.id,
      item: {
        id: "item_final",
        type: "agentMessage",
        phase: "final_answer",
        text: "Done."
      }
    }
  });

  assert.equal(monitor.ongoingThreadIds.has(thread.id), false);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), true);
});

test("notLoaded status waits for a short cooldown before stopping an ongoing monitored thread", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };
  const dormantNotLoadedThread = {
    ...thread,
    status: { type: "notLoaded" },
    turns: [
      {
        ...thread.turns[0],
        status: "completed",
        items: [
          {
            ...thread.turns[0].items[0],
            status: "completed"
          }
        ]
      }
    ]
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.client = {
    readThread: async () => dormantNotLoadedThread
  };
  monitor.handleAppServerNotification({
    method: "thread/status/changed",
    params: {
      threadId: thread.id,
      status: {
        type: "notLoaded"
      }
    }
  });

  assert.equal(monitor.ongoingThreadIds.has(thread.id), true);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), false);

  await new Promise((resolve) => setTimeout(resolve, 3200));

  assert.equal(monitor.ongoingThreadIds.has(thread.id), false);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), true);
});

test("pending notLoaded cooldown suppresses an early stop during reread confirmation", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };
  const dormantNotLoadedThread = {
    ...thread,
    status: { type: "notLoaded" },
    turns: [
      {
        ...thread.turns[0],
        status: "completed",
        items: [
          {
            ...thread.turns[0].items[0],
            status: "completed"
          }
        ]
      }
    ]
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.schedulePendingNotLoadedStop(thread.id);
  monitor.client = {
    readThread: async () => dormantNotLoadedThread
  };

  await monitor.refreshThread(thread.id);

  assert.equal(monitor.ongoingThreadIds.has(thread.id), true);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), false);
  monitor.clearPendingNotLoadedStop(thread.id);
});

test("completed non-final turns keep the monitored thread live until final answer", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const thread = {
    ...sampleThread(),
    status: { type: "active" },
    updatedAt: Math.floor(Date.now() / 1000)
  };
  const completedCommentaryThread = {
    ...thread,
    status: { type: "idle" },
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_commentary",
            type: "agentMessage",
            text: "I am still working through the next step.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  monitor.threads.set(thread.id, thread);
  monitor.markThreadLive(thread.id);
  monitor.client = {
    readThread: async () => completedCommentaryThread
  };

  await monitor.refreshThread(thread.id);

  assert.equal(monitor.ongoingThreadIds.has(thread.id), true);
  assert.equal(monitor.stoppedAtByThreadId.has(thread.id), false);
});

test("read-only Codex hydration preserves fresh list timestamps for current workload seating", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const staleUpdatedAt = Math.floor((Date.now() - 15 * 60 * 1000) / 1000);
  const freshUpdatedAt = Math.floor(Date.now() / 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: freshUpdatedAt,
    turns: []
  };
  const hydratedThread = {
    ...listedThread,
    updatedAt: staleUpdatedAt,
    turns: [
      {
        id: "turn_current",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_status",
            type: "agentMessage",
            text: "Working through the live seating check",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, {
    ...listedThread,
    updatedAt: staleUpdatedAt
  });
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id, listedThread);
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(agent.updatedAt, new Date(freshUpdatedAt * 1000).toISOString());
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("fresh interrupted read-only turns without a final answer remain live through text gaps", () => {
  const freshThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - 30_000) / 1000),
    turns: [
      {
        id: "turn_current",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_cmd",
            type: "commandExecution",
            command: "npm test",
            cwd: "/tmp/CodexAgentsOffice",
            status: "completed"
          }
        ]
      }
    ]
  };
  const staleThread = {
    ...freshThread,
    updatedAt: Math.floor((Date.now() - 4 * 60 * 1000) / 1000)
  };

  assert.equal(summariseThread(freshThread).state, "validating");
  assert.equal(isCurrentWorkloadAgent({
    source: "local",
    state: "validating",
    updatedAt: new Date(freshThread.updatedAt * 1000).toISOString(),
    stoppedAt: null,
    isOngoing: false,
    statusText: "notLoaded",
    liveSubscription: "readOnly",
    needsUser: null,
    activityEvent: null,
    latestMessage: ""
  }), true);
  assert.equal(summariseThread(staleThread).state, "done");
  assert.equal(isCurrentWorkloadAgent({
    source: "local",
    state: "done",
    updatedAt: new Date(staleThread.updatedAt * 1000).toISOString(),
    stoppedAt: null,
    isOngoing: false,
    statusText: "notLoaded",
    liveSubscription: "readOnly",
    needsUser: null,
    activityEvent: null,
    latestMessage: "Finished"
  }), false);
});

test("fresh unhydrated notLoaded desktop thread after a user prompt reserves a desk briefly", async () => {
  const promptedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor(Date.now() / 1000),
    turns: []
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [promptedThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.statusText, "notLoaded");
  assert.equal(agent.state, "planning");
  assert.equal(agent.isOngoing, true);
  assert.equal(agent.isCurrent, true);
});

test("stale unhydrated notLoaded desktop threads cool out of desk seating", async () => {
  const staleThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - 15 * 1000) / 1000),
    turns: []
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.statusText, "notLoaded");
  assert.equal(agent.state, "done");
  assert.equal(agent.isOngoing, false);
  assert.equal(agent.isCurrent, false);
});

test("tool call server requests become typed tool events", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
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
  assert.equal(event.title, "Tool call requested");
  assert.equal(event.detail, "browser_snapshot");
});

test("turn plan updates summarize the documented explanation and plan payload", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "turn/plan/updated",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        explanation: "Review parser coverage against the official app-server docs.",
        plan: [
          { step: "Read the events page", status: "completed" },
          { step: "Compare parser coverage", status: "inProgress" }
        ]
      }
    }
  );

  assert.equal(event.kind, "turn");
  assert.equal(event.phase, "updated");
  assert.equal(event.title, "Plan updated");
  assert.equal(event.detail, "Review parser coverage against the official app-server docs.");
});

test("turn diff updates summarize the documented diff payload", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "turn/diff/updated",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        diff: [
          "diff --git a/packages/core/src/live-monitor.ts b/packages/core/src/live-monitor.ts",
          "--- a/packages/core/src/live-monitor.ts",
          "+++ b/packages/core/src/live-monitor.ts"
        ].join("\n")
      }
    }
  );

  assert.equal(event.kind, "turn");
  assert.equal(event.phase, "updated");
  assert.equal(event.title, "Diff updated");
  assert.equal(event.detail, "packages/core/src/live-monitor.ts");
});

test("web search completion events summarize action payloads", () => {
  const event = buildDashboardEventFromAppServerMessage(
    { projectRoot: "/tmp/CodexAgentsOffice" },
    {
      method: "item/completed",
      params: {
        threadId: "thr_123",
        turnId: "turn_9",
        item: {
          id: "item_web",
          type: "webSearch",
          action: {
            type: "openPage",
            url: "https://developers.openai.com/codex/app-server#events"
          }
        }
      }
    }
  );

  assert.equal(event.kind, "tool");
  assert.equal(event.phase, "completed");
  assert.equal(event.itemId, "item_web");
  assert.equal(event.detail, "https://developers.openai.com/codex/app-server#events");
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
    { projectRoot: "/tmp/CodexAgentsOffice" },
    thread
  );

  assert.ok(event);
  assert.equal(event.kind, "message");
  assert.equal(event.method, "thread/read/agentMessage");
  assert.equal(event.threadId, "thr_123");
  assert.equal(event.itemId, "item_msg_1");
  assert.equal(event.phase, "updated");
  assert.equal(event.title, "Reply updated");
  assert.equal(event.confidence, "typed");
  assert.equal(event.detail, "Preview bridge reply from the desktop thread.");
});

test("snapshot carries typed needs-user and live subscription metadata", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
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

test("typed approval waits surface as blocked current workload", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [sampleThread()],
    events: [],
    needsUserByThreadId: new Map([
      ["thr_123", { kind: "approval", requestId: "88", reason: "Need approval" }]
    ])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "blocked");
  assert.equal(agent.detail, "Waiting on approval");
  assert.equal(agent.isCurrent, true);
});

test("typed input waits surface as waiting current workload", async () => {
  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [sampleThread()],
    events: [],
    needsUserByThreadId: new Map([
      ["thr_123", { kind: "input", requestId: "99", reason: "Need answer" }]
    ])
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "waiting");
  assert.equal(agent.detail, "Waiting on input");
  assert.equal(agent.isCurrent, true);
});

test("completed command, file, and tool items settle to done instead of active work", () => {
  const updatedAt = Math.floor((Date.now() - 10_000) / 1000);
  const cases = [
    {
      item: {
        type: "commandExecution",
        command: "npm test",
        cwd: "/tmp/CodexAgentsOffice",
        status: "completed"
      }
    },
    {
      item: {
        type: "fileChange",
        status: "completed",
        changes: [{ path: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts", kind: "edit" }]
      }
    },
    {
      item: {
        type: "dynamicToolCall",
        name: "browser_snapshot",
        status: "completed"
      }
    }
  ];

  for (const { item } of cases) {
    const summary = summariseThread({
      ...sampleThread(),
      status: { type: "idle" },
      updatedAt,
      turns: [{
        id: "turn_1",
        status: "completed",
        error: null,
        items: [item]
      }]
    });

    assert.equal(summary.state, "done");
  }
});

test("failed command items preserve the explicit error detail for blocked hover state", () => {
  const summary = summariseThread({
    ...sampleThread(),
    status: { type: "active", activeFlags: [] },
    turns: [{
      id: "turn_1",
      status: "inProgress",
      error: null,
      items: [{
        type: "commandExecution",
        command: "curl -sf http://127.0.0.1:4181/api/server-meta",
        cwd: "/tmp/CodexAgentsOffice",
        status: "failed",
        error: {
          message: "Connection refused"
        }
      }]
    }]
  });

  assert.equal(summary.state, "blocked");
  assert.equal(summary.detail, "Connection refused");
  assert.equal(summary.activityEvent?.title, "curl -sf http://127.0.0.1:4181/api/server-meta");
});

test("recent command activity does not reactivate a completed thread", () => {
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Finished work.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const summary = summariseThread(thread);
  const next = applyRecentActivityEvent(thread, summary, [
    {
      id: "evt_cmd_started",
      source: "codex",
      confidence: "typed",
      threadId: "thr_123",
      createdAt: new Date().toISOString(),
      method: "rollout/exec_command/started",
      kind: "command",
      phase: "started",
      title: "Command started",
      detail: "npm test",
      path: "/tmp/CodexAgentsOffice",
      command: "npm test"
    }
  ]);

  assert.equal(next.state, "done");
  assert.equal(next.detail, "Finished work.");
});

test("codex local adapter keeps message detail aligned with the newest thread reply", async () => {
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: 1730832999,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_msg_new",
            type: "agentMessage",
            phase: "final_answer",
            text: "something"
          }
        ]
      }
    ]
  };

  const snapshot = await buildCodexLocalAdapterSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [thread],
    events: [
      {
        id: "evt_old_message",
        source: "codex",
        confidence: "typed",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "The older commentary reply that should not win.",
        createdAt: "2024-11-05T10:15:30.000Z",
        threadId: "thr_123",
        turnId: "turn_1",
        itemId: "item_msg_old",
        path: "/tmp/CodexAgentsOffice",
        method: "thread/read/agentMessage"
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.latestMessage, "something");
  assert.equal(agent.detail, "something");
  assert.equal(agent.activityEvent?.type, "agentMessage");
  assert.equal(agent.activityEvent?.title, "something");
});

test("stale historical message events do not override dormant thread summaries", async () => {
  const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const dormantThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(threeDaysAgoMs / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Dormant final reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [dormantThread],
    events: [
      {
        id: "evt_stale_msg",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date(threeDaysAgoMs + 5_000).toISOString(),
        method: "thread/read/agentMessage",
        turnId: "turn_1",
        itemId: "item_msg_stale",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "Random stale text from days ago",
        path: "/tmp/CodexAgentsOffice"
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.detail, "Dormant final reply");
  assert.equal(agent.activityEvent?.title, "Dormant final reply");
});

test("fresh local thinking agents do not remain current when they are only read-only", () => {
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
    cwd: "/tmp/ProjectAtlas",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:20.000Z",
    stoppedAt: null,
    paths: ["/tmp/ProjectAtlas"],
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
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("fresh read-only local planning agents remain current for a short lag window", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_plan",
    label: "Fresh child",
    source: "local",
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 1,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: "worker",
    nickname: null,
    isSubagent: true,
    state: "planning",
    detail: "Inspect client-script.ts",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:45.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice/packages/web/src/client-script.ts"],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_plan",
    taskId: null,
    resumeCommand: "codex resume thr_plan",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("quiet subscribed local thinking agents remain current through a longer Codex pause", () => {
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
    cwd: "/tmp/ProjectAtlas",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:57:30.000Z",
    stoppedAt: null,
    paths: ["/tmp/ProjectAtlas"],
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

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("fresh local command activity reserves a desk even when Codex reports idle", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_live_command",
    label: "Live command worker",
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
    state: "done",
    detail: "npm run build",
    cwd: "/tmp/ProjectAtlas",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:59:20.000Z",
    stoppedAt: null,
    paths: ["/tmp/ProjectAtlas"],
    activityEvent: {
      type: "commandExecution",
      action: "ran",
      path: "/tmp/ProjectAtlas",
      title: "npm run build",
      isImage: false
    },
    latestMessage: "Still working",
    threadId: "thr_live_command",
    taskId: null,
    resumeCommand: "codex resume thr_live_command",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);

  assert.equal(isCurrentWorkloadAgent({
    ...agent,
    id: "thr_readonly_command",
    threadId: "thr_readonly_command",
    liveSubscription: "readOnly"
  }, now), true);
});

test("quiet subscribed local desk-live work still settles after the longer pause window", () => {
  const now = Date.parse("2026-03-24T00:00:00.000Z");
  const agent = {
    id: "thr_live_stale",
    label: "Quiet subscribed worker",
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
    cwd: "/tmp/ProjectAtlas",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-23T23:56:59.000Z",
    stoppedAt: null,
    paths: ["/tmp/ProjectAtlas"],
    activityEvent: null,
    latestMessage: "Still working",
    threadId: "thr_live_stale",
    taskId: null,
    resumeCommand: "codex resume thr_live_stale",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed"
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("parentThreadIdForThread extracts ancestor ids from subagent metadata", () => {
  const thread = {
    ...sampleThread(),
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    }
  };

  assert.equal(parentThreadIdForThread(thread), "thr_parent");
});

test("subagent source metadata accepts current nickname and role fields", () => {
  const thread = {
    ...sampleThread(),
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 2,
          agent_nickname: "Ada",
          agent_role: "worker"
        }
      }
    },
    agentNickname: null,
    agentRole: null
  };

  assert.deepEqual(parseThreadSourceMeta(thread), {
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 2,
    agentNickname: "Ada",
    agentRole: "worker"
  });
  assert.equal(pickThreadLabel(thread), "Ada");
  assert.equal(inferThreadAgentRole(thread, "subAgent"), "worker");
});

test("subagent source metadata tolerates lowercase schema key", () => {
  const thread = {
    ...sampleThread(),
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1,
          agent_nickname: "Casey",
          agent_role: "explorer"
        }
      }
    },
    agentNickname: null,
    agentRole: null
  };

  assert.equal(parentThreadIdForThread(thread), "thr_parent");
  assert.equal(parseThreadSourceMeta(thread).agentNickname, "Casey");
  assert.equal(inferThreadAgentRole(thread, "subAgent"), "explorer");
});

test("collab agent tool calls summarize parent sessions as delegating", () => {
  const thread = {
    ...sampleThread(),
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: [
          {
            type: "collabAgentToolCall",
            id: "call_1",
            tool: "spawn_agent",
            status: "inProgress",
            senderThreadId: "thr_parent",
            receiverThreadIds: ["thr_child_a", "thr_child_b"],
            prompt: "Check the latest app-server API.",
            model: null,
            reasoningEffort: null,
            agentsStates: {}
          }
        ]
      }
    ]
  };

  const summary = summariseThread(thread);
  assert.equal(summary.state, "delegating");
  assert.equal(summary.detail, "Spawning 2 subagents");
  assert.equal(summary.activityEvent?.type, "collabAgentToolCall");
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
    projectRoot: "/tmp/CodexAgentsOffice",
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
    projectRoot: "/tmp/CodexAgentsOffice",
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

test("plan items map to planning instead of synthetic thinking", async () => {
  const planningThread = {
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
            type: "plan",
            explanation: "Compare the state mapping against the app-server events."
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [planningThread],
    events: [],
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.detail, "Compare the state mapping against the app-server events.");
  assert.equal(agent.isCurrent, true);
});

test("fresh spawned notLoaded subagent threads without turns still read as live", async () => {
  const freshSpawnedThread = {
    ...sampleThread(),
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor((Date.now() + 60_000) / 1000),
    status: { type: "notLoaded" },
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    },
    turns: []
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [freshSpawnedThread],
    events: [],
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.isOngoing, true);
  assert.equal(agent.isCurrent, true);
});

test("in-progress turns without a stronger item signal default to planning", async () => {
  const activeWithoutItemsThread = {
    ...sampleThread(),
    status: { type: "active", activeFlags: [] },
    turns: [
      {
        id: "turn_1",
        status: "inProgress",
        error: null,
        items: []
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [activeWithoutItemsThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.detail, "Planning");
  assert.equal(agent.isCurrent, true);
});

test("recently finished local threads stay current for a short grace window", async () => {
  const recentDoneThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(Date.now() / 1000),
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
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [recentDoneThread],
    events: []
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, true);
});

test("stopped local live states settle to done immediately for rendering", () => {
  const now = Date.parse("2026-03-24T00:00:01.000Z");
  const snapshot = applyCurrentWorkloadState({
    projectRoot: "/tmp/CodexAgentsOffice",
    projectLabel: "CodexAgentsOffice",
    projectIdentity: null,
    generatedAt: "2026-03-24T00:00:01.000Z",
    rooms: {
      version: 1,
      generated: true,
      filePath: "",
      rooms: []
    },
    agents: [
      {
        id: "thr_done_render",
        label: "Finished worker",
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
        detail: "Wrapped up the change.",
        cwd: "/tmp/CodexAgentsOffice",
        roomId: "root",
        appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
        updatedAt: "2026-03-24T00:00:00.500Z",
        stoppedAt: "2026-03-24T00:00:00.500Z",
        paths: ["/tmp/CodexAgentsOffice"],
        activityEvent: null,
        latestMessage: "Wrapped up the change.",
        threadId: "thr_done_render",
        taskId: null,
        resumeCommand: "codex resume thr_done_render",
        url: null,
        git: null,
        provenance: "codex",
        confidence: "typed",
        needsUser: null,
        liveSubscription: "readOnly"
      }
    ],
    cloudTasks: [],
    events: [],
    notes: []
  }, now);

  assert.equal(snapshot.agents[0].state, "done");
  assert.equal(snapshot.agents[0].isCurrent, true);
});

test("recently finished top-level threads stay current for a 3 second cooldown window", () => {
  const agent = {
    id: "thr_done_top_level",
    label: "Finished lead",
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
    state: "done",
    detail: "Wrapped up the change.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-24T00:00:00.000Z",
    stoppedAt: "2026-03-24T00:00:00.000Z",
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: null,
    latestMessage: "Wrapped up the change.",
    threadId: "thr_done_top_level",
    taskId: null,
    resumeCommand: "codex resume thr_done_top_level",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(agent, Date.parse("2026-03-24T00:00:02.999Z")), true);
  assert.equal(isCurrentWorkloadAgent(agent, Date.parse("2026-03-24T00:00:03.001Z")), false);
});

test("recently finished subagents leave current workload faster than top-level threads", () => {
  const now = Date.parse("2026-03-24T00:00:05.000Z");
  const subagent = {
    id: "thr_sub_done",
    label: "Child worker",
    source: "local",
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 1,
    isCurrent: false,
    isOngoing: false,
    statusText: "idle",
    role: "worker",
    nickname: null,
    isSubagent: true,
    state: "done",
    detail: "Finished",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-24T00:00:03.000Z",
    stoppedAt: "2026-03-24T00:00:03.000Z",
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_sub_done",
    taskId: null,
    resumeCommand: "codex resume thr_sub_done",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(subagent, now), false);
});

test("stale local blocked threads do not stay current forever without ongoing state", () => {
  const now = Date.parse("2026-03-25T12:00:00.000Z");
  const blockedAgent = {
    id: "thr_blocked_old",
    label: "Old blocked thread",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "blocked",
    detail: "old failed command",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: "root",
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: "2026-03-24T15:32:00.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_blocked_old",
    taskId: null,
    resumeCommand: "codex resume thr_blocked_old",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly"
  };

  assert.equal(isCurrentWorkloadAgent(blockedAgent, now), false);
});

test("recently finished local threads stay current even when live monitor bookkeeping has not set stoppedAt yet", async () => {
  const recentDoneThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(Date.now() / 1000),
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
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [recentDoneThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.stoppedAt, null);
  assert.equal(agent.isCurrent, true);
});

test("codex local adapter keeps parent threads available even when only the child cwd matches the project", () => {
  const parentThread = {
    ...sampleThread(),
    id: "thr_parent",
    cwd: "/mnt/f/SomeOtherWorkspace",
    source: "vscode",
    turns: []
  };
  const childThread = {
    ...sampleThread(),
    id: "thr_child",
    cwd: "/tmp/CodexAgentsOffice",
    source: {
      subAgent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    },
    turns: []
  };

  const selected = selectProjectThreadsWithParents(
    "/tmp/CodexAgentsOffice",
    [parentThread, childThread],
    24
  );

  assert.deepEqual(selected.map((thread) => thread.id), ["thr_child", "thr_parent"]);
});

test("codex local adapter follows lowercase subagent parent metadata", () => {
  const parentThread = {
    ...sampleThread(),
    id: "thr_parent",
    cwd: "/mnt/f/SomeOtherWorkspace",
    source: "cli",
    turns: []
  };
  const childThread = {
    ...sampleThread(),
    id: "thr_child",
    cwd: "/tmp/CodexAgentsOffice",
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: "thr_parent",
          depth: 1
        }
      }
    },
    turns: []
  };

  const selected = selectProjectThreadsWithParents(
    "/tmp/CodexAgentsOffice",
    [parentThread, childThread],
    24
  );

  assert.deepEqual(selected.map((thread) => thread.id), ["thr_child", "thr_parent"]);
});

test("codex local adapter keeps active threads selected even when a newer idle thread would fill the limit", () => {
  const now = Math.floor(Date.now() / 1000);
  const activeThread = {
    ...sampleThread(),
    id: "thr_active",
    updatedAt: now - 3600,
    status: { type: "active", activeFlags: [] },
    turns: []
  };
  const recentIdleThread = {
    ...sampleThread(),
    id: "thr_recent",
    updatedAt: now,
    status: { type: "idle" },
    turns: []
  };

  const selected = selectProjectThreadsWithParents(
    "/tmp/CodexAgentsOffice",
    [recentIdleThread, activeThread],
    1
  );

  assert.deepEqual(selected.map((thread) => thread.id), ["thr_active"]);
});

test("codex local adapter synthesizes stoppedAt for quiet static done threads", async () => {
  const quietDoneThread = {
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

  const snapshot = await buildCodexLocalAdapterSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [quietDoneThread],
    events: [],
    notes: []
  });

  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0].state, "done");
  assert.notEqual(snapshot.agents[0].stoppedAt, null);
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
    projectRoot: "/tmp/CodexAgentsOffice",
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
    projectRoot: "/tmp/CodexAgentsOffice",
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

test("future-skewed done local threads are not kept current indefinitely", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_done",
    label: "Finished task",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "done",
    detail: "Wrapped up the change.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:08:53.000Z",
    stoppedAt: null,
    paths: [],
    activityEvent: null,
    latestMessage: "Wrapped up the change.",
    threadId: "thr_future_done",
    taskId: null,
    resumeCommand: "codex resume thr_future_done",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("future-skewed ongoing local threads still remain current", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_live",
    label: "Running task",
    source: "local",
    sourceKind: "subAgent",
    parentThreadId: "thr_parent",
    depth: 1,
    isCurrent: false,
    isOngoing: true,
    statusText: "notLoaded",
    role: "explorer",
    nickname: "Hegel",
    isSubagent: true,
    state: "thinking",
    detail: "Inspecting the repo.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:08:53.000Z",
    stoppedAt: null,
    paths: [],
    activityEvent: null,
    latestMessage: null,
    threadId: "thr_future_live",
    taskId: null,
    resumeCommand: "codex resume thr_future_live",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("future-skewed fresh user-prompt local threads remain current", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_prompt",
    label: "Deploy current build",
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
    state: "done",
    detail: "no nothing is working right now.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:51:49.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: {
      type: "userMessage",
      action: "updated",
      path: "/tmp/CodexAgentsOffice",
      title: "no nothing is working right now.",
      isImage: false
    },
    latestMessage: "Another live test message. If the office is behaving, this thread should be the only one updating right now.",
    threadId: "thr_future_prompt",
    taskId: null,
    resumeCommand: "codex resume thr_future_prompt",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
});

test("future-skewed subscribed live local threads do not remain current just from stale commentary", () => {
  const now = Date.parse("2026-03-27T12:15:58.377Z");
  const agent = {
    id: "thr_future_commentary",
    label: "Deploy current build",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "thinking",
    detail: "Checking the live snapshot.",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: null,
    updatedAt: "2026-03-27T13:56:08.000Z",
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: {
      type: "agentMessage",
      action: "said",
      path: "/tmp/CodexAgentsOffice",
      title: "Checking the live snapshot.",
      isImage: false
    },
    latestMessage: "Checking the live snapshot.",
    threadId: "thr_future_commentary",
    taskId: null,
    resumeCommand: "codex resume thr_future_commentary",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "subscribed",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), false);
});

test("completed commentary replies do not stay in thinking state once the turn is done", async () => {
  const completedCommentaryThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Wrapped up the reply.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [completedCommentaryThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
});

test("completed context compaction does not stay in thinking state once the turn is done", async () => {
  const completedCompactionThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "contextCompaction"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [completedCompactionThread],
    events: [],
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
});

test("interrupted commentary replies stay in thinking state while the subscribed thread is still fresh", async () => {
  const interruptedCommentaryThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Checking the next part of the state transition.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [interruptedCommentaryThread],
    events: [],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("stale interrupted commentary settles out of thinking on startup", async () => {
  const staleInterruptedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Old commentary text that should not keep the thread live.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleInterruptedThread],
    events: [],
    subscribedThreadIds: new Set(),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
});

test("stale process-only local threads settle to idle on startup", async () => {
  const staleCompactionThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            type: "contextCompaction"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleCompactionThread],
    events: [],
    subscribedThreadIds: new Set(),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "idle");
  assert.equal(agent.isCurrent, false);
});

test("fresh user prompts stay planning-current before the next turn starts", async () => {
  const freshPromptThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "userMessage",
            content: [
              {
                text: "Check why the desk agent disappeared"
              }
            ]
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [freshPromptThread],
    events: [],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "planning");
  assert.equal(agent.isCurrent, true);
});

test("fresh completed reply events keep final reply activity without reactivating the desk", async () => {
  const quietThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 10_000) / 1000),
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
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [quietThread],
    events: [
      {
        id: "evt_msg",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date().toISOString(),
        method: "thread/read/agentMessage",
        turnId: "turn_1",
        itemId: "item_msg",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "Final reply text",
        path: "/tmp/CodexAgentsOffice"
      }
    ],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.state, "done");
  assert.equal(agent.isCurrent, false);
  assert.equal(agent.activityEvent?.type, "agentMessage");
  assert.equal(agent.detail, "Final reply text");
});

test("fresh non-final subscribed events refresh stale desktop thread clocks for desk seating", async () => {
  const staleLiveThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((Date.now() - 12 * 60 * 60 * 1000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_msg",
            type: "agentMessage",
            text: "Still checking the live desk seating.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [staleLiveThread],
    events: [
      {
        id: "evt_file",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date().toISOString(),
        method: "rollout/apply_patch/completed",
        kind: "fileChange",
        phase: "completed",
        title: "File edited",
        detail: "/tmp/CodexAgentsOffice/CHANGELOG.md",
        path: "/tmp/CodexAgentsOffice/CHANGELOG.md"
      }
    ],
    subscribedThreadIds: new Set(["thr_123"]),
    stoppedAtByThreadId: new Map(),
    ongoingThreadIds: new Set()
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.isCurrent, true);
  assert.equal(agent.liveSubscription, "subscribed");
});

test("shared cloud rate-limit notes stay human readable", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });

  monitor.setSharedCloudTasks([], "Codex cloud temporarily rate-limited; retrying in 5 minutes.");
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  assert.ok(snapshot);
  assert.ok(snapshot.notes.includes("Codex cloud temporarily rate-limited; retrying in 5 minutes."));
});

test("live monitor drops stale historical events instead of replaying them on startup", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });

  monitor.pushRecentEvent({
    id: "evt_old_rollout",
    source: "codex",
    confidence: "typed",
    threadId: "thr_123",
    createdAt: new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString(),
    method: "rollout/exec_command/completed",
    itemId: "item_old",
    kind: "command",
    phase: "completed",
    title: "Command completed",
    detail: "echo stale",
    path: "/tmp/CodexAgentsOffice",
    command: "echo stale",
    action: "ran"
  });

  await monitor.rebuildSnapshot();
  const snapshot = monitor.getSnapshot();
  assert.ok(snapshot);
  assert.equal(
    snapshot.events.some((event) => event.id === "evt_old_rollout" || event.detail === "echo stale"),
    false
  );
});

test("initial thread hydration does not replay dormant final replies as fresh message events", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(threeDaysAgoMs / 1000),
    turns: []
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            text: "Dormant final reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  await monitor.rebuildSnapshot();

  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );
  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(agent.detail, "Dormant final reply");
  assert.equal(agent.isCurrent, false);
});

test("initial thread hydration ignores preloaded partial assistant history", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const threeDaysAgoMs = Date.now() - (3 * 24 * 60 * 60 * 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor(threeDaysAgoMs / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_preloaded",
            type: "agentMessage",
            text: "Preloaded commentary",
            phase: "commentary"
          }
        ]
      }
    ]
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_final",
            type: "agentMessage",
            text: "Dormant final reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  await monitor.rebuildSnapshot();

  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );
  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(agent.detail, "Dormant final reply");
  assert.equal(agent.isCurrent, false);
});

test("initial discovery waits for resumed live thread hydration before the first snapshot", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const now = Math.floor(Date.now() / 1000);
  const listedThread = {
    ...sampleThread(),
    status: { type: "notLoaded" },
    updatedAt: now,
    turns: []
  };
  const hydratedThread = {
    ...listedThread,
    status: { type: "idle" },
    turns: [
      {
        id: "turn_live",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_commentary",
            type: "agentMessage",
            text: "Checking the live snapshot.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  let resumeCalls = 0;
  let readCalls = 0;
  monitor.client = {
    listThreads: async () => [listedThread],
    listLoadedThreads: async () => [],
    resumeThread: async () => {
      resumeCalls += 1;
    },
    readThread: async () => {
      readCalls += 1;
      return hydratedThread;
    }
  };

  await monitor.discoverThreads();
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === listedThread.id);
  assert.ok(agent);
  assert.equal(resumeCalls, 1);
  assert.ok(readCalls >= 1);
  assert.equal(agent.liveSubscription, "subscribed");
  assert.equal(agent.state, "thinking");
  assert.equal(agent.isCurrent, true);
});

test("initial discovery still subscribes active older threads before their first new update", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false,
    localLimit: 1
  });
  const now = Math.floor(Date.now() / 1000);
  const recentIdleThread = {
    ...sampleThread(),
    id: "thr_recent",
    status: { type: "idle" },
    updatedAt: now,
    turns: []
  };
  const activeThread = {
    ...sampleThread(),
    id: "thr_active",
    status: { type: "active", activeFlags: [] },
    updatedAt: now - 3600,
    turns: []
  };
  const hydratedActiveThread = {
    ...activeThread,
    turns: [
      {
        id: "turn_live",
        status: "interrupted",
        error: null,
        items: [
          {
            id: "item_commentary",
            type: "agentMessage",
            text: "Still working before the next delta lands.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const resumedThreadIds = [];
  monitor.client = {
    listThreads: async () => [recentIdleThread, activeThread],
    listLoadedThreads: async () => [],
    resumeThread: async (threadId) => {
      resumedThreadIds.push(threadId);
    },
    readThread: async (threadId) => {
      if (threadId === activeThread.id) {
        return hydratedActiveThread;
      }
      return recentIdleThread;
    }
  };

  await monitor.discoverThreads();
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === activeThread.id);
  assert.ok(agent);
  assert.deepEqual(resumedThreadIds, [activeThread.id]);
  assert.equal(agent.liveSubscription, "subscribed");
  assert.equal(agent.isCurrent, true);
  assert.equal(agent.detail, "Still working before the next delta lands.");
});

test("initial discovery recovers a loaded current thread missing from cwd-scoped thread/list", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false,
    localLimit: 1
  });
  const now = Math.floor(Date.now() / 1000);
  const listedIdleThread = {
    ...sampleThread(),
    id: "thr_listed_idle",
    status: { type: "idle" },
    updatedAt: now,
    turns: []
  };
  const loadedCurrentThread = {
    ...sampleThread(),
    id: "thr_loaded_current",
    status: { type: "notLoaded" },
    updatedAt: now - 7200,
    turns: [
      {
        id: "turn_live",
        status: "inProgress",
        error: null,
        items: [
          {
            id: "item_commentary",
            type: "agentMessage",
            text: "Still active after restart.",
            phase: "commentary"
          }
        ]
      }
    ]
  };

  const resumedThreadIds = [];
  const readThreadIds = [];
  monitor.client = {
    listThreads: async () => [listedIdleThread],
    listLoadedThreads: async () => [loadedCurrentThread.id],
    resumeThread: async (threadId) => {
      resumedThreadIds.push(threadId);
    },
    readThread: async (threadId) => {
      readThreadIds.push(threadId);
      if (threadId === loadedCurrentThread.id) {
        return loadedCurrentThread;
      }
      return listedIdleThread;
    }
  };

  await monitor.discoverThreads();
  await monitor.rebuildSnapshot();

  const snapshot = monitor.getSnapshot();
  const agent = snapshot.agents.find((entry) => entry.threadId === loadedCurrentThread.id);
  assert.ok(agent);
  assert.ok(readThreadIds.includes(loadedCurrentThread.id));
  assert.ok(resumedThreadIds.includes(loadedCurrentThread.id));
  assert.equal(agent.liveSubscription, "subscribed");
  assert.equal(agent.isCurrent, true);
  assert.equal(agent.state, "thinking");
});

test("discoverThreads scopes app-server thread listing to the current project root", async () => {
  const projectRoot = "/tmp/CodexAgentsOffice";
  const monitor = new ProjectLiveMonitor({
    projectRoot,
    includeCloud: false,
    localLimit: 1
  });
  const listedThread = {
    ...sampleThread(),
    cwd: projectRoot
  };

  const listThreadCalls = [];
  monitor.client = {
    listThreads: async (params) => {
      listThreadCalls.push(params);
      return [listedThread];
    },
    listLoadedThreads: async () => [],
    resumeThread: async () => {},
    readThread: async () => listedThread
  };

  await monitor.discoverThreads();

  assert.deepEqual(listThreadCalls, [
    {
      cwd: projectRoot,
      limit: 40
    }
  ]);
});

test("recent read-only notLoaded local replies stay current briefly after restart recovery stalls", () => {
  const now = Date.now();
  const agent = {
    id: "thr_recent_restart",
    label: "run the app",
    source: "local",
    sourceKind: "vscode",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing: false,
    statusText: "notLoaded",
    role: null,
    nickname: null,
    isSubagent: false,
    state: "done",
    detail: "Reply completed",
    cwd: "/tmp/CodexAgentsOffice",
    roomId: null,
    appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
    updatedAt: new Date(now - 2 * 1000).toISOString(),
    stoppedAt: null,
    paths: ["/tmp/CodexAgentsOffice"],
    activityEvent: { type: "agentMessage" },
    latestMessage: "Still working after restart.",
    threadId: "thr_recent_restart",
    taskId: null,
    resumeCommand: "codex resume thr_recent_restart",
    url: null,
    git: null,
    provenance: "codex",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly",
    network: null
  };

  assert.equal(isCurrentWorkloadAgent(agent, now), true);
  assert.equal(isCurrentWorkloadAgent({
    ...agent,
    updatedAt: new Date(now - 5 * 1000).toISOString()
  }, now), false);
});

test("applyCurrentWorkloadState keeps the newest top-level notLoaded reply current when restart recovery leaves no local current agent", () => {
  const now = Date.now();
  const snapshot = {
    projectRoot: "/tmp/CodexAgentsOffice",
    projectLabel: "Codex Agents Office",
    projectIdentity: null,
    generatedAt: new Date(now).toISOString(),
    rooms: { version: 1, generated: true, filePath: "", rooms: [] },
    cloudTasks: [],
    events: [],
    notes: [],
    agents: [
      {
        id: "thr_old",
        label: "Older thread",
        source: "local",
        sourceKind: "vscode",
        parentThreadId: null,
        depth: 0,
        isCurrent: false,
        isOngoing: false,
        statusText: "notLoaded",
        role: null,
        nickname: null,
        isSubagent: false,
        state: "idle",
        detail: "Older reply",
        cwd: "/tmp/CodexAgentsOffice",
        roomId: null,
        appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
        updatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
        stoppedAt: null,
        paths: ["/tmp/CodexAgentsOffice"],
        activityEvent: { type: "agentMessage" },
        latestMessage: "Older reply",
        threadId: "thr_old",
        taskId: null,
        resumeCommand: "codex resume thr_old",
        url: null,
        git: null,
        provenance: "codex",
        confidence: "typed",
        needsUser: null,
        liveSubscription: "readOnly",
        network: null
      },
      {
        id: "thr_recent",
        label: "Recent thread",
        source: "local",
        sourceKind: "vscode",
        parentThreadId: null,
        depth: 0,
        isCurrent: false,
        isOngoing: false,
        statusText: "notLoaded",
        role: null,
        nickname: null,
        isSubagent: false,
        state: "done",
        detail: "Recent reply",
        cwd: "/tmp/CodexAgentsOffice",
        roomId: null,
        appearance: { id: "fern", label: "Fern", body: "#7fbf5b", accent: "#eef8e6", shadow: "#476d31" },
        updatedAt: new Date(now - 2 * 1000).toISOString(),
        stoppedAt: null,
        paths: ["/tmp/CodexAgentsOffice"],
        activityEvent: { type: "agentMessage" },
        latestMessage: "Recent reply",
        threadId: "thr_recent",
        taskId: null,
        resumeCommand: "codex resume thr_recent",
        url: null,
        git: null,
        provenance: "codex",
        confidence: "typed",
        needsUser: null,
        liveSubscription: "readOnly",
        network: null
      }
    ]
  };

  const result = applyCurrentWorkloadState(snapshot, now);
  assert.equal(result.agents.find((agent) => agent.id === "thr_recent")?.isCurrent, true);
  assert.equal(result.agents.find((agent) => agent.id === "thr_old")?.isCurrent, false);
});

test("hydrated thread rereads backfill fresh assistant replies when live events are missing", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const listedThread = {
    ...sampleThread(),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_preloaded",
            type: "agentMessage",
            text: "Preloaded commentary",
            phase: "commentary"
          }
        ]
      }
    ]
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_final",
            type: "agentMessage",
            text: "Hydrated reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };
  const updatedThread = {
    ...hydratedThread,
    updatedAt: hydratedThread.updatedAt + 5,
    turns: [
      {
        id: "turn_2",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_follow_up",
            type: "agentMessage",
            text: "Fresh follow-up reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.subscribedThreadIds.add(listedThread.id);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );

  monitor.client = {
    readThread: async () => updatedThread
  };

  await monitor.refreshThread(listedThread.id);

  const messageEvents = monitor.recentEvents.filter((event) => event.method === "thread/read/agentMessage");
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0].detail, "Fresh follow-up reply");
});

test("unsubscribed thread rereads still synthesize assistant replies as fallback events", async () => {
  const monitor = new ProjectLiveMonitor({
    projectRoot: "/tmp/CodexAgentsOffice",
    includeCloud: false
  });
  const listedThread = {
    ...sampleThread(),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_preloaded",
            type: "agentMessage",
            text: "Preloaded commentary",
            phase: "commentary"
          }
        ]
      }
    ]
  };
  const hydratedThread = {
    ...listedThread,
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_final",
            type: "agentMessage",
            text: "Hydrated reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };
  const updatedThread = {
    ...hydratedThread,
    updatedAt: hydratedThread.updatedAt + 5,
    turns: [
      {
        id: "turn_2",
        status: "completed",
        error: null,
        items: [
          {
            id: "item_follow_up",
            type: "agentMessage",
            text: "Fresh follow-up reply",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  monitor.threads.set(listedThread.id, listedThread);
  monitor.client = {
    readThread: async () => hydratedThread
  };

  await monitor.refreshThread(listedThread.id);
  assert.equal(
    monitor.recentEvents.some((event) => event.method === "thread/read/agentMessage"),
    false
  );

  monitor.client = {
    readThread: async () => updatedThread
  };

  await monitor.refreshThread(listedThread.id);

  const messageEvents = monitor.recentEvents.filter((event) => event.method === "thread/read/agentMessage");
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0].detail, "Fresh follow-up reply");
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
    projectRoot: "/tmp/CodexAgentsOffice",
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
    "*** Update File: /tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
    "@@",
    "-const VALUE = 1;",
    "+const VALUE = 2;",
    "*** End Patch"
  ].join("\n"));

  assert.deepEqual(parsed, {
    path: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
    action: "edited",
    title: "File edited",
    linesAdded: 1,
    linesRemoved: 1
  });
});

test("rollout apply_patch hooks become file-change events", () => {
  const event = buildRolloutHookEvent("/tmp/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:00.000Z",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      status: "completed",
      call_id: "call_123",
      input: [
        "*** Begin Patch",
        "*** Update File: /tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
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
  assert.equal(event.path, "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts");
  assert.equal(event.linesAdded, 1);
  assert.equal(event.linesRemoved, 1);
});

test("rollout exec_command hooks become command events", () => {
  const pendingCommands = new Map();
  const started = buildRolloutHookEvent("/tmp/CodexAgentsOffice", "thr_123", {
    timestamp: "2026-03-23T19:00:00.000Z",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "call_cmd_123",
      arguments: JSON.stringify({
        cmd: "git status --short README.md",
        workdir: "/tmp/CodexAgentsOffice"
      })
    }
  }, pendingCommands);

  const completed = buildRolloutHookEvent("/tmp/CodexAgentsOffice", "thr_123", {
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
  const now = Date.now();
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((now - 10_000) / 1000),
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
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [thread],
    events: [
      {
        id: "event_file",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date(now - 1_000).toISOString(),
        method: "rollout/apply_patch/completed",
        itemId: "call_123",
        kind: "fileChange",
        phase: "completed",
        title: "File edited",
        detail: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
        path: "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts",
        action: "edited",
        linesAdded: 1,
        linesRemoved: 1
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.activityEvent.type, "fileChange");
  assert.equal(agent.activityEvent.path, "/tmp/CodexAgentsOffice/packages/core/src/snapshot.ts");
  assert.match(agent.detail, /Edited .*snapshot\.ts$/);
});

test("streamed completed replies outrank later thread-read fallback messages", async () => {
  const now = Date.now();
  const thread = {
    ...sampleThread(),
    status: { type: "idle" },
    updatedAt: Math.floor((now - 5_000) / 1000),
    turns: [
      {
        id: "turn_1",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            id: "item_final",
            text: "Good. The fix is now live.",
            phase: "final_answer"
          }
        ]
      }
    ]
  };

  const snapshot = await buildDashboardSnapshotFromState({
    projectRoot: "/tmp/CodexAgentsOffice",
    threads: [thread],
    events: [
      {
        id: "evt_stream_final",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date(now - 2_000).toISOString(),
        method: "item/completed",
        turnId: "turn_1",
        itemId: "item_final",
        itemType: "agentMessage",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "Good. The fix is now live.",
        path: "/tmp/CodexAgentsOffice"
      },
      {
        id: "evt_read_fallback",
        source: "codex",
        confidence: "typed",
        threadId: "thr_123",
        createdAt: new Date(now - 1_000).toISOString(),
        method: "thread/read/agentMessage",
        turnId: "turn_1",
        itemId: "item_commentary",
        kind: "message",
        phase: "completed",
        title: "Reply completed",
        detail: "The older commentary reply that should not win.",
        path: "/tmp/CodexAgentsOffice"
      }
    ]
  });

  const agent = snapshot.agents.find((entry) => entry.threadId === "thr_123");
  assert.ok(agent);
  assert.equal(agent.latestMessage, "Good. The fix is now live.");
  assert.equal(agent.detail, "Good. The fix is now live.");
  assert.equal(agent.activityEvent?.type, "agentMessage");
  assert.equal(agent.activityEvent?.title, "Good. The fix is now live.");
});
