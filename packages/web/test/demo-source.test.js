const test = require('node:test');
const assert = require('node:assert/strict');
const { FleetLiveService } = require('../dist/server/fleet-live-service.js');
const { isDemoRequestAllowed } = require('../dist/server/server.js');

test('demo service never starts discovery, account providers or history publication', async () => {
  let sequence = 0;
  const source = () => ({ generatedAt: String(sequence), projects: [], accountAgents: [] });
  const service = new FleetLiveService([{ root: '/demo', label: 'DEMO' }], true, source);
  for (const method of ['ensureProjectSet', 'refreshSharedCloudTasks', 'refreshAccountAgents', 'startInternal']) {
    service[method] = () => { throw new Error(`Production method called: ${method}`); };
  }
  await service.start();
  try {
    assert.equal(service.monitors.size, 0);
    assert.equal((await service.getFleet()).generatedAt, '0');
    sequence = 1;
    assert.equal((await service.refreshAll()).generatedAt, '1');
    assert.equal(service.getPublishedFleet().generatedAt, '1');
    assert.deepEqual(await service.getProjects(), [{ root: '/demo', label: 'DEMO' }]);
    assert.equal(service.getMultiplayerStatus().enabled, false);
    const packets = [];
    service.clients.add({ write: packet => packets.push(packet), end() {} });
    await service.publish();
    assert.match(packets[0], /event: fleet/);
    assert.match(packets[0], /"generatedAt":"1"/);
  } finally { await service.stop(); }
  assert.equal(service.cloudTimer, null);
  assert.equal(service.clients.size, 0);
});

test('demo server allows display reads and refuses every external mutation surface', () => {
  for (const path of ['/', '/client/app.js', '/api/fleet', '/api/web-cli/query', '/api/events', '/api/server-meta', '/api/multiplayer', '/api/health/ready']) {
    assert.equal(isDemoRequestAllowed('GET', path), true, path);
  }
  for (const path of ['/api/needs-user/respond', '/api/needs-user/answer', '/api/thread/reply', '/api/settings/integrations', '/api/appearance/cycle', '/api/rooms/scaffold', '/api/refresh', '/api/web-cli/team-fleet']) {
    assert.equal(isDemoRequestAllowed('POST', path), false, path);
  }
  assert.equal(isDemoRequestAllowed('GET', '/api/settings/integrations'), false);
});

test('malformed demo request targets are refused without throwing out of the HTTP callback', () => {
  assert.equal(isDemoRequestAllowed('GET', 'http://['), false);
  assert.equal(isDemoRequestAllowed('GET', '/api/fleet?project=demo'), true);
});
