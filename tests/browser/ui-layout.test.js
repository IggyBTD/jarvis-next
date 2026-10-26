// The layout in real Chrome: every screen, at several window sizes, with the sidebar and the panel shown or hidden, with an HTML
// artifact open, with menus open. No control may be covered, cut off, off the window or on top of another one.
// SHOTS=1 also writes a picture of each state to docs/ui-shots/layout/. Run alone: node --test tests/browser/ui-layout.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { waitFor } from '../helpers.js';
import { ROOT } from '../../server/core/config.js';
import { scanLayout } from './layout-scan.js';

const VITE_PORT = 5198;
const SHOTS = path.join(ROOT, 'docs', 'ui-shots', 'layout');
const SIZES = [[960, 600], [1100, 700], [1280, 800], [1440, 900], [1920, 1080]];
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
  if (process.env.SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await vite?.close();
  await api?.close();
  await rig?.close();
});

const slug = (s) => s.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
async function check(label) {
  await page.waitForTimeout(120); // transitions settle
  const found = await page.evaluate(scanLayout);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(SHOTS, `${slug(label)}.png`) });
  assert.deepEqual(found, [], `${label}\n  ${found.join('\n  ')}`);
}
const setSize = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(80); };
const sidebar = async (on) => { const off = await page.evaluate(() => document.body.classList.contains('side-off')); if (off === on) await page.click('#side-toggle'); };
const panel = async (on) => { const shown = await page.evaluate(() => !document.body.classList.contains('ws-off')); if (shown !== on) await page.evaluate(() => { document.getElementById('ws-toggle').click(); }); };
const goto = async (p) => {
  await sidebar(true); // the page buttons live in the sidebar
  if (['chat', 'code', 'intel'].includes(p)) await page.click(`.mode-btn[data-page="${p}"]`);
  else if (p === 'settings') await page.click('#side-foot [data-page="settings"]');
  else await page.click(`#sidebar .nav-group [data-page="${p}"]`);
  await page.waitForTimeout(60);
};

for (const [w, h] of SIZES) {
  test(`${w}x${h}: every page, sidebar and panel shown or hidden`, async () => {
    await setSize(w, h);
    for (const p of ['chat', 'code', 'intel', 'projects', 'artifacts', 'scheduled', 'customize', 'settings']) {
      await goto(p);
      for (const side of [true, false]) {
        for (const pan of p === 'chat' || p === 'code' ? [true, false] : [true]) {
          await sidebar(side); await panel(pan);
          await check(`${w}x${h} ${p} sidebar-${side ? 'on' : 'off'} panel-${pan ? 'on' : 'off'}`);
        }
      }
      await sidebar(true); await panel(true);
    }
  });
}

test('chat page: every panel tab, the System tab, the Server tab', async () => {
  for (const [w, h] of [[1100, 700], [1440, 900]]) {
    await setSize(w, h); await goto('chat'); await sidebar(true); await panel(true);
    for (const id of ['env', 'context', 'connectors', 'outputs', 'files', 'changes', 'tasks']) {
      await page.click(`#ws-tabs [data-id="${id}"] .t-label`);
      await check(`${w}x${h} tab ${id}`);
    }
    await page.click('#nav-system'); await check(`${w}x${h} tab system`);
    await page.click('#nav-server'); await check(`${w}x${h} tab server`);
    await page.click('#workspace [data-id="system"] .t-x'); await page.click('#workspace [data-id="server"] .t-x');
  }
});

test('an HTML artifact opened in the panel, in each mode and size', async () => {
  rig.model.script({ content: 'Here it is.\n\n<jarvis-artifact id="demo-page" type="html" title="Demo page">\n<!doctype html><html><body style="font-family:sans-serif"><h1>Hello</h1><button>Click me</button></body></html>\n</jarvis-artifact>', chunk: 40 });
  await setSize(1440, 900); await goto('chat'); await sidebar(true); await panel(true);
  await page.fill('#hud-chat-input', 'make a demo page'); await page.keyboard.press('Enter');
  await page.waitForSelector('#workspace [data-id="demo-page"]', { timeout: 15000 });
  await waitFor(async () => (await page.locator('#dock-stop:not([hidden])').count()) === 0);
  for (const [w, h] of SIZES) {
    await setSize(w, h);
    for (const p of ['chat', 'code']) {
      await goto(p);
      for (const side of [true, false]) {
        for (const pan of [true, false]) {
          await sidebar(side); await panel(pan);
          if (pan) await page.click('#workspace [data-id="demo-page"] .t-label');
          await check(`${w}x${h} artifact ${p} sidebar-${side ? 'on' : 'off'} panel-${pan ? 'on' : 'off'}`);
        }
      }
      await sidebar(true); await panel(true);
    }
  }
});

test('menus: model menu, slash menu, a folder, search', async () => {
  for (const [w, h] of [[960, 600], [1440, 900]]) {
    await setSize(w, h); await goto('chat'); await sidebar(true); await panel(w > 1100);
    await page.click('#model-chip'); await page.waitForSelector('#model-server-list button');
    await check(`${w}x${h} model menu open`);
    await page.keyboard.press('Escape');
    await page.fill('#hud-chat-input', '/'); await page.waitForSelector('#command-palette:not([hidden])');
    await check(`${w}x${h} slash menu open`);
    await page.fill('#hud-chat-input', '');
    await page.click('#folder-add'); await page.keyboard.press('Enter');
    await check(`${w}x${h} folder added`);
    await page.click('#chat-search-btn');
    await check(`${w}x${h} search open`);
    await page.click('#chat-search-btn');
  }
});

test('Intel: the start page, the globe and the browser, with the conversation beside them', async () => {
  for (const [w, h] of SIZES) {
    await setSize(w, h); await goto('intel');
    for (const side of [true, false]) {
      await sidebar(side);
      await page.evaluate(() => { document.querySelectorAll('#intel-tabs [data-id]').forEach((t) => t.querySelector('.t-x')?.click()); document.getElementById('intel-add').click(); });
      await check(`${w}x${h} intel start sidebar-${side ? 'on' : 'off'}`);
      for (const app of ['osint', 'playwright']) {
        await page.evaluate((a) => { document.querySelector(`.start-tile[data-app="${a}"]`)?.click(); }, app);
        await page.waitForTimeout(150);
        await check(`${w}x${h} intel ${app} sidebar-${side ? 'on' : 'off'}`);
        await page.evaluate(() => { document.getElementById('intel-add').click(); });
      }
    }
    await sidebar(true);
  }
});

test('a crowded composer: long text, many attachments, a long chat title, a long list', async () => {
  for (const [w, h] of [[960, 600], [1280, 800], [1920, 1080]]) {
    await setSize(w, h); await goto('chat'); await sidebar(true); await panel(w > 1100);
    await page.fill('#hud-chat-input', Array.from({ length: 12 }, (_, i) => `line ${i} of a long message`).join(String.fromCharCode(10)));
    await page.evaluate(() => {
      const row = document.getElementById('attach-row');
      for (let i = 0; i < 6; i++) row.append(Object.assign(document.createElement('span'), { className: 'attach-chip', textContent: `a-quite-long-file-name-number-${i}.md` }));
      document.getElementById('chat-title').textContent = 'A very long chat title that keeps going and going and going until it has to be cut short somewhere';
      const list = document.getElementById('chat-list');
      for (let i = 0; i < 40; i++) { const r = document.createElement('div'); r.className = 'chat-row'; r.innerHTML = `<button type="button" class="chat-item"><span class="ci-name">A chat with a rather long name number ${i}</span></button>`; list.append(r); }
    });
    await check(`${w}x${h} crowded`);
    await page.evaluate(() => { document.getElementById('attach-row').replaceChildren(); document.querySelectorAll('#chat-list .chat-row').forEach((r) => r.remove()); });
    await page.fill('#hud-chat-input', '');
  }
});

test('narrow window: the panel replaces the conversation and has a way back', async () => {
  await setSize(960, 600); await goto('chat'); await sidebar(true);
  await panel(true);
  assert.ok(await page.evaluate(() => document.getElementById('workspace').getBoundingClientRect().width) > 300, 'the panel has room');
  assert.equal(await page.isVisible('#ws-back'), true);
  assert.equal(await page.isVisible('#chat-stack'), false);
  await page.click('#ws-back');
  assert.equal(await page.isVisible('#chat-stack'), true);
});

test('no script errors on the page', () => { assert.deepEqual(errors.filter((e) => !/transformCallback/.test(e)), []) /* no Tauri in a plain browser: the telemetry listener cannot start */; });
