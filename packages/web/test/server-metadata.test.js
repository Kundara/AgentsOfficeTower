const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { canonicalizeProjectPath } = require("../../core/dist/project-paths.js");
const { buildFleetResponse, buildServerMeta } = require("../dist/server-metadata.js");
const {
  DISCOVERED_PROJECT_FRESHNESS_WINDOW_MS,
  FLEET_CLOUD_REFRESH_TIMEOUT_MS,
  FLEET_MONITOR_START_TIMEOUT_MS,
  FLEET_MONITOR_REFRESH_TIMEOUT_MS,
  FLEET_OPTIONAL_SOURCE_TIMEOUT_MS,
  FleetLiveService,
  PROJECT_SET_REFRESH_INTERVAL_MS,
  filterFreshDiscoveredProjects,
  mergeDiscoveredProjectRootsWithSeeds,
  projectRootExists,
  refreshMonitorWithinTimeout,
  shouldRefreshProjectSet,
  sortProjectRootsWithCoworkLast
} = require("../dist/server/fleet-live-service.js");

test("fleet monitor refresh timeout keeps a degraded project from blocking the fleet", async () => {
  assert.equal(FLEET_CLOUD_REFRESH_TIMEOUT_MS, 5000);
  assert.equal(FLEET_OPTIONAL_SOURCE_TIMEOUT_MS, 3000);
  assert.equal(FLEET_MONITOR_START_TIMEOUT_MS, 8000);
  assert.equal(FLEET_MONITOR_REFRESH_TIMEOUT_MS, 20000);
  assert.equal(await refreshMonitorWithinTimeout(async () => {}, 10), true);
  assert.equal(
    await refreshMonitorWithinTimeout(() => new Promise(() => {}), 10),
    false
  );
});

test("server metadata can reflect the live fleet project set", () => {
  const options = {
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/seed/project", label: "project" }]
  };
  const liveProjects = [
    { root: "/project/a", label: "a" },
    { root: "/project/b", label: "b" }
  ];

  const meta = buildServerMeta(options, liveProjects);

  assert.equal(meta.explicitProjects, false);
  assert.deepEqual(meta.projects, liveProjects);
  assert.deepEqual(meta.multiplayer, {
    enabled: false,
    transport: null,
    secure: false,
    peerCount: 0,
    note: "Multiplayer transport not configured."
  });
});

test("fleet metadata keeps rootless account agents in a separate local lane", () => {
  const accountAgent = { id: "claude:home-remote:cse_fixture" };
  const fleet = buildFleetResponse([], new Map(), [accountAgent]);

  assert.deepEqual(fleet.projects, []);
  assert.deepEqual(fleet.accountAgents, [accountAgent]);
});

test("fleet metadata defaults the account lane for older callers", () => {
  assert.deepEqual(buildFleetResponse([], new Map()).accountAgents, []);
});

test("server metadata can include multiplayer status", () => {
  const options = {
    host: "127.0.0.1",
    port: 4181,
    explicitProjects: false,
    projects: [{ root: "/seed/project", label: "project" }]
  };
  const multiplayer = {
    enabled: false,
    transport: null,
    secure: false,
    peerCount: 0,
    note: "Multiplayer transport not configured."
  };

  const meta = buildServerMeta(options, options.projects, multiplayer);

  assert.deepEqual(meta.multiplayer, multiplayer);
});

test("fleet discovery hides autodiscovered workspaces older than the internal 7-day freshness window", () => {
  const nowMs = Date.parse("2026-03-28T12:00:00.000Z");
  const thresholdSeconds = Math.floor((nowMs - DISCOVERED_PROJECT_FRESHNESS_WINDOW_MS) / 1000);
  const visible = filterFreshDiscoveredProjects(
    [
      { root: "/fresh", label: "Fresh", updatedAt: thresholdSeconds + 1, count: 1 },
      { root: "/fresh-ms", label: "Fresh ms", updatedAt: (thresholdSeconds + 1) * 1000, count: 1 },
      { root: "/borderline", label: "Borderline", updatedAt: thresholdSeconds, count: 0 },
      { root: "/stale", label: "Stale", updatedAt: thresholdSeconds - 1, count: 1 }
    ],
    nowMs
  );

  assert.deepEqual(visible.map((project) => project.root), ["/fresh", "/fresh-ms"]);
});

test("fleet project existence checks convert canonical roots to host-native paths", () => {
  const nativeRoot = mkdtempSync(join(tmpdir(), "agents-tower-project-root-"));
  try {
    const canonicalRoot = canonicalizeProjectPath(nativeRoot);
    assert.ok(canonicalRoot);
    assert.equal(projectRootExists(canonicalRoot), true);
  } finally {
    rmSync(nativeRoot, { recursive: true, force: true });
  }
});

test("fleet discovery drops seed workspaces without recent discovered activity", () => {
  assert.deepEqual(
    mergeDiscoveredProjectRootsWithSeeds(
      ["/mnt/c/Users/User/OtherProject"],
      ["/mnt/c/Users/User/AgentsOfficeTower"]
    ),
    ["/mnt/c/Users/User/OtherProject"]
  );
});

test("fleet discovery uses seed spelling only for a matching fresh project", () => {
  assert.deepEqual(
    mergeDiscoveredProjectRootsWithSeeds(
      ["\\mnt\\c\\Users\\User\\AgentsOfficeTower"],
      ["/mnt/c/Users/User/AgentsOfficeTower"]
    ),
    ["/mnt/c/Users/User/AgentsOfficeTower"]
  );
});

test("fleet mode starts empty while explicit project mode remains pinned", () => {
  const seed = [{ root: "/seed/project", label: "project" }];
  assert.deepEqual(new FleetLiveService(seed, false).getCurrentProjects(), []);
  assert.deepEqual(new FleetLiveService(seed, true).getCurrentProjects(), seed);
});

test("fleet startup is single-flight and fleet reads wait for readiness", async () => {
  const service = new FleetLiveService([], false);
  let releaseStart;
  service.startInternal = async () => {
    await new Promise((resolve) => {
      releaseStart = resolve;
    });
    service.fleet = buildFleetResponse([], new Map());
  };

  const starting = service.start();
  let readResolved = false;
  const reading = service.getFleet().then(() => {
    readResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(readResolved, false);
  releaseStart();
  await Promise.all([starting, reading]);
  assert.equal(readResolved, true);
});

test("overlapping project-set requests share one discovery pass", async () => {
  const service = new FleetLiveService([], false);
  let refreshCount = 0;
  let releaseRefresh;
  service.refreshProjectSet = async () => {
    refreshCount += 1;
    await new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    service.lastProjectSetRefreshAt = Date.now();
  };

  const first = service.ensureProjectSet(true);
  const second = service.ensureProjectSet(true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(refreshCount, 1);
  releaseRefresh();
  await Promise.all([first, second]);
});

test("overlapping cloud refresh requests share one provider call", async () => {
  const service = new FleetLiveService([], false);
  let refreshCount = 0;
  let releaseRefresh;
  service.refreshSharedCloudTasksInternal = async () => {
    refreshCount += 1;
    await new Promise((resolve) => {
      releaseRefresh = resolve;
    });
  };

  const first = service.refreshSharedCloudTasks();
  const second = service.refreshSharedCloudTasks();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(refreshCount, 1);
  releaseRefresh();
  await Promise.all([first, second]);
});

test("empty fleet discovery still respects the project refresh cadence", () => {
  const lastRefreshAt = 10_000;
  assert.equal(shouldRefreshProjectSet(lastRefreshAt, false, lastRefreshAt + PROJECT_SET_REFRESH_INTERVAL_MS - 1), false);
  assert.equal(shouldRefreshProjectSet(lastRefreshAt, false, lastRefreshAt + PROJECT_SET_REFRESH_INTERVAL_MS), true);
  assert.equal(shouldRefreshProjectSet(0, false, lastRefreshAt), true);
  assert.equal(shouldRefreshProjectSet(lastRefreshAt, true, lastRefreshAt + 1), true);
});

test("fleet discovery sorts Claude Co-work-only projects after normal workspaces", () => {
  const sourceKindsByIdentity = new Map([
    ["/work/main", ["codex"]],
    ["/work/cowork", ["claude:cowork"]],
    ["/work/mixed", ["codex", "claude:cowork"]]
  ]);

  assert.deepEqual(
    sortProjectRootsWithCoworkLast(
      ["/work/cowork", "/work/main", "/work/mixed"],
      sourceKindsByIdentity
    ),
    ["/work/main", "/work/mixed", "/work/cowork"]
  );
});
