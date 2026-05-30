const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  loadRoamingOpenClawSnapshotData,
  openClawSessionToActivityState,
  openClawSessionDetail,
  openClawSessionWorkspaceLabel,
  openClawWorkspaceMatchesProject
} = require("../dist/openclaw.js");

test("OpenClaw running sessions with active children map to delegating", () => {
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "running" },
      activeChildCount: 2
    }),
    "delegating"
  );
  assert.equal(
    openClawSessionDetail({
      row: { key: "agent:main:main", status: "running" },
      activeChildCount: 2
    }),
    "Delegating to 2 sessions"
  );
});

test("OpenClaw terminal statuses map to done or blocked office states", () => {
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "done" },
      activeChildCount: 0
    }),
    "done"
  );
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "failed" },
      activeChildCount: 0
    }),
    "blocked"
  );
  assert.equal(
    openClawSessionToActivityState({
      row: { key: "agent:main:main", status: "killed" },
      activeChildCount: 0
    }),
    "blocked"
  );
});

test("OpenClaw workspace matching uses the shared project-path normalization", () => {
  assert.equal(
    openClawWorkspaceMatchesProject("F:\\Projects\\CodexAgentsOffice", "/mnt/f/Projects/CodexAgentsOffice"),
    true
  );
  assert.equal(
    openClawWorkspaceMatchesProject("/mnt/f/Projects/SomewhereElse", "/mnt/f/Projects/CodexAgentsOffice"),
    false
  );
  assert.equal(
    openClawSessionWorkspaceLabel("/mnt/f/Projects/CodexAgentsOffice"),
    "CodexAgentsOffice"
  );
});

test("OpenClaw unmatched workspace sessions become roaming orchestrators", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const originalCodexHome = process.env.CODEX_HOME;
  const tempCodexHome = mkdtempSync(join(tmpdir(), "cao-openclaw-"));
  const now = Date.now();

  class MockOpenClawSocket {
    constructor() {
      this.listeners = new Map();
      setImmediate(() => {
        this.emit("open", {});
        setImmediate(() => {
          this.emit("message", {
            data: JSON.stringify({
              type: "event",
              event: "connect.challenge",
              payload: { nonce: "test-nonce" }
            })
          });
        });
      });
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }

    send(data) {
      const frame = JSON.parse(data);
      let payload = {};
      if (frame.method === "config.get") {
        payload = {
          config: {
            agents: {
              list: [
                { id: "inside", name: "Inside", workspace: "/repo/app/worktrees/feature-a" },
                { id: "outside", name: "OpenClaw Harness", workspace: "/tmp/openclaw-harness" }
              ]
            }
          }
        };
      } else if (frame.method === "agents.list") {
        payload = {
          defaultId: "inside",
          agents: [
            { id: "inside", name: "Inside" },
            { id: "outside", name: "OpenClaw Harness" }
          ]
        };
      } else if (frame.method === "sessions.list") {
        payload = {
          sessions: [
            {
              key: "agent:inside:main",
              status: "running",
              updatedAt: now,
              label: "Inside worktree"
            },
            {
              key: "agent:outside:main",
              status: "running",
              updatedAt: now + 1,
              label: "Harness main",
              lastMessagePreview: "Watching the orchestrated project"
            }
          ]
        };
      }

      setImmediate(() => {
        this.emit("message", {
          data: JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload
          })
        });
      });
    }

    close() {}
  }

  try {
    process.env.OPENCLAW_GATEWAY_URL = "ws://openclaw.test";
    process.env.CODEX_HOME = tempCodexHome;
    globalThis.WebSocket = MockOpenClawSocket;

    const roaming = await loadRoamingOpenClawSnapshotData({
      anchorProjectRoot: "/repo/app",
      knownProjectRoots: ["/repo/app"],
      limit: 5
    });

    assert.equal(roaming.agents.length, 1);
    assert.equal(roaming.agents[0].id, "openclaw:agent:outside:main");
    assert.equal(roaming.agents[0].source, "openclaw");
    assert.equal(roaming.agents[0].sourceKind, "openclaw:roaming");
    assert.equal(roaming.agents[0].state, "thinking");
    assert.equal(roaming.agents[0].statusText, "roaming");
    assert.equal(roaming.agents[0].cwd, "/tmp/openclaw-harness");
  } finally {
    globalThis.WebSocket = originalWebSocket;
    if (originalGatewayUrl === undefined) {
      delete process.env.OPENCLAW_GATEWAY_URL;
    } else {
      process.env.OPENCLAW_GATEWAY_URL = originalGatewayUrl;
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    rmSync(tempCodexHome, { recursive: true, force: true });
  }
});
