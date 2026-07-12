const test = require("node:test");
const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { basename, join } = require("node:path");

const {
  listCodexProjectThreadCandidates,
  mergeThreadLists
} = require("../dist/codex-thread-query.js");
const {
  discoverCodexSessionThreads,
  parseCodexSessionThreadFromJsonl
} = require("../dist/codex-session-files.js");
const {
  latestAgentMessageForThread,
  parseThreadSourceMeta,
  summariseThread
} = require("../dist/snapshot.js");

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

function sessionMetaLine({ id, cwd, subagent = true }) {
  return JSON.stringify({
    timestamp: "2026-07-10T00:00:00.000Z",
    type: "session_meta",
    payload: {
      id,
      timestamp: "2026-07-10T00:00:00.000Z",
      cwd,
      source: subagent ? { subagent: {} } : "cli",
      thread_source: subagent ? "subagent" : "cli",
      model_provider: "openai"
    }
  });
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
    localLimit: 10,
    includeSessionThreads: false
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
    localLimit: 10,
    includeSessionThreads: false
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
    localLimit: 10,
    includeSessionThreads: false
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
    localLimit: 10,
    includeSessionThreads: false
  });

  assert.equal(result.usedUnscopedFallback, false);
  assert.deepEqual(result.trackedThreads.map((entry) => entry.id), ["match"]);
  assert.equal(calls.length, 1);
});

test("active session fallback wins timestamp ties without discarding listed identity or history", () => {
  const listed = thread({
    id: "thr_live",
    preview: "Choose next work",
    name: "Choose next work",
    source: "vscode",
    status: { type: "notLoaded" },
    updatedAt: 200,
    turns: [{ id: "turn_old", status: "completed", error: null, items: [] }]
  });
  const sessionFallback = thread({
    id: "thr_live",
    preview: "Codex session",
    name: null,
    source: "vscode",
    status: { type: "active", activeFlags: [] },
    updatedAt: 200,
    turns: [{ id: "session-live-thr_live", status: "inProgress", error: null, items: [] }]
  });

  const [merged] = mergeThreadLists([listed], [sessionFallback]);

  assert.equal(merged.status.type, "active");
  assert.equal(merged.preview, "Choose next work");
  assert.equal(merged.name, "Choose next work");
  assert.equal(merged.source, "vscode");
  assert.deepEqual(merged.turns.map((turn) => turn.id), ["turn_old", "session-live-thr_live"]);
});

test("Codex project thread query groups projectless desktop chats on the Chat floor", async () => {
  const calls = [];
  const client = {
    async listThreads(params) {
      calls.push(params);
      if (params.cwd) {
        return [];
      }
      return [
        thread({
          id: "chat_one",
          cwd: "C:\\Users\\kunda\\Documents\\Codex\\2026-06-29\\see",
          updatedAt: 300
        }),
        thread({
          id: "chat_two",
          cwd: "C:\\Users\\kunda\\Documents\\Codex\\2026-07-06\\you-know-my-projects",
          updatedAt: 250
        }),
        thread({
          id: "workspace",
          cwd: "F:\\AI\\CodexAgentsOffice",
          updatedAt: 400
        })
      ];
    }
  };

  const result = await listCodexProjectThreadCandidates({
    client,
    projectRoot: "/mnt/c/Users/kunda/Documents/Codex",
    localLimit: 10,
    includeSessionThreads: false
  });

  assert.equal(result.usedUnscopedFallback, true);
  assert.deepEqual(result.trackedThreads.map((entry) => entry.id), ["chat_one", "chat_two"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cwd, "/mnt/c/Users/kunda/Documents/Codex");
});

test("Codex session parser reads multiagents v2 subagent JSONL", () => {
  const jsonl = [
    {
      timestamp: "2026-05-17T19:54:06.000Z",
      type: "session_meta",
      payload: {
        id: "thr_child",
        timestamp: "2026-05-17T19:54:05.000Z",
        cwd: "F:\\Unity\\ChickenCoop",
        cli_version: "0.131.0-alpha.9",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "thr_parent",
              depth: 1,
              agent_path: "/root/firebase_docs_research",
              agent_nickname: "James",
              agent_role: "default"
            }
          }
        },
        thread_source: "subagent",
        agent_nickname: "James",
        agent_role: "default",
        agent_path: "/root/firebase_docs_research",
        model_provider: "openai"
      }
    },
    {
      timestamp: "2026-05-17T19:54:07.000Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: "turn_1"
      }
    },
    {
      timestamp: "2026-05-17T19:54:07.000Z",
      type: "turn_context",
      payload: {
        turn_id: "turn_1",
        cwd: "F:\\Unity\\ChickenCoop"
      }
    },
    {
      timestamp: "2026-05-17T19:54:08.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ type: "output_text", text: "I am checking Firebase docs." }]
      }
    },
    {
      timestamp: "2026-05-17T19:54:09.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call_1",
        arguments: JSON.stringify({ cmd: "rg Firebase Assets", workdir: "F:\\Unity\\ChickenCoop" })
      }
    },
    {
      timestamp: "2026-05-17T19:54:10.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_1",
        output: "Process exited with code 0"
      }
    },
    {
      timestamp: "2026-05-17T19:54:11.000Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "turn_1",
        last_agent_message: "Firebase Analytics uses manual screen_view logging in Unity."
      }
    }
  ].map((entry) => JSON.stringify(entry)).join("\n");

  const thread = parseCodexSessionThreadFromJsonl("C:\\tmp\\thr_child.jsonl", jsonl, Date.parse("2026-05-17T19:54:11.000Z"));
  assert.ok(thread);
  assert.equal(thread.id, "thr_child");
  assert.equal(thread.status.type, "notLoaded");
  assert.equal(thread.cwd, "F:\\Unity\\ChickenCoop");

  const sourceMeta = parseThreadSourceMeta(thread);
  assert.equal(sourceMeta.sourceKind, "subAgent");
  assert.equal(sourceMeta.parentThreadId, "thr_parent");
  assert.equal(sourceMeta.agentNickname, "James");
  assert.equal(sourceMeta.agentRole, "default");
  assert.equal(latestAgentMessageForThread(thread), "Firebase Analytics uses manual screen_view logging in Unity.");

  const summary = summariseThread(thread);
  assert.equal(summary.activityEvent.type, "commandExecution");
  assert.equal(summary.activityEvent.title, "rg Firebase Assets");
});

test("Codex session discovery reads matching subagents, fresh top-level sessions, and bounded malformed compatibility files", async () => {
  const directory = await fsPromises.mkdtemp(join(tmpdir(), "agents-office-session-filter-"));
  const projectRoot = join(directory, "project");
  const otherRoot = join(directory, "other");
  const files = {
    topLevel: join(directory, "top-level.jsonl"),
    otherProject: join(directory, "other-project.jsonl"),
    matching: join(directory, "matching.jsonl"),
    malformedPrefix: join(directory, "malformed-prefix.jsonl")
  };
  await Promise.all([
    fsPromises.writeFile(files.topLevel, [
      sessionMetaLine({ id: "top", cwd: projectRoot, subagent: false }),
      JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", text: '{"type":"task_complete"}' } })
    ].join("\n") + "\n"),
    fsPromises.writeFile(files.otherProject, `${sessionMetaLine({ id: "other", cwd: otherRoot })}\n`),
    fsPromises.writeFile(files.matching, `${sessionMetaLine({ id: "match", cwd: projectRoot })}\n`),
    fsPromises.writeFile(files.malformedPrefix, `not-json\n${sessionMetaLine({ id: "compat", cwd: projectRoot })}\n`)
  ]);

  const originalReadFile = fsPromises.readFile;
  const fullReads = [];
  fsPromises.readFile = async (...args) => {
    fullReads.push(basename(String(args[0])));
    return originalReadFile(...args);
  };
  try {
    const threads = await discoverCodexSessionThreads({
      projectRoot,
      sessionDirectories: [directory],
      now: new Date()
    });
    assert.deepEqual(threads.map((entry) => entry.id).sort(), ["compat", "match", "top"]);
    const topLevel = threads.find((entry) => entry.id === "top");
    assert.ok(topLevel);
    assert.equal(topLevel.status.type, "active");
    assert.equal(topLevel.turns.at(-1).status, "inProgress");
    assert.equal(parseThreadSourceMeta(topLevel).parentThreadId, null);
    assert.equal(fullReads.includes("top-level.jsonl"), false);
    await fsPromises.appendFile(
      files.topLevel,
      `${JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } })}\n`
    );
    const completedThreads = await discoverCodexSessionThreads({
      projectRoot,
      sessionDirectories: [directory],
      now: new Date()
    });
    assert.equal(completedThreads.some((entry) => entry.id === "top"), false);
    await discoverCodexSessionThreads({
      projectRoot: join(directory, "unmatched"),
      sessionDirectories: [directory],
      now: new Date()
    });
    assert.equal(fullReads.includes("top-level.jsonl"), false);
  } finally {
    fsPromises.readFile = originalReadFile;
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

test("Codex session discovery globally bounds and shares concurrent full reads", async () => {
  const directory = await fsPromises.mkdtemp(join(tmpdir(), "agents-office-session-bound-"));
  const projectRoot = join(directory, "project");
  const fileCount = 8;
  await Promise.all(Array.from({ length: fileCount }, (_, index) =>
    fsPromises.writeFile(
      join(directory, `session-${index}.jsonl`),
      `${sessionMetaLine({ id: `session-${index}`, cwd: projectRoot })}\n`
    )
  ));

  const originalReadFile = fsPromises.readFile;
  let activeReads = 0;
  let maximumActiveReads = 0;
  let fullReadCount = 0;
  fsPromises.readFile = async (...args) => {
    fullReadCount += 1;
    activeReads += 1;
    maximumActiveReads = Math.max(maximumActiveReads, activeReads);
    try {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return await originalReadFile(...args);
    } finally {
      activeReads -= 1;
    }
  };
  try {
    const options = {
      projectRoot,
      sessionDirectories: [directory],
      now: new Date()
    };
    const [first, second] = await Promise.all([
      discoverCodexSessionThreads(options),
      discoverCodexSessionThreads(options)
    ]);
    assert.equal(first.length, fileCount);
    assert.equal(second.length, fileCount);
    assert.equal(fullReadCount, fileCount);
    assert.ok(maximumActiveReads <= 3, `expected at most 3 active reads, saw ${maximumActiveReads}`);
  } finally {
    fsPromises.readFile = originalReadFile;
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});
