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
  assert.deepEqual(meta.multiplayer, {
    enabled: false,
    transport: null,
    secure: false,
    peerCount: 0,
    note: "Multiplayer transport not configured."
  });
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
