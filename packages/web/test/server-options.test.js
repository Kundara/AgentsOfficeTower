const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");

const { buildProjectDescriptors, parseArgs } = require("../dist/server-options.js");

test("web server defaults to fleet mode when no project roots are passed", () => {
  const options = parseArgs(["--port", "4181"]);

  assert.equal(options.explicitProjects, false);
  assert.equal(options.projects.length, 1);
  assert.ok(options.projects[0].root);
});

test("web server becomes pinned only when explicit project roots are passed", () => {
  const options = parseArgs(["/tmp/project-a", "/tmp/project-b", "--port", "4181"]);

  assert.equal(options.explicitProjects, true);
  assert.deepEqual(
    options.projects.map((project) => project.root),
    [resolve("/tmp/project-a"), resolve("/tmp/project-b")]
  );
});

test("project descriptors humanize camel-case workspace names", () => {
  const descriptors = buildProjectDescriptors([
    "/workspaces/CodexAgentsOffice",
    "/workspaces/ProjectAtlas"
  ]);

  assert.deepEqual(
    descriptors.map((project) => project.label),
    ["Codex Agents Office", "Project Atlas"]
  );
});

test("project descriptors label Codex projectless chat roots as Chat", () => {
  const descriptors = buildProjectDescriptors([
    "/mnt/c/Users/kunda/Documents/Codex"
  ]);

  assert.equal(descriptors[0].label, "Chat");
});

test("server args dedupe Windows-backed WSL project roots by identity", () => {
  const options = parseArgs([
    "--seed-project", "/mnt/f/AI/CodexAgentsOffice",
    "--seed-project", "/mnt/f/ai/codexagentsoffice"
  ]);

  assert.equal(options.projects.length, 1);
  assert.equal(options.projects[0].root, resolve("/mnt/f/AI/CodexAgentsOffice"));
});
