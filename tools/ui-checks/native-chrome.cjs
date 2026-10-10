// Checks that browser-default chrome is replaced: no title attributes (custom tooltip), custom
// right-click menu (page, input, artifact frames incl. the script-less ones), thin scrollbars,
// blocked browser shortcuts. Saves screenshots next to the script.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!String(e).includes('transformCallback')) errors.push(String(e)); });
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) errors.push('CSP: ' + m.text().slice(0, 160)); });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const menu = () => page.evaluate(() => { const m = document.getElementById('app-menu'); return m.hidden ? null : [...m.querySelectorAll('button')].map((b) => b.textContent + (b.disabled ? ' (off)' : '')); });

  console.log('title attributes left:', await page.evaluate(() => document.querySelectorAll('[title]').length), '| data-tip:', await page.evaluate(() => document.querySelectorAll('[data-tip]').length));
  await page.hover('#dock-web');
  await page.waitForTimeout(800);
  console.log('tooltip:', JSON.stringify(await page.evaluate(() => { const t = document.getElementById('app-tip'); const r = t.getBoundingClientRect(); return { on: t.classList.contains('on'), text: t.textContent, opacity: getComputedStyle(t).opacity, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; })));
  await page.screenshot({ path: path.join(__dirname, 'chrome-tooltip.png'), clip: { x: 560, y: 720, width: 480, height: 180 } });
  await page.click('#dock-web');
  await page.waitForTimeout(700);
  console.log('after toggling (script set a new title):', JSON.stringify(await page.evaluate(() => ({ title: document.getElementById('dock-web').getAttribute('title'), tip: document.getElementById('dock-web').dataset.tip, label: document.getElementById('dock-web').getAttribute('aria-label') }))));
  await page.click('#dock-web');

  await page.mouse.click(800, 300, { button: 'right' });
  console.log('menu on HUD:', JSON.stringify(await menu()));
  await page.screenshot({ path: path.join(__dirname, 'chrome-menu.png'), clip: { x: 700, y: 240, width: 400, height: 200 } });
  await page.keyboard.press('Escape');
  console.log('menu after Esc:', JSON.stringify(await menu()), '| still on HUD:', await page.evaluate(() => !document.body.classList.contains('wb-mode')));

  await page.fill('#hud-chat-input', 'hello world');
  await page.locator('#hud-chat-input').selectText();
  await page.click('#hud-chat-input', { button: 'right' });
  console.log('menu in input with selection:', JSON.stringify(await menu()));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); // CUT
  console.log('input after CUT:', JSON.stringify(await page.inputValue('#hud-chat-input')), '| focus back in input:', await page.evaluate(() => document.activeElement.id));

  await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map((r) => r.name);
    const f = (n) => urls.find((u) => u.includes('/src/core/' + n));
    const art = await import(f('artifacts.js'));
    const wb = await import(f('whiteboard.js'));
    art.upsertArtifact({ id: 'page', type: 'html', title: 'Page', content: '<h1>Hello</h1><button>plain button</button> <input placeholder="field"><div style="height:2000px"></div>' });
    art.upsertArtifact({ id: 'logo', type: 'svg', title: 'Logo', content: '<svg viewBox="0 0 100 100" width="200"><circle cx="50" cy="50" r="40" fill="#00d9ff"/></svg>' });
    wb.applyBoardSpec({ layout: 'split', panels: ['page', 'logo'] });
  });
  await page.waitForTimeout(2600);
  for (const i of [0, 1]) {
    const box = await page.locator('iframe.wb-frame').nth(i).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(300);
    console.log(`menu from frame ${i}:`, JSON.stringify(await menu()));
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: path.join(__dirname, 'chrome-frames.png') });
  console.log('frame scrollbar width (px):', await page.frames().filter((f) => f !== page.mainFrame())[0].evaluate(() => window.innerWidth - document.documentElement.clientWidth));
  console.log('shortcuts blocked:', JSON.stringify(await page.evaluate(() => Object.fromEntries([['ctrl+f', { key: 'f', ctrlKey: true }], ['ctrl+p', { key: 'p', ctrlKey: true }], ['f3', { key: 'F3' }], ['ctrl+c', { key: 'c', ctrlKey: true }], ['ctrl+shift+i', { key: 'I', ctrlKey: true, shiftKey: true }]].map(([n, init]) => { const e = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return [n, e.defaultPrevented]; })))));
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
