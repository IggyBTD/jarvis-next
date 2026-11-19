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
  const h = createStarter({ token: 'tok', allowed: ['100.64.0.0/10', '127.0.0.1'] /* the test connects from loopback, which is no longer exempt (F3-2) */, ports: { server: 7410, agent: 7421 }, probe: async (_h, p) => up[p], start: (script) => started.push(script), refresh: async () => started.push('refresh') });
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
    for (const f of ['JARVIS.app/Contents/Info.plist', 'JARVIS.app/Contents/MacOS/JARVIS', 'JARVIS.app/Contents/Resources/AppIcon.icns', 'scripts/open-mac.js']) assert.ok(b.files.includes(f), f);
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

test('logo: the icon is the node mesh (30 nodes from the shared geometry), and the Mac .icns holds the PNG sizes it declares', async () => {
  const { meshSvg, packIcns, iconSvg } = await import('../../scripts/make-icon.js');
  const { MESH_N } = await import('../../src/core/mesh-geometry.js');
  const svg = meshSvg();
  assert.equal((svg.match(/<circle/g) ?? []).length - 1, MESH_N * 2); // a halo and a core per node, plus the soft ground glow
  assert.ok((svg.match(/<line/g) ?? []).length > MESH_N); // linked, not loose dots
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.equal(iconSvg(), svg);
  assert.ok(iconSvg({ old: true }).includes('stroke-dasharray')); // the old JARVIS keeps its own reactor icon
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const icns = packIcns([{ size: 128, png }, { size: 256, png }, { size: 512, png }, { size: 64, png }]); // 64 has no icns type: left out
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(icns.length, 8 + 3 * (8 + png.length));
});

test('phone launcher: the starter serves the home-screen page and its icon without a key, and still refuses everything else', async () => {
  const { links } = await import('../../scripts/client-link.js');
  const handler = createStarter({ token: 'secret-token', allowed: ['100.64.0.0/10', '127.0.0.1'] /* the test connects from loopback, which is no longer exempt (F3-2) */, ports: { server: 7410, agent: 7421 }, probe: async () => false, start: () => {}, refresh: async () => {} });
  const srv = http.createServer(handler);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const get = (p) => new Promise((ok, no) => http.get({ port: srv.address().port, host: '127.0.0.1', path: p }, (res) => { const b = []; res.on('data', (d) => b.push(d)); res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(b) })); }).on('error', no));
  try {
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    const html = page.body.toString('utf8');
    assert.match(html, /const SERVER_PORT = 7410;/);
    assert.match(html, /apple-touch-icon/);
    assert.match(html, /\/mobile\.html'/, 'it moves on to the phone app, with nothing secret in the address (F3-4)');
    assert.ok(!/mobile\.html#token/.test(html));
    assert.ok(!html.includes('secret-token'), 'the page holds no key');
    const icon = await get('/apple-touch-icon.png');
    assert.equal(icon.status, 200);
    assert.equal(icon.body.subarray(1, 4).toString(), 'PNG');
    assert.equal((await get('/health')).status, 401, 'everything else still needs the key');
  } finally { srv.close(); }
  const l = links({ host: '192.168.1.5', port: 7410, tsName: 'pc.tail.ts.net' });
  assert.ok(l.some((x) => x.url === 'http://pc.tail.ts.net:7411/' && /iPhone/.test(x.label)), 'client-link prints the iPhone link (through the starter)');
});

test('the phone app is a second page of the same build, with a home-screen manifest and icon', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../mobile.html', import.meta.url), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)[1];
  assert.doesNotMatch(viewport, /user-scalable|maximum-scale/, 'pinch zoom stays available');
  assert.match(html, /<textarea id="m-input"[^>]*autocapitalize="sentences"/);
  const manifest = JSON.parse(fs.readFileSync(new URL('../../public/manifest-mobile.webmanifest', import.meta.url), 'utf8'));
  assert.deepEqual([manifest.start_url, manifest.display, manifest.orientation], ['/mobile.html', 'standalone', 'portrait']);
  const icon = fs.readFileSync(new URL('../../public/apple-touch-icon.png', import.meta.url));
  assert.equal(icon.readUInt32BE(16), 180); // width and height of the PNG
  assert.equal(icon.readUInt32BE(20), 180);
});
