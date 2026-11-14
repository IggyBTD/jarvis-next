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

test('the model chip and the context meter come from the server, not from an LM Studio on this computer', async () => {
  await waitFor(async () => (await page.textContent('#model-chip-label')).trim() === 'Qwen 3.8 27B');
  assert.equal(await page.isDisabled('#model-chip'), false);
  assert.equal(await page.getAttribute('#model-chip', 'data-loaded'), 'yes'); // the dot: this model is loaded on the PC
  assert.equal(await page.locator('#model-menu:not([hidden])').count(), 0);
  await page.click('#nav-system');
  await waitFor(async () => /server/.test(await page.textContent('#model-info-body')));
  assert.equal(await page.locator('#model-info-body .model-eject').count(), 0);
  assert.match(await page.textContent('#model-info-body'), new RegExp(rig.cfg.models.modelId.split('/').pop().replace('.', '\\.')));
  await page.click('#nav-server');
});

test('the switcher lists only the ticked models; Settings lists all of them with their full names and a checkbox each', async () => {
  await page.click('#model-chip');
  await waitFor(async () => (await page.locator('#model-server-list button:not(#model-claude)').count()) === 1); // the coder model is not one of the three shown by default
  await page.keyboard.press('Escape');
  await page.click('#sidebar [data-page="settings"]');
  await page.waitForSelector('#set-models-list input[type="checkbox"]');
  assert.match(await page.textContent('#set-models-list'), /unsloth\/qwen3\.8-27b[\s\S]*qwen\/qwen3-coder-30b/);
  assert.deepEqual(await page.locator('#set-models-list input').evaluateAll((i) => i.map((x) => x.checked)), [true, false]);
  await page.locator('#set-models-list input').nth(1).check();
  await page.click('.mode-btn[data-page="chat"]');
  await page.click('#model-chip');
  await waitFor(async () => (await page.locator('#model-server-list button:not(#model-claude)').count()) === 2);
  await page.keyboard.press('Escape');
});

test('Claude Code is a row in the model menu; picking it makes it the coder on the Code page only, and a local model puts it back', async () => {
  await page.click('.mode-btn[data-page="code"]');
  await page.click('#model-chip');
  await page.click('#model-claude');
  await waitFor(async () => (await page.textContent('#model-chip-label')).trim() === 'Claude Code');
  await page.click('.mode-btn[data-page="chat"]');
  assert.notEqual((await page.textContent('#model-chip-label')).trim(), 'Claude Code'); // chat keeps using the local model
  await page.click('.mode-btn[data-page="code"]');
  assert.equal((await page.textContent('#model-chip-label')).trim(), 'Claude Code');
  await page.click('#model-chip');
  await page.click('#model-server-list button:not(#model-claude)');
  await waitFor(async () => (await page.textContent('#model-chip-label')).trim() !== 'Claude Code');
  await page.click('.mode-btn[data-page="chat"]');
});

test('the permission mode is held by the server: picked in the app, it survives a reload', async () => {
  await page.click('.mode-btn[data-page="code"]');
  await page.click('#mode-chip'); await page.click('#mode-menu [data-mode="accept-edits"]');
  await page.evaluate(() => { try { localStorage.removeItem('jarvis.mode'); } catch { /* none */ } }); // only the server remembers it now
  await page.reload();
  await page.waitForSelector('#target-switch:not([hidden])');
  await page.click('.mode-btn[data-page="code"]');
  await waitFor(async () => (await page.textContent('#mode-chip')).trim() === 'Accept edits');
  await page.click('#mode-chip'); await page.click('#mode-menu [data-mode="auto"]');
  await page.click('.mode-btn[data-page="chat"]');
});

test('the effort level is plain text beside the model name; hovering outlines it, clicking opens the four levels, and the choice is sent with the message', async () => {
  assert.equal((await page.textContent('#effort-chip')).trim(), 'Medium');
  assert.equal(await page.locator('#effort-chip .icon, #model-chip .icon').count(), 0); // no arrows
  const border = (sel) => page.$eval(sel, (e) => getComputedStyle(e).borderTopColor);
  const rest = await border('#effort-chip');
  await page.hover('#effort-chip');
  assert.notEqual(await border('#effort-chip'), rest);
  await page.click('#effort-chip');
  assert.deepEqual(await page.locator('#effort-menu [data-effort]').evaluateAll((b) => b.map((x) => x.dataset.effort)), ['low', 'medium', 'high', 'max']);
  await page.click('#effort-menu [data-effort="high"]');
  assert.equal((await page.textContent('#effort-chip')).trim(), 'High');
  rig.model.script({ content: 'ok' });
  await send('check effort');
  await waitFor(() => rig.model.requests.some((r) => JSON.stringify(r.body.messages).includes('[Effort: high.')));
  await page.click('#effort-chip'); await page.click('#effort-menu [data-effort="medium"]');
});

test('the model menu lists the PC\'s models with the loaded one marked; picking one loads it on the PC and renames the chip', async () => {
  rig.model.native.loaded.clear(); rig.model.native.loaded.set('unsloth/qwen3.8-27b', 65536); rig.model.native.log.length = 0;
  await page.click('#model-chip');
  await page.waitForSelector('#model-server-list button:not(#model-claude)');
  assert.equal(await page.locator('#model-menu [data-preset]:visible').count(), 0); // the preset buttons are for the computer's own LM Studio
  const rows = await page.locator('#model-server-list button:not(#model-claude)').evaluateAll((bs) => bs.map((b) => ({ name: b.querySelector('.m-name').textContent, loaded: b.dataset.loaded, current: b.getAttribute('aria-current'), sub: b.querySelector('.m-sub').textContent })));
  assert.equal(rows.length, 2);
  const active = rows.find((r) => r.current === 'true');
  assert.equal(active.loaded, 'true');
  assert.match(active.sub, /active, loaded · 64k context/);
  assert.match(rows.find((r) => r.current !== 'true').sub, /^not loaded$/);
  await page.screenshot({ path: path.join(SHOTS, 'server-model-menu.png'), clip: { x: 0, y: 0, width: 520, height: 320 } });
  await page.click('#model-server-list button:not(#model-claude)[data-loaded="false"]');
  await waitFor(async () => (await page.textContent('#model-chip-label')).trim() === 'Qwen 3 Coder 30B');
  assert.equal(await page.getAttribute('#model-chip', 'data-loaded'), 'yes');
  assert.deepEqual(rig.model.native.log.map((x) => x.path.split('/').pop()), ['unload', 'load']);
  assert.equal(await page.locator('#model-menu:not([hidden])').count(), 0);
});

test('a reply streams in and carries the PC tag', async () => {
  rig.model.script({ content: 'Hello from the server.', chunk: 3 });
  await send('hello');
  await page.waitForSelector('#chat-output .chat-line.assistant .md');
  await waitFor(async () => (await page.textContent('#chat-output .chat-line.assistant:last-of-type')).includes('Hello from the server.'));
  assert.match(await page.textContent('#chat-output .chat-line.user .chat-meta'), /PC/);
  assert.match(await page.textContent('#chat-output .chat-line.assistant .chat-meta'), /PC/);
  assert.match(rig.model.requests.at(-1).body.messages.at(-1).content, /^hello\n\n\[Local time \d\d:\d\d\]$/); // the time rides on the newest message only, so the start of the prompt never changes
});

test('a safe tool runs without a dialog and shows as a line in the conversation', async () => {
  rig.model.script({ toolCalls: [{ name: 'get_volume', arguments: {} }] }, { content: 'The volume is fine.' });
  await send('what is the volume');
  await waitFor(async () => (await page.locator('#chat-output .chat-line.steps').allTextContents()).some((t) => /Read volume[\s\S]*on PC/.test(t)));
  assert.equal(await page.locator('#gate-dialog[open]').count(), 0);
});

test('several steps in a row: every step reads as a sentence with where it ran, how long, and what came back; it folds to one line when the turn ends', async () => {
  rig.model.script({ toolCalls: [{ name: 'get_volume', arguments: {} }, { name: 'open_app', arguments: { app: 'notes' } }, { name: 'list_running_apps', arguments: {} }] }, { content: 'Done: the volume is fine and Notes is open.' });
  await send('check the volume, open notes and list what is running');
  const steps = page.locator('#chat-output .chat-line.steps').last();
  await waitFor(async () => /3 steps/.test(await steps.locator('.steps-count').textContent()));
  await waitFor(async () => (await page.locator('#chat-output .chat-line.assistant').last().textContent()).includes('Notes is open'));
  const text = await steps.textContent();
  assert.match(text, /Read volume/);
  assert.match(text, /Opened notes/);
  assert.match(text, /on PC/);
  assert.match(await steps.locator('.steps-label').textContent(), /Read volume, Opened notes and 1 more/);
  assert.equal(await steps.locator('details.steps-box').evaluate((d) => d.open), false); // folded: the turn is over
  await steps.locator('.steps-head').click();
  assert.equal(await steps.locator('li').count(), 3);
  assert.ok((await steps.locator('.step-result').allTextContents()).every((r) => r.length > 0), 'every step says what came back');
  await steps.locator('details.step:not(.plain) .step-line').first().click();
  await steps.scrollIntoViewIfNeeded();
  const box = await steps.boundingBox();
  await page.screenshot({ path: path.join(SHOTS, 'server-steps.png'), clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 24), width: 760, height: box.height + 48 } });
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
  await waitFor(async () => (await page.locator('#chat-output .chat-line.steps').allTextContents()).some((t) => /Closing notes \(not approved\)/.test(t)));
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
  await waitFor(async () => (await page.textContent('#target-tag')).trim() === 'MAC'); // the tag follows the server's broadcast, a moment after the target changes
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
  assert.match(text, new RegExp(rig.cfg.models.modelId.replace('/', '.')));
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
test('the sidebar lists the saved chats from the server, a click reopens one, a reload restores the open chat', async () => {
  await page.waitForSelector('#chat-list .chat-item', { timeout: 15000 });
  assert.ok(await page.locator('#chat-list .chat-item').count() >= 1);
  await page.click('#chat-list .chat-item');
  await page.waitForSelector('#chat-output .chat-line.user');
  await page.reload();
  await page.waitForSelector('#chat-output .chat-line.user', { timeout: 15000 }); // the chat this window was in comes back
});

test('Ctrl+L turns LaTeX mode on with a chip beside the input and no window; symbols you send become LaTeX', async () => {
  await page.keyboard.press('Control+l');
  await page.waitForSelector('#latex-chip:not([hidden])');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.fill('#hud-chat-input', 'x^2/2 + sqrt(x)');
  await page.waitForSelector('#latex-view .katex'); // the input shows the maths typeset, not the typed text
  assert.equal(await page.$eval('#hud-chat-input', (e) => getComputedStyle(e).color), 'rgba(0, 0, 0, 0)');
  await page.fill('#hud-chat-input', 'integral of x');
  assert.equal(await page.isHidden('#latex-view'), true); // words stay as typed
  await page.fill('#hud-chat-input', '');
  rig.model.script({ content: 'ok' });
  await send('x^2/2 + sqrt(x)');
  await waitFor(() => rig.model.requests.some((r) => r.body.messages.some((m) => typeof m.content === 'string' && m.content.includes(String.raw`$\frac{x^{2}}{2}+\sqrt{x}$`))));
  await page.keyboard.press('Control+l');
  assert.equal(await page.isHidden('#latex-chip'), true);
});

test('no script errors on the page', () => { assert.deepEqual(errors.filter((e) => !/transformCallback/.test(e)), []); });
