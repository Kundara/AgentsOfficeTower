const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  canonicalizeProjectPath,
  sameProjectPath
} = require("../dist/project-paths.js");

const {
  currentHermesSessionProjectRootForTest,
  discoverHermesProjects,
  isHermesCompressionContinuationForTest,
  isHermesGatewayDaemonForTest,
  isHermesRuntimeHomeProcessForTest,
  loadHermesProjectSnapshotData,
  loadRoamingHermesSnapshotData,
  summarizeHermesHookSessionForTest,
  summarizeHermesSessionForTest
} = require("../dist/hermes.js");
const { installHermesAgentsOfficePlugin } = require("../dist/hermes-hook-install.js");

function session(overrides = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    id: "session-1",
    source: "cli",
    model: "hermes-test",
    parentSessionId: null,
    parentEndedAt: null,
    parentEndReason: null,
    startedAt: nowSeconds - 30,
    endedAt: null,
    endReason: null,
    messageCount: 0,
    toolCallCount: 0,
    title: null,
    systemPrompt: "Current working directory: /tmp/project",
    lastActive: nowSeconds,
    home: "/tmp/hermes",
    storage: "sqlite",
    messages: [],
    ...overrides
  };
}

function message(overrides = {}) {
  return {
    id: 1,
    role: "user",
    content: "work on this",
    toolCalls: null,
    toolName: null,
    toolCallId: null,
    timestamp: Math.floor(Date.now() / 1000),
    finishReason: null,
    reasoning: null,
    reasoningContent: null,
    ...overrides
  };
}

test("Hermes plugin install writes a load-status marker bridge", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-install-"));
  const hermesHome = join(tempRoot, "hermes-home");
  const hookDir = join(tempRoot, "hooks");

  const result = await installHermesAgentsOfficePlugin({ hermesHome, hookDir });
  const source = readFileSync(join(result.pluginDir, "__init__.py"), "utf8");

  assert.equal(result.hookDir, hookDir);
  assert.match(source, /codex-agents-office\.status\.json/);
  assert.match(source, /status_event_name/);
  assert.match(source, /record_error/);
});

test("Hermes user prompt remains active planning while recent", () => {
  const summary = summarizeHermesSessionForTest({
    session: session({
      messages: [message({ role: "user", content: "implement Hermes support" })]
    }),
    projectRoot: "/tmp/project"
  });

  assert.equal(summary.state, "planning");
  assert.equal(summary.isOngoing, true);
});

test("Hermes final assistant reply after older tool call is done, not running", () => {
  const now = Math.floor(Date.now() / 1000);
  const summary = summarizeHermesSessionForTest({
    session: session({
      endedAt: now,
      messages: [
        message({
          id: 1,
          role: "assistant",
          content: "",
          toolCalls: JSON.stringify([{ name: "terminal", arguments: { command: "npm test" } }]),
          timestamp: now - 5
        }),
        message({
          id: 2,
          role: "tool",
          content: JSON.stringify({ exit_code: 0, output: "ok" }),
          toolName: "terminal",
          timestamp: now - 4
        }),
        message({
          id: 3,
          role: "assistant",
          content: "Done.",
          timestamp: now
        })
      ],
      lastActive: now
    }),
    projectRoot: "/tmp/project",
    now: now * 1000
  });

  assert.equal(summary.state, "done");
  assert.equal(summary.isOngoing, false);
});

test("Hermes read-only tools map to scanning instead of file edits", () => {
  const now = Math.floor(Date.now() / 1000);
  const summary = summarizeHermesSessionForTest({
    session: session({
      messages: [
        message({
          role: "assistant",
          content: "",
          toolCalls: JSON.stringify([{ name: "read_file", arguments: { path: "/tmp/project/src/app.ts" } }]),
          timestamp: now
        })
      ],
      lastActive: now
    }),
    projectRoot: "/tmp/project",
    now: now * 1000
  });

  assert.equal(summary.state, "scanning");
  assert.equal(summary.activityEvent.type, "dynamicToolCall");
  assert.equal(summary.activityEvent.action, "updated");
  assert.equal(summary.activityEvent.path, "/tmp/project/src/app.ts");
});

test("fresh open Hermes gateway session remains current waiting work after a reply", () => {
  const now = Math.floor(Date.now() / 1000);
  const summary = summarizeHermesSessionForTest({
    session: session({
      endedAt: null,
      messages: [
        message({
          id: 1,
          role: "user",
          content: "check the gateway",
          timestamp: now - 5
        }),
        message({
          id: 2,
          role: "assistant",
          content: "Done.",
          finishReason: "stop",
          timestamp: now
        })
      ],
      lastActive: now
    }),
    projectRoot: "/tmp/project",
    now: now * 1000
  });

  assert.equal(summary.state, "waiting");
  assert.equal(summary.isOngoing, true);
});

test("stale open Hermes gateway session settles out of workstation currentness", () => {
  const now = Math.floor(Date.now() / 1000);
  const old = now - 60 * 60;
  const summary = summarizeHermesSessionForTest({
    session: session({
      startedAt: old,
      endedAt: null,
      messages: [
        message({
          id: 1,
          role: "assistant",
          content: "Done.",
          finishReason: "stop",
          timestamp: old
        })
      ],
      lastActive: old
    }),
    projectRoot: "/tmp/project",
    now: now * 1000
  });

  assert.equal(summary.state, "idle");
  assert.equal(summary.isOngoing, false);
});

test("Hermes failed tool result maps to blocked", () => {
  const summary = summarizeHermesSessionForTest({
    session: session({
      messages: [
        message({
          role: "tool",
          content: JSON.stringify({ exit_code: 1, error: "failed" }),
          toolName: "terminal"
        })
      ]
    }),
    projectRoot: "/tmp/project"
  });

  assert.equal(summary.state, "blocked");
});

test("Hermes roaming hook sessions exclude existing workspace floors", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const projectRoot = join(tempRoot, "project");
  const outsideRoot = join(tempRoot, "rec-room");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    const timestamp = new Date().toISOString();
    writeFileSync(
      join(hooksDir, "inside.jsonl"),
      JSON.stringify({
        session_id: "inside",
        hook_event_name: "pre_tool_call",
        timestamp,
        cwd: outsideRoot,
        payload: {
          tool_name: "write_file",
          args: { path: join(projectRoot, "src", "future-file.ts") }
        }
      }) + "\n"
    );
    writeFileSync(
      join(hooksDir, "outside.jsonl"),
      JSON.stringify({
        session_id: "outside",
        hook_event_name: "pre_llm_call",
        timestamp,
        cwd: outsideRoot,
        payload: {
          user_message: "talking from the rec room"
        }
      }) + "\n"
    );
    writeFileSync(
      join(hooksDir, "process-123.jsonl"),
      JSON.stringify({
        session_id: "process-123",
        hook_event_name: "pre_llm_call",
        timestamp,
        cwd: outsideRoot,
        payload: {
          user_message: "gateway process heartbeat"
        }
      }) + "\n"
    );

    const roaming = await loadRoamingHermesSnapshotData({
      anchorProjectRoot: projectRoot,
      knownProjectRoots: [projectRoot],
      limit: 4
    });

    assert.deepEqual(roaming.agents.map((agent) => agent.threadId), ["outside"]);
    assert.equal(roaming.agents[0].sourceKind, "hermes:roaming");
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("Hermes project discovery follows only the latest fresh hook project", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-discovery-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const oldProjectRoot = join(tempRoot, "old-project");
  const currentProjectRoot = join(tempRoot, "current-project");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(oldProjectRoot, ".git"), { recursive: true });
  mkdirSync(join(currentProjectRoot, ".git"), { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    writeFileSync(
      join(hooksDir, "session.jsonl"),
      [
        JSON.stringify({
          session_id: "session",
          hook_event_name: "pre_tool_call",
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          cwd: oldProjectRoot,
          payload: {
            tool_name: "read_file",
            args: { path: join(oldProjectRoot, "src", "old.ts") }
          }
        }),
        JSON.stringify({
          session_id: "session",
          hook_event_name: "pre_tool_call",
          timestamp: new Date().toISOString(),
          cwd: currentProjectRoot,
          payload: {
            tool_name: "write_file",
            args: { path: join(currentProjectRoot, "src", "future-file.ts") }
          }
        })
      ].join("\n") + "\n"
    );

    const discovered = await discoverHermesProjects(10);
    const roots = discovered.map((project) => project.root);

    assert.ok(roots.some((root) => sameProjectPath(root, currentProjectRoot)));
    assert.equal(roots.some((root) => sameProjectPath(root, oldProjectRoot)), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("active Hermes hook-only streams discover projects without creating workstation agents", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-current-agent-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const projectRoot = join(tempRoot, "project");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    writeFileSync(
      join(hooksDir, "session.jsonl"),
      JSON.stringify({
        session_id: "session",
        hook_event_name: "pre_tool_call",
        timestamp: new Date().toISOString(),
        cwd: projectRoot,
        payload: {
          tool_name: "write_file",
          args: { path: join(projectRoot, "src", "future-file.ts") }
        }
      }) + "\n"
    );

    const snapshot = await loadHermesProjectSnapshotData(projectRoot, 4);
    assert.equal(snapshot.agents.length, 0);

    const discovered = await discoverHermesProjects(10);
    assert.ok(discovered.some((project) => sameProjectPath(project.root, projectRoot)));
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("durable Hermes hook cron sessions use project task labels instead of raw ids", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-label-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const projectRoot = join(tempRoot, "IkaBot");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    writeFileSync(
      join(hooksDir, "cron_abc_20260515_194835.jsonl"),
      JSON.stringify({
        session_id: "cron_abc_20260515_194835",
        hook_event_name: "pre_api_request",
        timestamp: new Date().toISOString(),
        cwd: projectRoot,
        payload: {
          provider: "openai-codex",
          model: "gpt-5.5",
          user_message: "[IMPORTANT: The user has invoked the \"ikabot-gameplay-ops\" skill.]"
        }
      }) + "\n"
    );

    const snapshot = await loadHermesProjectSnapshotData(projectRoot, 4);
    const agent = snapshot.agents.find((entry) => entry.threadId === "cron_abc_20260515_194835");
    assert.ok(agent);
    assert.equal(agent.label, "IkaBot tick");
    assert.equal(agent.detail, "Thinking with gpt-5.5");
    assert.equal(agent.activityEvent?.type, "reasoning");
    assert.equal(agent.label.includes("cron_"), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("durable Hermes hook tool events expose command, file, and MCP toast shapes", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-events-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const projectRoot = join(tempRoot, "project");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    const started = new Date(Date.now() - 3000).toISOString();
    const edited = new Date(Date.now() - 2000).toISOString();
    const read = new Date(Date.now() - 1700).toISOString();
    const planned = new Date(Date.now() - 1400).toISOString();
    const clicked = new Date(Date.now() - 1000).toISOString();
    const waited = new Date(Date.now() - 500).toISOString();
    writeFileSync(
      join(hooksDir, "20260515_200001_abcdef.jsonl"),
      [
        JSON.stringify({
          session_id: "20260515_200001_abcdef",
          hook_event_name: "pre_tool_call",
          timestamp: started,
          cwd: projectRoot,
          payload: {
            tool_name: "terminal",
            args: { command: "sleep 75" }
          }
        }),
        JSON.stringify({
          session_id: "20260515_200001_abcdef",
          hook_event_name: "pre_tool_call",
          timestamp: edited,
          cwd: projectRoot,
          payload: {
            tool_name: "write_file",
            args: { path: join(projectRoot, "src", "app.ts") }
          }
        }),
        JSON.stringify({
          session_id: "20260515_200001_abcdef",
          hook_event_name: "pre_tool_call",
          timestamp: read,
          cwd: projectRoot,
          payload: {
            tool_name: "read_file",
            args: { path: join(projectRoot, "README.md") }
          }
        }),
        JSON.stringify({
          session_id: "20260515_200001_abcdef",
          hook_event_name: "pre_tool_call",
          timestamp: planned,
          cwd: projectRoot,
          payload: {
            tool_name: "todo",
            args: {
              todos: [
                { id: "1", content: "inspect", status: "completed" },
                { id: "2", content: "patch", status: "in_progress" }
              ]
            }
          }
        }),
        JSON.stringify({
          session_id: "20260515_200001_abcdef",
          hook_event_name: "pre_tool_call",
          timestamp: clicked,
          cwd: projectRoot,
          payload: {
            tool_name: "mcp_ikabot_bridge_click_at",
            args: { x: 10, y: 20 }
          }
        }),
        JSON.stringify({
          session_id: "20260515_200001_abcdef",
          hook_event_name: "pre_tool_call",
          timestamp: waited,
          cwd: projectRoot,
          payload: {
            tool_name: "process",
            args: { action: "wait", session_id: "proc_abc123", timeout: 120 }
          }
        })
      ].join("\n") + "\n"
    );

    const snapshot = await loadHermesProjectSnapshotData(projectRoot, 4);
    const commandEvent = snapshot.events.find((event) => event.command === "sleep 75");
    const fileEvent = snapshot.events.find((event) => event.kind === "fileChange");
    const readEvent = snapshot.events.find((event) => event.detail.includes("read_file:"));
    const planEvent = snapshot.events.find((event) => event.method === "turn/plan/updated");
    const mcpEvent = snapshot.events.find((event) => event.itemType === "mcpToolCall");
    const processEvent = snapshot.events.find((event) => event.command === "process wait proc_abc123");

    assert.ok(commandEvent);
    assert.equal(commandEvent.method, "item/started");
    assert.equal(commandEvent.detail, "sleep 75");
    assert.equal(commandEvent.command, "sleep 75");

    assert.ok(fileEvent);
    assert.equal(fileEvent.method, "item/started");
    assert.equal(fileEvent.action, "edited");
    assert.match(fileEvent.detail, /write_file:/);
    assert.match(fileEvent.path, /src[\\/]app\.ts$/);

    assert.ok(readEvent);
    assert.equal(readEvent.kind, "tool");
    assert.equal(readEvent.itemType, "dynamicToolCall");
    assert.equal(readEvent.action, "updated");
    assert.match(readEvent.path, /README\.md$/);

    assert.ok(planEvent);
    assert.equal(planEvent.kind, "turn");
    assert.equal(planEvent.detail, "todo: planning 2 task(s)");
    assert.equal(planEvent.phase, "updated");

    assert.ok(mcpEvent);
    assert.equal(mcpEvent.kind, "tool");
    assert.equal(mcpEvent.method, "item/tool/call");
    assert.equal(mcpEvent.detail, "mcp_ikabot_bridge_click_at");

    assert.ok(processEvent);
    assert.equal(processEvent.kind, "command");
    assert.equal(processEvent.method, "item/started");
    assert.equal(processEvent.detail, "process wait proc_abc123");
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("Hermes project discovery ignores non-git live cwd roots", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-nongit-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const nonGitRoot = join(tempRoot, "home-like-folder");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(nonGitRoot, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    writeFileSync(
      join(hooksDir, "session.jsonl"),
      JSON.stringify({
        session_id: "session",
        hook_event_name: "pre_llm_call",
        timestamp: new Date().toISOString(),
        cwd: nonGitRoot,
        payload: {
          user_message: "talking from a home directory"
        }
      }) + "\n"
    );

    const discovered = await discoverHermesProjects(10);

    assert.equal(discovered.some((project) => project.root === nonGitRoot), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("Hermes project discovery ignores the Hermes runtime checkout", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-runtime-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const runtimeRoot = join(tempRoot, "Hermes", "hermes-agent");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(runtimeRoot, ".git"), { recursive: true });
  mkdirSync(join(runtimeRoot, "hermes_cli"), { recursive: true });
  mkdirSync(join(runtimeRoot, "gateway"), { recursive: true });
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(join(runtimeRoot, "hermes_cli", "main.py"), "");
  writeFileSync(join(runtimeRoot, "pyproject.toml"), "[project]\nname = \"hermes-agent\"\n");

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    writeFileSync(
      join(hooksDir, "session.jsonl"),
      JSON.stringify({
        session_id: "session",
        hook_event_name: "pre_gateway_dispatch",
        timestamp: new Date().toISOString(),
        cwd: runtimeRoot,
        payload: {
          event: { text: "gateway heartbeat" }
        }
      }) + "\n"
    );

    const discovered = await discoverHermesProjects(10);

    assert.equal(discovered.some((project) => project.root === runtimeRoot), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("Hermes stored sessions resolve to their latest project root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-current-root-"));
  const oldProjectRoot = join(tempRoot, "old-project");
  const currentProjectRoot = join(tempRoot, "current-project");
  mkdirSync(join(oldProjectRoot, ".git"), { recursive: true });
  mkdirSync(join(currentProjectRoot, ".git"), { recursive: true });

  const now = Math.floor(Date.now() / 1000);
  const root = await currentHermesSessionProjectRootForTest({
    session: session({
      systemPrompt: `Current working directory: ${oldProjectRoot}`,
      messages: [
        message({
          id: 1,
          role: "assistant",
          timestamp: now - 60,
          toolCalls: JSON.stringify([{ name: "read_file", arguments: { path: join(oldProjectRoot, "src", "old.ts") } }])
        }),
        message({
          id: 2,
          role: "assistant",
          timestamp: now,
          toolCalls: JSON.stringify([{ name: "write_file", arguments: { path: join(currentProjectRoot, "src", "new.ts") } }])
        })
      ]
    })
  });

  assert.equal(root, canonicalizeProjectPath(currentProjectRoot));
});

test("Hermes gateway daemon is not treated as a workspace process", () => {
  assert.equal(isHermesGatewayDaemonForTest([
    "/home/kunda/.local/bin/hermes",
    "gateway",
    "run",
    "--replace"
  ]), true);

  assert.equal(isHermesGatewayDaemonForTest([
    "/mnt/f/AI/Hermes/hermes-agent/venv/bin/python",
    "-m",
    "hermes_cli.main",
    "gateway",
    "run",
    "--replace"
  ]), true);

  assert.equal(isHermesGatewayDaemonForTest([
    "/home/kunda/.local/bin/hermes",
    "chat",
    "-q",
    "hello"
  ]), false);

  assert.equal(isHermesRuntimeHomeProcessForTest([
    "/mnt/f/AI/Hermes/hermes-agent/venv/bin/python3",
    "/home/kunda/.local/bin/hermes"
  ], "/mnt/f/AI/Hermes/hermes-agent"), true);

  assert.equal(isHermesRuntimeHomeProcessForTest([
    "/mnt/f/AI/Hermes/hermes-agent/venv/bin/python3",
    "/home/kunda/.local/bin/hermes"
  ], "/mnt/f/AI/IkaBot"), false);
});

test("Hermes gateway hook uses nested event text as user prompt", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    now,
    records: [{
      eventName: "pre_gateway_dispatch",
      timestampMs: now,
      payload: {
        event: {
          text: "debug this Hermes connection"
        }
      }
    }]
  });

  assert.equal(summary.state, "planning");
  assert.equal(summary.detail, "debug this Hermes connection");
  assert.equal(summary.activityEvent.title, "debug this Hermes connection");
});

test("Hermes subagent hook maps to delegation activity", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    paths: ["/tmp/project"],
    now,
    records: [{
      eventName: "subagent_stop",
      timestampMs: now,
      payload: {
        parent_session_id: "parent-1",
        child_role: "researcher",
        child_summary: "Found the answer",
        child_status: "completed"
      }
    }]
  });

  assert.equal(summary.state, "delegating");
  assert.equal(summary.detail, "Found the answer");
  assert.equal(summary.activityEvent.type, "collabAgentToolCall");
});

test("Hermes transform hook output maps to terminal activity", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    paths: ["/tmp/project"],
    now,
    records: [{
      eventName: "transform_terminal_output",
      timestampMs: now,
      payload: {
        command: "npm test",
        output: "ok",
        returncode: 0
      }
    }]
  });

  assert.equal(summary.state, "running");
  assert.equal(summary.detail, "npm test");
  assert.equal(summary.activityEvent.type, "commandExecution");
});

test("Hermes process hooks map to command activity instead of generic tool text", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    paths: ["/tmp/project"],
    now,
    records: [{
      eventName: "pre_tool_call",
      timestampMs: now,
      payload: {
        tool_name: "process",
        args: {
          action: "wait",
          session_id: "proc_abc123",
          timeout: 120
        }
      }
    }]
  });

  assert.equal(summary.state, "running");
  assert.equal(summary.detail, "process wait proc_abc123");
  assert.equal(summary.activityEvent.type, "commandExecution");
  assert.equal(summary.activityEvent.title, "process wait proc_abc123");
});

test("Hermes command hooks keep user prompts out of agent latestMessage", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    paths: ["/tmp/project"],
    now,
    records: [
      {
        eventName: "pre_api_request",
        timestampMs: now - 1000,
        payload: {
          user_message: "watch them all now",
          model: "gpt-5.5"
        }
      },
      {
        eventName: "pre_tool_call",
        timestampMs: now,
        payload: {
          tool_name: "terminal",
          args: { command: "sleep 75" }
        }
      }
    ]
  });

  assert.equal(summary.state, "running");
  assert.equal(summary.detail, "sleep 75");
  assert.equal(summary.latestMessage, null);
  assert.equal(summary.activityEvent.type, "commandExecution");
});

test("Hermes generic maintenance prompts do not replace the last real message", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    paths: ["/tmp/project"],
    now,
    records: [
      {
        eventName: "post_llm_call",
        timestampMs: now - 2000,
        payload: {
          assistant_response: "Watched the Cinema reward flow and updated the playbook."
        }
      },
      {
        eventName: "pre_api_request",
        timestampMs: now - 1000,
        payload: {
          user_message: "Review the conversation above and update the skill library."
        }
      },
      {
        eventName: "pre_tool_call",
        timestampMs: now,
        payload: {
          tool_name: "terminal",
          args: { command: "sleep 75" }
        }
      }
    ]
  });

  assert.equal(summary.detail, "sleep 75");
  assert.equal(summary.latestMessage, "Watched the Cinema reward flow and updated the playbook.");
});

test("Hermes long hook streams do not turn earlier user prompts into agent speech", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-agents-office-hermes-long-stream-"));
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHookDir = process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
  const codexHome = join(tempRoot, "codex-home");
  const projectRoot = join(tempRoot, "IkaBot");
  const hooksDir = join(codexHome, "codex-agents-office", "hermes-hooks");
  mkdirSync(join(projectRoot, ".git"), { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = hooksDir;
  try {
    const startedAt = Date.now() - 60_000;
    const records = [
      {
        session_id: "20260515_193834_5d9193",
        hook_event_name: "pre_api_request",
        timestamp: new Date(startedAt).toISOString(),
        cwd: projectRoot,
        payload: {
          session_id: "20260515_193834_5d9193",
          model: "gpt-5.5",
          user_message: "the video production boost is always failing, click play after entering"
        }
      },
      ...Array.from({ length: 30 }, (_, index) => ({
        session_id: "20260515_193834_5d9193",
        hook_event_name: "pre_tool_call",
        timestamp: new Date(startedAt + 1000 + index * 1000).toISOString(),
        cwd: projectRoot,
        payload: {
          session_id: "20260515_193834_5d9193",
          tool_name: "terminal",
          args: {
            command: index === 29 ? "sleep 75" : `echo ${index}`,
            padding: "x".repeat(20_000)
          }
        }
      }))
    ];
    writeFileSync(
      join(hooksDir, "20260515_193834_5d9193.jsonl"),
      records.map((record) => JSON.stringify(record)).join("\n") + "\n"
    );

    const snapshot = await loadHermesProjectSnapshotData(projectRoot, 4);
    const agent = snapshot.agents.find((entry) => entry.threadId === "20260515_193834_5d9193");

    assert.ok(agent);
    assert.equal(agent.detail, "sleep 75");
    assert.equal(agent.latestMessage, null);
    assert.equal(agent.activityEvent?.type, "commandExecution");
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (previousHookDir === undefined) {
      delete process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR;
    } else {
      process.env.CODEX_AGENTS_OFFICE_HERMES_HOOK_DIR = previousHookDir;
    }
  }
});

test("Hermes ended hook sessions keep the last actual message", () => {
  const now = Date.now();
  const summary = summarizeHermesHookSessionForTest({
    projectRoot: "/tmp/project",
    paths: ["/tmp/project"],
    now,
    records: [
      {
        eventName: "transform_llm_output",
        timestampMs: now - 1000,
        payload: {
          response_text: "The final Hermes update"
        }
      },
      {
        eventName: "on_session_end",
        timestampMs: now,
        payload: {}
      }
    ]
  });

  assert.equal(summary.state, "done");
  assert.equal(summary.detail, "The final Hermes update");
  assert.equal(summary.latestMessage, "The final Hermes update");
});

test("Hermes compression continuations stay lead sessions", () => {
  assert.equal(isHermesCompressionContinuationForTest({
    parentSessionId: "parent",
    parentEndedAt: 100,
    parentEndReason: "compression",
    startedAt: 101
  }), true);

  assert.equal(isHermesCompressionContinuationForTest({
    parentSessionId: "parent",
    parentEndedAt: 100,
    parentEndReason: "session_reset",
    startedAt: 101
  }), false);
});
