const test = require("node:test");
const assert = require("node:assert/strict");

const { buildServerMeta } = require("../dist/server-metadata.js");

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
});
