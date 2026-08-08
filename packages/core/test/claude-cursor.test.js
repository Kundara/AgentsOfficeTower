const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawnSync } = require("node:child_process");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");

const {
  buildClaudeBackgroundAgentsForTest,
  buildClaudeCoworkAgentsForTest,
  buildClaudeLeadAgentsForTest,
  buildClaudeSubagentAgentsForTest,
  buildClaudeTeamAgentsForTest,
  discoverClaudeProjectsFromBackgroundJobsForTest,
  buildClaudeSessionEventsForTest,
  discoverClaudeProjectsFromCoworkForTest,
  discoverClaudeProjectsFromTeamsForTest,
  normalizeClaudeBackgroundJobForTest,
  summariseClaudeHookRecord,
  summariseClaudeSession
} = require("../dist/claude.js");
const {
  claudeSdkSessionListOptions,
  filterClaudeSdkSessionsForProject
} = require("../dist/claude-session-ownership.js");
const {
  claudeHooksFilePath,
  createClaudeSdkSidecarHooks,
  normalizeClaudeSdkMessageForTest,
  respondToClaudeHookInputRequest,
  respondToClaudeHookPermissionRequest
} = require("../dist/claude-agent-sdk.js");
const {
  describeStoredAppearanceSettings,
  describeCursorIntegrationSettings,
  describeStoredMultiplayerSettings,
  getAppSettingsFilePath,
  resetAppSettingsCacheForTest,
  setStoredAppearanceSettings,
  setStoredCursorApiKey,
  setStoredMultiplayerSettings
} = require("../dist/app-settings.js");
const {
  describeCursorAgentAvailability,
  cursorAgentMatchesRepository,
  cursorApiKeyConfigured,
  loadCursorCloudProjectSnapshotData,
  loadCursorLocalProjectSnapshotData,
  normalizeRepositoryUrl,
  cursorStatusToActivityState
} = require("../dist/cursor.js");
const { cursorCloudAdapter } = require("../dist/adapters/cursor-cloud.js");

const execFileAsync = promisify(execFile);

async function withTempAppData(prefix, fn) {
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  const configHome = await mkdtemp(path.join(os.tmpdir(), prefix));
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.CODEX_HOME;
  resetAppSettingsCacheForTest();

  try {
    return await fn(configHome);
  } finally {
    await rm(configHome, { recursive: true, force: true });
    if (previousXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (previousCodexHome !== undefined) {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
}

async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

test("Claude SDK sessions belong only to their exact project snapshot", () => {
  const sessions = [
    { sessionId: "main", cwd: "/workspaces/PartyGame" },
    { sessionId: "sibling-worktree", cwd: "/workspaces/PartyGame-review" },
    { sessionId: "nested-root", cwd: "/workspaces/PartyGame/Packages/PolyStack" }
  ];

  assert.deepEqual(
    filterClaudeSdkSessionsForProject("/workspaces/PartyGame/", sessions).map((session) => session.sessionId),
    ["main"]
  );
  assert.deepEqual(
    filterClaudeSdkSessionsForProject("/workspaces/PartyGame-review", sessions).map((session) => session.sessionId),
    ["sibling-worktree"]
  );
  assert.deepEqual(
    filterClaudeSdkSessionsForProject("/workspaces/PartyGame/Packages/PolyStack", sessions).map((session) => session.sessionId),
    ["nested-root"]
  );
});

test("Claude SDK project reads exclude sibling worktrees before applying their page limit", () => {
  assert.deepEqual(
    claudeSdkSessionListOptions("/workspaces/PartyGame/.claude/worktrees/fix-agents", 12),
    {
      dir: "/workspaces/PartyGame/.claude/worktrees/fix-agents",
      limit: 12,
      includeWorktrees: false
    }
  );
});

test("typed Claude permission hooks become approval-backed blocked state", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "PermissionRequest",
      cwd: "/workspaces/CodexAgentsOffice",
      request_id: "req_42",
      reason: "Need approval to run a privileged command",
      tool_input: {
        command: "npm publish",
        cwd: "/workspaces/CodexAgentsOffice"
      }
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "blocked");
  assert.equal(summary.confidence, "typed");
  assert.deepEqual(summary.needsUser, {
    kind: "approval",
    requestId: "req_42",
    reason: "Need approval to run a privileged command",
    command: "npm publish",
    cwd: "/workspaces/CodexAgentsOffice",
    grantRoot: "/workspaces/CodexAgentsOffice"
  });
  assert.equal(summary.isOngoing, true);
});

test("typed Claude elicitation hooks expose actionable questions from requested schema", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "Elicitation",
      hook_source: "claude-agent-sdk",
      cwd: "/workspaces/CodexAgentsOffice",
      request_id: "elicitation-42",
      message: "Pick a mode and add notes",
      requested_schema: {
        type: "object",
        required: ["mode"],
        properties: {
          mode: {
            type: "string",
            title: "Mode",
            description: "Choose the operating mode",
            enum: ["Fast", "Safe"]
          },
          notes: {
            type: "string",
            title: "Notes",
            description: "Anything the agent should keep in mind"
          }
        }
      }
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "waiting");
  assert.deepEqual(summary.needsUser, {
    kind: "input",
    requestId: "elicitation-42",
    reason: "Pick a mode and add notes",
    cwd: "/workspaces/CodexAgentsOffice",
    questions: [
      {
        header: "Mode",
        id: "mode",
        question: "Choose the operating mode",
        required: true,
        isSecret: false,
        options: [
          { label: "Fast", description: "Fast" },
          { label: "Safe", description: "Safe" }
        ]
      },
      {
        header: "Notes",
        id: "notes",
        question: "Anything the agent should keep in mind",
        required: false,
        isSecret: false,
        options: null
      }
    ]
  });
});

test("typed Claude user prompt hooks become planning state with user-message activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "UserPromptSubmit",
      cwd: "/workspaces/CodexAgentsOffice",
      prompt: "Update /workspaces/CodexAgentsOffice/README.md with Cursor support"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "planning");
  assert.equal(summary.activityEvent?.type, "userMessage");
  assert.equal(summary.activityEvent?.action, "said");
  assert.match(summary.detail, /README\.md/);
  assert.deepEqual(summary.paths, ["/workspaces/CodexAgentsOffice/README.md"]);
});

test("newer Claude SDK hook events are summarized as typed workload states", () => {
  const base = {
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z")
  };

  const taskCreated = summariseClaudeHookRecord({
    ...base,
    record: {
      hook_event_name: "TaskCreated",
      cwd: "/workspaces/CodexAgentsOffice",
      task_subject: "Investigate flaky tests"
    }
  });
  const permissionDenied = summariseClaudeHookRecord({
    ...base,
    record: {
      hook_event_name: "PermissionDenied",
      cwd: "/workspaces/CodexAgentsOffice",
      reason: "Auto mode denied this command"
    }
  });
  const postToolBatch = summariseClaudeHookRecord({
    ...base,
    record: {
      hook_event_name: "PostToolBatch",
      cwd: "/workspaces/CodexAgentsOffice"
    }
  });

  assert.equal(taskCreated.state, "delegating");
  assert.equal(taskCreated.isOngoing, true);
  assert.equal(taskCreated.activityEvent?.type, "collabAgentToolCall");
  assert.equal(taskCreated.activityEvent?.path, "/workspaces/CodexAgentsOffice");
  assert.equal(permissionDenied.state, "blocked");
  assert.equal(permissionDenied.isOngoing, false);
  assert.equal(postToolBatch.state, "thinking");
  assert.equal(postToolBatch.isOngoing, true);
});

test("Claude MessageDisplay hooks surface typed streaming assistant text", () => {
  const partial = summariseClaudeHookRecord({
    sessionId: "claude-message-display",
    model: "claude-opus-4-8",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.now(),
    record: {
      hook_event_name: "MessageDisplay",
      delta: "Checking the current integration.\n",
      final: false,
      timestamp: new Date().toISOString()
    }
  });
  const completed = summariseClaudeHookRecord({
    sessionId: "claude-message-display",
    model: "claude-opus-4-8",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.now(),
    record: {
      hook_event_name: "MessageDisplay",
      delta: "",
      final: true,
      timestamp: new Date().toISOString()
    }
  });

  assert.equal(partial?.state, "thinking");
  assert.equal(partial?.latestMessage, "Checking the current integration.");
  assert.equal(partial?.isOngoing, true);
  assert.equal(completed?.state, "thinking");
  assert.equal(completed?.detail, "Assistant message displayed");
  assert.equal(completed?.isOngoing, true);
});

test("Claude delegation hooks normalize to shared subagent events", () => {
  const now = Date.now();
  const events = buildClaudeSessionEventsForTest({
    sessionId: "session-123",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    records: [],
    fallbackUpdatedAt: now,
    hookRecords: [
      {
        hook_event_name: "SubagentStart",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        agent_type: "explorer"
      }
    ]
  });

  assert.ok(events.some((event) =>
    event.kind === "subagent"
    && event.method === "claude/collabAgentToolCall"
    && event.path === "/workspaces/CodexAgentsOffice"
    && event.title === "Spawning explorer subagent"
  ));
});

test("Claude subagent hooks create child agent rows keyed by agent_id", async () => {
  await withTempAppData("claude-subagent-rows-", async () => {
    const now = Date.now();
    const agents = await buildClaudeSubagentAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      sessionId: "session-123",
      cwd: "/workspaces/CodexAgentsOffice",
      updatedAt: now,
      hookRecords: [
        {
          hook_event_name: "SubagentStart",
          timestamp: new Date(now - 2_000).toISOString(),
          cwd: "/workspaces/CodexAgentsOffice",
          agent_id: "agent-1",
          agent_type: "explorer"
        },
        {
          hook_event_name: "PostToolUse",
          timestamp: new Date(now - 1_000).toISOString(),
          cwd: "/workspaces/CodexAgentsOffice",
          agent_id: "agent-1",
          agent_type: "explorer",
          tool_name: "Bash",
          tool_input: {
            command: "npm test",
            cwd: "/workspaces/CodexAgentsOffice"
          }
        }
      ]
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "claude:session-123:agent:agent-1");
    assert.equal(agents[0].parentThreadId, "claude:session-123");
    assert.equal(agents[0].threadId, "claude:session-123:agent:agent-1");
    assert.equal(agents[0].isSubagent, true);
    assert.equal(agents[0].role, "explorer");
    assert.equal(agents[0].state, "validating");
    assert.equal(agents[0].activityEvent?.type, "commandExecution");
  });
});

test("Claude subagent hook events attach to the child thread id", () => {
  const now = Date.now();
  const events = buildClaudeSessionEventsForTest({
    sessionId: "session-123",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    records: [],
    fallbackUpdatedAt: now,
    hookRecords: [
      {
        hook_event_name: "SubagentStart",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        agent_id: "agent-1",
        agent_type: "explorer"
      }
    ]
  });

  assert.ok(events.some((event) =>
    event.kind === "subagent"
    && event.threadId === "claude:session-123:agent:agent-1"
  ));
});

test("Claude child hook records do not update lead summaries while still driving child activity", async () => {
  await withTempAppData("claude-child-hook-ownership-", async () => {
    const now = Date.now();
    const sessionId = "session-child-ownership";
    const cwd = "/workspaces/CodexAgentsOffice";
    const leadRecords = [
      {
        type: "assistant",
        timestamp: new Date(now - 3_000).toISOString(),
        cwd,
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Lead is coordinating the workflow." }]
        }
      }
    ];
    const childHook = {
      hook_event_name: "PostToolUse",
      timestamp: new Date(now - 1_000).toISOString(),
      cwd,
      agent_id: "agent-1",
      agent_type: "explorer",
      tool_name: "Bash",
      tool_input: {
        command: "npm test -w packages/core",
        cwd
      }
    };

    const summary = summariseClaudeSession(sessionId, cwd, leadRecords, now - 3_000, [childHook]);
    assert.equal(summary.latestMessage, "Lead is coordinating the workflow.");
    assert.equal(summary.detail, "Lead is coordinating the workflow.");
    assert.notEqual(summary.detail, "npm test -w packages/core");
    assert.notEqual(summary.activityEvent?.type, "commandExecution");

    const agents = await buildClaudeSubagentAgentsForTest({
      projectRoot: cwd,
      sessionId,
      cwd,
      updatedAt: now,
      records: leadRecords,
      hookRecords: [childHook]
    });
    assert.equal(agents.length, 1);
    assert.equal(agents[0].threadId, "claude:session-child-ownership:agent:agent-1");
    assert.equal(agents[0].detail, "npm test -w packages/core");
    assert.equal(agents[0].activityEvent?.type, "commandExecution");

    const events = buildClaudeSessionEventsForTest({
      sessionId,
      fallbackCwd: cwd,
      records: leadRecords,
      fallbackUpdatedAt: now,
      hookRecords: [childHook]
    });
    const commandEvents = events.filter((event) => event.method === "claude/commandExecution");
    assert.equal(commandEvents.length, 1);
    assert.equal(commandEvents[0].threadId, "claude:session-child-ownership:agent:agent-1");
    assert.ok(!events.some((event) => event.method === "claude/commandExecution" && event.threadId === sessionId));
  });
});

test("Claude subagent hooks use teammate session ids when team metadata links them", async () => {
  await withTempAppData("claude-team-hook-rows-", async () => {
    const now = Date.now();
    const agents = await buildClaudeSubagentAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      sessionId: "lead-123",
      cwd: "/workspaces/CodexAgentsOffice",
      updatedAt: now,
      teams: [
        {
          name: "review",
          description: null,
          leadAgentId: "team-lead@review",
          leadSessionId: "lead-123",
          updatedAt: now,
          members: [
            {
              agentId: "security@review",
              name: "security",
              agentType: "security-reviewer",
              model: "claude-sonnet-4-5",
              prompt: null,
              color: null,
              joinedAt: now,
              tmuxPaneId: "%1",
              cwd: "/workspaces/CodexAgentsOffice",
              worktreePath: null,
              sessionId: "teammate-123",
              subscriptions: [],
              backendType: "tmux",
              isActive: true,
              mode: "default"
            }
          ]
        }
      ],
      hookRecords: [
        {
          hook_event_name: "SubagentStart",
          timestamp: new Date(now - 1_000).toISOString(),
          cwd: "/workspaces/CodexAgentsOffice",
          agent_id: "security@review",
          agent_type: "security-reviewer"
        }
      ]
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "claude:teammate-123");
    assert.equal(agents[0].threadId, "teammate-123");
    assert.equal(agents[0].parentThreadId, "claude:lead-123");
    assert.equal(agents[0].nickname, "security");
  });
});

test("Claude workflow subagent transcripts create inferred child rows under the lead session", async () => {
  await withTempAppData("claude-workflow-subagent-rows-", async () => {
    const now = Date.now();
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "claude-workflow-project-"));
    const sessionId = "session-workflow-123";
    const workflowDir = path.join(projectDir, sessionId, "subagents", "workflows", "workflow-a");
    const transcriptPath = path.join(workflowDir, "agent-reviewer.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "assistant",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Reviewed the renderer and found no duplicate desks." }]
        }
      }
    ]);
    await writeFile(
      path.join(workflowDir, "agent-reviewer.meta.json"),
      JSON.stringify({
        agentId: "reviewer",
        agentType: "code-reviewer",
        name: "Renderer reviewer",
        description: "Review renderer changes",
        cwd: "/workspaces/CodexAgentsOffice"
      }),
      "utf8"
    );

    try {
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId,
        projectDirPath: projectDir,
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        hookRecords: []
      });

      assert.equal(agents.length, 1);
      assert.equal(agents[0].id, "claude:session-workflow-123:agent:reviewer");
      assert.equal(agents[0].parentThreadId, "claude:session-workflow-123");
      assert.equal(agents[0].isSubagent, true);
      assert.equal(agents[0].label, "Renderer reviewer");
      assert.equal(agents[0].role, "code-reviewer");
      assert.equal(agents[0].sourceKind, "claude:workflow-subagent");
      assert.equal(agents[0].confidence, "inferred");
      assert.equal(agents[0].state, "done");
      assert.equal(agents[0].latestMessage, "Reviewed the renderer and found no duplicate desks.");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

test("Claude background Bash tasks create live child rows with bounded output", async () => {
  await withTempAppData("claude-background-task-live-", async () => {
    const now = Date.now();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "claude-background-task-output-"));
    const outputPath = path.join(tempDir, "session-background-live", "tasks", "task-live.output");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "starting review\nchecking renderer tests\n", "utf8");

    try {
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId: "session-background-live",
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        records: [
          {
            type: "assistant",
            timestamp: new Date(now - 1_000).toISOString(),
            message: {
              content: [{
                type: "tool_use",
                id: "tool-background-live",
                name: "Bash",
                input: {
                  command: "npm test",
                  description: "Run renderer tests",
                  run_in_background: true
                }
              }]
            }
          },
          {
            type: "user",
            timestamp: new Date(now - 900).toISOString(),
            message: {
              content: [{
                type: "tool_result",
                tool_use_id: "tool-background-live",
                content: `Command running in background with ID: task-live. Output is being written to: ${outputPath}.`
              }]
            },
            toolUseResult: { backgroundTaskId: "task-live" }
          }
        ],
        hookRecords: []
      });

      assert.equal(agents.length, 1);
      assert.equal(agents[0].id, "claude:session-background-live:agent:background-task:task-live");
      assert.equal(agents[0].parentThreadId, "claude:session-background-live");
      assert.equal(agents[0].sourceKind, "claude:background-task");
      assert.equal(agents[0].label, "Run renderer tests");
      assert.equal(agents[0].taskId, "task-live");
      assert.equal(agents[0].isSubagent, true);
      assert.equal(agents[0].isOngoing, true);
      assert.equal(agents[0].state, "running");
      assert.equal(agents[0].latestMessage, "checking renderer tests");
      assert.equal(agents[0].activityEvent?.type, "commandExecution");
      assert.equal(agents[0].confidence, "inferred");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test("Claude raw task notifications finish background child rows when SDK records omit completion", async () => {
  await withTempAppData("claude-background-task-complete-", async () => {
    const now = Date.now();
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "claude-background-task-transcript-"));
    const sessionId = "session-background-complete";
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
    const outputPath = path.join(projectDir, sessionId, "tasks", "task-complete.output");
    await mkdir(path.dirname(outputPath), { recursive: true });
    const spawn = {
      type: "assistant",
      timestamp: new Date(now - 2_000).toISOString(),
      message: {
        content: [{
          type: "tool_use",
          id: "tool-background-complete",
          name: "Bash",
          input: {
            command: "npm test",
            description: "Run full suite",
            run_in_background: true
          }
        }]
      }
    };
    const started = {
      type: "user",
      timestamp: new Date(now - 1_900).toISOString(),
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "tool-background-complete",
          content: `Command running in background with ID: task-complete. Output is being written to: ${outputPath}.`
        }]
      },
      toolUseResult: { backgroundTaskId: "task-complete" }
    };
    const notification = {
      type: "queue-operation",
      operation: "enqueue",
      timestamp: new Date(now - 1_000).toISOString(),
      content: `<task-notification>\n<task-id>task-complete</task-id>\n<tool-use-id>tool-background-complete</tool-use-id>\n<output-file>${outputPath}</output-file>\n<status>completed</status>\n<summary>Background command \"Run full suite\" completed (exit code 0)</summary>\n</task-notification>`
    };
    await writeFile(outputPath, "result=Passed total=60 failed=0\n", "utf8");
    await writeFile(transcriptPath, [spawn, started].map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");

    try {
      const runningAgents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId,
        projectDirPath: projectDir,
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        records: [spawn, started],
        hookRecords: []
      });
      assert.equal(runningAgents.length, 1);
      assert.equal(runningAgents[0].isOngoing, true);

      await writeFile(
        transcriptPath,
        [spawn, started, notification].map((record) => JSON.stringify(record)).join("\n") + "\n",
        "utf8"
      );
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId,
        projectDirPath: projectDir,
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        records: [spawn, started],
        hookRecords: []
      });

      assert.equal(agents.length, 1);
      assert.equal(agents[0].state, "done");
      assert.equal(agents[0].isOngoing, false);
      assert.ok(Date.parse(agents[0].stoppedAt) >= now - 1_000);
      assert.equal(agents[0].latestMessage, "result=Passed total=60 failed=0");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

test("Claude failed background task notifications produce blocked child rows", async () => {
  await withTempAppData("claude-background-task-failed-", async () => {
    const now = Date.now();
    const agents = await buildClaudeSubagentAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      sessionId: "session-background-failed",
      cwd: "/workspaces/CodexAgentsOffice",
      updatedAt: now,
      records: [
        {
          type: "assistant",
          timestamp: new Date(now - 2_000).toISOString(),
          message: { content: [{
            type: "tool_use",
            id: "tool-background-failed",
            name: "Bash",
            input: { command: "npm test", description: "Run checks", run_in_background: true }
          }] }
        },
        {
          type: "user",
          timestamp: new Date(now - 1_900).toISOString(),
          message: { content: [{
            type: "tool_result",
            tool_use_id: "tool-background-failed",
            content: "Command running in background with ID: task-failed."
          }] },
          toolUseResult: { backgroundTaskId: "task-failed" }
        },
        {
          type: "queue-operation",
          operation: "enqueue",
          timestamp: new Date(now - 1_000).toISOString(),
          content: "<task-notification>\n<task-id>task-failed</task-id>\n<status>failed</status>\n<summary>Background command \"Run checks\" failed (exit code 1)</summary>\n</task-notification>"
        }
      ],
      hookRecords: []
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0].label, "Run checks");
    assert.equal(agents[0].state, "blocked");
    assert.equal(agents[0].isOngoing, false);
  });
});

test("Claude background task output paths stay confined to the matching session task file", async () => {
  await withTempAppData("claude-background-task-path-guard-", async () => {
    const now = Date.now();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "claude-background-task-path-guard-"));
    const unrelatedPath = path.join(tempDir, "unrelated.output");
    await writeFile(unrelatedPath, "must not surface\n", "utf8");

    try {
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId: "session-background-guarded",
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        records: [
          {
            type: "assistant",
            timestamp: new Date(now - 2_000).toISOString(),
            message: { content: [{
              type: "tool_use",
              id: "tool-background-guarded",
              name: "Bash",
              input: { command: "printenv", description: "Guarded task", run_in_background: true }
            }] }
          },
          {
            type: "user",
            timestamp: new Date(now - 1_900).toISOString(),
            message: { content: [{
              type: "tool_result",
              tool_use_id: "tool-background-guarded",
              content: "Command running in background with ID: task-guarded."
            }] },
            toolUseResult: { backgroundTaskId: "task-guarded" }
          },
          {
            type: "queue-operation",
            operation: "enqueue",
            timestamp: new Date(now - 1_000).toISOString(),
            content: `<task-notification>\n<task-id>task-guarded</task-id>\n<output-file>${unrelatedPath}</output-file>\n<status>completed</status>\n<summary>Background command \"Guarded task\" completed (exit code 0)</summary>\n</task-notification>`
          }
        ],
        hookRecords: []
      });

      assert.equal(agents.length, 1);
      assert.equal(agents[0].latestMessage, null);
      assert.equal(agents[0].detail, "Background command \"Guarded task\" completed (exit code 0)");
      assert.deepEqual(agents[0].paths, ["/workspaces/CodexAgentsOffice"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test("Claude Agent task notifications do not create duplicate background-command children", async () => {
  await withTempAppData("claude-background-task-agent-dedupe-", async () => {
    const now = Date.now();
    const agents = await buildClaudeSubagentAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      sessionId: "session-agent-notification",
      cwd: "/workspaces/CodexAgentsOffice",
      updatedAt: now,
      records: [
        {
          type: "user",
          timestamp: new Date(now - 1_500).toISOString(),
          message: { content: [{
            type: "tool_result",
            tool_use_id: "agent-tool-use",
            content: "Agent running in background with ID: agent-worker."
          }] },
          toolUseResult: { backgroundTaskId: "agent-worker" }
        },
        {
          type: "queue-operation",
          operation: "enqueue",
          timestamp: new Date(now - 1_000).toISOString(),
          content: "<task-notification>\n<task-id>agent-worker</task-id>\n<status>completed</status>\n<summary>Agent worker completed</summary>\n</task-notification>"
        }
      ],
      hookRecords: []
    });

    assert.equal(agents.length, 0);
  });
});

test("Claude workflow journal records create and finish inferred child rows", async () => {
  await withTempAppData("claude-workflow-journal-rows-", async () => {
    const now = Date.now();
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "claude-workflow-journal-"));
    const sessionId = "session-workflow-456";
    const journalPath = path.join(projectDir, sessionId, "subagents", "workflows", "workflow-b", "journal.jsonl");
    await writeJsonl(journalPath, [
      {
        type: "agent_started",
        timestamp: new Date(now - 2_000).toISOString(),
        agent_id: "planner",
        agent_type: "planner",
        name: "Planner",
        description: "Plan the renderer check",
        cwd: "/workspaces/CodexAgentsOffice"
      },
      {
        type: "agent_result",
        timestamp: new Date(now - 1_000).toISOString(),
        agent_id: "auditor",
        agent_type: "auditor",
        name: "Auditor",
        result: "Audit complete with one follow-up.",
        cwd: "/workspaces/CodexAgentsOffice"
      }
    ]);

    try {
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId,
        projectDirPath: projectDir,
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        hookRecords: []
      });
      const byThreadId = new Map(agents.map((agent) => [agent.threadId, agent]));

      assert.equal(agents.length, 2);
      assert.equal(byThreadId.get("claude:session-workflow-456:agent:planner")?.state, "running");
      assert.equal(byThreadId.get("claude:session-workflow-456:agent:planner")?.isOngoing, true);
      assert.equal(byThreadId.get("claude:session-workflow-456:agent:auditor")?.state, "done");
      assert.equal(byThreadId.get("claude:session-workflow-456:agent:auditor")?.latestMessage, "Audit complete with one follow-up.");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

test("Claude hook-backed child rows override inferred workflow rows for the same agent", async () => {
  await withTempAppData("claude-workflow-hook-override-", async () => {
    const now = Date.now();
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "claude-workflow-hook-"));
    const sessionId = "session-workflow-789";
    const workflowDir = path.join(projectDir, sessionId, "subagents", "workflows", "workflow-c");
    const transcriptPath = path.join(workflowDir, "agent-reviewer.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "assistant",
        timestamp: new Date(now - 1_000).toISOString(),
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Inferred transcript summary." }]
        }
      }
    ]);
    await writeFile(
      path.join(workflowDir, "agent-reviewer.meta.json"),
      JSON.stringify({
        agentId: "reviewer",
        agentType: "code-reviewer",
        name: "Workflow reviewer",
        cwd: "/workspaces/CodexAgentsOffice"
      }),
      "utf8"
    );
    await writeJsonl(path.join(workflowDir, "journal.jsonl"), [
      {
        type: "agent_result",
        timestamp: new Date(now - 500).toISOString(),
        agent_id: "reviewer",
        agent_type: "code-reviewer",
        name: "Workflow reviewer",
        result: "Journal summary for the same child.",
        cwd: "/workspaces/CodexAgentsOffice"
      }
    ]);

    try {
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId,
        projectDirPath: projectDir,
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        hookRecords: [
          {
            hook_event_name: "PostToolUse",
            timestamp: new Date(now).toISOString(),
            cwd: "/workspaces/CodexAgentsOffice",
            agent_id: "reviewer",
            agent_type: "explorer",
            tool_name: "Bash",
            tool_input: {
              command: "npm test",
              cwd: "/workspaces/CodexAgentsOffice"
            }
          }
        ]
      });

      assert.equal(agents.length, 1);
      assert.equal(agents[0].id, "claude:session-workflow-789:agent:reviewer");
      assert.equal(agents[0].confidence, "typed");
      assert.equal(agents[0].sourceKind, "claude:subagent:explorer");
      assert.equal(agents[0].state, "validating");
      assert.equal(agents[0].activityEvent?.type, "commandExecution");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

test("Claude workflow seeds keep same-named children from separate workflows distinct", async () => {
  await withTempAppData("claude-workflow-distinct-agent-ids-", async () => {
    const now = Date.now();
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "claude-workflow-distinct-"));
    const sessionId = "session-workflow-distinct";
    const workflowADir = path.join(projectDir, sessionId, "subagents", "workflows", "workflow-a");
    const workflowBDir = path.join(projectDir, sessionId, "subagents", "workflows", "workflow-b");
    await writeJsonl(path.join(workflowADir, "agent-reviewer.jsonl"), [
      {
        type: "assistant",
        timestamp: new Date(now - 2_000).toISOString(),
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Workflow A review complete." }]
        }
      }
    ]);
    await writeJsonl(path.join(workflowBDir, "agent-reviewer.jsonl"), [
      {
        type: "assistant",
        timestamp: new Date(now - 1_000).toISOString(),
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Workflow B review complete." }]
        }
      }
    ]);

    try {
      const agents = await buildClaudeSubagentAgentsForTest({
        projectRoot: "/workspaces/CodexAgentsOffice",
        sessionId,
        projectDirPath: projectDir,
        cwd: "/workspaces/CodexAgentsOffice",
        updatedAt: now,
        hookRecords: []
      });
      const byThreadId = new Map(agents.map((agent) => [agent.threadId, agent]));

      assert.equal(agents.length, 2);
      assert.equal(
        byThreadId.get("claude:session-workflow-distinct:agent:workflow:workflow-a:agent:reviewer")?.latestMessage,
        "Workflow A review complete."
      );
      assert.equal(
        byThreadId.get("claude:session-workflow-distinct:agent:workflow:workflow-b:agent:reviewer")?.latestMessage,
        "Workflow B review complete."
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

test("Claude team files create teammate child agents and project floors", async () => {
  await withTempAppData("claude-team-rows-", async () => {
    const now = Date.now();
    const teams = [
      {
        name: "review",
        description: "Review team",
        leadAgentId: "team-lead@review",
        leadSessionId: "lead-123",
        updatedAt: now,
        members: [
          {
            agentId: "security@review",
            name: "security",
            agentType: "security-reviewer",
            model: "claude-sonnet-4-5",
            prompt: "Review auth edge cases",
            color: "#4477aa",
            joinedAt: now,
            tmuxPaneId: "%1",
            cwd: "/workspaces/CodexAgentsOffice",
            worktreePath: "/workspaces/CodexAgentsOffice-review",
            sessionId: "teammate-123",
            subscriptions: [],
            backendType: "tmux",
            isActive: true,
            mode: "default"
          }
        ]
      }
    ];

    const agents = await buildClaudeTeamAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice-review",
      teams
    });
    const floors = discoverClaudeProjectsFromTeamsForTest(teams);

    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "claude:teammate-123");
    assert.equal(agents[0].parentThreadId, "claude:lead-123");
    assert.equal(agents[0].threadId, "teammate-123");
    assert.equal(agents[0].isSubagent, true);
    assert.equal(agents[0].nickname, "security");
    assert.equal(agents[0].role, "security-reviewer");
    assert.equal(agents[0].goal?.kind, "claudeSubagent");
    assert.equal(agents[0].goal?.objective, "Review auth edge cases");
    assert.equal(agents[0].goal?.confidence, "inferred");
    assert.equal(agents[0].cwd, "/workspaces/CodexAgentsOffice-review");
    assert.ok(floors.some((floor) => floor.root === "/workspaces/CodexAgentsOffice-review"));
  });
});

test("stale Claude team active flags do not force loaded lead sessions to run forever", async () => {
  await withTempAppData("claude-stale-team-lead-", async () => {
    const now = Date.now();
    const old = now - 11 * 24 * 60 * 60 * 1000;
    const agents = await buildClaudeLeadAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      sessionId: "lead-123",
      cwd: "/workspaces/CodexAgentsOffice",
      updatedAt: old,
      records: [
        {
          type: "user",
          timestamp: new Date(old).toISOString(),
          message: {
            content: "Review settings.local.json"
          }
        }
      ],
      hookRecords: [],
      teams: [
        {
          name: "review",
          description: "Review team",
          leadAgentId: "team-lead@review",
          leadSessionId: "lead-123",
          updatedAt: old,
          members: [
            {
              agentId: "security@review",
              name: "security",
              agentType: "security-reviewer",
              model: "claude-sonnet-4-6",
              prompt: null,
              color: null,
              joinedAt: old,
              tmuxPaneId: "%0",
              cwd: "/workspaces/CodexAgentsOffice",
              worktreePath: null,
              sessionId: "lead-123",
              subscriptions: [],
              backendType: "tmux",
              isActive: true,
              mode: "default"
            }
          ]
        }
      ]
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0].state, "idle");
    assert.equal(agents[0].isOngoing, false);
    assert.equal(agents[0].statusText, "idle");
    assert.equal(agents[0].activityEvent, null);
  });
});

test("fresh Claude team active flags can still keep loaded lead sessions running", async () => {
  await withTempAppData("claude-fresh-team-lead-", async () => {
    const now = Date.now();
    const old = now - 11 * 24 * 60 * 60 * 1000;
    const agents = await buildClaudeLeadAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      sessionId: "lead-123",
      cwd: "/workspaces/CodexAgentsOffice",
      updatedAt: old,
      records: [
        {
          type: "assistant",
          timestamp: new Date(old).toISOString(),
          message: {
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "Older summary." }]
          }
        }
      ],
      hookRecords: [],
      teams: [
        {
          name: "review",
          description: "Review team",
          leadAgentId: "team-lead@review",
          leadSessionId: "lead-123",
          updatedAt: now - 30_000,
          members: [
            {
              agentId: "security@review",
              name: "security",
              agentType: "security-reviewer",
              model: "claude-sonnet-4-6",
              prompt: null,
              color: null,
              joinedAt: old,
              tmuxPaneId: "%0",
              cwd: "/workspaces/CodexAgentsOffice",
              worktreePath: null,
              sessionId: "lead-123",
              subscriptions: [],
              backendType: "tmux",
              isActive: true,
              mode: "default"
            }
          ]
        }
      ]
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0].state, "running");
    assert.equal(agents[0].isOngoing, true);
    assert.equal(agents[0].statusText, "running");
  });
});

test("Claude Home local work sessions create workspace floors and read-only agents", async () => {
  await withTempAppData("claude-cowork-rows-", async () => {
    const now = Date.now();
    const sessions = [
      {
        sessionId: "local_93d9682b-41c3-4903-a969-9531b87dc7e4",
        cliSessionId: "ec813396-85ee-4e90-a82d-94262f7923bb",
        processName: "serene-practical-feynman",
        vmProcessName: "serene-practical-feynman",
        title: "Write squirrel story with conflict",
        initialMessage: "write a story about a squirrel, with deep conflict, save as md file",
        model: "claude-opus-4-7",
        spaceId: "1e7cd9fb-3d71-4af9-932a-a44204254ebb",
        roots: ["/mnt/f/AI/Projects/ClaudeTest/Test Proj"],
        filePaths: ["/mnt/f/AI/Projects/ClaudeTest/Test Proj/the_last_acorn.md"],
        createdAt: now - 60_000,
        updatedAt: now - 30_000,
        isArchived: false
      }
    ];
    const spaces = [
      {
        id: "1e7cd9fb-3d71-4af9-932a-a44204254ebb",
        name: "Test Proj",
        root: "/mnt/f/AI/Projects/ClaudeTest/Test Proj",
        instructions: "Create a story document about a squirrel",
        updatedAt: now - 45_000
      }
    ];

    const agents = await buildClaudeCoworkAgentsForTest({
      projectRoot: "/mnt/f/AI/Projects/ClaudeTest/Test Proj",
      sessions
    });
    const floors = discoverClaudeProjectsFromCoworkForTest({
      spaces,
      sessions
    });

    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "claude:cowork:local_93d9682b-41c3-4903-a969-9531b87dc7e4");
    assert.equal(agents[0].sourceKind, "claude:cowork:claude-opus-4-7");
    assert.equal(agents[0].threadId, "local_93d9682b-41c3-4903-a969-9531b87dc7e4");
    assert.equal(agents[0].statusText, "home");
    assert.equal(agents[0].role, "home work");
    assert.equal(agents[0].state, "thinking");
    assert.equal(agents[0].activityEvent?.type, "fileChange");
    assert.equal(agents[0].goal?.kind, "claudeCowork");
    assert.equal(agents[0].goal?.objective, "Write squirrel story with conflict");
    assert.equal(agents[0].goal?.confidence, "inferred");
    const coworkFloor = floors.find((floor) => floor.root === "/mnt/f/AI/Projects/ClaudeTest/Test Proj");
    assert.ok(coworkFloor);
    assert.equal(coworkFloor.sourceKind, "claude:cowork");
    assert.deepEqual(coworkFloor.sourceKinds, ["claude:cowork"]);
  });
});

test("Claude background job state creates workspace floors and read-only agents", async () => {
  await withTempAppData("claude-background-rows-", async () => {
    const now = Date.now();
    const job = normalizeClaudeBackgroundJobForTest(
      "job-123",
      {
        session: {
          sessionId: "session-bg-123",
          cwd: "/workspaces/CodexAgentsOffice/.claude/worktrees/job-123"
        },
        projectRoot: "/workspaces/CodexAgentsOffice",
        name: "collision detection",
        status: "needs_input",
        currentActivity: "needs input: choose double jump or wall climb",
        prompt: "Fix the platformer collision regression",
        updatedAt: new Date(now - 1_000).toISOString()
      },
      now
    );

    assert.ok(job);
    assert.equal(job.state, "waiting");
    assert.equal(job.isOngoing, true);

    const agents = await buildClaudeBackgroundAgentsForTest({
      projectRoot: "/workspaces/CodexAgentsOffice",
      jobs: [job]
    });
    const floors = discoverClaudeProjectsFromBackgroundJobsForTest([job]);

    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "claude:session-bg-123");
    assert.equal(agents[0].sourceKind, "claude:background");
    assert.equal(agents[0].threadId, "session-bg-123");
    assert.equal(agents[0].taskId, "job-123");
    assert.equal(agents[0].state, "waiting");
    assert.equal(agents[0].cwd, "/workspaces/CodexAgentsOffice/.claude/worktrees/job-123");
    assert.equal(agents[0].resumeCommand, "claude attach job-123");
    assert.deepEqual(agents[0].paths, [
      "/workspaces/CodexAgentsOffice",
      "/workspaces/CodexAgentsOffice/.claude/worktrees/job-123"
    ]);
    assert.equal(agents[0].latestMessage, null);
    assert.equal(agents[0].liveSubscription, "readOnly");
    assert.equal(agents[0].confidence, "typed");
    assert.equal(agents[0].goal?.kind, "claudeBackground");
    assert.equal(agents[0].goal?.objective, "Fix the platformer collision regression");
    assert.equal(agents[0].goal?.confidence, "inferred");
    const backgroundFloor = floors.find((floor) => floor.root === "/workspaces/CodexAgentsOffice");
    assert.ok(backgroundFloor);
    assert.equal(backgroundFloor.sourceKind, "claude:background");
    assert.deepEqual(backgroundFloor.sourceKinds, ["claude:background"]);
  });
});

test("failed Claude background job state cools off instead of staying ongoing", () => {
  const now = Date.now();
  const job = normalizeClaudeBackgroundJobForTest(
    "job-failed",
    {
      cwd: "/workspaces/CodexAgentsOffice",
      status: "failed",
      message: "Tool process failed",
      updatedAt: new Date(now - 1_000).toISOString()
    },
    now
  );

  assert.ok(job);
  assert.equal(job.state, "blocked");
  assert.equal(job.isOngoing, false);
});

test("synthetic Claude model placeholders do not leak into agent labels", () => {
  const summary = summariseClaudeSession(
    "f06cc37e-5ca7-4c5e-9eba-4bf8e99e536a",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: "2026-03-25T21:18:22.366Z",
        cwd: "/workspaces/CodexAgentsOffice",
        message: {
          model: "<synthetic>",
          content: [
            {
              type: "text",
              text: "Please run /login · API Error: 401"
            }
          ]
        }
      }
    ],
    Date.parse("2026-03-25T21:18:22.366Z")
  );

  assert.equal(summary.label, "Claude f06c");
});

test("Claude transcript ai-title wins over model fallback labels", () => {
  const now = Date.now();
  const summary = summariseClaudeSession(
    "session-1234",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "ai-title",
        aiTitle: "Track live Claude workers",
        sessionId: "session-1234"
      },
      {
        type: "assistant",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        message: {
          model: "claude-opus-4-8-20260530",
          content: [
            {
              type: "text",
              text: "I am checking the agent roster."
            }
          ]
        }
      }
    ],
    now
  );

  assert.equal(summary.label, "Track live Claude workers");
  assert.equal(summary.goal?.kind, "claudeSession");
  assert.equal(summary.goal?.objective, "Track live Claude workers");
  assert.equal(summary.goal?.confidence, "inferred");
  assert.equal(summary.goal?.status, "active");
  assert.notEqual(summary.label, "Claude opus 4 8");
});

test("Claude SDK session title wins over transcript model fallback labels", () => {
  const now = Date.now();
  const summary = summariseClaudeSession(
    "session-5678",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        message: {
          model: "claude-opus-4-8-20260530",
          content: [
            {
              type: "text",
              text: "I am checking the agent roster."
            }
          ]
        }
      }
    ],
    now,
    [],
    "Claude roster audit"
  );

  assert.equal(summary.label, "Claude roster audit");
  assert.equal(summary.goal?.kind, "claudeSession");
  assert.equal(summary.goal?.objective, "Claude roster audit");
  assert.equal(summary.goal?.confidence, "inferred");
  assert.equal(summary.goal?.status, "active");
  assert.notEqual(summary.label, "Claude opus 4 8");
});

test("typed Claude file-change hooks become editing file-change activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "FileChanged",
      cwd: "/workspaces/CodexAgentsOffice",
      file_path: "/workspaces/CodexAgentsOffice/README.md",
      event: "change"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "editing");
  assert.equal(summary.activityEvent?.type, "fileChange");
  assert.equal(summary.activityEvent?.action, "edited");
  assert.deepEqual(summary.paths, ["/workspaces/CodexAgentsOffice/README.md", "/workspaces/CodexAgentsOffice"]);
});

test("typed Claude notification hooks surface a recent agent message", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "Notification",
      cwd: "/workspaces/CodexAgentsOffice",
      title: "Checkpoint",
      message: "Analyzing renderer layout",
      notification_type: "info"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "thinking");
  assert.equal(summary.activityEvent?.type, "agentMessage");
  assert.equal(summary.latestMessage, "Analyzing renderer layout");
});

test("Cursor generic typed session-start falls back to planning instead of synthetic thinking", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-sessionstart-"));
  const projectRoot = path.join(tempRoot, "project");
  const hooksDir = path.join(projectRoot, ".codex-agents", "cursor-hooks");
  const sessionId = "cursor-hook-sessionstart";
  const hookFile = path.join(hooksDir, `${sessionId}.jsonl`);
  const now = Date.now();
  await mkdir(projectRoot, { recursive: true });
  await mkdir(hooksDir, { recursive: true });

  const hookLines = [
    JSON.stringify({
      conversation_id: sessionId,
      hook_event_name: "sessionStart",
      timestamp: new Date(now).toISOString(),
      workspace_roots: [projectRoot],
      model: "composer-2-fast"
    })
  ].join("\n") + "\n";

  await writeFile(hookFile, hookLines);

  const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0].confidence, "typed");
  assert.equal(snapshot.agents[0].state, "planning");
  assert.equal(snapshot.agents[0].detail, "Session started");
});

test("stale Claude hook-backed live states decay to done instead of staying ongoing forever", () => {
  const now = Date.now();
  const hookTimestamp = new Date(now - 5 * 60 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [],
    now,
    [
      {
        hook_event_name: "PostToolUse",
        timestamp: hookTimestamp,
        cwd: "/workspaces/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/workspaces/CodexAgentsOffice"
        }
      }
    ]
  );

  assert.equal(summary.state, "done");
  assert.equal(summary.isOngoing, false);
  assert.equal(summary.activityEvent, null);
});

test("stale Claude transcript tool activity does not stay ongoing forever", () => {
  const now = Date.now();
  const oldTimestamp = new Date(now - 11 * 24 * 60 * 60 * 1000).toISOString();

  for (const [toolName, input] of [
    ["Edit", { file_path: "/workspaces/CodexAgentsOffice/.claude/settings.local.json" }],
    ["Bash", { command: "npm test", cwd: "/workspaces/CodexAgentsOffice" }]
  ]) {
    const summary = summariseClaudeSession(
      `session-${toolName}`,
      "/workspaces/CodexAgentsOffice",
      [
        {
          type: "assistant",
          timestamp: oldTimestamp,
          message: {
            model: "claude-sonnet-4-6",
            content: [
              {
                type: "tool_use",
                name: toolName,
                input
              }
            ]
          }
        }
      ],
      now
    );

    assert.equal(summary.state, "idle");
    assert.equal(summary.detail, "Idle");
    assert.equal(summary.isOngoing, false);
    assert.equal(summary.activityEvent, null);
  }
});

test("fresh Claude transcript tool activity still stays ongoing", () => {
  const now = Date.now();
  const freshTimestamp = new Date(now - 30 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-fresh-bash",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: freshTimestamp,
        message: {
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command: "npm test",
                cwd: "/workspaces/CodexAgentsOffice"
              }
            }
          ]
        }
      }
    ],
    now
  );

  assert.equal(summary.state, "validating");
  assert.equal(summary.isOngoing, true);
  assert.equal(summary.activityEvent?.type, "commandExecution");
});

test("stale Claude transcript user prompts do not stay in planning forever", () => {
  const now = Date.now();
  const oldTimestamp = new Date(now - 11 * 24 * 60 * 60 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "user",
        timestamp: oldTimestamp,
        message: {
          content: "Fix the renderer and update settings.local.json"
        }
      }
    ],
    now
  );

  assert.equal(summary.state, "idle");
  assert.equal(summary.detail, "Idle");
  assert.equal(summary.isOngoing, false);
  assert.equal(summary.activityEvent, null);
});

test("hook-backed Claude sessions still surface assistant reply text", () => {
  const now = Date.now();
  const toolTimestamp = new Date(now - 60 * 1000).toISOString();
  const replyTimestamp = new Date(now - 30 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: replyTimestamp,
        cwd: "/workspaces/CodexAgentsOffice",
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Finished the pass and updated the renderer."
            }
          ]
        }
      }
    ],
    now,
    [
      {
        hook_event_name: "PostToolUse",
        timestamp: toolTimestamp,
        cwd: "/workspaces/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/workspaces/CodexAgentsOffice"
        }
      }
    ]
  );

  assert.equal(summary.latestMessage, "Finished the pass and updated the renderer.");
  assert.equal(summary.activityEvent?.type, "agentMessage");
  assert.equal(summary.state, "thinking");
});

test("Claude session events include the latest assistant reply and file-change hooks", () => {
  const now = Date.now();
  const events = buildClaudeSessionEventsForTest({
    sessionId: "session-123",
    fallbackCwd: "/workspaces/CodexAgentsOffice",
    records: [
      {
        type: "assistant",
        timestamp: new Date(now - 2_000).toISOString(),
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Updated /workspaces/CodexAgentsOffice/README.md"
            }
          ]
        }
      }
    ],
    fallbackUpdatedAt: now,
    hookRecords: [
      {
        hook_event_name: "FileChanged",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        file_path: "/workspaces/CodexAgentsOffice/README.md",
        event: "change"
      }
    ]
  });

  assert.ok(events.some((event) => event.kind === "message" && event.method === "claude/agentMessage"));
  assert.ok(events.some((event) => event.kind === "fileChange" && event.method === "claude/fileChange"));
  assert.ok(events.every((event) => event.threadId === "session-123"));
});

test("Claude SDK message normalization preserves top-level timestamps", () => {
  const normalizedUser = normalizeClaudeSdkMessageForTest(
    {
      type: "user",
      uuid: "user-1",
      session_id: "session-123",
      parent_tool_use_id: null,
      timestamp: "2026-03-26T10:00:00.000Z",
      message: {
        role: "user",
        content: "hello"
      }
    },
    {
      cwd: "/workspaces/CodexAgentsOffice",
      gitBranch: "main"
    }
  );
  const normalizedAssistant = normalizeClaudeSdkMessageForTest(
    {
      type: "assistant",
      uuid: "assistant-1",
      session_id: "session-123",
      parent_tool_use_id: null,
      timestamp: "2026-03-26T10:00:02.000Z",
      message: {
        model: "claude-sonnet-4-5",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "done"
          }
        ]
      }
    },
    {
      cwd: "/workspaces/CodexAgentsOffice",
      gitBranch: "main"
    }
  );

  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [normalizedUser, normalizedAssistant],
    Date.parse("2026-03-26T10:00:02.000Z")
  );

  assert.equal(summary.latestMessage, "done");
  assert.equal(summary.detail, "done");
});

test("synthetic Claude command wrapper user records do not override assistant replies", () => {
  const now = Date.now();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: new Date(now - 2_000).toISOString(),
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Actual assistant reply"
            }
          ]
        }
      },
      {
        type: "user",
        timestamp: new Date(now - 1_000).toISOString(),
        message: {
          content: "<local-command-stdout>Bye!</local-command-stdout>"
        }
      }
    ],
    now
  );

  assert.equal(summary.latestMessage, "Actual assistant reply");
  assert.equal(summary.detail, "Actual assistant reply");
});

test("Claude transcript metadata touches do not revive stale tool activity after a final reply", () => {
  const now = Date.now();
  const toolAt = new Date(now - 21 * 60_000).toISOString();
  const finalAt = new Date(now - 20 * 60_000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: toolAt,
        message: {
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: {
                file_path: "/workspaces/CodexAgentsOffice/docs/spec.md"
              }
            }
          ]
        }
      },
      {
        type: "user",
        timestamp: new Date(now - 20 * 60_000 - 500).toISOString(),
        message: {
          content: [
            {
              type: "tool_result",
              content: "large file content should not become a user prompt"
            }
          ]
        }
      },
      {
        type: "assistant",
        timestamp: finalAt,
        message: {
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: "Finished reviewing the project."
            }
          ]
        }
      },
      {
        type: "last-prompt",
        lastPrompt: "review this",
        sessionId: "session-123"
      },
      {
        type: "ai-title",
        aiTitle: "Review project",
        sessionId: "session-123"
      }
    ],
    now
  );

  assert.equal(summary.state, "idle");
  assert.equal(summary.isOngoing, false);
  assert.equal(summary.detail, "Finished reviewing the project.");
  assert.equal(summary.latestMessage, "Finished reviewing the project.");
  assert.equal(summary.activityEvent, null);
  assert.equal(summary.updatedAt, finalAt);
});

test("recent Claude final replies cool off without staying ongoing as active work", () => {
  const now = Date.now();
  const finalAt = new Date(now - 5 * 60_000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: finalAt,
        message: {
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "text",
              text: "All done."
            }
          ]
        }
      }
    ],
    now
  );

  assert.equal(summary.state, "done");
  assert.equal(summary.isOngoing, false);
});

test("Claude SDK sidecar hooks append typed hook records per session", async () => {
  await withTempAppData("claude-hooks-storage-", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "claude-hooks-"));
    const hooks = createClaudeSdkSidecarHooks({
      projectRoot,
      watchPaths: [projectRoot]
    });
    const matcher = hooks.SessionStart?.[0];
    assert.ok(matcher);

    const output = await matcher.hooks[0]({
      hook_event_name: "SessionStart",
      session_id: "session-123",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: projectRoot,
      source: "startup"
    }, undefined, {
      signal: AbortSignal.timeout(1000)
    });

    assert.equal(output.continue, true);
    assert.deepEqual(output.hookSpecificOutput, {
      hookEventName: "SessionStart",
      watchPaths: [projectRoot]
    });

    const sidecar = await readFile(claudeHooksFilePath(projectRoot, "session-123"), "utf8");
    const [recordText] = sidecar.trim().split("\n");
    const record = JSON.parse(recordText);
    assert.equal(record.hook_source, "claude-agent-sdk");
    assert.equal(record.hook_event_name, "SessionStart");
    assert.equal(record.session_id, "session-123");
  });
});

test("Claude SDK permission hooks can be answered from Agents Office", async () => {
  await withTempAppData("claude-permission-storage-", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "claude-permission-response-"));
    const hooks = createClaudeSdkSidecarHooks({
      projectRoot
    });
    const matcher = hooks.PermissionRequest?.[0];
    assert.ok(matcher);

    const pending = matcher.hooks[0]({
      hook_event_name: "PermissionRequest",
      session_id: "session-123",
      cwd: projectRoot,
      tool_name: "Bash",
      tool_input: {
        command: "npm publish",
        cwd: projectRoot
      }
    }, undefined, {
      signal: AbortSignal.timeout(2_000)
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const sidecarBefore = await readFile(claudeHooksFilePath(projectRoot, "session-123"), "utf8");
    const requestRecord = JSON.parse(sidecarBefore.trim().split("\n")[0]);
    await respondToClaudeHookPermissionRequest(projectRoot, "session-123", requestRecord.request_id, "accept");
    const output = await pending;

    assert.equal(output.continue, true);
    assert.deepEqual(output.hookSpecificOutput, {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow"
      }
    });
  });
});

test("Claude SDK elicitation hooks can be answered from Agents Office", async () => {
  await withTempAppData("claude-input-storage-", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "claude-input-response-"));
    const hooks = createClaudeSdkSidecarHooks({
      projectRoot
    });
    const matcher = hooks.Elicitation?.[0];
    assert.ok(matcher);

    const pending = matcher.hooks[0]({
      hook_event_name: "Elicitation",
      session_id: "session-123",
      cwd: projectRoot,
      message: "Choose a mode",
      requested_schema: {
        type: "object",
        required: ["mode"],
        properties: {
          mode: {
            type: "string",
            title: "Mode",
            enum: ["Fast", "Safe"]
          },
          notes: {
            type: "string",
            title: "Notes"
          }
        }
      }
    }, undefined, {
      signal: AbortSignal.timeout(2_000)
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const sidecar = await readFile(claudeHooksFilePath(projectRoot, "session-123"), "utf8");
    const requestRecord = JSON.parse(sidecar.trim().split("\n")[0]);
    await respondToClaudeHookInputRequest(
      projectRoot,
      "session-123",
      requestRecord.request_id,
      [
        {
          header: "Mode",
          id: "mode",
          question: "Mode",
          required: true,
          options: [
            { label: "Fast", description: "Fast" },
            { label: "Safe", description: "Safe" }
          ]
        },
        {
          header: "Notes",
          id: "notes",
          question: "Notes",
          required: false,
          options: null
        }
      ],
      {
        mode: { answers: ["Fast"] }
      }
    );
    const output = await pending;

    assert.equal(output.continue, true);
    assert.deepEqual(output.hookSpecificOutput, {
      hookEventName: "Elicitation",
      action: "accept",
      content: {
        mode: "Fast"
      }
    });
  });
});

test("synthetic Agents Office Claude resolution records clear needsUser state", () => {
  const now = Date.now();
  const summary = summariseClaudeSession(
    "session-123",
    "/workspaces/CodexAgentsOffice",
    [],
    now,
    [
      {
        hook_event_name: "PermissionRequest",
        hook_source: "claude-agent-sdk",
        request_id: "req_42",
        timestamp: new Date(now - 1_000).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm publish",
          cwd: "/workspaces/CodexAgentsOffice"
        }
      },
      {
        hook_event_name: "AgentsOfficePermissionDecision",
        hook_source: "agents-office",
        request_id: "req_42",
        action: "accept",
        timestamp: new Date(now).toISOString(),
        cwd: "/workspaces/CodexAgentsOffice"
      }
    ]
  );

  assert.equal(summary.state, "planning");
  assert.equal(summary.needsUser, null);
  assert.equal(summary.detail, "Permission approved");
});

test("cursor repository URLs normalize across ssh and https forms", () => {
  assert.equal(
    normalizeRepositoryUrl("git@github.com:OpenAI/CodexAgentsOffice.git"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("https://github.com/OpenAI/CodexAgentsOffice.git"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("ssh://git@github.com/OpenAI/CodexAgentsOffice.git"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("https://github.com/OpenAI/CodexAgentsOffice/pull/42"),
    "https://github.com/openai/codexagentsoffice"
  );
  assert.equal(
    normalizeRepositoryUrl("https://gitlab.example.com/team/platform/CodexAgentsOffice/-/merge_requests/42"),
    "https://gitlab.example.com/team/platform/codexagentsoffice"
  );
});

test("cursor background agent statuses map into workload states", () => {
  assert.equal(cursorStatusToActivityState("CREATING"), "running");
  assert.equal(cursorStatusToActivityState("RUNNING"), "running");
  assert.equal(cursorStatusToActivityState("FINISHED"), "done");
  assert.equal(cursorStatusToActivityState("ERROR"), "blocked");
  assert.equal(cursorStatusToActivityState("EXPIRED"), "idle");
});

test("cursor cloud snapshot maps conversation messages into typed activity and events", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-cloud-snapshot-"));
  await execFileAsync("git", ["init", projectRoot]);
  await execFileAsync("git", ["-C", projectRoot, "remote", "add", "origin", "https://github.com/example-org/CodexAgentsOffice.git"]);

  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousFetch = global.fetch;
  process.env.CURSOR_API_KEY = "cursor_test_12345678";
  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v0/agents?")) {
      return new Response(JSON.stringify({
        agents: [
          {
            id: "agent-123",
            name: "Cursor cloud task",
            status: "RUNNING",
            createdAt: "2026-03-27T00:00:00.000Z",
            updatedAt: "2026-03-27T00:01:00.000Z",
            summary: "Implementing cursor conversation polling",
            source: {
              repository: "https://github.com/example-org/CodexAgentsOffice.git",
              ref: "main"
            },
            target: {
              url: "https://cursor.com/agents/agent-123",
              branchName: "cursor/conversation-polling",
              prUrl: null,
              autoCreatePr: false
            },
            model: "gpt-5"
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/v0/agents/agent-123/conversation")) {
      return new Response(JSON.stringify({
        messages: [
          {
            id: "message-1",
            type: "user_message",
            text: "Please implement Cursor toast support"
          },
          {
            id: "message-2",
            type: "assistant_message",
            text: "Implemented Cursor toast support."
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const snapshot = await loadCursorCloudProjectSnapshotData(projectRoot, {
      emitConversationEvents: true
    });
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].threadId, "agent-123");
    assert.equal(snapshot.agents[0].latestMessage, "Implemented Cursor toast support.");
    assert.equal(snapshot.agents[0].activityEvent?.type, "agentMessage");
    assert.equal(snapshot.events.length, 2);
    assert.equal(snapshot.events[0].source, "cursor");
    assert.equal(snapshot.events[0].confidence, "typed");
    assert.equal(snapshot.events[0].threadId, "agent-123");
    assert.equal(snapshot.events[0].kind, "message");
    assert.equal(snapshot.events[1].detail, "Please implement Cursor toast support");
  } finally {
    if (typeof previousCursorApiKey === "string") {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    global.fetch = previousFetch;
  }
});

test("cursor cloud API uses documented bearer auth before legacy fallback", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-cloud-auth-"));
  await execFileAsync("git", ["init", projectRoot]);
  await execFileAsync("git", ["-C", projectRoot, "remote", "add", "origin", "https://github.com/example-org/CodexAgentsOffice.git"]);

  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousFetch = global.fetch;
  const authorizations = [];
  process.env.CURSOR_API_KEY = "cursor_test_12345678";
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    authorizations.push(init?.headers?.Authorization);
    if (url.includes("/v0/agents?")) {
      return new Response(JSON.stringify({ agents: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    await loadCursorCloudProjectSnapshotData(projectRoot);
    assert.deepEqual(authorizations, ["Bearer cursor_test_12345678"]);
  } finally {
    if (previousCursorApiKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    }
    global.fetch = previousFetch;
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("cursor cloud adapter suppresses historical conversation toasts on first refresh and emits only new messages later", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-cloud-adapter-"));
  await execFileAsync("git", ["init", projectRoot]);
  await execFileAsync("git", ["-C", projectRoot, "remote", "add", "origin", "https://github.com/example-org/CodexAgentsOffice.git"]);

  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousFetch = global.fetch;
  process.env.CURSOR_API_KEY = "cursor_test_12345678";

  let conversationMessages = [
    {
      id: "message-1",
      type: "user_message",
      text: "Initial prompt"
    },
    {
      id: "message-2",
      type: "assistant_message",
      text: "Initial reply"
    }
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/v0/agents?")) {
      return new Response(JSON.stringify({
        agents: [
          {
            id: "agent-123",
            name: "Cursor cloud task",
            status: "RUNNING",
            createdAt: "2026-03-27T00:00:00.000Z",
            updatedAt: "2026-03-27T00:01:00.000Z",
            summary: "Implementing cursor conversation polling",
            source: {
              repository: "https://github.com/example-org/CodexAgentsOffice.git",
              ref: "main"
            },
            target: {
              url: "https://cursor.com/agents/agent-123",
              branchName: "cursor/conversation-polling",
              prUrl: null,
              autoCreatePr: false
            },
            model: "gpt-5"
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/v0/agents/agent-123/conversation")) {
      return new Response(JSON.stringify({ messages: conversationMessages }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const source = cursorCloudAdapter.createSource({ projectRoot });
    await source.warm();
    const firstSnapshot = source.getCachedSnapshot();
    assert.equal(firstSnapshot.events.length, 0);
    assert.equal(firstSnapshot.agents[0].latestMessage, "Initial reply");

    conversationMessages = [
      ...conversationMessages,
      {
        id: "message-3",
        type: "assistant_message",
        text: "Follow-up reply"
      }
    ];

    await source.refresh("interval");
    const secondSnapshot = source.getCachedSnapshot();
    assert.equal(secondSnapshot.events.length, 1);
    assert.equal(secondSnapshot.events[0].detail, "Follow-up reply");
    assert.equal(secondSnapshot.agents[0].latestMessage, "Follow-up reply");
    await source.dispose();
  } finally {
    if (typeof previousCursorApiKey === "string") {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    global.fetch = previousFetch;
  }
});

test("cursor local snapshot ignores workspace-state inference when no typed hooks exist", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const composerId = "composer-1234";
  const composerData = JSON.stringify({
    allComposers: [
      {
        type: "head",
        composerId,
        name: "Local Cursor test",
        subtitle: "Scanning renderer files",
        createdAt: now - 30_000,
        lastUpdatedAt: now - 5_000,
        unifiedMode: "agent",
        filesChangedCount: 2,
        totalLinesAdded: 4,
        totalLinesRemoved: 1,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [composerId],
    lastFocusedComposerIds: [composerId]
  });
  const prompts = JSON.stringify([{ text: "Inspect the local Cursor adapter", commandType: 4 }]);
  const generations = JSON.stringify([
    {
      unixMs: now - 4_000,
      generationUUID: "generation-1",
      type: "composer",
      textDescription: "Inspect the local Cursor adapter"
    }
  ]);
  const backgroundComposer = JSON.stringify({
    cachedSelectedGitState: {
      ref: "main",
      continueRef: "main"
    }
  });

  const rawState = Buffer.concat([
    Buffer.from(`noise composer.composerData${composerData.slice(0, 96)}`, "utf8"),
    Buffer.from([0, 1, 2]),
    Buffer.from(composerData.slice(96), "utf8"),
    Buffer.from([0]),
    Buffer.from(` aiService.prompts${prompts}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(` aiService.generations${generations}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(` workbench.backgroundComposer.workspacePersistentData${backgroundComposer}`, "utf8")
  ]);

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), rawState);
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 0);
    assert.equal(snapshot.events.length, 0);
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot ignores retained workspace composers when no typed hooks exist", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-retained-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const activeComposerId = "composer-active";
  const staleComposerId = "composer-stale";
  const composerData = JSON.stringify({
    allComposers: [
      {
        composerId: activeComposerId,
        name: "Active Cursor chat",
        subtitle: "Editing renderer",
        createdAt: now - 60_000,
        lastUpdatedAt: now - 5_000,
        unifiedMode: "agent",
        filesChangedCount: 1,
        totalLinesAdded: 3,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      },
      {
        composerId: staleComposerId,
        name: "Old retained chat",
        subtitle: "Previously asked a question",
        createdAt: now - (2 * 60 * 60 * 1000),
        lastUpdatedAt: now - (90 * 60 * 1000),
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [activeComposerId, staleComposerId],
    lastFocusedComposerIds: [activeComposerId, staleComposerId]
  });
  const prompts = JSON.stringify([{ text: "Inspect the current Cursor chat", commandType: 4 }]);
  const generations = JSON.stringify([
    {
      unixMs: now - 4_000,
      generationUUID: "generation-active",
      type: "composer",
      textDescription: "Inspect the current Cursor chat"
    }
  ]);

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), Buffer.from([
      `composer.composerData${composerData}`,
      ` aiService.prompts${prompts}`,
      ` aiService.generations${generations}`
    ].join("\0"), "utf8"));
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 0);
    assert.equal(snapshot.events.length, 0);
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot ignores focused workspace composers when no typed hooks exist", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-focused-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const staleSelectedComposerId = "composer-stale-selected";
  const focusedComposerId = "composer-focused";
  const composerData = JSON.stringify({
    allComposers: [
      {
        composerId: staleSelectedComposerId,
        name: "Stale selected tab",
        subtitle: "Old work",
        createdAt: now - (2 * 60 * 60 * 1000),
        lastUpdatedAt: now - (90 * 60 * 1000),
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      },
      {
        composerId: focusedComposerId,
        name: "Focused Cursor task",
        subtitle: "Read package.json, CHANGELOG.md",
        createdAt: now - 60_000,
        lastUpdatedAt: now - 4_000,
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [staleSelectedComposerId, focusedComposerId],
    lastFocusedComposerIds: [focusedComposerId, staleSelectedComposerId]
  });
  const prompts = JSON.stringify([{ text: "Read package.json, CHANGELOG.md", commandType: 4 }]);
  const generations = JSON.stringify([
    {
      unixMs: now - 3_000,
      generationUUID: "generation-focused",
      type: "composer",
      textDescription: "Read package.json, CHANGELOG.md"
    }
  ]);

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), Buffer.from([
      `composer.composerData${composerData}`,
      ` aiService.prompts${prompts}`,
      ` aiService.generations${generations}`
    ].join("\0"), "utf8"));
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 0);
    assert.equal(snapshot.events.length, 0);
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot ignores transcript-only state when no typed hooks exist", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-transcript-"));
  const projectRoot = path.join(tempRoot, "project");
  const workspaceStorageDir = path.join(tempRoot, "workspaceStorage");
  const logsDir = path.join(tempRoot, "logs");
  const workspaceDir = path.join(workspaceStorageDir, "workspace-1");
  const cursorProjectsDir = path.join(tempRoot, "cursor-projects");
  const projectSlug = projectRoot.replace(/^\/+/, "").replace(/[\\/]+/g, "-");
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const transcriptDir = path.join(cursorProjectsDir, projectSlug, "agent-transcripts", sessionId);
  await mkdir(projectRoot, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(logsDir, "20260326T120000"), { recursive: true });
  await mkdir(transcriptDir, { recursive: true });

  const previousWorkspaceStorageDir = process.env.CURSOR_WORKSPACE_STORAGE_DIR;
  const previousLogsDir = process.env.CURSOR_LOGS_DIR;
  const previousCursorUserDataDir = process.env.CURSOR_USER_DATA_DIR;
  const previousCursorProjectsDir = process.env.CURSOR_PROJECTS_DIR;
  process.env.CURSOR_WORKSPACE_STORAGE_DIR = workspaceStorageDir;
  process.env.CURSOR_LOGS_DIR = logsDir;
  process.env.CURSOR_PROJECTS_DIR = cursorProjectsDir;
  delete process.env.CURSOR_USER_DATA_DIR;

  const now = Date.now();
  const composerId = "sqlite-composer";
  const composerData = JSON.stringify({
    allComposers: [
      {
        composerId,
        name: "Old sqlite composer",
        subtitle: "Should not win over transcript data",
        createdAt: now - (3 * 60 * 60 * 1000),
        lastUpdatedAt: now - (2 * 60 * 60 * 1000),
        unifiedMode: "agent",
        filesChangedCount: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        hasBlockingPendingActions: false,
        isArchived: false,
        createdOnBranch: "main",
        branches: []
      }
    ],
    selectedComposerIds: [composerId],
    lastFocusedComposerIds: [composerId]
  });
  const transcriptFile = path.join(transcriptDir, `${sessionId}.jsonl`);
  const transcriptLines = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<user_query>\nInspect the transcript-backed Cursor adapter\n</user_query>" }
        ]
      }
    }),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the transcript-backed Cursor adapter now." }
        ]
      }
    })
  ].join("\n") + "\n";

  try {
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({
      folder: pathToFileURL(projectRoot).toString()
    }));
    await writeFile(path.join(workspaceDir, "state.vscdb"), Buffer.from([
      `composer.composerData${composerData}`
    ].join("\0"), "utf8"));
    await writeFile(path.join(logsDir, "20260326T120000", "main.log"), "");
    await writeFile(transcriptFile, transcriptLines);

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 0);
    assert.equal(snapshot.events.length, 0);
  } finally {
    if (typeof previousWorkspaceStorageDir === "string") {
      process.env.CURSOR_WORKSPACE_STORAGE_DIR = previousWorkspaceStorageDir;
    } else {
      delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    }
    if (typeof previousLogsDir === "string") {
      process.env.CURSOR_LOGS_DIR = previousLogsDir;
    } else {
      delete process.env.CURSOR_LOGS_DIR;
    }
    if (typeof previousCursorProjectsDir === "string") {
      process.env.CURSOR_PROJECTS_DIR = previousCursorProjectsDir;
    } else {
      delete process.env.CURSOR_PROJECTS_DIR;
    }
    if (typeof previousCursorUserDataDir === "string") {
      process.env.CURSOR_USER_DATA_DIR = previousCursorUserDataDir;
    } else {
      delete process.env.CURSOR_USER_DATA_DIR;
    }
  }
});

test("cursor local snapshot ignores transcript tool activity when no typed hooks exist", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-transcript-edit-"));
  const projectRoot = path.join(tempRoot, "project");
  const cursorProjectsDir = path.join(tempRoot, "cursor-projects");
  const projectSlug = projectRoot.replace(/^\/+/, "").replace(/[\\/]+/g, "-");
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const transcriptDir = path.join(cursorProjectsDir, projectSlug, "agent-transcripts", sessionId);
  const transcriptFile = path.join(transcriptDir, `${sessionId}.jsonl`);
  await mkdir(projectRoot, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });

  const previousCursorProjectsDir = process.env.CURSOR_PROJECTS_DIR;
  process.env.CURSOR_PROJECTS_DIR = cursorProjectsDir;

  const transcriptLines = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<user_query>\nPatch the README spacing\n</user_query>" }
        ]
      }
    }),
    JSON.stringify({
      role: "assistant",
      model: "claude-3.7-sonnet",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/tmp/project/README.md" } },
          { type: "text", text: "Updated the README spacing." }
        ]
      }
    })
  ].join("\n") + "\n";

  try {
    await writeFile(transcriptFile, transcriptLines);

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 0);
    assert.equal(snapshot.events.length, 0);
  } finally {
    if (typeof previousCursorProjectsDir === "string") {
      process.env.CURSOR_PROJECTS_DIR = previousCursorProjectsDir;
    } else {
      delete process.env.CURSOR_PROJECTS_DIR;
    }
  }
});

test("cursor local snapshot reads typed project hook sidecars and ignores transcript noise", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-hooks-"));
  const projectRoot = path.join(tempRoot, "project");
  const cursorProjectsDir = path.join(tempRoot, "cursor-projects");
  const projectSlug = projectRoot.replace(/^\/+/, "").replace(/[\\/]+/g, "-");
  const transcriptSessionId = "transcript-only-session";
  const transcriptDir = path.join(cursorProjectsDir, projectSlug, "agent-transcripts", transcriptSessionId);
  const hooksDir = path.join(projectRoot, ".codex-agents", "cursor-hooks");
  const hookSessionId = "cursor-hook-session";
  const transcriptFile = path.join(transcriptDir, `${transcriptSessionId}.jsonl`);
  const hookFile = path.join(hooksDir, `${hookSessionId}.jsonl`);
  const now = Date.now();
  await mkdir(projectRoot, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });

  const previousCursorProjectsDir = process.env.CURSOR_PROJECTS_DIR;
  process.env.CURSOR_PROJECTS_DIR = cursorProjectsDir;

  const transcriptLines = [
    JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<user_query>\nInfer local Cursor state from transcripts\n</user_query>" }
        ]
      }
    }),
    JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "Transcript fallback should not win when typed hooks exist." }
        ]
      }
    })
  ].join("\n") + "\n";

  const hookLines = [
    JSON.stringify({
      conversation_id: hookSessionId,
      hook_event_name: "beforeSubmitPrompt",
      timestamp: new Date(now - 2_000).toISOString(),
      prompt: "Wire Cursor hooks into Agents Office",
      workspace_roots: [projectRoot],
      model: "claude-4.5-sonnet"
    }),
    JSON.stringify({
      conversation_id: hookSessionId,
      hook_event_name: "afterFileEdit",
      timestamp: new Date(now - 1_000).toISOString(),
      file_path: path.join(projectRoot, "packages/core/src/cursor.ts"),
      edits: [{ old_string: "old", new_string: "new" }],
      workspace_roots: [projectRoot],
      model: "claude-4.5-sonnet"
    }),
    JSON.stringify({
      conversation_id: hookSessionId,
      hook_event_name: "afterAgentResponse",
      timestamp: new Date(now).toISOString(),
      text: "Typed Cursor hook state is now flowing into the office view.",
      workspace_roots: [projectRoot],
      model: "claude-4.5-sonnet"
    })
  ].join("\n") + "\n";

  try {
    await writeFile(transcriptFile, transcriptLines);
    await writeFile(hookFile, hookLines);

    const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].id, `cursor-local:${hookSessionId}`);
    assert.equal(snapshot.agents[0].confidence, "typed");
    assert.equal(snapshot.agents[0].source, "cursor");
    assert.equal(snapshot.agents[0].sourceKind, "cursor:claude-4.5-sonnet");
    assert.equal(snapshot.agents[0].label, "Wire Cursor hooks into Agents Office");
    assert.equal(snapshot.agents[0].latestMessage, "Typed Cursor hook state is now flowing into the office view.");
    assert.equal(snapshot.agents[0].state, "thinking");
    assert.equal(snapshot.events.some((event) => event.method === "cursor/local/userMessage"), true);
    assert.equal(snapshot.events.some((event) => event.method === "cursor/local/fileChange"), true);
    assert.equal(snapshot.events.some((event) => event.method === "cursor/local/agentMessage"), true);
  } finally {
    if (typeof previousCursorProjectsDir === "string") {
      process.env.CURSOR_PROJECTS_DIR = previousCursorProjectsDir;
    } else {
      delete process.env.CURSOR_PROJECTS_DIR;
    }
  }
});

test("cursor hook-backed local failures become typed blocked state", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-hook-failure-"));
  const projectRoot = path.join(tempRoot, "project");
  const hooksDir = path.join(projectRoot, ".codex-agents", "cursor-hooks");
  const sessionId = "cursor-hook-failure-session";
  const hookFile = path.join(hooksDir, `${sessionId}.jsonl`);
  const now = Date.now();
  await mkdir(projectRoot, { recursive: true });
  await mkdir(hooksDir, { recursive: true });

  const hookLines = [
    JSON.stringify({
      conversation_id: sessionId,
      hook_event_name: "postToolUseFailure",
      timestamp: new Date(now).toISOString(),
      tool_name: "Shell",
      tool_input: {
        command: "npm test"
      },
      cwd: projectRoot,
      error_message: "Command timed out after 30s",
      failure_type: "timeout",
      model: "claude-4.5-sonnet"
    })
  ].join("\n") + "\n";

  await writeFile(hookFile, hookLines);

  const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0].confidence, "typed");
  assert.equal(snapshot.agents[0].state, "blocked");
  assert.match(snapshot.agents[0].detail, /timed out/i);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].method, "cursor/local/commandExecution");
  assert.equal(snapshot.events[0].phase, "failed");
});

test("cursor hook snapshot ignores future-skewed stale records when newer lines are appended", { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-local-hook-skew-"));
  const projectRoot = path.join(tempRoot, "project");
  const hooksDir = path.join(projectRoot, ".codex-agents", "cursor-hooks");
  const sessionId = "cursor-hook-future-skew";
  const hookFile = path.join(hooksDir, `${sessionId}.jsonl`);
  const now = Date.now();
  await mkdir(projectRoot, { recursive: true });
  await mkdir(hooksDir, { recursive: true });

  const hookLines = [
    JSON.stringify({
      conversation_id: sessionId,
      hook_event_name: "stop",
      timestamp: new Date(now + 7 * 60 * 1000).toISOString(),
      status: "completed",
      workspace_roots: [projectRoot],
      model: "composer-2-fast"
    }),
    JSON.stringify({
      conversation_id: sessionId,
      hook_event_name: "beforeSubmitPrompt",
      timestamp: new Date(now - 2_000).toISOString(),
      prompt: "fresh prompt should win over future-skewed stop",
      workspace_roots: [projectRoot],
      model: "composer-2-fast"
    }),
    JSON.stringify({
      conversation_id: sessionId,
      hook_event_name: "afterAgentResponse",
      timestamp: new Date(now - 1_000).toISOString(),
      text: "fresh response should stay visible",
      workspace_roots: [projectRoot],
      model: "composer-2-fast"
    })
  ].join("\n") + "\n";

  await writeFile(hookFile, hookLines);

  const snapshot = await loadCursorLocalProjectSnapshotData(projectRoot);
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0].id, `cursor-local:${sessionId}`);
  assert.equal(snapshot.agents[0].confidence, "typed");
  assert.equal(snapshot.agents[0].state, "thinking");
  assert.equal(snapshot.agents[0].latestMessage, "fresh response should stay visible");
  assert.equal(snapshot.agents[0].label, "fresh prompt should win over future-skewed stop");
});

test("Cursor project hook recorder accepts utf16 payloads", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-hook-script-"));
  const scriptPath = path.resolve(__dirname, "..", "..", "..", ".cursor", "hooks", "capture-cursor-hook.mjs");
  const payload = JSON.stringify({
    conversation_id: "utf16-session",
    hook_event_name: "afterAgentResponse",
    text: "hello from utf16"
  });

  const result = spawnSync("node", [scriptPath, "afterAgentResponse"], {
    input: Buffer.from(payload, "utf16le"),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_AGENTS_OFFICE_PROJECT_ROOT: projectRoot
    }
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "{}");

  const outputPath = path.join(projectRoot, ".codex-agents", "cursor-hooks", "utf16-session.jsonl");
  const raw = await readFile(outputPath, "utf8");
  const record = JSON.parse(raw.trim());
  assert.equal(record.conversation_id, "utf16-session");
  assert.equal(record.hook_event_name, "afterAgentResponse");
  assert.equal(record.text, "hello from utf16");
  assert.equal(record.hook_source, "cursor-project-hooks");
  assert.equal(record.project_root, projectRoot);
});

test("cursor diagnostics report when the api key is missing", { concurrency: false }, async () => {
  const previousValue = process.env.CURSOR_API_KEY;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "cursor-settings-missing-"));
  delete process.env.CODEX_HOME;
  resetAppSettingsCacheForTest();
  delete process.env.CURSOR_API_KEY;
  try {
    assert.equal(cursorApiKeyConfigured(), false);
    assert.equal(
      await describeCursorAgentAvailability("/workspaces/CodexAgentsOffice"),
      "Cursor background agents disabled: CURSOR_API_KEY is not configured for this process."
    );
  } finally {
    if (typeof previousValue === "string") {
      process.env.CURSOR_API_KEY = previousValue;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    if (typeof previousXdgConfigHome === "string") {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (typeof previousCodexHome === "string") {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
});

test("stored cursor api key enables cursor integration without CURSOR_API_KEY", { concurrency: false }, async () => {
  const previousCursorApiKey = process.env.CURSOR_API_KEY;
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "cursor-settings-stored-"));
  delete process.env.CODEX_HOME;
  delete process.env.CURSOR_API_KEY;
  resetAppSettingsCacheForTest();

  try {
    assert.equal(cursorApiKeyConfigured(), false);
    await setStoredCursorApiKey("cursor_test_12345678");
    assert.equal(cursorApiKeyConfigured(), true);
    assert.deepEqual(describeCursorIntegrationSettings(), {
      configured: true,
      source: "stored",
      maskedKey: "curs...5678",
      storedConfigured: true,
      storedMaskedKey: "curs...5678"
    });
    const savedSettings = await readFile(getAppSettingsFilePath(), "utf8");
    assert.match(savedSettings, /cursor_test_12345678/);
  } finally {
    if (typeof previousCursorApiKey === "string") {
      process.env.CURSOR_API_KEY = previousCursorApiKey;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
    if (typeof previousXdgConfigHome === "string") {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (typeof previousCodexHome === "string") {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
});

test("stored multiplayer settings persist host, room, nickname, and enabled state in user data", { concurrency: false }, async () => {
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "multiplayer-settings-stored-"));
  delete process.env.CODEX_HOME;
  resetAppSettingsCacheForTest();

  try {
    await setStoredMultiplayerSettings({
      enabled: true,
      host: "team-sync.partykit.dev",
      room: "design/review",
      nickname: "kaki"
    });
    const describedSettings = describeStoredMultiplayerSettings();
    assert.equal(typeof describedSettings.deviceId, "string");
    assert.ok(describedSettings.deviceId.length > 0);
    assert.deepEqual({
      ...describedSettings,
      deviceId: "<generated>"
    }, {
      enabled: true,
      host: "team-sync.partykit.dev",
      room: "design/review",
      nickname: "kaki",
      deviceId: "<generated>",
      configured: true
    });
    const savedSettings = await readFile(getAppSettingsFilePath(), "utf8");
    assert.match(savedSettings, /team-sync\.partykit\.dev/);
    assert.match(savedSettings, /design\/review/);
    assert.match(savedSettings, /kaki/);
    assert.match(savedSettings, /"deviceId":\s*"[0-9a-f-]+"/);
    await setStoredCursorApiKey("cursor_test_12345678");
    assert.deepEqual({
      ...describeStoredMultiplayerSettings(),
      deviceId: describedSettings.deviceId
    }, {
      enabled: true,
      host: "team-sync.partykit.dev",
      room: "design/review",
      nickname: "kaki",
      deviceId: describedSettings.deviceId,
      configured: true
    });
  } finally {
    if (typeof previousXdgConfigHome === "string") {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (typeof previousCodexHome === "string") {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
});

test("stored appearance settings persist the selected hat and survive other settings writes", { concurrency: false }, async () => {
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.XDG_CONFIG_HOME = await mkdtemp(path.join(os.tmpdir(), "appearance-settings-stored-"));
  delete process.env.CODEX_HOME;
  resetAppSettingsCacheForTest();

  try {
    await setStoredAppearanceSettings({
      hatId: "sombrero"
    });
    assert.deepEqual(describeStoredAppearanceSettings(), {
      hatId: "sombrero"
    });
    const savedSettings = await readFile(getAppSettingsFilePath(), "utf8");
    assert.match(savedSettings, /sombrero/);
    await setStoredMultiplayerSettings({
      enabled: true,
      host: "team-sync.partykit.dev",
      room: "design/review",
      nickname: "kaki"
    });
    assert.deepEqual(describeStoredAppearanceSettings(), {
      hatId: "sombrero"
    });
  } finally {
    if (typeof previousXdgConfigHome === "string") {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    if (typeof previousCodexHome === "string") {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetAppSettingsCacheForTest();
  }
});

test("cursor diagnostics report when a git project has no origin remote", { concurrency: false }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "cursor-diagnostics-"));
  await execFileAsync("git", ["init", projectRoot]);

  const previousValue = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "test-key";
  try {
    assert.equal(
      await describeCursorAgentAvailability(projectRoot),
      "Cursor background agents unavailable for this project: git remote.origin.url is missing."
    );
  } finally {
    if (typeof previousValue === "string") {
      process.env.CURSOR_API_KEY = previousValue;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
  }
});

test("cursor agents match the current repo when Cursor reports a PR URL instead of source.repository", () => {
  assert.equal(
    cursorAgentMatchesRepository(
      {
        source: {
          prUrl: "https://github.com/example-org/CodexAgentsOffice/pull/123"
        }
      },
      "https://github.com/example-org/CodexAgentsOffice.git"
    ),
    true
  );
  assert.equal(
    cursorAgentMatchesRepository(
      {
        target: {
          prUrl: "https://github.com/example-org/CodexAgentsOffice/pull/456"
        }
      },
      "git@github.com:example-org/CodexAgentsOffice.git"
    ),
    true
  );
});
