const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ts = require("typescript");

function extractSection(fileName, exportName) {
  const source = readFileSync(join(__dirname, "../src/client/runtime", fileName), "utf8");
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === exportName
        && declaration.initializer
        && ts.isNoSubstitutionTemplateLiteral(declaration.initializer)
      ) {
        return declaration.initializer.text;
      }
    }
  }
  throw new Error(`literal ${exportName} not found in ${fileName}`);
}

function loadCoordination(state = {}) {
  const code = extractSection("coordination-source.ts", "CLIENT_RUNTIME_COORDINATION_SOURCE");
  const documentStub = {
    body: { addEventListener() {} },
    getElementById() { return null; }
  };
  const localStorageStub = { getItem() { return null; }, setItem() {} };
  const factory = new Function(
    "state", "escapeHtml", "projectLabel", "evidenceTime", "formatHealthAge", "document", "localStorage", "render", "setCoverageOpen",
    `${code}\nreturn { detectPossibleOverlaps, renderCoordinationCards, refreshCoordinationState, overlapEvidenceLine, desktopNotificationsState, renderDeclaredClaimCards };`
  );
  return factory(
    state,
    (value) => String(value),
    (root) => String(root).split("/").pop(),
    () => "1m ago",
    (ms) => `${Math.round(ms / 60000)}m`,
    documentStub,
    localStorageStub,
    () => {},
    () => {}
  );
}

function snapshotWithChanges(hotChanges) {
  return {
    projectRoot: "/tmp/fixture",
    generatedAt: new Date().toISOString(),
    notes: [],
    providerHealth: [],
    agents: [],
    activity: { hotChanges }
  };
}

test("multi-actor hot changes become possible-overlap findings; single actors do not", () => {
  const coordination = loadCoordination();
  const overlaps = coordination.detectPossibleOverlaps([snapshotWithChanges([
    { path: "src/a.ts", label: "a.ts", agents: ["a1", "a2"], users: [], branches: [], lastChangedAt: "2026-07-11T12:00:00Z", confidence: "typed" },
    { path: "src/b.ts", label: "b.ts", agents: ["a3"], users: [], branches: [], lastChangedAt: "2026-07-11T12:00:00Z", confidence: "typed" },
    { path: "src/c.ts", label: "c.ts", agents: [], users: ["Me", "Peer"], branches: [], lastChangedAt: "2026-07-11T12:00:00Z", confidence: "inferred" },
    { path: "src/d.ts", label: "d.ts", agents: [], users: [], branches: ["main", "feature/x"], lastChangedAt: "2026-07-11T12:00:00Z", confidence: "typed" }
  ])]);
  assert.equal(overlaps.length, 3);
  assert.deepEqual(overlaps.map((overlap) => overlap.label), ["a.ts", "c.ts", "d.ts"]);
});

test("overlap evidence lines cite actors without claiming ownership", () => {
  const coordination = loadCoordination();
  const line = coordination.overlapEvidenceLine({
    agents: ["a1", "a2"], users: ["Me", "Peer"], branches: []
  });
  assert.match(line, /2 agents recently touched this path/);
  assert.match(line, /changed by Me and Peer/);
  assert.ok(!/owned by/i.test(line));
});

test("refreshCoordinationState publishes overlap agent ids for the lens and cards render evidence", () => {
  const state = {};
  const coordination = loadCoordination(state);
  const projects = [snapshotWithChanges([
    { path: "src/a.ts", label: "a.ts", agents: ["a1", "a2"], users: [], branches: [], lastChangedAt: "2026-07-11T12:00:00Z", confidence: "typed" }
  ])];
  coordination.refreshCoordinationState(projects);
  assert.ok(state.overlapAgentIds.has("a1"));
  assert.ok(state.overlapAgentIds.has("a2"));
  const html = coordination.renderCoordinationCards(projects);
  assert.match(html, /Possible overlap — a\.ts/);
  assert.match(html, /typed evidence/);
  assert.match(html, /data-action="search-overlap"/);
});

test("desktop notifications default to off and report unsupported without the Notification API", () => {
  const coordination = loadCoordination();
  assert.equal(coordination.desktopNotificationsState(), "unsupported");
});


test("declared claims render side by side with detected overlaps, stale claims flagged", () => {
  const coordination = loadCoordination({});
  const projects = [{
    projectRoot: "/tmp/fixture",
    generatedAt: new Date().toISOString(),
    notes: [],
    providerHealth: [],
    agents: [],
    activity: { hotChanges: [] },
    claims: [
      { id: "c1", objective: "Refactor drawer", scope: ["packages/web"], branch: null, agentLabel: "Claude", lifecycle: "active", heartbeatAt: new Date().toISOString(), status: "active" },
      { id: "c2", objective: "Abandoned work", scope: [], branch: null, agentLabel: null, lifecycle: "stale", heartbeatAt: new Date().toISOString(), status: "active" },
      { id: "c3", objective: "Finished work", scope: [], branch: null, agentLabel: null, lifecycle: "released", heartbeatAt: new Date().toISOString(), status: "released" }
    ]
  }];
  const html = coordination.renderDeclaredClaimCards(projects);
  assert.match(html, /Declared: Refactor drawer/);
  assert.match(html, /by Claude/);
  assert.match(html, /Stale: expired without an explicit release/);
  assert.ok(!html.includes("Finished work"));
});

test("the overlap lens includes actors beyond the six visible evidence cards", () => {
  const state = {};
  const coordination = loadCoordination(state);
  const projects = [snapshotWithChanges(Array.from({ length: 8 }, (_, i) => ({
    path: `src/file-${i}.ts`, label: `file-${i}.ts`, agents: [`a-${i}`, `b-${i}`], users: [], branches: [], confidence: "typed"
  })))];
  coordination.refreshCoordinationState(projects);
  assert.equal(state.overlapAgentIds.size, 16);
  assert.ok(state.overlapAgentIds.has("a-7"));
  const html = coordination.renderCoordinationCards(projects);
  assert.equal((html.match(/data-action="search-overlap"/g) || []).length, 6);
  assert.match(html, /8 findings/);
});

test("duplicate or blank actors do not invent overlap", () => {
  const coordination = loadCoordination();
  assert.deepEqual(coordination.detectPossibleOverlaps([snapshotWithChanges([
    { path: "a.ts", agents: ["a", "a", ""], users: ["Me", "Me"], branches: ["main", "main"] }
  ])]), []);
});
