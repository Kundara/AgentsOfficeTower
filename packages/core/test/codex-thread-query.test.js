const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listCodexProjectThreadCandidates
} = require("../dist/codex-thread-query.js");
const {
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
