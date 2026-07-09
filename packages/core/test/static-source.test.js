const test = require("node:test");
const assert = require("node:assert/strict");

const { StaticProjectSource } = require("../dist/adapters/static-source.js");

function snapshot(adapterId, generatedAt) {
  return {
    adapterId,
    source: "local",
    generatedAt,
    agents: [],
    events: [],
    notes: [],
    health: { status: "ready", detail: null, lastUpdatedAt: generatedAt }
  };
}

test("newer static-source refreshes win when loaders resolve out of order", async () => {
  const resolvers = [];
  const source = new StaticProjectSource(
    () => new Promise((resolve) => resolvers.push(resolve)),
    snapshot("test", "initial")
  );

  const first = source.refresh("event");
  const second = source.refresh("manual");
  resolvers[1](snapshot("test", "newer"));
  await second;
  resolvers[0](snapshot("test", "older"));
  await first;

  assert.equal(source.getCachedSnapshot().generatedAt, "newer");
});
