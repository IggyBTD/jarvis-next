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

test('the empty chat page: the big mesh is the centrepiece and the group stays centred; it reacts to typing, a click and a drag, and then rests without a loop', async () => {
  const g = await page.evaluate(() => {
    const h = document.querySelector('canvas.hero').getBoundingClientRect();
    const c = document.getElementById('composer-dock').getBoundingClientRect();
    const pane = document.getElementById('chat-stack').getBoundingClientRect();
    return { size: h.width, mid: (h.top + c.bottom) / 2, paneMid: (pane.top + pane.bottom) / 2, cx: h.left + h.width / 2, paneCx: pane.left + pane.width / 2 };
  });
  assert.ok(g.size >= 150, `the mesh is big (${g.size})`);
  assert.ok(Math.abs(g.mid - g.paneMid) < 90, `mesh, greeting and card are centred together (${Math.round(g.mid)} vs ${Math.round(g.paneMid)})`);
  assert.ok(Math.abs(g.cx - g.paneCx) < 4, 'the mesh is on the centre line');
  await page.evaluate(() => {
    const cv = document.querySelector('canvas.hero');
    window.__sig = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let k = 3; k < d.length; k += 4) s += d[k] * (((k >> 2) % 251) + 1); return s; };
    window.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { window.__frames++; return raf(f); };
  });
  const sig = () => page.evaluate(() => window.__sig());
  const settle = async () => { let last = await sig(); for (let k = 0; k < 40; k++) { await page.waitForTimeout(250); const now = await sig(); if (now === last) { await page.waitForTimeout(250); if ((await sig()) === now) return now; } last = now; } throw new Error('the mesh never came to rest'); };
  await settle();
  await page.evaluate(() => { window.__frames = 0; });
  await page.waitForTimeout(1000);
  assert.ok((await page.evaluate(() => window.__frames)) < 20, 'resting: no animation loop');
  // typing: the letters move it, and it rests again after
  const still = await sig();
  await page.click('#hud-chat-input');
  await page.evaluate(() => { window.__frames = 0; });
  await page.keyboard.type('hello there, how are you today', { delay: 35 });
  assert.notEqual(await sig(), still, 'typing changed the picture');
  assert.ok((await page.evaluate(() => window.__frames)) > 15, 'it ran while typing');
  await settle();
  // a click makes it jump; a drag turns it
  const box = await page.locator('canvas.hero').boundingBox();
  const base = await sig();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  assert.notEqual(await sig(), base, 'a click changed the picture');
  await settle();
  const before = await sig();
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + 40 + k * 9, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.notEqual(await sig(), before, 'a drag turned it');
  await settle();
  await page.fill('#hud-chat-input', ''); // the next test starts from an empty box
});

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
  await page.click('.p-more > summary');
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

test('the panel: one Overview tab that cannot be closed, with cards that fold; outputs lists files by type and a click shows the raw code', async () => {
  assert.equal(await page.locator('#ws-tabs .ws-tab[data-kind="info"]').count(), 1);
  assert.deepEqual(await page.locator('details.p-card').evaluateAll((d) => d.map((x) => x.dataset.card)), ['pc', 'model', 'env', 'changes', 'outputs', 'tasks']);
  await page.click('[data-card="pc"] > summary'); // a card folds and opens again
  assert.equal(await page.isHidden('#pc-meters'), true);
  assert.match(await page.innerText('#pc-sub'), /^GPU: \S+C\s+CPU: \S+C$/); // folded, the card shows its one line
  await page.evaluate(() => document.querySelectorAll('details.p-card').forEach((d) => { d.open = false; }));
  assert.equal((await page.innerText('#llm-sum')).trim(), 'Qwen 3.8 27B');
  assert.match(await page.innerText('#cli-changes-count'), /^\+\d+\s+-\d+$/);
  assert.match(await page.innerText('#out-count'), /^\d+$/);
  assert.match(await page.innerText('#bg-count'), /^\d+ running$/);
  assert.equal(await page.$eval('#cli-changes-count .plus', (e) => getComputedStyle(e).color) !== await page.$eval('#cli-changes-count .minus', (e) => getComputedStyle(e).color), true); // green and red  await page.click('[data-card="pc"] > summary');
  await page.click('[data-card="pc"] > summary');
  assert.equal(await page.isVisible('#pc-meters'), true);
  assert.equal(await page.locator('#ws-tabs .ws-tab[data-kind="info"] .t-x').count(), 0);
  rig.model.script({ content: 'Done.\n\n<jarvis-artifact id="pg" type="html" title="A page">\n<!doctype html><body><h1>hi</h1></body>\n</jarvis-artifact>' });
  await send('make a page');
  await page.waitForSelector('#ws-docs [data-id="pg"]');
  await page.click('#ws-docs [data-id="pg"] .t-x');
  assert.equal(await page.locator('#ws-docs [data-id="pg"]').count(), 0);
  await page.evaluate(() => { document.querySelector('[data-card="outputs"]').open = true; });
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
  for (const [id, pane, text] of [['pc', '#pc-meters', /GPU temp[\s\S]*CPU temp[\s\S]*GPU compute load[\s\S]*CPU compute load/], ['llm', '#llm-ctx', /Context left/], ['tasks', '#bg-list', /Nothing running/], ['env', '#env-branch', /Current\s*main/]]) {
    await waitFor(async () => text.test(await page.textContent(pane)));
  }
  assert.match(await page.textContent('#env-remote'), /Status\s*on/);
  assert.match(await page.textContent('#env-pc'), /pc-host/);
});

test('Code: the permission mode shows only there (five modes, first under the input), plus is left of the input and the mic right of it; the changes and tasks cards are in the panel', async () => {
  assert.equal(await page.isVisible('#mode-chip'), false);
  await page.click('.mode-btn[data-page="code"]');
  assert.equal(await page.isVisible('#mode-chip'), true);
  const box = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  const [plus, input, mic, bar, web, mode] = await Promise.all(['#dock-attach', '#hud-chat-input', '#dock-mic', '.composer-bar', '#dock-web', '#mode-chip'].map(box));
  assert.ok(plus.r <= input.l && input.r <= mic.l, 'plus, input, mic from left to right');
  assert.ok(mode.t >= input.b && mode.l < web.l, 'the mode is under the input, before the web button');
  assert.ok(web.t >= input.b, 'web and link stay under the input');
  await page.click('#mode-chip');
  assert.deepEqual(await page.locator('#mode-menu [data-mode]').evaluateAll((b) => b.map((x) => x.textContent.split(/(?=[A-Z][a-z]+ )/)[0].trim().slice(0, 6))), ['Auto', 'Manual', 'Accept', 'Plan', 'Bypass']);
  await page.click('#mode-menu [data-mode="plan"]');
  assert.equal((await page.textContent('#mode-chip')).trim(), 'Plan');
  await page.click('#mode-chip'); await page.click('#mode-menu [data-mode="auto"]');
  for (const id of ['changes', 'tasks']) assert.equal(await page.isVisible(`[data-card="${id}"]`), true);
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

test('the plus opens a menu of places to add a file from; Accounts takes several accounts per service and keeps them', async () => {
  await page.click('.mode-btn[data-page="chat"]');
  assert.match(await page.getAttribute('#dock-attach .icon', 'data-icon'), /plus/);
  await page.click('#dock-attach');
  await page.waitForSelector('#attach-menu:not([hidden])');
  assert.match(await page.textContent('#attach-menu'), /From this PC[\s\S]*From Mac/);
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#attach-menu'), true);
  await page.click('#sidebar [data-page="accounts"]');
  assert.match(await page.textContent('#acct-root'), /Google[\s\S]*Microsoft[\s\S]*GitHub/);
  for (const [kind, name] of [['School', 'University'], ['Work', 'Company']]) {
    await page.click('#acct-root .set-card:has(h2:text-is("Google")) .acct-head .av-btn');
    await page.selectOption('#acct-root .acct-form select', kind);
    await page.fill('#acct-root .acct-form input[type="text"]', name);
    await page.click('#acct-root .acct-form .av-btn:has-text("Add account")');
  }
  assert.equal(await page.locator('#acct-root .set-card:has(h2:text-is("Google")) .set-row').count(), 2);
  await page.reload();
  await page.waitForSelector('#target-switch:not([hidden])');
  await page.click('#sidebar [data-page="accounts"]');
  assert.equal(await page.locator('#acct-root .set-card:has(h2:text-is("Google")) .set-row').count(), 2);
  while (await page.locator('#acct-root .set-row .av-btn.danger').count()) await page.locator('#acct-root .set-row .av-btn.danger').first().click();
  assert.equal(await page.locator('#acct-root .set-row').count(), 0);
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
