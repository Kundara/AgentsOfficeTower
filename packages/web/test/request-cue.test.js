const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const source = readFileSync(join(__dirname, '../src/client/runtime/render-source.ts'), 'utf8');
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS });
const exported = {};
new Function('exports', compiled)(exported);
const code = exported.CLIENT_RUNTIME_RENDER_SOURCE;
const functions = code.slice(code.indexOf('      function activityCueDurationMs'), code.indexOf('      function buildWorkstationCueEffect'));
let now = Date.parse('2026-09-06T12:00:00Z');
const runtime = new Function('Date', 'typedNotificationKey', `const ACTIVITY_CUE_MAX_AGE_MS = 4800; ${functions}; return {activityCueForEvent, requestCueProfileForAgent, recentActivityCueForAgent};`)({ now: () => now, parse: Date.parse }, event => event.id);
const agent = { threadId: 'demo', needsUser: { kind: 'approval', requestId: 'B', command: 'demo', availableDecisions: ['a','b','c','d'], networkApprovalContext: {} } };

test('resolution A cannot borrow current request B profile, including missing event identity', () => {
  for (const requestId of ['A', undefined]) {
    const profile = runtime.requestCueProfileForAgent(agent, { mode: 'resolved' }, { kind: 'approval', requestId });
    assert.equal(profile.decisionCount, 3);
    assert.equal(profile.approvalType, 'general');
  }
  assert.equal(runtime.requestCueProfileForAgent(agent, { mode: 'approval' }, { requestId: 'B' }).decisionCount, 4);
  assert.equal(runtime.requestCueProfileForAgent(agent, { mode: 'approval' }).approvalType, 'network');
});

test('WAIT ASK OK cues follow matching thread events and expire under a virtual clock', () => {
  for (const [method, kind, label, duration] of [
    ['item/commandExecution/requestApproval', 'approval', 'WAIT', 3200],
    ['item/tool/requestUserInput', 'input', 'ASK', 3400],
    ['serverRequest/resolved', 'input', 'OK', 2200]
  ]) {
    const started = now;
    const event = { id: method, threadId: 'demo', method, kind, requestId: 'A', createdAt: new Date(started).toISOString() };
    assert.equal(runtime.recentActivityCueForAgent({ events: [event] }, agent).label, label);
    assert.equal(runtime.recentActivityCueForAgent({ events: [{ ...event, threadId: 'other' }] }, agent), null);
    now = started + duration + 1;
    assert.equal(runtime.recentActivityCueForAgent({ events: [event] }, agent), null);
  }
});

test('demo Needs You cards have no approval or input action target', () => {
  const attentionSource = readFileSync(join(__dirname, '../src/client/runtime/attention-panel-source.ts'), 'utf8');
  const attentionExports = {};
  new Function('exports', ts.transpile(attentionSource, { module: ts.ModuleKind.CommonJS }))(attentionExports);
  const attentionCode = attentionExports.CLIENT_RUNTIME_ATTENTION_PANEL_SOURCE;
  const body = attentionCode.slice(attentionCode.indexOf('      function needsUserActionProjectRoot'), attentionCode.indexOf('      function approvalDecisionEntries'));
  const actionRoot = new Function('localProjectRootsForSnapshot', `${body}; return needsUserActionProjectRoot;`)(() => ['/demo']);
  for (const kind of ['approval', 'input']) {
    assert.equal(actionRoot({ projectRoot: '/demo' }, { sourceKind: 'demo-fixture', source: 'local', provenance: 'codex', needsUser: { kind, requestId: 'demo' } }), null);
  }
  assert.equal(actionRoot({ projectRoot: '/demo' }, { sourceKind: 'app-server', source: 'local', provenance: 'codex', needsUser: { kind: 'approval' } }), '/demo');
});

test('seated WAIT ASK and OK chips stay above the avatar instead of behind its monitor', () => {
  const navSource = readFileSync(join(__dirname, '../src/client/runtime/navigation-source.ts'), 'utf8');
  const navExports = {};
  new Function('exports', ts.transpile(navSource, { module: ts.ModuleKind.CommonJS }))(navExports);
  const navCode = navExports.CLIENT_RUNTIME_NAVIGATION_SOURCE;
  const body = navCode.slice(navCode.indexOf('        function activityCueAnchorMode'), navCode.indexOf('        function buildActivityCueAdornment'));
  const positioning = new Function(`const pixelSnap = Math.round, ACTIVITY_CUE_SIDE_OFFSET_X = 3, ACTIVITY_CUE_SIDE_OFFSET_Y = 0, ACTIVITY_CUE_AVATAR_Y_OFFSET = 4; ${body}; return {activityCueAnchorMode, activityCuePosition};`)();
  const agent = { slotId: 'boss-slot', x: 100, y: 80, width: 18, height: 24 };
  for (const mode of ['approval', 'input', 'resolved']) {
    const anchor = positioning.activityCueAnchorMode(agent, { mode });
    assert.equal(anchor, 'avatar');
    for (const flipX of [false, true]) {
      const position = positioning.activityCuePosition(agent, 42, 12, anchor, flipX);
      assert.ok(position.y + 12 < agent.y, `${mode} chip clears seated avatar and monitor`);
      assert.equal(position.x + 21, agent.x + 9);
    }
  }
});
