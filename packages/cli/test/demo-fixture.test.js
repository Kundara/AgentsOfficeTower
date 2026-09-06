const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDemoSnapshot } = require('../dist/demo-fixture.js');
const base = Date.parse('2026-09-06T12:00:00Z');
const frame = ms => buildDemoSnapshot('/isolated/demo', base, base + ms);

test('virtual clock preserves durable waits then resolves the exact request and cools down', () => {
  assert.equal(frame(4999).agents[0].needsUser, null);
  const waiting = frame(5000);
  assert.equal(waiting.agents[0].needsUser.requestId, 'demo-approval-A');
  assert.equal(frame(11999).agents[0].needsUser.requestId, 'demo-approval-A');
  const resolved = frame(12000);
  assert.equal(resolved.agents[0].needsUser, null);
  assert.equal(resolved.events.at(-1).requestId, waiting.events[0].requestId);
  assert.equal(resolved.events.at(-1).method, 'serverRequest/resolved');
  assert.equal(frame(16000).agents[0].needsUser.requestId, 'demo-input-B');
  assert.equal(frame(23999).agents[0].needsUser.kind, 'input');
  assert.equal(frame(24000).agents[0].needsUser, null);
  assert.equal(frame(24000).events.at(-1).requestId, 'demo-input-B');
  assert.equal(frame(32000).agents[0].isOngoing, false);
  assert.equal(frame(34999).agents[0].isCurrent, true);
  assert.equal(frame(35000).agents[0].isCurrent, false);
  assert.equal(frame(90000).events.length, 4);
});

test('seeking is deterministic and fresh snapshots cannot mutate earlier frames', () => {
  const expected = frame(16000);
  frame(90000);
  assert.deepEqual(frame(16000), expected);
  expected.agents[0].needsUser.requestId = 'tampered';
  assert.equal(frame(16000).agents[0].needsUser.requestId, 'demo-input-B');
  for (const agent of frame(5000).agents) {
    assert.match(agent.label, /DEMO/);
    assert.equal(agent.liveSubscription, 'readOnly');
    assert.equal(agent.resumeCommand, null);
    assert.equal(agent.url, null);
    assert.equal(agent.network, null);
  }
});

test('delegation and coordination fixtures stay labeled, scoped, and release on completion', () => {
  const waiting = frame(5000);
  assert.equal(waiting.agents[0].state, 'blocked');
  assert.equal(frame(16000).agents[0].state, 'waiting');
  assert.equal(waiting.agents.length, 3);
  assert.ok(waiting.agents.slice(1).every(agent => agent.parentThreadId === waiting.agents[0].threadId && agent.isSubagent));
  assert.deepEqual(waiting.activity.hotChanges[0].agents, ['demo-mapper', 'demo-verifier']);
  assert.ok(waiting.activity.hotChanges[0].agents.every(id => waiting.agents.some(agent => agent.id === id)));
  assert.equal(waiting.claims[0].blockedOn, waiting.agents[0].needsUser.reason);
  assert.equal(frame(12000).claims[0].blockedOn, null);
  assert.equal(frame(32000).claims[0].lifecycle, 'released');
  assert.equal(frame(32000).agents.length, 1);
});

test('demo identities resolve through the renderer parent-child lookup', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const ts = require('typescript');
  const exported = {};
  const source = readFileSync(join(__dirname, '../../web/src/client/runtime/layout-source.ts'), 'utf8');
  new Function('exports', ts.transpile(source, { module: ts.ModuleKind.CommonJS }))(exported);
  const code = exported.CLIENT_RUNTIME_LAYOUT_SOURCE;
  const section = code.slice(code.indexOf('      function childAgentsFor'), code.indexOf('      function agentRankLabel'));
  const hierarchy = new Function('isBusyAgent', `${section}; return {childAgentsFor, liveChildAgentsFor, isLeadSession};`)(agent => agent.isOngoing);
  const snapshot = frame(5000);
  const lead = snapshot.agents[0];
  assert.equal(hierarchy.liveChildAgentsFor(snapshot, lead.id).length, 2);
  assert.equal(hierarchy.isLeadSession(snapshot, lead), true);
  assert.ok(snapshot.agents.every(agent => agent.id === agent.threadId));
  assert.ok(snapshot.events.every(event => event.threadId === lead.id));
});
