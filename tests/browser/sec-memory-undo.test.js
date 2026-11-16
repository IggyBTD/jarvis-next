// Security fix F2-5: a note the model saves is shown at once in every client, whole, with Undo, and Undo removes it.
// Desktop and phone pages in real Chromium (Vite dev server) against the test rig. Run alone:
//   node --test --test-force-exit tests/browser/sec-memory-undo.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { waitFor } from '../helpers.js';
import { ROOT } from '../../server/core/config.js';
import { createMemory, registerMemoryTools } from '../../server/core/memory.js';

const VITE_PORT = 5196;
let rig; let api; let vite; let browser; let memory;

before(async () => {
  rig = await makeRig({ edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${VITE_PORT}`); } });
  memory = createMemory({ dataDir: rig.cfg.dataDir });
  registerMemoryTools(rig.router, { memory, bus: rig.bus });
  api = await startApi(rig);
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true, proxy: { '/ws': { target: api.url, ws: true }, '/api': { target: api.url } } }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
});
after(async () => { await browser?.close(); await vite?.close(); await api?.close(); await rig?.close(); });

const save = (text) => rig.router.invoke({ name: 'remember', args: { text } }, { target: 'pc', source: 'user', convId: 'c-x' });

test('F2-5: desktop shows a new note with Undo, and Undo removes it', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(([url, token]) => { localStorage.setItem('jarvis.server', JSON.stringify({ enabled: true, url, token })); }, [api.wsUrl, api.uiToken]);
  await page.goto(`http://localhost:${VITE_PORT}`);
  await page.waitForSelector('#target-switch:not([hidden])', { timeout: 15000 });
  await save('Desktop note: always use metric units');
  const row = page.locator('#chat-output .chat-memo').last();
  await row.waitFor({ timeout: 5000 });
  assert.match(await row.textContent(), /always use metric units/);
  await row.getByRole('button', { name: 'Undo' }).click();
  await waitFor(() => !memory.list().some((n) => n.text.startsWith('Desktop note')), { timeout: 5000 });
  await waitFor(async () => /Note removed/.test(await row.textContent()), { timeout: 5000 });
  await page.close();
});

test('F2-5: the phone shows a new note with Undo, and Undo removes it', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(`http://localhost:${VITE_PORT}/mobile.html#token=${api.uiToken}`);
  await page.waitForSelector('#m-app[data-state="online"]', { timeout: 15000 });
  await save('Phone note: call the dentist on Monday');
  const row = page.locator('.m-memo').last();
  await row.waitFor({ timeout: 5000 });
  assert.match(await row.textContent(), /call the dentist on Monday/);
  await row.getByRole('button', { name: 'Undo' }).click();
  await waitFor(() => !memory.list().some((n) => n.text.startsWith('Phone note')), { timeout: 5000 });
  await waitFor(async () => /Note removed/.test(await row.textContent()), { timeout: 5000 });
  await page.close();
});
