import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStarter } from '../../scripts/pc-starter.js';
import { bringUp, selfUpdate } from '../../scripts/open-mac.js';
import { readZip } from '../../shared/zip.js';
import { buildMacBundle } from '../../scripts/make-mac-bundle.js';
import { tmpDir, rmDir } from '../helpers.js';

const ask = (port, method, url, token) => new Promise((ok, no) => {
  const r = http.request({ port, host: '127.0.0.1', method, path: url, headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(b) })); });
  r.on('error', no); r.end();
});

test('starter: needs the token, starts only what is down, and does nothing when all is up', async () => {
  const started = [];
  let up = { 7410: false, 7421: false };
  const h = createStarter({ token: 'tok', allowed: ['100.64.0.0/10'], ports: { server: 7410, agent: 7421 }, probe: async (_h, p) => up[p], start: (script) => started.push(script), refresh: async () => started.push('refresh') });
  const srv = http.createServer(h);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = srv.address().port;
  try {
    assert.equal((await ask(port, 'POST', '/start')).status, 401);
    assert.equal((await ask(port, 'POST', '/start', 'wrong')).status, 401);
    assert.deepEqual(started, []);
    assert.deepEqual((await ask(port, 'POST', '/start', 'tok')).body.starting, ['agent', 'server']);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(started, ['agent/index.js', 'refresh', 'server/index.js']); // UI rebuilt before the server starts
    up = { 7410: true, 7421: false };
    started.length = 0;
    assert.deepEqual((await ask(port, 'POST', '/start', 'tok')).body.starting, ['agent']);
    up = { 7410: true, 7421: true };
    started.length = 0;
    assert.deepEqual((await ask(port, 'POST', '/start', 'tok')).body.starting, []);
    assert.deepEqual(started, []);
    assert.equal((await ask(port, 'GET', '/nope', 'tok')).status, 404);
  } finally { srv.close(); }
});

test('open on the Mac: does nothing when the server is up, rings the PC starter when it is down, wakes the PC when the starter is unreachable', async () => {
  const server = { host: '100.1.1.1', port: 7410 };
  const log = () => {};
  assert.equal((await bringUp({ server, token: 't', probe: async () => true, fetchImpl: () => assert.fail('no ring needed'), log })).ok, true);

  let up = false; const rings = [];
  const fetchImpl = async (url, o) => { rings.push([url, o.headers.authorization]); up = true; return { ok: true }; };
  const r = await bringUp({ server, token: 't', probe: async () => up, fetchImpl, wait: async () => {}, log });
  assert.equal(r.ok, true);
  assert.deepEqual(rings, [['http://100.1.1.1:7411/start', 'Bearer t']]);

  let woke = 0;
  const w = await bringUp({ server, token: 't', probe: async () => false, fetchImpl: async () => { throw new Error('refused'); }, wakeConf: { mac: 'aa:bb:cc:dd:ee:ff' }, wakeFn: async () => { woke++; return { ok: true }; }, log });
  assert.equal(w.ok, true); assert.equal(woke, 1);

  const bad = await bringUp({ server, token: 't', probe: async () => false, fetchImpl: async () => ({ ok: false }), wait: async () => {}, waitMs: 50, log });
  assert.equal(bad.ok, false); assert.match(bad.reason, /did not start JARVIS/);
});

test('Mac zip: has the double-click app with executable bits and open-mac.js; tokens only with the flag', async () => {
  const out = tmpDir('macopen');
  try {
    const b = await buildMacBundle({ outDir: out });
    for (const f of ['JARVIS.app/Contents/Info.plist', 'JARVIS.app/Contents/MacOS/JARVIS', 'scripts/open-mac.js']) assert.ok(b.files.includes(f), f);
    assert.ok(!b.files.some((f) => /\.token$/.test(f)));
    const fs = await import('node:fs');
    const zip = fs.readFileSync(b.zip);
    assert.equal(readZip(zip).length, b.files.length);
    // central directory entry for the launcher carries mode 0755 (unix, so unzip on macOS restores the executable bit)
    const name = Buffer.from('JARVIS.app/Contents/MacOS/JARVIS');
    let p = zip.readUInt32LE(zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16), mode = null;
    while (zip.readUInt32LE(p) === 0x02014b50) { const n = zip.readUInt16LE(p + 28); if (zip.subarray(p + 46, p + 46 + n).equals(name)) mode = zip.readUInt32LE(p + 38) >>> 16; p += 46 + n + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32); }
    assert.equal(mode & 0o777, 0o755);
  } finally { rmDir(out); }
});

test('Mac self-update: applies the bundle the PC serves, and never throws when the PC says no or is unreachable', async () => {
  const applied = [];
  const ok = await selfUpdate({ base: 'http://x', token: 't', fetchImpl: async (u, o) => { assert.equal(o.headers.authorization, 'Bearer t'); assert.equal(u, 'http://x/api/bundle'); return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) }; }, apply: (buf, root) => { applied.push(buf.length); return { written: ['a'] }; } });
  assert.deepEqual(ok, { written: ['a'] }); assert.deepEqual(applied, [3]);
  assert.equal(await selfUpdate({ base: 'http://x', token: 't', fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await selfUpdate({ base: 'http://x', token: 't', fetchImpl: async () => { throw new Error('down'); } }), null);
});
