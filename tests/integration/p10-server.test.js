// The whole server booted for real (createServerApp) against a fake model and fake agents; a UI client talks to it over WebSocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeAgent } from '../mocks/fake-agent.js';
import { startFakeModel } from '../mocks/fake-model.js';
import { testConfig } from '../helpers.js';
import { createServerApp } from '../../server/index.js';
import { generateTokens, loadTokens } from '../../server/core/auth.js';
import { wsClient } from '../rig.js';
import { request } from '../helpers.js';

test('server boots, serves a chat turn with a tool call through the router, and stops cleanly', async () => {
  const model = await startFakeModel();
  const t = testConfig((f) => { f['models.json'].baseUrl = model.url; f['machines.json'].machines.mac.host = '127.0.0.1'; f['schedules.json'].jobs.digest.enabled = false; f['digest.json'].gmail = false; f['digest.json'].calendar = false; });
  generateTokens(t.cfg);
  const tokens = loadTokens(t.cfg);
  const pc = await startFakeAgent({ token: tokens.machines.pc[0], machine: 'pc' });
  const mac = await startFakeAgent({ token: tokens.machines.mac[0], machine: 'mac' });
  t.cfg.machines.machines.pc.agentPort = pc.port;
  t.cfg.machines.machines.mac.agentPort = mac.port;
  const app = await createServerApp({ cfg: t.cfg, log: () => {} });
  const addr = await app.start({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${addr.port}`;
  const ui = tokens.ui[0];
  try {
    assert.equal((await request(`${url}/health`)).status, 401);
    const h = await request(`${url}/health?fresh=1`, { headers: { authorization: `Bearer ${ui}` } });
    assert.equal(h.json.model.reachable, true);
    assert.deepEqual([h.json.machines.pc.online, h.json.machines.mac.online], [true, true]);

    const c = wsClient(`ws://127.0.0.1:${addr.port}/ws`, { token: ui });
    await c.opened;
    c.send({ type: 'hello', clientId: 't' });
    await c.next((m) => m.type === 'state');
    model.script({ toolCalls: [{ name: 'set_timer', arguments: { minutes: 5, label: 'tea' } }] }, { content: 'Timer set.' });
    c.send({ type: 'chat.send', text: 'timer for tea in five minutes' });
    const done = await c.next((m) => m.type === 'chat.done', 5000);
    assert.equal(done.text, 'Timer set.');
    assert.equal(done.stats.requests, 2); // the tool call and the answer
    assert.equal(done.stats.tools, 1);
    assert.ok(done.stats.completionTokens > 0 && done.stats.totalMs >= 0, 'the reply reports what it cost');
    assert.equal(app.reminders.list().length, 1); // time tools run on the server, not on an agent
    assert.equal(pc.calls.length, 0);

    c.send({ type: 'action.invoke', id: 'a1', name: 'get_system_info', args: {} });
    const res = await c.next((m) => m.type === 'action.result');
    assert.deepEqual([res.ok, res.target], [true, 'pc']);
    assert.equal(pc.calls.at(-1).name, 'get_system_info');
    assert.equal(app.audit.verify().ok, true);
    await c.close();
  } finally { await app.stop(); await pc.close(); await mac.close(); await model.close(); t.cleanup(); }
});

test('server bound to a network address also answers on loopback', async () => {
  const { networkInterfaces } = await import('node:os');
  const lan = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
  if (!lan) return;
  const model = await startFakeModel();
  const t = testConfig((f) => { f['models.json'].baseUrl = model.url; f['schedules.json'].jobs.digest.enabled = false; });
  const app = await createServerApp({ cfg: t.cfg, log: () => {} });
  try {
    const a = await app.start({ port: 0, host: lan });
    assert.equal((await request(`http://${lan}:${a.port}/health`)).status, 401);
    assert.equal((await request(`http://127.0.0.1:${a.port}/health`)).status, 401);
  } finally { await app.stop(); await model.close(); t.cleanup(); }
});
