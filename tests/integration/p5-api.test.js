import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { makeRig, startApi, wsClient, openClient, settle } from '../rig.js';
import { request, waitFor, tmpDir, rmDir } from '../helpers.js';
import { modelTokenFor } from '../../server/core/auth.js';
import { createTelemetry, createLhmProvider, createMacProvider } from '../../server/telemetry/index.js';
import { summarize } from '../../server/telemetry/summary.js';
import { createBus } from '../../server/core/event-bus.js';
import { parseClientMessage } from '../../server/api/protocol.js';

const ORIGIN = 'http://localhost:5174';
async function rigApi(opts = {}, extra = {}) {
  const r = await makeRig(opts);
  const api = await startApi(r, extra);
  return { r, api, async close() { await api.close(); await r.close(); } };
}

test('protocol: every client message type is validated', () => {
  assert.equal(parseClientMessage('{"type":"chat.send","text":"hi"}').ok, true);
  assert.equal(parseClientMessage('{"type":"chat.send"}').ok, false);
  assert.equal(parseClientMessage('{"type":"chat.send","text":"x","extra":1}').ok, false);
  assert.equal(parseClientMessage('{"type":"target.set","target":"toaster"}').ok, false);
  assert.equal(parseClientMessage('{"type":"gate.reply","id":"g","decision":"always"}').ok, false);
  assert.equal(parseClientMessage('{"type":"nope"}').ok, false);
  assert.equal(parseClientMessage('[1]').ok, false);
  assert.equal(parseClientMessage('x'.repeat(300_000)).ok, false);
  assert.equal(parseClientMessage('{"type":"__proto__"}').ok, false);
});

test('websocket: authentication, origin and protocol-borne tokens', async () => {
  const t = await rigApi();
  try {
    const status = async (opts) => { const c = wsClient(t.api.wsUrl, opts); c.ws.on('error', () => {}); const s = await c.opened.catch(() => 'error'); c.ws.terminate(); return s; };
    assert.equal(await status({}), 401);
    assert.equal(await status({ token: 'w'.repeat(64) }), 401);
    assert.equal(await status({ token: t.r.tokens.pc }), 403); // an agent token is not a UI token
    assert.equal(await status({ token: t.api.uiToken, origin: 'http://evil.example' }), 403);
    assert.equal(await status({ token: t.api.uiToken, origin: ORIGIN }), true);
    assert.equal(await status({ protocols: ['jarvis.v1', `bearer.${t.api.uiToken}`] }), true);
    const q = wsClient(`${t.api.wsUrl}?token=${t.api.uiToken}`);
    q.ws.on('error', () => {});
    assert.equal(await q.opened.catch(() => 'error'), 401); // the query string is never accepted
    const other = wsClient(t.api.wsUrl.replace('/ws', '/other'), { token: t.api.uiToken });
    other.ws.on('error', () => {});
    assert.equal(await other.opened.catch(() => 'error'), 404);
  } finally { await t.close(); }
});

test('websocket: hello first, snapshot contents, bad input keeps the connection alive', async () => {
  const t = await rigApi();
  try {
    const c = wsClient(t.api.wsUrl, { token: t.api.uiToken });
    await c.opened;
    c.send({ type: 'chat.send', text: 'hi' });
    assert.match((await c.next((m) => m.type === 'error')).reason, /hello first/);
    c.send({ type: 'hello', clientId: 'a' });
    const s = await c.next((m) => m.type === 'state');
    assert.equal(s.target, 'pc');
    assert.deepEqual(Object.keys(s.machines), ['pc', 'mac']);
    assert.equal(s.machines.pc.online, true);
    assert.equal(s.health.model.reachable, true);
    assert.deepEqual(s.pendingApprovals, []);
    assert.equal(s.conversation.id, 'main');
    c.send('not json');
    c.send({ type: 'unknown.thing' });
    c.send({ type: 'target.set', target: 'toaster' });
    await waitFor(() => c.messages.filter((m) => m.type === 'error').length >= 4);
    c.send({ type: 'ping', id: 'p1' });
    assert.equal((await c.next((m) => m.type === 'pong')).id, 'p1');
    c.send(JSON.stringify({ type: 'ping', pad: 'x'.repeat(300_000) }));
    await new Promise((ok) => c.ws.once('close', ok)); // oversized frames close the socket
  } finally { await t.close(); }
});

test('websocket: a reply streams to the client, tagged with the target, within the latency budget', async () => {
  const t = await rigApi();
  try {
    const c = await openClient(t.api);
    t.r.model.script({ content: 'Streaming works fine.', chunk: 3, delayMs: 3 });
    const published = [];
    t.r.bus.subscribe((m) => { if (m.type === 'chat.delta') published.push(Date.now()); });
    c.send({ type: 'chat.send', convId: 'main', text: 'hello' });
    const done = await c.next((m) => m.type === 'chat.done');
    assert.equal(done.text, 'Streaming works fine.');
    const deltas = c.messages.filter((m) => m.type === 'chat.delta');
    assert.equal(deltas.map((d) => d.text).join(''), 'Streaming works fine.');
    assert.ok(deltas.every((d) => d.target === 'pc' && d.convId === 'main'));
    assert.ok(deltas[0].at - published[0] < 100, `first delta took ${deltas[0].at - published[0]} ms`);
    // a second send while one is running is refused, not queued
    t.r.model.script({ content: 'z'.repeat(300), chunk: 1, delayMs: 4 });
    c.send({ type: 'chat.send', convId: 'main', text: 'again' });
    await c.next((m) => m.type === 'chat.delta' && m.at > done.at);
    c.send({ type: 'chat.send', convId: 'main', text: 'too soon' });
    assert.match((await c.next((m) => m.type === 'chat.error')).reason, /still being answered/);
    c.send({ type: 'chat.abort', convId: 'main' });
    await waitFor(() => !t.r.orchestrator.isBusy('main'));
  } finally { await t.close(); }
});

test('websocket: target switch is broadcast, validated, and rolled back when it cannot be saved', async () => {
  const t = await rigApi();
  try {
    const a = await openClient(t.api, { clientId: 'a' });
    const b = await openClient(t.api, { clientId: 'b' });
    a.send({ type: 'target.set', id: 'req1', target: 'mac' });
    assert.equal((await a.next((m) => m.type === 'target.ack')).target, 'mac');
    const seen = await b.next((m) => m.type === 'target.changed');
    assert.deepEqual([seen.from, seen.to, seen.by], ['pc', 'mac', 'ui']);
    assert.equal(t.r.target.get(), 'mac');
    // make the state file unwritable: the server refuses and tells the client which target is really active
    const file = path.join(t.r.cfg.dataDir, 'state.json');
    fs.rmSync(file, { force: true });
    fs.mkdirSync(file);
    b.send({ type: 'target.set', id: 'req2', target: 'pc' });
    const rej = await b.next((m) => m.type === 'target.rejected');
    assert.deepEqual([rej.id, rej.target], ['req2', 'mac']);
    assert.equal(t.r.target.get(), 'mac');
  } finally { await t.close(); }
});

test('websocket: approvals go to every client, the first reply wins, always is refused, tools wait for the answer', async () => {
  const t = await rigApi({ enableAll: true });
  try {
    const a = await openClient(t.api, { clientId: 'a' });
    const b = await openClient(t.api, { clientId: 'b' });
    t.r.model.script({ toolCalls: [{ name: 'close_app', arguments: { app: 'notes' } }] }, { content: 'Closed it.' });
    a.send({ type: 'chat.send', text: 'close notes' });
    const reqA = await a.next((m) => m.type === 'gate.request');
    const reqB = await b.next((m) => m.type === 'gate.request');
    assert.equal(reqA.request.id, reqB.request.id);
    assert.deepEqual([reqA.request.action, reqA.request.target, reqA.request.tier], ['close_app', 'pc', 'T2']);
    assert.equal(t.r.pc.calls.filter((c) => !c.dryRun).length, 0); // nothing ran yet
    b.send({ type: 'gate.reply', id: reqA.request.id, decision: 'always' });
    assert.match((await b.next((m) => m.type === 'error')).reason, /decision/);
    const lateState = await openClient(t.api, { clientId: 'late' });
    assert.equal(lateState.messages.find((m) => m.type === 'state').pendingApprovals[0].id, reqA.request.id);
    b.send({ type: 'gate.reply', id: reqA.request.id, decision: 'approve' });
    a.send({ type: 'gate.reply', id: reqA.request.id, decision: 'deny' });
    await a.next((m) => m.type === 'chat.done');
    assert.equal(t.r.pc.calls.filter((c) => c.name === 'close_app' && !c.dryRun).length, 1);
    assert.equal((await a.next((m) => m.type === 'gate.resolved')).decision, 'approve');
    assert.ok(a.messages.some((m) => m.type === 'error' && /unknown or already answered/.test(m.reason)));
  } finally { await t.close(); }
});

test('websocket: a reconnecting client resumes a reply that is still streaming', async () => {
  const t = await rigApi();
  try {
    const a = await openClient(t.api, { clientId: 'a' });
    t.r.model.script({ content: 'resume me please '.repeat(20), chunk: 2, delayMs: 5 });
    a.send({ type: 'chat.send', text: 'long one' });
    await waitFor(() => a.messages.filter((m) => m.type === 'chat.delta').length > 5);
    await a.close();
    const b = await openClient(t.api, { clientId: 'b' });
    const st = b.messages.find((m) => m.type === 'state');
    assert.ok(st.conversation.streaming.text.length > 0);
    const done = await b.next((m) => m.type === 'chat.done', 5000);
    assert.ok(done.text.startsWith(st.conversation.streaming.text.slice(0, 20)));
    assert.equal(t.r.conversations.get('main').messages.at(-1).content, done.text);
  } finally { await t.close(); }
});

test('http: tokens decide the route; the proxy takes machine and model tokens only; CORS only for listed origins', async () => {
  const t = await rigApi();
  try {
    const ui = { authorization: `Bearer ${t.api.uiToken}` };
    const machine = { authorization: `Bearer ${t.r.tokens.mac}` };
    const model = { authorization: `Bearer ${modelTokenFor(t.r.tokens.mac)}` };
    assert.equal((await request(`${t.api.url}/health`)).status, 401);
    assert.equal((await request(`${t.api.url}/health`, { headers: ui })).json.model.reachable, true);
    assert.equal((await request(`${t.api.url}/api/state`, { headers: ui })).json.type, 'state');
    assert.equal((await request(`${t.api.url}/api/state`, { headers: machine })).status, 403);
    assert.equal((await request(`${t.api.url}/api/state`, { headers: model })).status, 403);
    assert.equal((await request(`${t.api.url}/v1/models`, { headers: ui })).status, 403);
    assert.equal((await request(`${t.api.url}/v1/models`)).status, 401);
    assert.equal((await request(`${t.api.url}/v1/models`, { headers: model })).json.data[0].id, 'local');
    t.r.model.script({ content: 'proxied reply' });
    const chat = await request(`${t.api.url}/v1/chat/completions`, { method: 'POST', headers: machine, body: { messages: [{ role: 'user', content: 'hi' }], stream: true } });
    assert.equal(chat.status, 200);
    assert.match(chat.text, /\[DONE\]/);
    assert.equal((await request(`${t.api.url}/api/audit?n=5`, { headers: ui })).json.entries.length > 0, true);
    assert.equal((await request(`${t.api.url}/api/digest?date=nope`, { headers: ui })).status, 400);
    assert.equal((await request(`${t.api.url}/nope`, { headers: ui })).status, 404);

    const pre = await request(`${t.api.url}/api/state`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], ORIGIN);
    assert.equal((await request(`${t.api.url}/api/state`, { method: 'OPTIONS', headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await request(`${t.api.url}/api/state`, { headers: { ...ui, origin: 'http://evil.example' } })).status, 403);

    // brute force: a source that keeps failing gets 429, a valid token still works from it
    for (let i = 0; i < 12; i++) await request(`${t.api.url}/health`, { headers: { authorization: 'Bearer wrongwrongwrongwrong' } });
    assert.equal((await request(`${t.api.url}/health`, { headers: { authorization: 'Bearer wrongwrongwrongwrong' } })).status, 429);
    assert.equal((await request(`${t.api.url}/health`, { headers: ui })).status, 200);
  } finally { await t.close(); }
});

test('telemetry: polls, caches, logs per minute, summarises in code, survives provider failures', async () => {
  const dir = tmpDir('telemetry');
  const lhm = http.createServer((req, res) => {
    res.end(JSON.stringify({ Text: 'Sensor', Children: [{ Text: 'CPU Total', Value: `${lhm.cpu} %`, SensorId: '/amdcpu/0/load/0', Children: [] }, { Text: 'GPU Core', Value: `${lhm.temp} °C`, SensorId: '/gpu-amd/0/temperature/0', Children: [] }, { Text: 'Memory Used', Value: '24 GB', SensorId: '/ram/data/0', Children: [] }, { Text: 'Memory Available', Value: '8 GB', SensorId: '/ram/data/1', Children: [] }] }));
  });
  lhm.cpu = 20;
  lhm.temp = 60;
  await new Promise((ok) => lhm.listen(0, '127.0.0.1', ok));
  const bus = createBus();
  const got = [];
  bus.subscribe((m) => got.push(m));
  let t = Date.UTC(2026, 9, 18, 2, 0, 0);
  const macFail = { on: true };
  try {
    const tel = createTelemetry({
      bus, dataDir: dir, now: () => t, intervals: { pc: 20, mac: 20 },
      providers: { pc: createLhmProvider({ url: `http://127.0.0.1:${lhm.address().port}` }), mac: createMacProvider({ invoke: async (n) => { if (macFail.on) throw new Error('mac offline'); return n === 'cpu_usage' ? { loadPercent: 12 } : n === 'memory_usage' ? { usedGiB: 8, totalGiB: 16 } : { percent: 80, state: 'charging' }; } }) },
    });
    assert.equal(await tel.poll('pc'), true);
    assert.equal(tel.last('pc').metrics.CPU_Load, 20);
    assert.equal(tel.last('pc').metrics.Memory_Total, 32);
    assert.equal(await tel.poll('mac'), false);
    assert.equal(tel.last('mac').offline, true);
    assert.ok(got.some((m) => m.type === 'telemetry' && m.machine === 'mac' && m.offline));

    lhm.cpu = 40; lhm.temp = 91; t += 60_000; await tel.poll('pc');
    lhm.cpu = 10; lhm.temp = 55; t += 60_000; await tel.poll('pc');
    tel.stop();
    const s = summarize({ dir: tel.dir, machine: 'pc', fromMs: Date.UTC(2026, 9, 18, 2, 0), toMs: Date.UTC(2026, 9, 18, 2, 10), thresholds: { gpuTempC: 85, cpuLoadPct: 95, memoryPct: 70 } });
    assert.equal(s.minutesWithData, 3);
    assert.equal(s.metrics.cpuLoadPercent.peak, 40);
    assert.equal(s.metrics.gpuTempC.peak, 91);
    assert.equal(s.metrics.gpuTempC.peakAt, '2026-10-18T02:01:00.000Z');
    assert.deepEqual(s.anomalies.map((a) => a.metric).sort(), ['GPU temperature', 'Memory use']);
    assert.equal(summarize({ dir: tel.dir, machine: 'pc', fromMs: Date.UTC(2026, 9, 17), toMs: Date.UTC(2026, 9, 17, 6), thresholds: {} }).minutesWithData, 0);

    // a failing provider backs off but the loop keeps going and recovers; the other provider is unaffected
    macFail.on = false;
    const live = createTelemetry({ bus: createBus(), dataDir: tmpDir('tel2'), intervals: { pc: 10, mac: 10 }, providers: { pc: createLhmProvider({ url: `http://127.0.0.1:${lhm.address().port}` }), mac: createMacProvider({ invoke: async () => { throw new Error('x'); } }) } });
    live.start();
    await waitFor(() => live.last('pc')?.metrics?.CPU_Load !== undefined && live.last('mac')?.offline);
    live.stop();

    // log retention
    const old = path.join(tel.dir, '2020-01-01.jsonl');
    fs.writeFileSync(old, '{}\n');
    assert.equal(tel.prune(), 1);
    assert.ok(!fs.existsSync(old));
  } finally { lhm.close(); rmDir(dir); }
});

test('telemetry has no imports from the agent, OpenCode, browser or digest code', () => {
  for (const f of fs.readdirSync('server/telemetry')) {
    const text = fs.readFileSync(path.join('server/telemetry', f), 'utf8');
    for (const m of text.matchAll(/from '([^']+)'/g)) assert.ok(!/agent|opencode|browser|digest|router|gate/.test(m[1]), `${f} imports ${m[1]}`);
  }
});
