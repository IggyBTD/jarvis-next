// What the new shell does when you use it (the layout is checked in ui-layout.test.js): folders, dragging a chat into one, search,
// the title menu, the panel's tabs, the Plan chip in Code, Customize and Scheduled. Run alone: node --test tests/browser/ui-shell.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { waitFor } from '../helpers.js';
import { ROOT } from '../../server/core/config.js';

const VITE_PORT = 5197;
let rig; let api; let vite; let browser; let page; const errors = [];

before(async () => {
  rig = await makeRig({ enableAll: true, edit: (f) => { f['machines.json'].server.origins.push(`http://localhost:${VITE_PORT}`); } });
  api = await startApi(rig);
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([url, token]) => { try { localStorage.setItem('jarvis.server', JSON.stringify({ enabled: true, url, token })); localStorage.setItem('jarvis.theme', 'dark'); } catch { /* storage blocked */ } }, [api.wsUrl, api.uiToken]);
  await page.goto(`http://localhost:${VITE_PORT}`);
  await page.waitForSelector('#target-switch:not([hidden])', { timeout: 15000 });
});

after(async () => {
  await browser?.close();
  await vite?.close();
  await api?.close();
  await rig?.close();
});

// a drag with the pointer (the sidebar does not use the webview's drag and drop)
async function dragTo(from, to) {
  const a = await page.locator(from).boundingBox();
  const z = await page.locator(to).boundingBox();
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 50, a.y + a.height / 2 - 8, { steps: 4 });
  await page.mouse.move(z.x + 60, z.y + z.height / 2, { steps: 12 });
  await page.mouse.up();
}
const send = async (text) => { await page.waitForSelector('#dock-stop', { state: 'hidden' }); await page.fill('#hud-chat-input', text); await page.keyboard.press('Enter'); };

test('a new chat shows the greeting and the input card together, in the middle; after a message the card is at the bottom', async () => {
  const empty = await page.evaluate(() => { const g = document.getElementById('chat-empty').getBoundingClientRect(); const c = document.getElementById('composer-dock').getBoundingClientRect(); return { greetingAbove: g.bottom <= c.top, cardMid: c.top > 150 && c.bottom < innerHeight - 150 }; });
  assert.deepEqual(empty, { greetingAbove: true, cardMid: true });
  rig.model.script({ content: 'Hello.' });
  await send('hello');
  await page.waitForSelector('#chat-output .chat-line.assistant');
  const after = await page.evaluate(() => document.getElementById('composer-dock').getBoundingClientRect().bottom);
  assert.ok(after > 800, `the card sits at the bottom (${after})`);
  // what the reply cost the local model is shown under it and counted in the panel
  await page.waitForSelector('#chat-output .chat-line.assistant .chat-stats');
  assert.match(await page.textContent('#chat-output .chat-line.assistant .chat-stats'), /\d+ tokens/);
  await page.click('#ws-tabs [data-id="llm"] .t-label');
  await waitFor(async () => /Replies\s*1/.test(await page.textContent('#llm-speed-rows')));
  assert.equal((await page.textContent('#llm-name')).trim(), 'Qwen 3.8 27B'); // the title is the name, not the file name
  await page.click('#env-reset');
  await waitFor(async () => /shows here/.test(await page.textContent('#llm-speed-rows')));
});

test('folders: add one and name it, drag a chat into it, it opens to show the chat, the count follows, drag it back to Recents', async () => {
  await page.waitForSelector('#chat-list .chat-item');
  await page.click('#folder-add');
  await page.fill('#chat-list .folder-item input', 'Work');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#chat-list .folder-item .ci-name');
  assert.equal((await page.textContent('#chat-list .folder-item .ci-name')).trim(), 'Work');
  await dragTo('#chat-list .chat-item', '#chat-list .folder-item');
  await waitFor(async () => (await page.locator('#chat-list .chat-row.in-folder').count()) === 1);
  assert.equal((await page.textContent('#chat-list .folder-item .ci-count')).trim(), '1');
  await dragTo('#chat-list .chat-row.in-folder .chat-item', '#chat-list .list-label:has-text("Recents")');
  await waitFor(async () => (await page.locator('#chat-list .chat-row.in-folder').count()) === 0);
});

test('search narrows the list to every chat that matches, and Ctrl+K opens it', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#chat-search:not([hidden])');
  await page.fill('#chat-search', 'zzzz-nothing');
  assert.match(await page.textContent('#chat-list'), /No chat matches/);
  await page.fill('#chat-search', 'hello');
  assert.ok(await page.locator('#chat-list .chat-item').count() >= 1);
  await page.click('#chat-search-btn');
  assert.equal(await page.isHidden('#chat-search'), true);
});

test('the title menu and the row\'s more button open the chat menu', async () => {
  await page.click('#chat-title-btn');
  await page.waitForSelector('#app-menu:not([hidden])');
  assert.match(await page.textContent('#app-menu'), /Rename[\s\S]*Pin to top[\s\S]*Delete/);
  await page.keyboard.press('Escape');
  await page.hover('#chat-list .chat-row');
  await page.click('#chat-list .chat-row .ci-more');
  await page.waitForSelector('#app-menu:not([hidden])');
  assert.match(await page.textContent('#app-menu'), /Export as Markdown/);
  await page.keyboard.press('Escape');
});

test('the panel: six info tabs that cannot be closed, each shows its own content; outputs lists files by type and a click shows the raw code', async () => {
  assert.equal(await page.locator('#ws-tabs .ws-tab[data-kind="info"]').count(), 6);
  assert.equal(await page.locator('#ws-tabs .ws-tab[data-kind="info"] .t-x').count(), 0);
  rig.model.script({ content: 'Done.\n\n<jarvis-artifact id="pg" type="html" title="A page">\n<!doctype html><body><h1>hi</h1></body>\n</jarvis-artifact>' });
  await send('make a page');
  await page.waitForSelector('#ws-docs [data-id="pg"]');
  await page.click('#ws-docs [data-id="pg"] .t-x');
  assert.equal(await page.locator('#ws-docs [data-id="pg"]').count(), 0);
  await page.click('#ws-tabs [data-id="outputs"] .t-label');
  await page.waitForSelector('#out-list .out-file');
  assert.match(await page.textContent('#out-list'), /HTML pages[\s\S]*pg\.html/); // sorted by type, the file named by its type
  await page.click('#out-list .out-group > summary'); // a type folds
  assert.equal(await page.isHidden('#out-list .out-file'), true);
  await page.click('#out-list .out-group > summary');
  await page.click('#out-list .out-file'); // a click shows the raw code
  await page.waitForSelector('#out-viewer:not([hidden])');
  assert.match(await page.textContent('#out-body'), /<h1>hi<\/h1>|&lt;h1&gt;|h1/);
  await page.click('#out-back');
  await page.waitForSelector('#out-list .out-file');
  for (const [id, pane, text] of [['pc', '#pc-meters', /CPU usage[\s\S]*SSD space/], ['llm', '#llm-ctx', /Tokens in the window/], ['tasks', '#bg-list', /Nothing running/], ['env', '#env-branch', /Current\s*main/]]) {
    await page.click(`#ws-tabs [data-id="${id}"] .t-label`);
    await waitFor(async () => text.test(await page.textContent(pane)));
  }
  assert.match(await page.textContent('#env-remote'), /Status\s*on/);
  assert.match(await page.textContent('#env-pc'), /pc-host/);
});

test('Code: the Plan chip shows only there and switches plan mode; the changes and tasks tabs are in the panel', async () => {
  assert.equal(await page.isVisible('#cli-toggle-plan'), false);
  await page.click('.mode-btn[data-page="code"]');
  assert.equal(await page.isVisible('#cli-toggle-plan'), true);
  await page.click('#cli-toggle-plan');
  assert.equal(await page.getAttribute('#cli-toggle-plan', 'aria-pressed'), 'true');
  await page.click('#cli-toggle-plan');
  for (const id of ['changes', 'tasks']) { await page.click(`#ws-tabs [data-id="${id}"] .t-label`); assert.equal(await page.isVisible(`#ws-${id}`), true); }
  await page.click('.mode-btn[data-page="chat"]');
});

test('Customize holds appearance, commands and shortcuts; Scheduled shows the digest and the background tasks', async () => {
  await page.click('#sidebar [data-page="customize"]');
  assert.match(await page.textContent('#page-customize'), /Appearance[\s\S]*Slash commands[\s\S]*Keyboard shortcuts[\s\S]*Ctrl\+K/);
  await page.click('#theme-seg [data-theme="light"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.click('#theme-seg [data-theme="dark"]');
  await page.click('#sidebar [data-page="scheduled"]');
  assert.match(await page.textContent('#sched-root'), /Morning digest[\s\S]*Reminders you missed[\s\S]*Background tasks/);
  await page.click('.mode-btn[data-page="chat"]');
});

test('the sidebar hides and comes back, and the way back is always on screen', async () => {
  await page.click('#side-toggle');
  assert.equal(await page.evaluate(() => document.body.classList.contains('side-off')), true);
  assert.equal(await page.isVisible('#side-toggle'), true);
  await page.keyboard.press('Control+\\');
  assert.equal(await page.evaluate(() => document.body.classList.contains('side-off')), false);
});

test('the desktop app falls back to this computer when the saved server address (a LAN address that changed) does not answer', async () => {
  const wrong = api.wsUrl.replace('127.0.0.1', '127.0.0.2'); // nothing listens there: refused at once
  assert.notEqual(wrong, api.wsUrl);
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(([url, token]) => { window.__TAURI_INTERNALS__ = { invoke: () => Promise.reject(new Error('stub')), transformCallback: () => 0 }; try { localStorage.setItem('jarvis.server', JSON.stringify({ enabled: true, url, token })); } catch { /* storage blocked */ } }, [wrong, api.uiToken]);
  await p.goto(`http://localhost:${VITE_PORT}`);
  try {
    await p.waitForSelector('#target-switch[data-link="on"]', { timeout: 20000 });
    await p.click('#model-chip');
    await p.waitForSelector('#model-server-list button');
  } finally { await p.close(); }
});

test('with no server at all the model chip says so and its menu explains it instead of staying empty', async () => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(([token]) => { try { localStorage.setItem('jarvis.server', JSON.stringify({ enabled: true, url: 'ws://127.0.0.1:9', token })); } catch { /* storage blocked */ } }, [api.uiToken]);
  await p.goto(`http://localhost:${VITE_PORT}`);
  try {
    await p.waitForSelector('#model-chip[data-loaded="no"]');
    assert.equal((await p.textContent('#model-chip-label')).trim(), 'Server offline');
    await p.click('#model-chip');
    await p.waitForSelector('#model-server-list .menu-note');
    await waitFor(async () => /not reachable/.test(await p.textContent('#model-server-list')));
    assert.equal(await p.isVisible('#model-server-list .menu-note button'), true);
  } finally { await p.close(); }
});

test('no script errors on the page', () => { assert.deepEqual(errors.filter((e) => !/transformCallback/.test(e)), []); });
