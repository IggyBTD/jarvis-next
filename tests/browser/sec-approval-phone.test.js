// Security fix F3-5: the phone shows a request whole (summary, source, the exact request uncut, hidden characters revealed) and
// Approve works only once the end of the request has been on screen. Run alone:
//   node --test --test-force-exit tests/browser/sec-approval-phone.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { ROOT } from '../../server/core/config.js';

const VITE_PORT = 5194;
let rig; let api; let vite; let browser; let page;

before(async () => {
  rig = await makeRig({ edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${VITE_PORT}`); } });
  api = await startApi(rig);
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true, proxy: { '/ws': { target: api.url, ws: true }, '/api': { target: api.url } } }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(`http://localhost:${VITE_PORT}/mobile.html#token=${api.uiToken}`);
  await page.waitForSelector('#m-app[data-state="online"]', { timeout: 15000 });
});
after(async () => { await browser?.close(); await vite?.close(); await api?.close(); await rig?.close(); });

test('F3-5: a 3000-character command: its end must be on screen before Approve works; summary, source and hidden characters show', async () => {
  const command = `Get-ChildItem src ${'x'.repeat(3000)} ; Remove-Item -Recurse C:\\Users\\bethe\\Documents\u202e END-OF-COMMAND`;
  const asked = rig.gate.requestApproval({ action: 'opencode_bash', args: { command }, tier: 'T2', target: 'pc', source: 'agent', summary: `The coding agent wants to run a command on PC: ${command.slice(0, 40)}` });
  await page.waitForSelector('.m-sheet.modal.open .m-appr-action');
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  assert.equal(await approve.isDisabled(), true, 'Approve waits until the whole request has been seen');
  const text = await page.textContent('.m-approval');
  assert.match(text, /The coding agent/, 'who asked is shown');
  assert.match(text, /END-OF-COMMAND/, 'nothing is cut off');
  assert.match(text, /\[U\+202E\]/, 'hidden characters are revealed');
  await page.locator('.m-appr-request').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => !document.querySelector('.m-appr-buttons .m-primary').disabled, null, { timeout: 5000 });
  await approve.click();
  assert.equal((await asked).approved, true);
});
