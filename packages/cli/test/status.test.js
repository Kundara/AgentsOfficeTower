const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cliVersion,
  formatAge,
  formatDoctorLines,
  formatStatusLines,
  resolveServerTarget
} = require("../dist/status.js");

function healthPayload(overrides = {}) {
  return {
    status: "healthy",
    version: "0.1.0",
    buildAt: "2026-07-11T10:00:00.000Z",
    startedAt: "2026-07-11T11:00:00.000Z",
    pid: 4242,
    host: "127.0.0.1",
    port: 4181,
    projectCount: 2,
    projects: [
      { projectRoot: "/tmp/a", projectLabel: "Project A", snapshotAgeMs: 3000, status: "healthy" },
      { projectRoot: "/tmp/b", projectLabel: "Project B", snapshotAgeMs: 200000, status: "stale" }
    ],
    providers: [
      { adapterId: "codex-local", provider: "local", status: "ready", detail: null, degradedProjects: 0 },
      { adapterId: "hermes", provider: "hermes", status: "degraded", detail: "state.db unreadable", degradedProjects: 2 }
    ],
    notes: ["Local Codex app-server unavailable: ECONNREFUSED"],
    ...overrides
  };
}

test("status lines summarize fleet, providers, projects, and notes", () => {
  const lines = formatStatusLines(healthPayload());
  assert.match(lines[0], /Tower: healthy — 2 projects, v0\.1\.0, pid 4242 @ 127\.0\.0\.1:4181/);
  assert.ok(lines.some((line) => line.includes("degraded") && line.includes("hermes") && line.includes("state.db unreadable")));
  assert.ok(lines.some((line) => line.includes("stale") && line.includes("Project B")));
  assert.ok(lines.some((line) => line.includes("! Local Codex app-server unavailable")));
});

test("ready providers do not print empty detail suffixes", () => {
  const lines = formatStatusLines(healthPayload());
  const codexLine = lines.find((line) => line.includes("codex-local"));
  assert.ok(codexLine);
  assert.ok(!codexLine.includes("—"));
});

test("formatAge scales through seconds, minutes, and hours", () => {
  assert.equal(formatAge(500), "just now");
  assert.equal(formatAge(9000), "9s ago");
  assert.equal(formatAge(3 * 60 * 1000), "3m ago");
  assert.equal(formatAge(2 * 60 * 60 * 1000), "2h ago");
  assert.equal(formatAge(Number.POSITIVE_INFINITY), "unknown age");
});

test("doctor lines carry PASS/WARN/FAIL badges", () => {
  const lines = formatDoctorLines([
    { name: "tower server", status: "pass", detail: "live" },
    { name: "hermes data", status: "warn", detail: "missing" },
    { name: "provider cursor", status: "fail", detail: "auth rejected" }
  ]);
  assert.equal(lines[0], "PASS  tower server: live");
  assert.equal(lines[1], "WARN  hermes data: missing");
  assert.equal(lines[2], "FAIL  provider cursor: auth rejected");
});

test("server target resolution honors flags over environment defaults", () => {
  const fromFlags = resolveServerTarget(["--server", "http://127.0.0.1:5000", "--json"]);
  assert.equal(fromFlags.serverBase, "http://127.0.0.1:5000");
  assert.equal(fromFlags.json, true);

  const fromHostPort = resolveServerTarget(["--host", "0.0.0.0", "--port", "4300"]);
  assert.equal(fromHostPort.serverBase, "http://127.0.0.1:4300");
  assert.equal(fromHostPort.json, false);
});

test("cli version reads a semver-looking string", () => {
  assert.match(cliVersion(), /^\d+\.\d+\.\d+/);
});
