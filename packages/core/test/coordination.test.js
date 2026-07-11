const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function withTempHome(run) {
  const home = mkdtempSync(join(tmpdir(), "agents-tower-coordination-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    return run(home);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previous;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

const {
  adviseOnClaimOverlap,
  heartbeatCoordinationClaim,
  listCoordinationClaims,
  releaseCoordinationClaim,
  startCoordinationClaim,
  DEFAULT_CLAIM_TTL_MS
} = require("../dist/coordination.js");

test("claims round-trip: start, list, heartbeat, release", () => {
  withTempHome(() => {
    const projectRoot = "/tmp/claims-project";
    const claim = startCoordinationClaim({
      projectRoot,
      objective: "Refactor the health drawer",
      scope: ["packages/web/src/client/runtime"],
      agentLabel: "Claude",
      branch: "feature/health"
    });
    assert.equal(claim.status, "active");

    const listed = listCoordinationClaims(projectRoot);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].lifecycle, "active");
    assert.equal(listed[0].objective, "Refactor the health drawer");

    const beat = heartbeatCoordinationClaim(projectRoot, claim.id);
    assert.ok(beat);
    assert.ok(Date.parse(beat.expiresAt) > Date.parse(claim.createdAt) + DEFAULT_CLAIM_TTL_MS - 1000);

    const released = releaseCoordinationClaim(projectRoot, claim.id);
    assert.equal(released.status, "released");
    assert.equal(listCoordinationClaims(projectRoot)[0].lifecycle, "released");
  });
});

test("expired active claims read as stale, not released", () => {
  withTempHome(() => {
    const projectRoot = "/tmp/claims-stale";
    const past = Date.now() - 60 * 60 * 1000;
    startCoordinationClaim({ projectRoot, objective: "Old work", scope: ["src"], nowMs: past, ttlMs: 60 * 1000 });
    const listed = listCoordinationClaims(projectRoot);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].lifecycle, "stale");
  });
});

test("released claims prune after their retention window", () => {
  withTempHome(() => {
    const projectRoot = "/tmp/claims-prune";
    const past = Date.now() - 60 * 60 * 1000;
    const claim = startCoordinationClaim({ projectRoot, objective: "Done work", nowMs: past });
    releaseCoordinationClaim(projectRoot, claim.id, { nowMs: past });
    assert.equal(listCoordinationClaims(projectRoot).length, 0);
  });
});

test("overlap advice distinguishes disjoint, active, and stale claims", () => {
  withTempHome(() => {
    const projectRoot = "/tmp/claims-advice";
    startCoordinationClaim({
      projectRoot,
      objective: "Editing the web server",
      scope: ["packages/web/src/server"],
      agentLabel: "Codex"
    });

    const disjoint = adviseOnClaimOverlap(projectRoot, ["packages/core/src"]);
    assert.equal(disjoint.verdict, "proceed");

    const overlapping = adviseOnClaimOverlap(projectRoot, ["packages/web/src/server/router.ts"]);
    assert.equal(overlapping.verdict, "caution");
    assert.match(overlapping.reasons[0], /Active claim "Editing the web server" by Codex overlaps/);

    const stalePast = Date.now() - 2 * 60 * 60 * 1000;
    const projectRootStale = "/tmp/claims-advice-stale";
    startCoordinationClaim({
      projectRoot: projectRootStale,
      objective: "Abandoned edit",
      scope: ["packages/web"],
      nowMs: stalePast,
      ttlMs: 1000
    });
    const staleAdvice = adviseOnClaimOverlap(projectRootStale, ["packages/web/src"]);
    assert.equal(staleAdvice.verdict, "caution");
    assert.match(staleAdvice.reasons[0], /Stale claim "Abandoned edit" overlaps and was not explicitly released/);
  });
});

async function withTempHomeAsync(run) {
  const home = mkdtempSync(join(tmpdir(), "agents-tower-coordination-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previous;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

test("assembled snapshots carry coordination claims", async () => {
  await withTempHomeAsync(async () => {
    const projectRoot = "/tmp/claims-snapshot";
    startCoordinationClaim({ projectRoot, objective: "Visible in snapshot", scope: ["src"] });
    const { emptyAdapterSnapshot } = require("../dist/adapters/helpers.js");
    const { assembleProjectSnapshot } = require("../dist/services/snapshot-assembler.js");
    const snapshot = await assembleProjectSnapshot({
      projectRoot,
      adapterSnapshots: [emptyAdapterSnapshot({ adapterId: "codex-local", source: "local" })]
    });
    assert.equal(snapshot.claims.length, 1);
    assert.equal(snapshot.claims[0].objective, "Visible in snapshot");
    assert.equal(snapshot.claims[0].lifecycle, "active");
  });
});
