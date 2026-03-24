const test = require("node:test");
const assert = require("node:assert/strict");

const { codexProjectDiscoveryThreadLimit } = require("../dist/project-paths.js");

test("project discovery scans a wider thread window than the requested project count", () => {
  assert.equal(codexProjectDiscoveryThreadLimit(1), 100);
  assert.equal(codexProjectDiscoveryThreadLimit(10), 200);
  assert.equal(codexProjectDiscoveryThreadLimit(50), 400);
});
