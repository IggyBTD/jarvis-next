// The interface in server mode, in real Chrome through Playwright, against the fake model and fake agents: connection, the
// target switcher and tag, streaming with a PC/Mac tag, tool lines, the approval dialog (focus, Esc, Approve), the Server tab,
// the offline state with nothing silently run locally. Screenshots go to docs/ui-shots/. Run alone: npm run test:browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { waitFor } from '../helpers.js';
import { ROOT } from '../../server/core/config.js';

const VITE_PORT = 5199;
const SHOTS = path.join(ROOT, 'docs', 'ui-shots');
let rig; let api; let vite; let browser; let page; const errors = [];

before(async () => {
  rig = await makeRig({ enableAll: true, edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${VITE_PORT}`); } });
  api = await startApi(rig);
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['warning', 'error'].includes(m.type()) && /jarvis/.test(m.text())) console.log('[page]', m.text()); });
  await page.addInitScript(([url, token]) => { localStorage.setItem('jarvis.server', JSON.stringify({ enabled: true, url, token })); localStorage.setItem('jarvis.theme', 'dark'); }, [api.wsUrl, api.uiToken]);
  await page.goto(`http://localhost:${VITE_PORT}`);
  await page.waitForSelector('#target-switch:not([hidden])', { timeout: 15000 });
});

after(async () => {
  await browser?.close();
  await vite?.close();
  await api?.close();
  await rig?.close();
});

// the stop button exists only while a message is with the model: wait for the previous turn to end before typing
const send = async (text) => { await page.waitForSelector('#dock-stop', { state: 'hidden' }); await page.fill('#hud-chat-input', text); await page.keyboard.press('Enter'); };
const lastLine = (sel) => page.locator(`#chat-output ${sel}`).last();

test('connects, shows the switcher with the PC active and both computers reachable', async () => {
  await waitFor(async () => (await page.getAttribute('#target-switch button[data-target="pc"]', 'data-online')) === 'true');
  assert.equal(await page.getAttribute('#target-switch button[data-target="pc"]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#target-switch button[data-target="mac"]', 'data-online'), 'true');
  assert.equal((await page.textContent('#target-tag')).trim(), 'PC');
  assert.equal(await page.getAttribute('#target-switch', 'data-link'), 'on');
});

test('a reply streams in and carries the PC tag', async () => {
  rig.model.script({ content: 'Hello from the server.', chunk: 3 });
  await send('hello');
  await page.waitForSelector('#chat-output .chat-line.assistant .md');
  await waitFor(async () => (await page.textContent('#chat-output .chat-line.assistant:last-of-type')).includes('Hello from the server.'));
  assert.match(await page.textContent('#chat-output .chat-line.user .chat-meta'), /PC/);
  assert.match(await page.textContent('#chat-output .chat-line.assistant .chat-meta'), /PC/);
  assert.equal(rig.model.requests.at(-1).body.messages.at(-1).content, 'hello');
});

test('a safe tool runs without a dialog and shows as a line in the conversation', async () => {
  rig.model.script({ toolCalls: [{ name: 'get_volume', arguments: {} }] }, { content: 'The volume is fine.' });
  await send('what is the volume');
  await waitFor(async () => (await page.locator('#chat-output .chat-line.system').allTextContents()).some((t) => /get_volume.*PC.*done/.test(t)));
  assert.equal(await page.locator('#gate-dialog[open]').count(), 0);
});

test('a risky tool opens the approval dialog: target, exact arguments, Deny focused, Esc denies', async () => {
  rig.model.script({ toolCalls: [{ name: 'close_app', arguments: { app: 'notes' } }] }, { content: 'Okay, I left it open.' });
  await send('close notes');
  await page.waitForSelector('#gate-dialog[open]');
  assert.equal((await page.textContent('#gate-target')).trim(), 'PC');
  assert.match(await page.textContent('#gate-args'), /"app": "notes"/);
  assert.match(await page.textContent('#gate-tier'), /T2/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'gate-deny');
  await page.waitForTimeout(400); // let the entrance finish before the picture
  await page.screenshot({ path: path.join(SHOTS, 'server-approval-dialog.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('gate-dialog').open);
  await waitFor(async () => (await page.locator('#chat-output .chat-line.system').allTextContents()).some((t) => /close_app.*not approved/.test(t)));
  assert.equal(rig.pc.calls.filter((c) => c.name === 'close_app' && !c.dryRun).length, 0);
});

test('Approve runs the action, and Enter on the dialog does not approve by itself', async () => {
  rig.model.script({ toolCalls: [{ name: 'close_app', arguments: { app: 'notes' } }] }, { content: 'Closed.' });
  await send('close notes please');
  await page.waitForSelector('#gate-dialog[open]');
  await page.keyboard.press('Enter'); // focus is on Deny, so Enter denies, never approves
  await page.waitForFunction(() => !document.getElementById('gate-dialog').open);
  assert.equal(rig.pc.calls.filter((c) => c.name === 'close_app' && !c.dryRun).length, 0);

  rig.model.script({ toolCalls: [{ name: 'close_app', arguments: { app: 'notes' } }] }, { content: 'Closed.' });
  await send('close notes now');
  await page.waitForSelector('#gate-dialog[open]');
  await page.click('#gate-approve');
  await waitFor(() => rig.pc.calls.filter((c) => c.name === 'close_app' && !c.dryRun).length === 1);
  await waitFor(async () => (await page.locator('#chat-output .chat-line.assistant').last().textContent()).includes('Closed.'));
});

test('switching to the Mac moves the tag and the next tool runs there', async () => {
  await page.click('#target-switch button[data-target="mac"]');
  await waitFor(() => rig.target.get() === 'mac');
  assert.equal((await page.textContent('#target-tag')).trim(), 'MAC');
  assert.equal(await page.getAttribute('#target-switch button[data-target="mac"]', 'aria-pressed'), 'true');
  rig.model.script({ toolCalls: [{ name: 'get_volume', arguments: {} }] }, { content: 'Mac volume read.' });
  await send('volume on the mac');
  await waitFor(() => rig.mac.calls.length === 1);
  assert.match(rig.model.requests.at(-2).body.messages[0].content, /ACTIVE TARGET: Mac/);
  assert.match(await page.textContent('#chat-output .chat-line.assistant:last-of-type .chat-meta'), /MAC/);
  await page.click('#target-switch button[data-target="pc"]');
  await waitFor(() => rig.target.get() === 'pc');
});

test('the Server tab shows the connection, the model and both computers', async () => {
  await page.click('#nav-server');
  await page.waitForSelector('#ws-server:not([hidden]) .sys-card');
  const text = await page.textContent('#ws-server');
  assert.match(text, /Connected/);
  assert.match(text, /local/);
  assert.match(text, /PC/);
  assert.match(text, /Mac/);
  await page.screenshot({ path: path.join(SHOTS, 'server-tab.png') });
});

test('settings card is filled from the saved settings', async () => {
  await page.click('[data-page="settings"].nav-item');
  assert.equal(await page.isChecked('#srv-enabled'), true);
  assert.match(await page.inputValue('#srv-url'), /^ws:\/\/127\.0\.0\.1/);
  assert.equal(await page.inputValue('#srv-token'), api.uiToken);
  assert.equal((await page.textContent('#srv-status')).trim(), 'Connected');
  await page.click('.mode-btn[data-page="chat"]');
});

test('offline: nothing is sent, nothing runs locally, the text comes back, and it reconnects', async () => {
  const port = new URL(api.url).port;
  await api.close();
  await page.waitForFunction(() => document.querySelector('#target-switch')?.dataset.link === 'off', null, { timeout: 8000 });
  const before = rig.model.requests.length;
  await send('anyone there?');
  await waitFor(async () => (await page.locator('#chat-output .chat-line.system').allTextContents()).some((t) => /not reachable.*nothing was run on this computer/s.test(t)));
  assert.equal(await page.inputValue('#hud-chat-input'), 'anyone there?');
  assert.equal(rig.model.requests.length, before);
  await page.screenshot({ path: path.join(SHOTS, 'server-offline.png') });
  api = await startApi(rig, { port: Number(port) });
  await page.waitForFunction(() => document.querySelector('#target-switch')?.dataset.link === 'on', null, { timeout: 30000 });
});

// Outside the desktop app there is no Tauri bridge, so the original telemetry start-up logs one rejection; that is not ours.
test('no script errors on the page', () => { assert.deepEqual(errors.filter((e) => !/transformCallback/.test(e)), []); });
