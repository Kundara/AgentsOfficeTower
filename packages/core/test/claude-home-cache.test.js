const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, utimesSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  discoverClaudeHomeRemoteSessions,
  loadClaudeHomeAccountAgents,
  parseClaudeHomeWatchSse,
  readClaudeHomeWatchCacheFile
} = require("../dist/claude-home-cache.js");

const MAGIC = Buffer.from("305c72a71b6dfbfc", "hex");
const WATCH_KEY = "1/0/https://claude.ai/v1/code/sessions/watch";

function sse(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function cacheEntry(key, body) {
  const keyBytes = Buffer.from(key);
  const header = Buffer.alloc(24);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(keyBytes.length, 12);
  return Buffer.concat([header, keyBytes, Buffer.from(body)]);
}

function writeCache(dir, name, body, options = {}) {
  const path = join(dir, name);
  writeFileSync(path, cacheEntry(options.key ?? `${WATCH_KEY}?resume_from=never-read-this-token`, body));
  if (options.mtimeMs) {
    const time = new Date(options.mtimeMs);
    utimesSync(path, time, time);
  }
  return path;
}

function remoteSession(id, overrides = {}) {
  return {
    id,
    title: "Untitled",
    created_at: "2026-07-09T21:52:48.756Z",
    last_event_at: "2026-07-09T23:15:27.524Z",
    environment_kind: "anthropic_cloud",
    status: "active",
    status_bucket: "working",
    worker_status: "WORKER_STATUS_UNSPECIFIED",
    tags: ["config:cowork-remote", "cowork-remote", "product:cowork-remote"],
    config: {
      model: "claude-opus-4-8",
      origin: "desktop_app",
      sources: [{ path: "/Users/example/Secret Project" }]
    },
    external_metadata: {
      post_turn_summary: {
        needs_action: "false",
        status_category: "working",
        status_detail: "Working in Claude Home"
      }
    },
    ...overrides
  };
}

test("Claude Home SSE parsing keeps only bounded remote-session metadata", () => {
  const raw = remoteSession("cse_safe123", {
    messages: [{ content: "must never escape the cache parser" }],
    auth_token: "also-private"
  });
  const events = parseClaudeHomeWatchSse(
    ":keepalive\n\n" +
    sse("added", raw) +
    sse("changed", {
      id: raw.id,
      last_event_at: "2026-07-09T23:16:00Z",
      status_bucket: "review_ready",
      worker_status: "idle"
    }) +
    "event: changed\ndata: {unfinished"
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "added");
  assert.equal(events[0].session.id, "cse_safe123");
  assert.equal(events[0].session.model, "claude-opus-4-8");
  assert.deepEqual(events[0].session.selectedFolders, ["Secret Project"]);
  assert.equal(JSON.stringify(events).includes("must never escape"), false);
  assert.equal(JSON.stringify(events).includes("auth_token"), false);
  assert.equal(JSON.stringify(events).includes("Working in Claude Home"), false);
  assert.equal(events[1].type, "changed");
  assert.equal(events[1].session.statusBucket, "review_ready");
});

test("Claude Home cache reader validates framing and reads no query-key payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-office-claude-home-reader-"));
  const body = sse("added", remoteSession("cse_reader"));
  const accepted = writeCache(dir, "accepted_0", body);
  const exact = writeCache(dir, "exact_0", body, { key: WATCH_KEY });
  const wrongSuffix = writeCache(dir, "wrong-suffix_0", body, { key: `${WATCH_KEY}x-private` });
  const wrongMagic = join(dir, "wrong-magic_0");
  writeFileSync(wrongMagic, Buffer.concat([Buffer.alloc(24), Buffer.from(body)]));
  const oversized = writeCache(dir, "oversized_0", body + "x".repeat(512));

  assert.equal((await readClaudeHomeWatchCacheFile(accepted)).length, 1);
  assert.equal((await readClaudeHomeWatchCacheFile(exact)).length, 1);
  assert.deepEqual(await readClaudeHomeWatchCacheFile(wrongSuffix), []);
  assert.deepEqual(await readClaudeHomeWatchCacheFile(wrongMagic), []);
  assert.deepEqual(await readClaudeHomeWatchCacheFile(oversized, { maxBodyBytes: 128 }), []);
});

test("Claude Home discovery replays added, changed, and removed events and rejects other sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-office-claude-home-discovery-"));
  const now = Date.parse("2026-07-10T00:00:00Z");
  writeCache(dir, "first_0", [
    sse("added", remoteSession("cse_keep")),
    sse("added", remoteSession("cse_remove")),
    sse("added", remoteSession("cse_wrong_tag", { tags: ["cowork-remote"] })),
    sse("added", remoteSession("cse_wrong_env", { environment_kind: "local" })),
    sse("added", { id: "not-a-cse", tags: ["product:cowork-remote"] })
  ].join(""), { mtimeMs: now - 2_000 });
  writeCache(dir, "second_0", [
    sse("changed", {
      id: "cse_keep",
      last_event_at: "2026-07-09T23:59:30Z",
      status_bucket: "review_ready",
      worker_status: "idle"
    }),
    sse("removed", { id: "cse_remove" })
  ].join(""), { mtimeMs: now - 1_000 });
  writeCache(dir, "stale-file_0", sse("added", remoteSession("cse_stale_file")), {
    mtimeMs: now - 60_000
  });

  const sessions = await discoverClaudeHomeRemoteSessions({
    cacheDirs: [dir],
    now,
    cacheFreshnessMs: 10_000
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "cse_keep");
  assert.equal(sessions[0].statusBucket, "review_ready");
  assert.equal(sessions[0].workerStatus, "idle");
  assert.equal(sessions[0].environmentKind, "anthropic_cloud");
});

test("Claude Home account agents are rootless, read-only, inferred, and age out of running state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-office-claude-home-agents-"));
  const now = Date.parse("2026-07-10T00:00:00Z");
  writeCache(dir, "agents_0", [
    sse("added", remoteSession("cse_live", {
      title: "Weather research",
      last_event_at: "2026-07-09T23:59:30Z"
    })),
    sse("added", remoteSession("cse_stale_active", {
      title: "Older active work",
      last_event_at: "2026-07-09T23:40:00Z"
    })),
    sse("added", remoteSession("cse_review", {
      title: "",
      last_event_at: "2026-07-09T23:58:00Z",
      status_bucket: "review_ready",
      worker_status: "idle"
    }))
  ].join(""), { mtimeMs: now - 1_000 });

  const agents = await loadClaudeHomeAccountAgents({ cacheDirs: [dir], now });
  const live = agents.find((agent) => agent.id.endsWith("cse_live"));
  const stale = agents.find((agent) => agent.id.endsWith("cse_stale_active"));
  const review = agents.find((agent) => agent.id.endsWith("cse_review"));

  assert.equal(live.label, "Weather research");
  assert.equal(live.state, "thinking");
  assert.equal(live.isOngoing, true);
  assert.equal(live.sourceKind, "claude:cowork-remote:claude-opus-4-8");
  assert.equal(live.interactionMode, "work");
  assert.equal(live.conversationKey, "claude-home:cse_live");
  assert.equal(live.accountObserved, true);
  assert.equal(live.cwd, null);
  assert.deepEqual(live.paths, []);
  assert.equal(live.threadId, null);
  assert.equal(live.taskId, null);
  assert.equal(live.resumeCommand, null);
  assert.equal(live.url, null);
  assert.equal(live.liveSubscription, "readOnly");
  assert.equal(live.confidence, "inferred");
  assert.equal(stale.state, "done");
  assert.equal(stale.isOngoing, false);
  assert.equal(review.label, "Claude Home");
  assert.equal(review.state, "done");
});
