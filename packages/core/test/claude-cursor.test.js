const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");

const {
  buildClaudeSessionEventsForTest,
  summariseClaudeHookRecord,
  summariseClaudeSession
} = require("../dist/claude.js");
const {
  claudeHooksFilePath,
  createClaudeSdkSidecarHooks,
  normalizeClaudeSdkMessageForTest
} = require("../dist/claude-agent-sdk.js");
const {
  describeCursorIntegrationSettings,
  getAppSettingsFilePath,
  resetAppSettingsCacheForTest,
  setStoredCursorApiKey
} = require("../dist/app-settings.js");
const {
  describeCursorAgentAvailability,
  cursorAgentMatchesRepository,
  cursorApiKeyConfigured,
  loadCursorLocalProjectSnapshotData,
  normalizeRepositoryUrl,
  cursorStatusToActivityState
} = require("../dist/cursor.js");

const execFileAsync = promisify(execFile);

test("typed Claude permission hooks become approval-backed blocked state", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "PermissionRequest",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      request_id: "req_42",
      reason: "Need approval to run a privileged command",
      tool_input: {
        command: "npm publish",
        cwd: "/mnt/f/AI/CodexAgentsOffice"
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
    cwd: "/mnt/f/AI/CodexAgentsOffice",
    grantRoot: "/mnt/f/AI/CodexAgentsOffice"
  });
  assert.equal(summary.isOngoing, true);
});

test("typed Claude user prompt hooks become planning state with user-message activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "UserPromptSubmit",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      prompt: "Update /mnt/f/AI/CodexAgentsOffice/README.md with Cursor support"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "planning");
  assert.equal(summary.activityEvent?.type, "userMessage");
  assert.equal(summary.activityEvent?.action, "said");
  assert.match(summary.detail, /README\.md/);
  assert.deepEqual(summary.paths, ["/mnt/f/AI/CodexAgentsOffice/README.md"]);
});

test("synthetic Claude model placeholders do not leak into agent labels", () => {
  const summary = summariseClaudeSession(
    "f06cc37e-5ca7-4c5e-9eba-4bf8e99e536a",
    "/mnt/f/AI/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: "2026-03-25T21:18:22.366Z",
        cwd: "/mnt/f/AI/CodexAgentsOffice",
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

test("typed Claude file-change hooks become editing file-change activity", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "FileChanged",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      file_path: "/mnt/f/AI/CodexAgentsOffice/README.md",
      event: "change"
    }
  });

  assert.ok(summary);
  assert.equal(summary.state, "editing");
  assert.equal(summary.activityEvent?.type, "fileChange");
  assert.equal(summary.activityEvent?.action, "edited");
  assert.deepEqual(summary.paths, ["/mnt/f/AI/CodexAgentsOffice/README.md", "/mnt/f/AI/CodexAgentsOffice"]);
});

test("typed Claude notification hooks surface a recent agent message", () => {
  const summary = summariseClaudeHookRecord({
    sessionId: "session-123",
    model: "claude-sonnet-4-5",
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    gitBranch: "main",
    fallbackUpdatedAt: Date.parse("2026-03-24T00:00:00.000Z"),
    record: {
      hook_event_name: "Notification",
      cwd: "/mnt/f/AI/CodexAgentsOffice",
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

test("stale Claude hook-backed live states decay to done instead of staying ongoing forever", () => {
  const now = Date.now();
  const hookTimestamp = new Date(now - 5 * 60 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/mnt/f/AI/CodexAgentsOffice",
    [],
    now,
    [
      {
        hook_event_name: "PostToolUse",
        timestamp: hookTimestamp,
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/mnt/f/AI/CodexAgentsOffice"
        }
      }
    ]
  );

  assert.equal(summary.state, "done");
  assert.equal(summary.isOngoing, false);
  assert.equal(summary.activityEvent, null);
});

test("hook-backed Claude sessions still surface assistant reply text", () => {
  const now = Date.now();
  const toolTimestamp = new Date(now - 60 * 1000).toISOString();
  const replyTimestamp = new Date(now - 30 * 1000).toISOString();
  const summary = summariseClaudeSession(
    "session-123",
    "/mnt/f/AI/CodexAgentsOffice",
    [
      {
        type: "assistant",
        timestamp: replyTimestamp,
        cwd: "/mnt/f/AI/CodexAgentsOffice",
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
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        tool_name: "Bash",
        tool_input: {
          command: "npm test",
          cwd: "/mnt/f/AI/CodexAgentsOffice"
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
    fallbackCwd: "/mnt/f/AI/CodexAgentsOffice",
    records: [
      {
        type: "assistant",
        timestamp: new Date(now - 2_000).toISOString(),
        message: {
          model: "claude-sonnet-4-5",
          content: [
            {
              type: "text",
              text: "Updated /mnt/f/AI/CodexAgentsOffice/README.md"
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
        cwd: "/mnt/f/AI/CodexAgentsOffice",
        file_path: "/mnt/f/AI/CodexAgentsOffice/README.md",
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
      cwd: "/mnt/f/AI/CodexAgentsOffice",
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
      cwd: "/mnt/f/AI/CodexAgentsOffice",
      gitBranch: "main"
    }
  );

  const summary = summariseClaudeSession(
    "session-123",
    "/mnt/f/AI/CodexAgentsOffice",
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
    "/mnt/f/AI/CodexAgentsOffice",
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

test("Claude SDK sidecar hooks append typed hook records per session", async () => {
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

test("cursor local snapshot parsing survives fragmented workspace state blobs", async () => {
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
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].source, "cursor");
    assert.equal(snapshot.agents[0].confidence, "inferred");
    assert.equal(snapshot.agents[0].label, "Local Cursor test");
    assert.equal(snapshot.agents[0].state, "editing");
    assert.equal(snapshot.agents[0].git?.branch, "main");
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].method, "cursor/local/prompt");
    assert.match(snapshot.events[0].detail, /Inspect the local Cursor adapter/);
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

test("cursor diagnostics report when the api key is missing", async () => {
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
      await describeCursorAgentAvailability("/mnt/f/AI/CodexAgentsOffice"),
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

test("stored cursor api key enables cursor integration without CURSOR_API_KEY", async () => {
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

test("cursor diagnostics report when a git project has no origin remote", async () => {
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
          prUrl: "https://github.com/Kundara/CodexAgentsOffice/pull/123"
        }
      },
      "https://github.com/Kundara/CodexAgentsOffice.git"
    ),
    true
  );
  assert.equal(
    cursorAgentMatchesRepository(
      {
        target: {
          prUrl: "https://github.com/Kundara/CodexAgentsOffice/pull/456"
        }
      },
      "git@github.com:Kundara/CodexAgentsOffice.git"
    ),
    true
  );
});
