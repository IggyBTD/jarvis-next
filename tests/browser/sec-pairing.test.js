// Security fix F3-4: the phone pairs with a short code typed in the app and nothing secret is ever in its address; an old link
// with the shared key still works once and the key leaves the address at once. Desktop page: pairing from Settings.
// Run alone: node --test --test-force-exit tests/browser/sec-pairing.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { ROOT } from '../../server/core/config.js';
import { LOCAL } from '../../server/core/devices.js';

const VITE_PORT = 5195;
let rig; let api; let vite; let browser;

before(async () => {
  rig = await makeRig({ edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${VITE_PORT}`); } });
  api = await startApi(rig);
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true, proxy: { '/ws': { target: api.url, ws: true }, '/api': { target: api.url } } }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
});
after(async () => { await browser?.close(); await vite?.close(); await api?.close(); await rig?.close(); });

const phone = () => browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('F3-4: an unpaired phone asks for a code; with it, it connects and keeps no token in its address', async () => {
  const page = await phone();
  await page.goto(`http://localhost:${VITE_PORT}/mobile.html`);
  await page.waitForSelector('#m-pair-code', { timeout: 15000 });
  const { code } = api.devices.startPairing({ by: LOCAL, kind: 'phone' });
  await page.fill('#m-pair-code', `${code.slice(0, 4)}-${code.slice(4)}`);
  await page.click('.m-pair button');
  await page.waitForSelector('#m-app[data-state="online"]', { timeout: 15000 });
  assert.ok(!/token|[0-9a-f]{64}/i.test(page.url()), page.url());
  assert.ok(api.devices.list().some((d) => d.kind === 'phone' && d.name === 'iPhone'));
  await page.close();
});

test('F3-4: a wrong code is refused and says so', async () => {
  const page = await phone();
  await page.goto(`http://localhost:${VITE_PORT}/mobile.html`);
  await page.waitForSelector('#m-pair-code', { timeout: 15000 });
  await page.fill('#m-pair-code', 'ABCD-EFGH');
  await page.click('.m-pair button');
  await page.waitForFunction(() => /Not paired/.test(document.getElementById('m-greet-sub').textContent), null, { timeout: 5000 });
  await page.close();
});

test('F3-4: an old link with the shared key still works, and the key leaves the address at once', async () => {
  const page = await phone();
  await page.goto(`http://localhost:${VITE_PORT}/mobile.html#token=${api.uiToken}`);
  await page.waitForSelector('#m-app[data-state="online"]', { timeout: 15000 });
  assert.ok(!page.url().includes(api.uiToken), page.url());
  await page.close();
});
