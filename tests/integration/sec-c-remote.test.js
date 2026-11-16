// Security fixes, stage C: the remote path (docs/security/fix-run.md F3-1, F3-4). Real server pieces against paired devices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeRig, startApi, wsClient } from '../rig.js';
import { request, waitFor } from '../helpers.js';
import { LOCAL } from '../../server/core/devices.js';
import { createStarter, deviceCheck } from '../../scripts/pc-starter.js';

const PIN = '424242';
const bearer = (t) => ({ authorization: `Bearer ${t}` });

async function setup() {
  const r = await makeRig();
  const api = await startApi(r);
  const pair = (kind, scopes) => { const { code } = api.devices.startPairing({ by: LOCAL, kind, scopes }); return api.devices.completePairing({ code, name: kind, ip: '100.64.0.9' }); };
  const connect = async (token) => { const c = wsClient(api.wsUrl, { token }); assert.equal(await c.opened, true); c.send({ type: 'hello', clientId: 'test' }); await c.next((m) => m.type === 'state'); return c; };
  return { r, api, pair, connect, async close() { await api.close(); await r.close(); } };
}

test('F3-1: a phone chats and approves T0 to T2, needs the PIN for T3, and cannot change settings', async () => {
  const s = await setup();
  try {
    s.api.devices.setPin({ by: LOCAL, newPin: PIN });
    const phone = s.pair('phone');
    const c = await s.connect(phone.token);
    // a T3 request waiting for approval: the phone's approve without the PIN is refused, with it accepted
    const asked = s.r.gate.requestApproval({ action: 'kill_process', args: {}, tier: 'T3', target: 'pc', source: 'user', summary: 'x' });
    const req = (await c.next((m) => m.type === 'gate.request')).request;
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve', tier: 'T0' }); // a client cannot name the tier: the message is refused
    assert.match((await c.next((m) => m.type === 'error' && !m.id)).reason, /tier|not allowed|additional/i);
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve' });
    assert.match((await c.next((m) => m.type === 'error' && m.id === req.id)).reason, /PIN/);
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve', pin: PIN });
    assert.equal((await asked).approved, true);
    // settings: Bypass, the backend and the audit log are not the phone's
    c.send({ type: 'mode.set', id: 'm1', mode: 'bypass' });
    assert.match((await c.next((m) => m.type === 'error' && m.id === 'm1')).reason, /settings/);
    assert.equal((await request(`${s.api.url}/api/audit`, { headers: bearer(phone.token) })).status, 403);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(phone.token) })).status, 200);
    c.close();
  } finally { await s.close(); }
});

test('F3-1: a chat-only device cannot approve; it can still deny', async () => {
  const s = await setup();
  try {
    const viewer = s.pair('phone', ['chat']);
    const c = await s.connect(viewer.token);
    const asked = s.r.gate.requestApproval({ action: 'set_volume', args: {}, tier: 'T1', target: 'pc', source: 'user', summary: 'x' });
    const req = (await c.next((m) => m.type === 'gate.request')).request;
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve' });
    assert.match((await c.next((m) => m.type === 'error' && m.id === req.id)).reason, /approve/);
    c.send({ type: 'gate.reply', id: req.id, decision: 'deny' });
    assert.equal((await asked).approved, false);
    c.close();
  } finally { await s.close(); }
});

test('F3-1: rotation with no grace ends the old token at once on 7410 and on the starter (7411); revoke closes open sockets', async () => {
  const s = await setup();
  const starter = http.createServer(createStarter({ check: deviceCheck(s.api.devices), allowed: ['127.0.0.1'], ports: { server: 1, agent: 2 }, probe: async () => true, start: () => {}, refresh: async () => {} }));
  await new Promise((ok) => starter.listen(0, '127.0.0.1', ok));
  const starterUrl = `http://127.0.0.1:${starter.address().port}`;
  try {
    const mac = s.pair('browser');
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(mac.token) })).status, 200);
    assert.equal((await request(`${starterUrl}/health`, { headers: bearer(mac.token) })).status, 200);
    const [{ token: fresh }] = s.api.devices.rotate(mac.device.id, { by: LOCAL }).tokens;
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(mac.token) })).status, 401);
    assert.equal((await request(`${starterUrl}/health`, { headers: bearer(mac.token) })).status, 401);
    assert.equal(await wsClient(s.api.wsUrl, { token: mac.token }).opened, 401);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(fresh) })).status, 200);
    assert.equal((await request(`${starterUrl}/health`, { headers: bearer(fresh) })).status, 200);
    // a revoked device's open socket is closed, whoever revoked it (here the command on the PC)
    const c = await s.connect(fresh);
    const closed = new Promise((ok) => c.ws.once('close', ok));
    assert.ok(s.api.devices.revoke(mac.device.id, { by: LOCAL }).ok);
    s.api.wsApi.sweep();
    await closed;
  } finally { starter.close(); await s.close(); }
});

test('F3-1: the command on the PC pairs, lists, sets the PIN and ends the old shared token with no grace', async () => {
  const { runDevices } = await import('../../scripts/devices.js');
  const s = await setup();
  const out = [];
  let rotated = 0;
  const run = (args, answers = []) => runDevices(args, { cfg: s.r.cfg, devices: s.api.devices, ask: async () => answers.shift(), print: (l) => out.push(l), rotateUi: () => { rotated += 1; } });
  try {
    assert.equal(await run(['pair', 'desktop']), 0);
    const code = out.at(-1).match(/([A-Z2-9]{4})-([A-Z2-9]{4})$/);
    assert.ok(code, out.at(-1));
    const desk = s.api.devices.completePairing({ code: code[1] + code[2], name: 'PC window', ip: '127.0.0.1' });
    assert.equal(desk.device.kind, 'desktop');
    assert.equal(await run(['pin'], ['123456', '654321']), 1, 'two different PINs change nothing');
    assert.equal(await run(['pin'], ['123456', '123456']), 0);
    assert.equal(s.api.devices.info().pinSet, true);
    assert.equal(await run(['list']), 0);
    assert.ok(out.some((l) => l.includes('PC window')) && !out.join('\n').includes(desk.token));
    assert.equal(await run(['revoke', 'legacy']), 0);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(s.api.uiToken) })).status, 401);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(desk.token) })).status, 200);
  } finally { await s.close(); }
  assert.equal(rotated, 0, 'the rig has no ui.token file to rotate');
});

test('F3-4: pairing with a short code: the token comes back once in the body, never in an address; device routes need settings', async () => {
  const s = await setup();
  try {
    const legacy = bearer(s.api.uiToken); // the old shared token from the PC itself: the desktop before it is paired
    const started = await request(`${s.api.url}/api/devices/pair/start`, { method: 'POST', headers: { ...legacy, 'content-type': 'application/json' }, body: { kind: 'phone' } });
    assert.equal(started.status, 200);
    assert.match(started.json.code, /^[A-Z2-9]{8}$/);
    const done = await request(`${s.api.url}/api/devices/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { code: started.json.code, name: 'iPhone' } });
    assert.equal(done.status, 200);
    assert.equal(done.headers['cache-control'], 'no-store');
    assert.match(done.json.token, /^[0-9a-f]{64}$/);
    assert.equal(done.json.device.kind, 'phone');
    const again = await request(`${s.api.url}/api/devices/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { code: started.json.code, name: 'again' } });
    assert.equal(again.status, 403);
    // the new phone cannot list or add devices; the PC can, and the list holds no secret
    assert.equal((await request(`${s.api.url}/api/devices`, { headers: bearer(done.json.token) })).status, 403);
    const list = await request(`${s.api.url}/api/devices`, { headers: legacy });
    assert.equal(list.status, 200);
    assert.ok(list.json.devices.some((d) => d.name === 'iPhone'));
    assert.ok(!list.text.includes(done.json.token) && !/hash/.test(list.text));
    // revoking through the API closes that device's socket at once
    const c = await s.connect(done.json.token);
    const closed = new Promise((ok) => c.ws.once('close', ok));
    const rev = await request(`${s.api.url}/api/devices/revoke`, { method: 'POST', headers: { ...legacy, 'content-type': 'application/json' }, body: { id: done.json.device.id } });
    assert.equal(rev.status, 200);
    await closed;
    await waitFor(async () => (await request(`${s.api.url}/api/state`, { headers: bearer(done.json.token) })).status === 401);
  } finally { await s.close(); }
});
