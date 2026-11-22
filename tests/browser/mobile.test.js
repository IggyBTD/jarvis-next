// JARVIS on iPhone (docs/mobile.md), in Chromium with an iPhone 15's size, touch and pixel density, against the fake model and fake agents: the
// empty chat, sending and streaming, steps, approvals, the chat list and settings, the keyboard, light and dark, small and large phones.
// Not WebKit and not a real phone: the keyboard and the home-screen launch have to be checked on the device. Screenshots: docs/ui-shots/mobile/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium, devices } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { waitFor } from '../helpers.js';
import { ROOT } from '../../server/core/config.js';

const VITE_PORT = 5198;
const SHOTS = path.join(ROOT, 'docs', 'ui-shots', 'mobile');
fs.mkdirSync(SHOTS, { recursive: true });
let rig; let api; let vite; let browser; let ctx; let page; const errors = [];

// The page asks the keyboard for room through window.visualViewport; the stub lets a test open and close "the keyboard".
const KEYBOARD_STUB = () => {
  const vv = new EventTarget();
  let covered = 0; // how much of the screen the keyboard covers
  Object.defineProperties(vv, { height: { get: () => innerHeight - covered }, width: { get: () => innerWidth }, offsetTop: { value: 0 }, scale: { value: 1 } });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__keyboard = (h) => { covered = h; vv.dispatchEvent(new Event('resize')); };
};

const open = async (opts = {}) => {
  ctx = await browser.newContext({ ...devices['iPhone 15'], colorScheme: 'dark', ...opts });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/transformCallback|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(KEYBOARD_STUB);
  await page.goto(`http://localhost:${VITE_PORT}/mobile.html#token=${api.uiToken}`);
  await page.waitForSelector('#m-app[data-state="online"]', { timeout: 15000 });
};
const shot = (name, o = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), scale: 'css', ...o });
const sheetSettled = () => page.waitForTimeout(450); // the entrance is 300 ms
const typeAndSend = async (text) => { await page.fill('#m-input', text); await page.dispatchEvent('#m-send', 'click'); };

before(async () => {
  rig = await makeRig({ enableAll: true, edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${VITE_PORT}`); } });
  api = await startApi(rig);
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true, proxy: { '/ws': { target: api.url, ws: true }, '/api': { target: api.url } } }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  await open();
});

after(async () => {
  await ctx?.close();
  await browser?.close();
  await vite?.close();
  await api?.close();
  await rig?.close();
});

test('the empty chat: the mesh is the centrepiece, the greeting and the composer fit one portrait screen with nothing cut off', async () => {
  await page.waitForSelector('canvas.logo-hero');
  const g = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const hero = r('canvas.logo-hero'), field = r('.m-field'), bar = r('.m-bar');
    return { w: innerWidth, h: innerHeight, scrollW: document.documentElement.scrollWidth, hero: { w: hero.width, top: hero.top, bottom: hero.bottom, cx: hero.left + hero.width / 2 }, field: { top: field.top, bottom: field.bottom, left: field.left, right: field.right }, barBottom: bar.bottom };
  });
  assert.equal(g.scrollW, g.w, 'no sideways scrolling');
  assert.ok(g.hero.w >= 150, `the mesh is big (${g.hero.w})`);
  assert.ok(Math.abs(g.hero.cx - g.w / 2) < 2, 'the mesh is on the centre line');
  assert.ok(g.hero.top > g.barBottom && g.hero.bottom < g.field.top, 'the mesh sits between the bar and the composer');
  assert.ok(g.field.left >= 16 && g.w - g.field.right >= 16, 'the composer keeps its 16 pt side margins');
  assert.ok(g.field.bottom <= g.h, 'the composer is on screen');
  assert.match(await page.textContent('#m-greet-sub'), /Running on your PC/);
  await page.waitForTimeout(3000); // the mesh's intro, then it rests
  await shot('empty-dark');
});

test('the field is a plain textarea, so the iPhone keyboard is the system one: sentences capitalised, autocorrect and spellcheck on, return is a new line, 16 pt so Safari never zooms', async () => {
  const a = await page.evaluate(() => { const t = document.getElementById('m-input'); const s = getComputedStyle(t); return { tag: t.tagName, cap: t.getAttribute('autocapitalize'), fix: t.getAttribute('autocorrect'), spell: t.spellcheck, hint: t.getAttribute('enterkeyhint'), type: t.type, font: parseFloat(s.fontSize), mode: t.inputMode }; });
  assert.deepEqual([a.tag, a.cap, a.fix, a.spell, a.hint, a.type, a.mode], ['TEXTAREA', 'sentences', 'on', true, 'enter', 'textarea', '']);
  assert.ok(a.font >= 16, `font ${a.font}`);
  await page.fill('#m-input', '');
  await page.focus('#m-input');
  await page.keyboard.type('first line');
  await page.keyboard.press('Enter'); // plain return: a new line, not a send
  await page.keyboard.type('second line');
  assert.equal(await page.inputValue('#m-input'), 'first line\nsecond line');
  assert.equal(await page.locator('.m-msg.user').count(), 0, 'return did not send');
  const h = await page.evaluate(() => document.getElementById('m-input').getBoundingClientRect().height);
  assert.ok(h > 40, `the field grew for two lines (${h})`);
  await page.fill('#m-input', '');
});

test('the send button is disabled until there is text, is a 44 pt target, and sending keeps the keyboard (the field keeps focus)', async () => {
  assert.equal(await page.getAttribute('#m-send', 'aria-disabled'), 'true');
  await page.focus('#m-input');
  await page.keyboard.type('hello');
  assert.equal(await page.getAttribute('#m-send', 'aria-disabled'), 'false');
  const box = await page.locator('#m-send').boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `${box.width}x${box.height}`);
  await page.fill('#m-input', '');
});

test('a message goes out, the reply streams in as serif text with markdown, the logo rests under it, and the composer comes back', async () => {
  rig.model.script({ content: 'Here is **a reply** with a list:\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n\nThat is all.' });
  await typeAndSend('hello jarvis');
  await page.waitForSelector('.m-msg.user .m-bubble');
  assert.equal((await page.textContent('.m-msg.user .m-bubble')).trim(), 'hello jarvis');
  await page.waitForSelector('.m-msg.assistant strong');
  await waitFor(async () => (await page.locator('#m-app[data-busy]').count()) === 0);
  assert.equal(await page.locator('.m-msg.assistant li').count(), 2);
  assert.equal(await page.locator('.m-msg.assistant pre code').count(), 1);
  assert.equal(await page.locator('.m-msg.assistant > canvas.m-logo').count(), 1, 'the stamp rests under the reply');
  assert.equal(await page.inputValue('#m-input'), '', 'the field was cleared');
  assert.equal(await page.getAttribute('#m-send', 'aria-label'), 'Send');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.equal(scrollW, 0);
  await shot('reply-dark');
});

test('sending again: the logo moves from the first reply to the next, there is only ever one', async () => {
  rig.model.script({ content: 'Second reply.' });
  await typeAndSend('and again');
  await waitFor(async () => (await page.locator('.m-msg.assistant').count()) === 2 && (await page.locator('#m-app[data-busy]').count()) === 0);
  assert.equal(await page.locator('canvas.m-logo').count(), 1);
  assert.equal(await page.locator('.m-msg.assistant').last().locator('canvas.m-logo').count(), 1);
  assert.equal(await page.locator('.m-msg.assistant').first().locator('canvas.m-logo').count(), 0);
});

test('steps: tool calls fold into one plain line, which opens to short lines and a step opens to where it ran and what came back', async () => {
  rig.model.script({ toolCalls: [{ name: 'get_volume', arguments: {} }, { name: 'list_running_apps', arguments: {} }] }, { content: 'The volume is fine.' });
  await typeAndSend('check the volume and the apps');
  await waitFor(async () => (await page.locator('.m-msg.assistant').last().textContent()).includes('The volume is fine'));
  const steps = page.locator('.m-steps').last();
  assert.match(await steps.locator('.m-steps-label').textContent(), /^Checked your computer$/);
  assert.equal(await steps.evaluate((d) => d.open), false, 'folded once the turn is over');
  await steps.locator('.m-steps-head').click();
  assert.equal(await steps.locator('.m-steps-list > li').count(), 2);
  const first = steps.locator('.m-step-line').first();
  const lineBox = await first.boundingBox();
  assert.ok(lineBox.height >= 44, `a step line is a 44 pt target (${lineBox.height})`);
  await first.click();
  assert.match(await steps.locator('.m-step-facts').first().textContent(), /^on PC/);
  await shot('steps-dark');
});

test('an approval is a sheet that has to be answered: no close button, tapping outside does nothing, Deny and Approve are 44+ pt', async () => {
  rig.model.script({ toolCalls: [{ name: 'close_app', arguments: { app: 'notes' } }] }, { content: 'Closed it.' });
  await typeAndSend('close notes');
  await page.waitForSelector('.m-sheet.modal.open .m-appr-action');
  assert.equal(await page.textContent('.m-appr-action'), 'Closing notes');
  assert.match(await page.textContent('.m-appr-meta'), /PC/);
  const boxText = await page.textContent('.m-appr-box');
  assert.ok(boxText.includes('close_app') && boxText.includes('notes'), `the exact request is in the box: ${boxText}`);
  assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).isDisabled(), false, 'a short request is fully on screen, so Approve is ready');
  assert.equal(await page.locator('.m-sheet.modal .m-sheet-right button').count(), 0, 'no close button');
  await page.mouse.click(100, 60); // outside the sheet
  assert.equal(await page.locator('.m-sheet.modal.open').count(), 1, 'tapping outside did not dismiss it');
  for (const label of ['Approve', 'Deny']) {
    const b = await page.getByRole('button', { name: label, exact: true }).boundingBox();
    assert.ok(b.height >= 44 && b.width >= 44, `${label} ${b.width}x${b.height}`);
  }
  assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'BUTTON'), false, 'neither answer is focused for you');
  await sheetSettled();
  await shot('approval-dark');
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
  await waitFor(async () => (await page.locator('#m-app[data-busy]').count()) === 0);
  assert.equal(rig.pc.calls.filter((c) => c.name === 'close_app' && !c.dryRun).length, 0, 'denied: nothing ran');
});

test('the chat list: a sheet with search, the open chat marked, edit mode to delete, new chat', async () => {
  await page.click('#m-menu'); // the drawer: recent chats, the open one marked; "View all" opens the full list sheet
  await page.waitForSelector('.m-drawer.open .m-drow');
  assert.equal(await page.locator('.m-drow[aria-current="true"]').count(), 1, 'the drawer marks the chat you are in');
  await sheetSettled();
  await shot('drawer-dark');
  await page.getByRole('button', { name: 'View all' }).click();
  await page.waitForSelector('.m-sheet.open .m-row');
  assert.ok((await page.locator('.m-row').count()) >= 1);
  assert.equal(await page.locator('.m-row[aria-current="true"]').count(), 1, 'the chat you are in is marked');
  const search = await page.evaluate(() => { const s = document.querySelector('.m-sheet .m-search'); return { size: parseFloat(getComputedStyle(s).fontSize), h: s.getBoundingClientRect().height, type: s.type }; });
  assert.ok(search.size >= 16 && search.h >= 44 && search.type === 'search');
  await sheetSettled();
  await shot('chats-dark');
  await page.fill('.m-sheet .m-search', 'zzzz-no-such-chat');
  assert.match(await page.textContent('.m-list'), /No chats match/);
  await page.fill('.m-sheet .m-search', '');
  await page.getByRole('button', { name: 'Edit' }).click();
  assert.ok((await page.locator('.m-danger-btn').count()) >= 1, 'edit mode shows a delete button per chat');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
});

test('the tab bar: four pages, it goes away while you type and comes back; Projects lists and creates, Code lists the computers, Artifacts says where they are', async () => {
  assert.equal(await page.locator('#m-tabs [data-tab]').count(), 4);
  assert.equal(await page.getAttribute('#m-tabs [data-tab="chat"]', 'aria-current'), 'page');
  await page.focus('#m-input');
  assert.equal(await page.locator('#m-tabs').isHidden(), true, 'typing hides the bar');
  await page.evaluate(() => document.getElementById('m-input').blur());
  await page.waitForSelector('#m-tabs', { state: 'visible' });
  const tab = await page.locator('#m-tabs [data-tab="projects"]').boundingBox();
  assert.ok(tab.height >= 44, 'tabs are 44 pt or taller');

  await page.click('#m-tabs [data-tab="projects"]');
  await page.waitForSelector('#m-p-projects:not([hidden])');
  assert.equal(await page.locator('#m-scroll').isHidden(), true, 'the conversation steps aside');
  await page.waitForSelector('#m-projects .m-empty-list');
  await page.click('#m-fab-project');
  await page.waitForSelector('.m-sheet.open input');
  await page.fill('.m-sheet.open input', 'Home lab');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForSelector('#m-projects .m-prow');
  assert.match(await page.textContent('#m-projects'), /Home lab/);
  assert.equal((await (await fetch(`${api.url}/api/projects`, { headers: { authorization: `Bearer ${api.uiToken}` } })).json()).projects[0].name, 'Home lab', 'the project is on the server, so every device sees it');
  await sheetSettled();
  await shot('projects-dark');

  await page.click('#m-tabs [data-tab="code"]');
  await page.waitForSelector('#m-p-code:not([hidden])');
  assert.match(await page.textContent('#m-code'), /Computers/);
  assert.ok((await page.locator('#m-code .m-prow').count()) >= 1, 'the computers are listed');
  await shot('code-page-dark');

  await page.click('#m-tabs [data-tab="artifacts"]');
  await page.waitForSelector('#m-artifacts .m-empty-list:has-text("No artifacts yet")');

  await page.click('#m-tabs [data-tab="chat"]');
  await page.waitForSelector('#m-scroll', { state: 'visible' });
});

test('artifacts: a reply that makes one shows a card, the card opens the viewer, and the Artifacts tab lists it; approvals and projects have their controls', async () => {
  rig.model.script({ content: ['Here you go.', '<jarvis-artifact id="hello-page" type="html" title="Hello page">', '<h1>Hello from JARVIS</h1>', '</jarvis-artifact>', 'Done.'].join('\n') });
  await typeAndSend('make a page');
  await page.waitForSelector('.m-msg.assistant .m-art-card[data-art="hello-page"]');
  assert.doesNotMatch(await page.textContent('#m-log'), /jarvis-artifact/, 'the tag is never shown as text');
  await page.click('.m-art-card[data-art="hello-page"]');
  await page.waitForSelector('.m-sheet.open iframe.m-art-frame');
  assert.equal(await page.getAttribute('iframe.m-art-frame', 'sandbox'), 'allow-scripts', 'sandboxed, no same-origin');
  await waitFor(async () => (await page.frameLocator('iframe.m-art-frame').locator('h1').count()) === 1);
  await sheetSettled();
  await shot('artifact-dark');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
  await page.click('#m-tabs [data-tab="artifacts"]');
  await page.waitForSelector('#m-artifacts .m-prow');
  assert.match(await page.textContent('#m-artifacts'), /Hello page/);
  // the plus offers files; settings (with the approvals mode) are one more row
  await page.click('#m-tabs [data-tab="chat"]');
  await page.click('#m-plus');
  await page.waitForSelector('.m-sheet.open .m-arow');
  assert.match(await page.textContent('.m-sheet'), /Files/);
  await page.getByRole('button', { name: /Chat settings/ }).click();
  await page.waitForSelector('.m-mode');
  assert.equal(await page.locator('.m-mode').count(), 5, 'the same five permission modes as the desktop');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
  // projects: open one, rename it, give it instructions
  await page.click('#m-tabs [data-tab="projects"]');
  await page.click('#m-projects .m-prow');
  await page.waitForSelector('.m-sheet.open .m-textarea');
  await page.fill('.m-sheet.open .m-search', 'Home lab 2');
  await page.fill('.m-sheet.open .m-textarea', 'Be brief.');
  await page.getByRole('button', { name: 'Save' }).click();
  await waitFor(async () => (await (await fetch(`${api.url}/api/projects`, { headers: { authorization: `Bearer ${api.uiToken}` } })).json()).projects[0].instructions === 'Be brief.');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
  await page.click('#m-tabs [data-tab="chat"]');
});

test('the Back swipe closes a sheet instead of leaving the page', async () => {
  const before = page.url();
  await page.click('#m-title');
  await page.waitForSelector('.m-sheet.open');
  await page.goBack();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
  assert.equal(page.url(), before, 'still on the app');
});

test('chat settings: computer and effort are segmented controls (44 pt), the choice reaches the server', async () => {
  await page.click('#m-title');
  await page.waitForSelector('.m-seg');
  const seg = await page.locator('.m-seg-btn').first().boundingBox();
  assert.ok(seg.height >= 36 && (await page.locator('.m-seg').first().boundingBox()).height >= 44);
  await page.getByRole('radio', { name: 'Mac' }).click();
  await waitFor(() => rig.target.get() === 'mac');
  await page.getByRole('radio', { name: 'PC' }).click();
  await waitFor(() => rig.target.get() === 'pc');
  await page.getByRole('radio', { name: 'High' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('jarvis.phone.effort')), 'high');
  await page.getByRole('radio', { name: 'Medium' }).click();
  await sheetSettled();
  await shot('settings-dark');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.m-sheet', { state: 'detached' });
});

test('the keyboard: the composer rides on top of it and the conversation stays in view', async () => {
  await page.evaluate(() => window.__keyboard(336));
  await waitFor(async () => (await page.getAttribute('#m-app', 'data-kb')) === 'open');
  const g = await page.evaluate(() => { const f = document.querySelector('.m-field').getBoundingClientRect(); const a = document.getElementById('m-app').getBoundingClientRect(); return { fieldBottom: f.bottom, appBottom: a.bottom, appH: a.height, inner: innerHeight }; });
  assert.ok(Math.abs(g.appH - (g.inner - 336)) < 2, `the app is as tall as the room above the keyboard (${g.appH})`);
  assert.ok(g.fieldBottom <= g.appBottom, 'the composer is above the keyboard');
  assert.ok(g.appBottom - g.fieldBottom < 20, 'with the keyboard open there is no home-indicator gap under the composer');
  await shot('keyboard-dark');
  await page.evaluate(() => window.__keyboard(0));
  await waitFor(async () => (await page.getAttribute('#m-app', 'data-kb')) === 'closed');
});

test('thinking and streaming: the line says so with the mesh in front, send turns into stop, and stop ends the reply', async () => {
  rig.model.script({ reasoning: 'Working out what to say. '.repeat(4), content: 'A slow reply that keeps on coming. '.repeat(14), delayMs: 70 });
  await typeAndSend('write something slow');
  await page.waitForSelector('.m-think');
  assert.match(await page.textContent('.m-think'), /Thinking/);
  assert.equal(await page.locator('.m-think canvas.m-logo').count(), 1, 'the mesh is the loading icon');
  assert.equal(await page.getAttribute('#m-send', 'aria-label'), 'Stop');
  assert.equal(await page.getAttribute('#m-send', 'aria-disabled'), 'false');
  assert.equal(await page.getAttribute('#m-log', 'aria-busy'), 'true');
  await page.waitForTimeout(450); // the logo's glide to this line
  await shot('thinking-dark');
  const before = await page.locator('.m-msg.assistant').count();
  await waitFor(async () => (await page.locator('.m-msg.assistant').count()) === before + 1 && (await page.locator('.m-msg.assistant').last().textContent()).length > 30);
  await page.waitForTimeout(500);
  await shot('streaming-dark');
  await page.dispatchEvent('#m-send', 'click'); // stop
  await waitFor(async () => (await page.locator('#m-app[data-busy]').count()) === 0);
  assert.match(await page.locator('.m-note').last().textContent(), /Stopped/);
  assert.ok((await page.locator('.m-msg.assistant').last().textContent()).length > 30, 'what was written before Stop stays');
  assert.equal(await page.locator('.m-msg.assistant').last().locator('canvas.m-logo').count(), 1, 'the logo rests under that partial reply');
  assert.equal(await page.getAttribute('#m-send', 'aria-label'), 'Send');
  assert.equal(await page.getAttribute('#m-log', 'aria-busy'), 'false');
});

test('a code block has a 44 pt Copy button that copies the code, and the code scrolls sideways inside its box, not the page', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  rig.model.script({ content: 'Code:\n\n```js\nconst veryLongLine = "' + 'x'.repeat(120) + '";\n```\n' });
  await typeAndSend('show code');
  await waitFor(async () => (await page.locator('.m-msg.assistant .copy-btn').count()) >= 1 && (await page.locator('#m-app[data-busy]').count()) === 0);
  const btn = page.locator('.m-msg.assistant .copy-btn').last();
  assert.ok((await btn.boundingBox()).height >= 44);
  await btn.click();
  await waitFor(async () => /COPIED/.test(await btn.textContent()));
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^const veryLongLine = "x{120}";/);
  assert.ok(await page.evaluate(() => document.querySelector('.m-msg.assistant:last-of-type .code-box').getBoundingClientRect().right <= innerWidth), 'the code box stays on screen');
  const pre = await page.locator('.m-msg.assistant pre').last().evaluate((p) => p.scrollWidth > p.clientWidth);
  assert.equal(pre, true, 'the code scrolls inside its own box');
  await shot('code-dark');
});

test('scrolled away from the newest message, a jump button appears; it brings you back', async () => {
  rig.model.script({ content: Array.from({ length: 40 }, (_, i) => `Line number ${i + 1} of a long answer.`).join('\n\n') });
  await typeAndSend('a long answer');
  await waitFor(async () => (await page.locator('#m-app[data-busy]').count()) === 0);
  await waitFor(async () => await page.locator('#m-jump').isHidden()); // at the bottom (once the last render has settled): no button
  await page.evaluate(() => { document.getElementById('m-scroll').scrollTop = 0; });
  await page.waitForSelector('#m-jump:not([hidden])');
  const b = await page.locator('#m-jump').boundingBox();
  assert.ok(b.width >= 40 && b.height >= 40);
  await page.locator('#m-jump').click();
  await waitFor(async () => (await page.evaluate(() => { const s = document.getElementById('m-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight; })) < 4);
  assert.equal(await page.locator('#m-jump').isHidden(), true);
});

test('a small nudge upward lets go of the stream (it does not pull the reader back down)', async () => {
  await page.waitForTimeout(900); // the previous test's glide down has finished
  await page.evaluate(() => { const s = document.getElementById('m-scroll'); s.scrollTop = s.scrollHeight; });
  await waitFor(async () => await page.locator('#m-jump').isHidden());
  await page.waitForTimeout(150); // let the scroll to the end be seen before the nudge, as a real hand would
  await page.evaluate(() => { const s = document.getElementById('m-scroll'); s.scrollTop -= 40; }); // well inside the old 96 px "near the bottom" band
  await page.waitForSelector('#m-jump:not([hidden])');
  await page.evaluate(() => { const s = document.getElementById('m-scroll'); s.scrollTop = s.scrollHeight; });
  await waitFor(async () => await page.locator('#m-jump').isHidden());
});

test('light appearance follows the iPhone setting', async () => {
  await ctx.close();
  await open({ colorScheme: 'light' });
  await page.waitForTimeout(3000);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(bg, 'rgb(10, 14, 20)', 'not the dark background');
  await shot('empty-light');
  rig.model.script({ content: 'A light-theme reply with `code` and a [link](https://example.com).' });
  await typeAndSend('hi');
  await waitFor(async () => (await page.locator('#m-app[data-busy]').count()) === 0 && (await page.locator('.m-msg.assistant').count()) === 1);
  await shot('reply-light');
});

test('a small phone (iPhone SE) and a large one (Pro Max): everything fits, nothing scrolls sideways, the composer is reachable', async () => {
  for (const [name, device] of [['se', 'iPhone SE'], ['promax', 'iPhone 15 Pro Max']]) {
    await ctx.close();
    await open({ ...devices[device], colorScheme: 'dark' });
    await page.waitForTimeout(1500);
    const g = await page.evaluate(() => { const f = document.querySelector('.m-field').getBoundingClientRect(); const hero = document.querySelector('canvas.logo-hero').getBoundingClientRect(); const bar = document.querySelector('.m-bar').getBoundingClientRect(); return { w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, fb: f.bottom, ft: f.top, heroTop: hero.top, heroBottom: hero.bottom, barBottom: bar.bottom }; });
    assert.equal(g.sw, g.w, `${device}: no sideways scroll`);
    assert.ok(g.fb <= g.h, `${device}: composer on screen`);
    assert.ok(g.heroTop >= g.barBottom && g.heroBottom <= g.ft, `${device}: the mesh fits between the bar and the composer`);
    await shot(`empty-${name}`);
  }
});

test('no script errors on the page', () => { assert.deepEqual(errors, []); });
