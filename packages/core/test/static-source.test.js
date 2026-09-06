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

test("loader failures preserve cached data and timestamps and publish degraded health", async () => {
  const initial = snapshot("test", "old");
  initial.agents = [{ id: "cached-agent" }];
  const source = new StaticProjectSource(async () => { throw new Error("offline"); }, initial);
  let notifications = 0;
  source.subscribe(() => { throw new Error("broken observer"); });
  source.subscribe(() => notifications++);
  await source.warm();
  const cached = source.getCachedSnapshot();
  assert.equal(cached.agents, initial.agents);
  assert.equal(cached.generatedAt, "old");
  assert.equal(cached.health.lastUpdatedAt, "old");
  assert.equal(cached.health.status, "degraded");
  assert.match(cached.health.detail, /offline/);
  assert.equal(notifications, 1);
});

test("initial loader failure reports error and a later success recovers", async () => {
  const initial = snapshot("test", "initial");
  initial.health = { status: "unconfigured", detail: "Not loaded", lastUpdatedAt: null };
  let fail = true;
  const source = new StaticProjectSource(async () => {
    if (fail) throw new Error("offline");
    return snapshot("test", "fresh");
  }, initial);
  await source.refresh("manual");
  assert.equal(source.getCachedSnapshot().health.status, "error");
  assert.equal(source.getCachedSnapshot().health.lastUpdatedAt, null);
  fail = false;
  await source.refresh("manual");
  assert.equal(source.getCachedSnapshot().health.status, "ready");
  assert.equal(source.getCachedSnapshot().generatedAt, "fresh");
});

test("stale failures cannot overwrite newer successful snapshots", async () => {
  const pending = [];
  const source = new StaticProjectSource(() => new Promise((resolve, reject) => pending.push({ resolve, reject })), snapshot("test", "initial"));
  const first = source.refresh("event");
  const second = source.refresh("manual");
  pending[1].resolve(snapshot("test", "newer"));
  await second;
  pending[0].reject(new Error("stale failure"));
  await first;
  assert.equal(source.getCachedSnapshot().generatedAt, "newer");
  assert.equal(source.getCachedSnapshot().health.status, "ready");
});

test("latest failure wins over a late older successful refresh", async () => {
  const pending = [];
  const source = new StaticProjectSource(() => new Promise((resolve, reject) => pending.push({ resolve, reject })), snapshot("test", "initial"));
  const first = source.refresh("event");
  const second = source.refresh("manual");
  pending[1].reject(new Error("latest failure"));
  await second;
  pending[0].resolve(snapshot("test", "stale"));
  await first;
  assert.equal(source.getCachedSnapshot().generatedAt, "initial");
  assert.match(source.getCachedSnapshot().health.detail, /latest failure/);
});

for (const rejectPending of [false, true]) {
  test(`dispose blocks pending ${rejectPending ? "failure" : "success"}, subscriptions and future work`, async () => {
    let settle;
    let loads = 0;
    let notifications = 0;
    const initial = snapshot("test", "initial");
    const source = new StaticProjectSource(() => {
      loads++;
      return new Promise((resolve, reject) => { settle = rejectPending ? reject : resolve; });
    }, initial);
    source.subscribe(() => notifications++);
    const pending = source.refresh("event");
    await source.dispose();
    source.subscribe(() => notifications++);
    settle(rejectPending ? new Error("late failure") : snapshot("test", "late"));
    await pending;
    await source.warm();
    await source.refresh("manual");
    await source.dispose();
    assert.equal(loads, 1);
    assert.equal(notifications, 0);
    assert.equal(source.getCachedSnapshot(), initial);
  });
}
