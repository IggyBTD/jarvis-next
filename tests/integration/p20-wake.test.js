import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { wolPacket } from '../../shared/wol.js';
import { createRelay } from '../../scripts/wake-relay.js';
import { wake } from '../../scripts/wake.js';
import { request } from '../helpers.js';

const MAC = 'AC:36:1B:E9:A4:91';

test('the magic packet is 6 x FF then the MAC 16 times; a bad MAC is refused', () => {
  const p = wolPacket(MAC);
  assert.equal(p.length, 102);
  assert.ok(p.subarray(0, 6).every((b) => b === 0xff));
  assert.equal(p.subarray(6, 12).toString('hex'), 'ac361be9a491');
  assert.equal(p.subarray(96, 102).toString('hex'), 'ac361be9a491');
  assert.throws(() => wolPacket('nope'));
});

test('the relay wakes only its own MAC, only with the token, and not twice in a row', async () => {
  const sent = [];
  let t = 100000;
  const server = http.createServer(createRelay({ token: 'secret', mac: MAC, send: async (mac) => { sent.push(mac); }, now: () => t }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await request(`${url}/wake`, { method: 'POST' })).status, 401);
    assert.equal((await request(`${url}/wake`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 401);
    const h = { authorization: 'Bearer secret' };
    assert.equal((await request(`${url}/wake`, { method: 'POST', headers: h, body: { mac: '00:00:00:00:00:01' } })).status, 200);
    assert.deepEqual(sent, [MAC]); // a MAC in the request is ignored
    assert.equal((await request(`${url}/wake`, { method: 'POST', headers: h })).status, 429);
    t += 6000;
    assert.equal((await request(`${url}/wake`, { method: 'POST', headers: h })).status, 200);
    assert.equal(sent.length, 2);
  } finally { server.closeAllConnections?.(); server.close(); }
});

test('wake: nothing to do when the PC answers; otherwise sends, then waits until it answers; reports a PC that never does', async () => {
  const log = () => {};
  const server = { host: 'pc', port: 7410 };
  assert.deepEqual(await wake({ conf: { mac: MAC }, server, log, probe: async () => true, send: async () => assert.fail('must not send') }), { ok: true, already: true });

  let answers = 0;
  const sent = [];
  const ok = await wake({ conf: { mac: MAC }, server, log, probe: async () => (answers++ > 2), send: async (m) => { sent.push(m); }, stepMs: 1, waitMs: 100 });
  assert.equal(ok.ok, true);
  assert.deepEqual(sent, [MAC]);

  const calls = [];
  const viaRelay = await wake({ conf: { mac: MAC, relay: 'http://relay:7430/' }, server, log, token: 'tok', probe: async () => calls.length > 0, fetchImpl: async (u, init) => { calls.push([u, init.headers.authorization]); return { ok: true, status: 200 }; }, stepMs: 1, waitMs: 50 });
  assert.equal(viaRelay.ok, true);
  assert.deepEqual(calls, [['http://relay:7430/wake', 'Bearer tok']]);

  const never = await wake({ conf: { mac: MAC }, server, log, probe: async () => false, send: async () => {}, stepMs: 1, waitMs: 5 });
  assert.equal(never.ok, false);
  const denied = await wake({ conf: { mac: MAC, relay: 'http://relay:7430' }, server, log, token: 'x', probe: async () => false, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.match(denied.reason, /wake token/);
});
