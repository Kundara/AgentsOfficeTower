const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { buildHealthResponse, SNAPSHOT_STALE_AFTER_MS } = require("../dist/server/health.js");
const { handleRequest } = require("../dist/server/router.js");

const NOW_MS = Date.parse("2026-07-11T12:00:00.000Z");

function identity() {
  return { pid: 4242, startedAt: "2026-07-11T11:00:00.000Z", buildAt: "2026-07-11T10:00:00.000Z", version: "0.1.0" };
}

function options() {
  return { host: "127.0.0.1", port: 4181, projects: [], explicitProjects: false };
}

function multiplayer() {
  return { enabled: false, transport: null, secure: false, peerCount: 0, note: "Multiplayer transport not configured." };
}

function providerRow(overrides = {}) {
  return {
    adapterId: "codex-local",
    provider: "local",
    status: "ready",
    detail: null,
    lastUpdatedAt: new Date(NOW_MS - 1000).toISOString(),
    snapshotGeneratedAt: new Date(NOW_MS - 1000).toISOString(),
    ...overrides
  };
}

function snapshot(overrides = {}) {
  const generatedAt = overrides.generatedAt ?? new Date(NOW_MS - 2000).toISOString();
  return {
    projectRoot: "/tmp/project-a",
    projectLabel: "Project A",
    projectIdentity: null,
    generatedAt,
    rooms: { version: 1, generated: true, filePath: "", rooms: [] },
    agents: [],
    cloudTasks: [],
    events: [],
    activity: { generatedAt, hotChanges: [], hotTools: [], runningCommands: [] },
    notes: [],
    providerHealth: [providerRow()],
    ...overrides
  };
}

test("health response reports starting when no fleet has been published", () => {
  const health = buildHealthResponse({
    options: options(),
    fleet: null,
    multiplayer: multiplayer(),
    identity: identity(),
    nowMs: NOW_MS
  });
  assert.equal(health.status, "starting");
  assert.equal(health.projectCount, 0);
  assert.equal(health.version, "0.1.0");
});

test("health response is healthy for fresh ready snapshots", () => {
  const health = buildHealthResponse({
    options: options(),
    fleet: { generatedAt: new Date(NOW_MS).toISOString(), projects: [snapshot()], accountAgents: [] },
    multiplayer: multiplayer(),
    identity: identity(),
    nowMs: NOW_MS
  });
  assert.equal(health.status, "healthy");
  assert.equal(health.projects[0].status, "healthy");
  assert.equal(health.providers.length, 1);
  assert.equal(health.providers[0].status, "ready");
});

test("degraded providers roll up to a degraded fleet with worst-status detail", () => {
  const degradedSnapshot = snapshot({
    projectRoot: "/tmp/project-b",
    projectLabel: "Project B",
    providerHealth: [
      providerRow(),
      providerRow({ adapterId: "hermes", provider: "hermes", status: "degraded", detail: "Hermes state.db unreadable" })
    ]
  });
  const health = buildHealthResponse({
    options: options(),
    fleet: { generatedAt: new Date(NOW_MS).toISOString(), projects: [snapshot(), degradedSnapshot], accountAgents: [] },
    multiplayer: multiplayer(),
    identity: identity(),
    nowMs: NOW_MS
  });
  assert.equal(health.status, "degraded");
  const hermes = health.providers.find((provider) => provider.adapterId === "hermes");
  assert.equal(hermes.status, "degraded");
  assert.equal(hermes.detail, "Hermes state.db unreadable");
  assert.equal(hermes.degradedProjects, 1);
});

test("unconfigured optional providers do not degrade the fleet", () => {
  const unconfiguredSnapshot = snapshot({
    providerHealth: [
      providerRow(),
      providerRow({
        adapterId: "cursor-cloud",
        provider: "cursor",
        status: "unconfigured",
        detail: "Cursor background agents disabled: CURSOR_API_KEY is not configured for this process."
      })
    ]
  });
  const health = buildHealthResponse({
    options: options(),
    fleet: { generatedAt: new Date(NOW_MS).toISOString(), projects: [unconfiguredSnapshot], accountAgents: [] },
    multiplayer: multiplayer(),
    identity: identity(),
    nowMs: NOW_MS
  });
  assert.equal(health.status, "healthy");
  assert.equal(health.projects[0].status, "healthy");
  const cursor = health.providers.find((provider) => provider.adapterId === "cursor-cloud");
  assert.equal(cursor.status, "unconfigured");
  assert.equal(cursor.degradedProjects, 0);
});

test("stale snapshots outrank degraded providers in the fleet rollup", () => {
  const staleSnapshot = snapshot({
    generatedAt: new Date(NOW_MS - SNAPSHOT_STALE_AFTER_MS - 1000).toISOString(),
    providerHealth: [providerRow({ status: "degraded", detail: "slow observer" })]
  });
  const health = buildHealthResponse({
    options: options(),
    fleet: { generatedAt: new Date(NOW_MS).toISOString(), projects: [staleSnapshot], accountAgents: [] },
    multiplayer: multiplayer(),
    identity: identity(),
    nowMs: NOW_MS
  });
  assert.equal(health.projects[0].status, "stale");
  assert.equal(health.status, "stale");
});

test("fleet notes are deduplicated and bounded", () => {
  const projects = Array.from({ length: 5 }, (_, index) => snapshot({
    projectRoot: `/tmp/project-${index}`,
    notes: ["Local Codex app-server unavailable: connect ECONNREFUSED", `unique note ${index}`]
  }));
  const health = buildHealthResponse({
    options: options(),
    fleet: { generatedAt: new Date(NOW_MS).toISOString(), projects, accountAgents: [] },
    multiplayer: multiplayer(),
    identity: identity(),
    nowMs: NOW_MS
  });
  const repeated = health.notes.filter((note) => note.includes("ECONNREFUSED"));
  assert.equal(repeated.length, 1);
  assert.ok(health.notes.length <= 10);
});

function createStubOptions() {
  return { host: "127.0.0.1", port: 0, projects: [], explicitProjects: false };
}

async function startTestServer(t, service) {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, createStubOptions(), service);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "EPERM") {
      t.skip("sandbox disallows loopback listeners");
      return null;
    }
    throw error;
  }
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

test("health routes answer live, ready, and full health over HTTP", async (t) => {
  const service = {
    getPublishedFleet() {
      return { generatedAt: new Date().toISOString(), projects: [snapshot({ generatedAt: new Date().toISOString() })], accountAgents: [] };
    },
    getMultiplayerStatus() {
      return multiplayer();
    }
  };
  const server = await startTestServer(t, service);
  if (!server) {
    return;
  }
  try {
    const live = await fetch(`${server.baseUrl}/api/health/live`);
    assert.equal(live.status, 200);
    assert.equal((await live.json()).status, "ok");

    const ready = await fetch(`${server.baseUrl}/api/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, "ready");

    const health = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal(payload.status, "healthy");
    assert.equal(payload.projectCount, 1);
    assert.ok(Array.isArray(payload.providers));
  } finally {
    await server.close();
  }
});

test("readiness returns 503 before the first fleet publish", async (t) => {
  const service = {
    getPublishedFleet() {
      return null;
    },
    getMultiplayerStatus() {
      return multiplayer();
    }
  };
  const server = await startTestServer(t, service);
  if (!server) {
    return;
  }
  try {
    const ready = await fetch(`${server.baseUrl}/api/health/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).status, "starting");

    const health = await fetch(`${server.baseUrl}/api/health`);
    assert.equal((await health.json()).status, "starting");
  } finally {
    await server.close();
  }
});
