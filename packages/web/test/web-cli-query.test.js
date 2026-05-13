const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWebCliQueryResponse,
  hasSharedFleetData
} = require("../dist/server/web-cli-query.js");

function snapshot(overrides = {}) {
  return {
    projectRoot: overrides.projectRoot ?? "/work/CodexAgentsOffice",
    projectLabel: overrides.projectLabel ?? "Codex Agents Office",
    projectIdentity: overrides.projectIdentity ?? {
      repoName: "CodexAgentsOffice",
      gitRoot: "/work/CodexAgentsOffice",
      worktreeName: null
    },
    generatedAt: overrides.generatedAt ?? "2026-05-13T10:00:00.000Z",
    rooms: { version: 1, generated: true, filePath: "", rooms: [] },
    agents: overrides.agents ?? [],
    cloudTasks: [],
    events: overrides.events ?? [],
    notes: [],
    ...overrides.extra
  };
}

function agent(overrides = {}) {
  return {
    id: overrides.id ?? "agent-1",
    label: overrides.label ?? "Atlas",
    source: overrides.source ?? "local",
    state: overrides.state ?? "running",
    updatedAt: overrides.updatedAt ?? "2026-05-13T10:02:00.000Z",
    role: overrides.role ?? "default",
    detail: overrides.detail ?? "Running tests",
    latestMessage: overrides.latestMessage ?? null,
    roomId: overrides.roomId ?? "main",
    threadId: overrides.threadId ?? "thread-1",
    provenance: overrides.provenance ?? "codex",
    confidence: overrides.confidence ?? "typed",
    network: overrides.network ?? null
  };
}

function event(overrides = {}) {
  return {
    id: overrides.id ?? "event-1",
    source: overrides.source ?? "codex",
    confidence: overrides.confidence ?? "typed",
    threadId: overrides.threadId ?? "thread-1",
    createdAt: overrides.createdAt ?? "2026-05-13T10:03:00.000Z",
    method: overrides.method ?? "codex/item/commandExecution",
    kind: overrides.kind ?? "command",
    phase: overrides.phase ?? "started",
    title: overrides.title ?? "npm test",
    detail: overrides.detail ?? "Validation command",
    path: overrides.path ?? null
  };
}

test("web CLI query returns bounded recent local project data by repo name", () => {
  const fleet = {
    generatedAt: "2026-05-13T10:04:00.000Z",
    projects: [
      snapshot({
        agents: [
          agent({ id: "agent-old", label: "Mira", updatedAt: "2026-05-13T09:58:00.000Z", state: "waiting" }),
          agent({ id: "agent-new", label: "Nova", updatedAt: "2026-05-13T10:02:00.000Z", state: "running" })
        ],
        events: [
          event({ id: "event-new", createdAt: "2026-05-13T10:03:00.000Z", title: "npm run typecheck" })
        ]
      })
    ]
  };

  const result = buildWebCliQueryResponse(
    {
      repo: "codex-agents-office",
      scope: "local",
      command: "recent",
      values: { limit: 2 }
    },
    fleet,
    null,
    Date.parse("2026-05-13T10:05:00.000Z")
  );

  assert.equal(result.ok, true);
  assert.equal(result.response.dataSource, "local");
  assert.equal(result.response.items.length, 2);
  assert.deepEqual(result.response.items.map((item) => item.id), ["event-new", "agent-new"]);
});

test("web CLI last command returns one filtered event", () => {
  const fleet = {
    generatedAt: "2026-05-13T10:04:00.000Z",
    projects: [
      snapshot({
        agents: [agent({ id: "agent-1" })],
        events: [
          event({ id: "event-command", kind: "command", createdAt: "2026-05-13T10:03:00.000Z" }),
          event({ id: "event-message", kind: "message", createdAt: "2026-05-13T10:04:00.000Z" })
        ]
      })
    ]
  };

  const result = buildWebCliQueryResponse(
    {
      repo: "CodexAgentsOffice",
      scope: "local",
      command: "last",
      values: { type: "events", kind: "command", limit: 20 }
    },
    fleet,
    null,
    Date.parse("2026-05-13T10:05:00.000Z")
  );

  assert.equal(result.ok, true);
  assert.equal(result.response.values.limit, 1);
  assert.deepEqual(result.response.items.map((item) => item.id), ["event-command"]);
});

test("web CLI team scope uses coordinated shared fleet cache when available", () => {
  const localFleet = {
    generatedAt: "2026-05-13T10:00:00.000Z",
    projects: [snapshot({ agents: [agent({ id: "local-agent", label: "Local" })] })]
  };
  const teamFleet = {
    generatedAt: "2026-05-13T10:04:00.000Z",
    projects: [
      snapshot({
        agents: [
          agent({
            id: "shared:peer-1:agent-remote",
            label: "Remote Atlas",
            source: "local",
            network: {
              transport: "partykit",
              peerId: "peer-1",
              peerLabel: "Teammate",
              peerHost: "example.partykit.dev",
              peerRoom: "room-a"
            }
          })
        ],
        extra: {
          sharedParticipantLabels: ["Teammate"]
        }
      })
    ]
  };

  const result = buildWebCliQueryResponse(
    {
      repo: "CodexAgentsOffice",
      scope: "team",
      command: "recent",
      values: { type: "agents" }
    },
    localFleet,
    {
      fleet: teamFleet,
      receivedAt: "2026-05-13T10:04:30.000Z",
      hasSharedData: true
    },
    Date.parse("2026-05-13T10:05:00.000Z")
  );

  assert.equal(result.ok, true);
  assert.equal(result.response.dataSource, "team-cache");
  assert.equal(result.response.teamDataAvailable, true);
  assert.equal(result.response.items[0].id, "shared:peer-1:agent-remote");
  assert.equal(result.response.items[0].peerLabel, "Teammate");
});

test("web CLI team scope falls back to local data without shared cache data", () => {
  const localFleet = {
    generatedAt: "2026-05-13T10:00:00.000Z",
    projects: [snapshot({ agents: [agent({ id: "local-agent" })] })]
  };
  const cache = {
    fleet: {
      generatedAt: "2026-05-13T10:04:00.000Z",
      projects: [snapshot({ agents: [agent({ id: "cached-local-agent" })] })]
    },
    receivedAt: "2026-05-13T10:04:30.000Z",
    hasSharedData: false
  };

  const result = buildWebCliQueryResponse(
    {
      repo: "CodexAgentsOffice",
      scope: "team",
      command: "recent",
      values: { type: "agents" }
    },
    localFleet,
    cache,
    Date.parse("2026-05-13T10:05:00.000Z")
  );

  assert.equal(result.ok, true);
  assert.equal(result.response.dataSource, "local");
  assert.equal(result.response.items[0].id, "local-agent");
});

test("shared fleet guard only accepts snapshots with multiplayer data", () => {
  assert.equal(hasSharedFleetData({ generatedAt: "", projects: [snapshot({ agents: [agent()] })] }), false);
  assert.equal(hasSharedFleetData({ generatedAt: "", projects: [snapshot({ extra: { sharedRemoteOnly: true } })] }), true);
  assert.equal(
    hasSharedFleetData({
      generatedAt: "",
      projects: [
        snapshot({
          agents: [
            agent({
              network: {
                transport: "partykit",
                peerId: "peer-1",
                peerLabel: "Teammate",
                peerHost: null,
                peerRoom: "room-a"
              }
            })
          ]
        })
      ]
    }),
    true
  );
});
