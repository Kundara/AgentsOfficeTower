const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
function runtimeSource(file, name) {
  const exports = {};
  new Function('exports', ts.transpile(readFileSync(join(__dirname, '../src/client/runtime', file), 'utf8'), { module: ts.ModuleKind.CommonJS }))(exports);
  return exports[name];
}

test('overlap and search filter active/recent sessions without removing durable Needs You requests', () => {
  const state = { overlapAgentIds: new Set(['worker']), sessionFilter: { lens: 'overlap', query: '' } };
  const triage = runtimeSource('triage-source.ts', 'CLIENT_RUNTIME_TRIAGE_SOURCE');
  const triageFunctions = triage.slice(0, triage.indexOf('      function sessionAgeBadge'));
  const ui = runtimeSource('ui-source.ts', 'CLIENT_RUNTIME_UI_SOURCE');
  const hierarchyFunction = ui.slice(ui.indexOf('      function sessionHierarchy(entries)'), ui.indexOf('      function sessionHierarchySummary'));
  const hierarchy = new Function('state', 'displayAgentLabel', 'projectLabel', 'isLiveSessionAgent', `const SESSION_RECENT_LEAD_LIMIT = 10; ${triageFunctions}; ${hierarchyFunction}; return sessionHierarchy;`)(state, (_snapshot, agent) => agent.id, root => root, agent => agent.isOngoing);
  const snapshot = { projectRoot: '/demo' };
  const entries = [
    { snapshot, agent: { id: 'approval', needsUser: { kind: 'approval' }, updatedAt: '2026-09-06T10:00:00Z', isOngoing: true } },
    { snapshot, agent: { id: 'input', needsUser: { kind: 'input' }, updatedAt: '2026-09-06T11:00:00Z', isOngoing: true } },
    { snapshot, agent: { id: 'worker', updatedAt: '2026-09-06T12:00:00Z', isOngoing: true } },
    { snapshot, agent: { id: 'finished', updatedAt: '2026-09-06T12:00:00Z', isOngoing: false } }
  ];
  assert.deepEqual(hierarchy(entries).needsYou.map(entry => entry.agent.id), ['approval', 'input']);
  assert.deepEqual(hierarchy(entries).active.map(entry => entry.agent.id), ['worker']);
  assert.equal(hierarchy(entries).recent.length, 0);
  state.sessionFilter = { lens: 'all', query: 'no-match' };
  assert.equal(hierarchy(entries).needsYou.length, 2);
  assert.equal(hierarchy(entries).active.length, 0);
  assert.equal(hierarchy(entries).recent.length, 0);
  state.sessionFilter = { lens: 'all', query: '' };
  assert.equal(hierarchy(entries).needsYou.length, 2);
  assert.equal(hierarchy(entries).recent.length, 1);
});
