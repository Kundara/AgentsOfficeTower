const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateStopSafety, buildServiceFile } = require("../dist/lifecycle.js");

test("stop safety requires the live pid to match the pidfile", () => {
  assert.equal(evaluateStopSafety(1234, 1234), "safe");
  assert.equal(evaluateStopSafety(1234, 5678), "ownership-mismatch");
  assert.equal(evaluateStopSafety(null, 5678), "ownership-mismatch");
  assert.equal(evaluateStopSafety(1234, null), "not-running");
  assert.equal(evaluateStopSafety(null, null), "not-running");
});

test("service files are generated for darwin and linux with the web entry", () => {
  const darwin = buildServiceFile("darwin", "/opt/aot/index.js", "4181");
  assert.ok(darwin.path.endsWith("com.agents-tower.aot.plist"));
  assert.match(darwin.contents, /<string>web<\/string>/);
  assert.match(darwin.contents, /<string>4181<\/string>/);
  assert.match(darwin.instructions, /launchctl load/);

  const linux = buildServiceFile("linux", "/opt/aot/index.js", "4300");
  assert.ok(linux.path.endsWith("agents-office-tower.service"));
  assert.match(linux.contents, /ExecStart=.* web --port 4300/);

  assert.equal(buildServiceFile("win32", "/opt/aot/index.js", "4181"), null);
});
