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
    activity: overrides.activity ?? { generatedAt: "2026-05-13T10:04:00.000Z", hotChanges: [], hotTools: [], runningCommands: [] },
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
    activitySummary: overrides.activitySummary,
    activityEvent: overrides.activityEvent ?? null,
    roomId: overrides.roomId ?? "main",
    threadId: overrides.threadId ?? "thread-1",
    provenance: overrides.provenance ?? "codex",
    confidence: overrides.confidence ?? "typed",
    network: overrides.network ?? null
  };
}

function hotChange(overrides = {}) {
  return {
    path: overrides.path ?? "/work/CodexAgentsOffice/packages/web/src/server/web-cli-query.ts",
    label: overrides.label ?? "web-cli-query.ts",
    fileType: overrides.fileType ?? "script",
    branch: overrides.branch ?? null,
    branches: overrides.branches ?? [],
    users: overrides.users ?? [],
    heat: overrides.heat ?? 88,
    score: overrides.score ?? 42,
    changeCount: overrides.changeCount ?? 3,
    lastChangedAt: overrides.lastChangedAt ?? "2026-05-13T10:03:30.000Z",
    linesAdded: overrides.linesAdded ?? 12,
    linesRemoved: overrides.linesRemoved ?? 2,
    agents: overrides.agents ?? ["Nova"],
    provenance: overrides.provenance ?? "codex",
    confidence: overrides.confidence ?? "typed"
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

test("web CLI gist returns hot changes and active agent state sync", () => {
  const fleet = {
    generatedAt: "2026-05-13T10:04:00.000Z",
    projects: [
      snapshot({
        activity: {
          generatedAt: "2026-05-13T10:04:00.000Z",
          hotChanges: [hotChange({ label: "server.ts", branch: "feature/hot-board", branches: ["feature/hot-board"], users: ["Teammate"] })],
          hotTools: [],
          runningCommands: []
        },
        agents: [
          agent({
            id: "agent-active",
            label: "Nova",
            state: "editing",
            isCurrent: true,
            latestMessage: "Updating CLI state sync",
            activitySummary: {
              hotFiles: [
                {
                  path: "/work/CodexAgentsOffice/packages/cli/src/web-query.ts",
                  label: "web-query.ts",
                  action: "edited",
                  count: 2,
                  lastUpdatedAt: "2026-05-13T10:02:30.000Z",
                  linesAdded: 20,
                  linesRemoved: 1
                }
              ],
              runningCommand: null,
              blockers: [],
              updatedAt: "2026-05-13T10:02:30.000Z"
            }
          }),
          agent({ id: "agent-idle", label: "Resting", state: "idle", isCurrent: false, isOngoing: false })
        ]
      })
    ]
  };

  const result = buildWebCliQueryResponse(
    {
      repo: "CodexAgentsOffice",
      scope: "local",
      command: "gist",
      values: {}
    },
    fleet,
    null,
    Date.parse("2026-05-13T10:05:00.000Z")
  );

  assert.equal(result.ok, true);
  assert.equal(result.response.items.length, 0);
  assert.equal(result.response.values.limit, 8);
  assert.equal(result.response.gist.summary, "1 active agent; 1 hot change");
  assert.equal(result.response.gist.hotChanges[0].label, "server.ts");
  assert.equal(result.response.gist.hotChanges[0].branch, "feature/hot-board");
  assert.deepEqual(result.response.gist.hotChanges[0].branches, ["feature/hot-board"]);
  assert.deepEqual(result.response.gist.hotChanges[0].users, ["Teammate"]);
  assert.equal(result.response.gist.activeAgents[0].label, "Nova");
  assert.equal(result.response.gist.activeAgents[0].lastMessage, "Updating CLI state sync");
  assert.equal(result.response.gist.activeAgents[0].lastFileChange.label, "web-query.ts");
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
  assert.equal(hasSharedFleetData({ generatedAt: "", projects: [snapshot({ extra: { sharedRemoteOnly: true } })] }), false);
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
