import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRig, startApi, wsClient } from '../rig.js';
import { request } from '../helpers.js';
import { links, tailscaleName } from '../../scripts/client-link.js';
import { runDoctor } from '../../scripts/doctor.js';
import { testConfig } from '../helpers.js';
import { startFakeModel } from '../mocks/fake-model.js';

const running = { code: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.tail1234.ts.net.' } }), stderr: '' };

test('behind tailscale serve: https pages may open the socket, other origins may not, and the page carries security headers', async () => {
  const r = await makeRig();
  try {
    const api = await startApi(r);
    const host = new URL(api.url).host;
    const ok = wsClient(api.wsUrl, { token: api.uiToken, origin: `https://${host}` });
    assert.equal(await ok.opened, true);
    ok.ws.terminate();
    for (const origin of ['https://evil.example', `https://${host}.evil.example`, `http://evil.example`]) {
      const bad = wsClient(api.wsUrl, { token: api.uiToken, origin });
      bad.ws.on('error', () => {});
      assert.equal(await bad.opened.catch(() => 'error'), 403, origin);
      bad.ws.terminate();
    }
    const dist = fs.existsSync('dist/index.html');
    if (dist) {
      const page = await request(`${api.url}/`);
      assert.equal(page.headers['x-frame-options'], 'DENY');
      assert.equal(page.headers['referrer-policy'], 'no-referrer');
      assert.match(page.headers['permissions-policy'], /microphone=\(self\)/);
    }
    const pre = await request(`${api.url}/api/state`, { method: 'OPTIONS', headers: { origin: `https://${host}` } });
    assert.equal(pre.status, 204);
    await api.close();
  } finally { await r.close(); }
});

test('client links: Tailscale names only, and only when it is running; the name is read from its status', async () => {
  assert.equal(await tailscaleName(async () => running), 'pc.tail1234.ts.net');
  assert.equal(await tailscaleName(async () => ({ code: 1, stdout: '', stderr: 'stopped' })), null);
  assert.equal(await tailscaleName(async () => { throw new Error('ENOENT'); }), null);
  assert.equal(await tailscaleName(async () => ({ code: 0, stdout: JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: 'x.' } }), stderr: '' })), null);
  // plain addresses since the security fixes (F3-4): a device is paired with a code, never with a key in a link
  // tailnet names only since F3-6: no Tailscale, no link
  assert.deepEqual(links({ host: '192.168.1.32', port: 7410 }), []);
  const away = links({ host: '192.168.1.32', port: 7410, tsName: 'pc.tail1234.ts.net' });
  assert.deepEqual(away.map((l) => l.url), ['http://pc.tail1234.ts.net:7411/', 'https://pc.tail1234.ts.net/', 'http://pc.tail1234.ts.net:7410/']);
  assert.match(away[0].label, /iPhone/);
  assert.match(away[1].label, /tailscale serve --bg 7410/);
});

test('doctor reports Tailscale as information, never as a failure', async () => {
  const model = await startFakeModel();
  const t = testConfig((f) => { f['models.json'].baseUrl = model.url; f['digest.json'].enabled = false; });
  try {
    const none = (await runDoctor({ cfg: t.cfg, agentOnly: true, run: async () => { throw new Error('ENOENT'); } })).find((r) => r.name.startsWith('Tailscale'));
    assert.equal(none.ok, true);
    assert.match(none.detail, /only needed away from home/);
    const on = (await runDoctor({ cfg: t.cfg, agentOnly: true, run: async () => running })).find((r) => r.name.startsWith('Tailscale'));
    assert.match(on.detail, /pc\.tail1234\.ts\.net/);
  } finally { await new Promise((r) => setTimeout(r, 150)); await model.close(); t.cleanup(); }
});
