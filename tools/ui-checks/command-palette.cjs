// The "/" menu: opens on "/", narrows while typing, keys, click, usage hint, Esc, a command still
// runs, no menu for plain text. Saves command-palette.png next to the script (delete it after looking).
const { chromium } = require('playwright');
const path = require('path');

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  page.on('pageerror', (e) => { if (!/transformCallback|currentWindow|plugin:event/.test(String(e))) console.log('pageerror', String(e).slice(0, 200)); });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const state = () => page.evaluate(() => {
    const p = document.getElementById('command-palette');
    const i = document.getElementById('hud-chat-input');
    const rows = [...p.querySelectorAll('li[data-name]')].map((l) => l.dataset.name);
    const r = p.getBoundingClientRect(); const ir = i.getBoundingClientRect();
    return {
      open: !p.hidden, rows, active: p.querySelector('li.active')?.dataset.name, value: i.value,
      gap: Math.round(ir.top - r.bottom), usage: p.querySelector('.cp-usage').textContent, hint: p.classList.contains('hint'),
      activedesc: i.getAttribute('aria-activedescendant'), expanded: i.getAttribute('aria-expanded'),
      empty: p.querySelector('.cp-empty')?.textContent ?? null,
    };
  });

  await page.click('#hud-chat-input');
  let s = await state();
  check('closed before typing', !s.open);

  await page.keyboard.type('/');
  await page.waitForTimeout(250);
  s = await state();
  check('"/" opens the menu with every command', s.open && s.rows.length >= 30, `(${s.rows.length} rows)`);
  check('first row is selected', s.active === s.rows[0], s.active);
  check('menu sits just above the field', s.gap >= 0 && s.gap <= 16, `gap ${s.gap}px`);
  await page.screenshot({ path: path.join(__dirname, 'command-palette.png'), clip: { x: 300, y: 300, width: 1000, height: 600 } });

  await page.keyboard.type('mem');
  await page.waitForTimeout(100);
  s = await state();
  check('"/mem" narrows the list', s.rows.length > 0 && s.rows.length < 8 && s.rows.includes('memory') && s.rows.includes('memories'), s.rows.join(','));
  check('prefix matches come first', s.rows[0].startsWith('mem'), s.rows[0]);

  await page.keyboard.press('ArrowDown');
  s = await state();
  check('ArrowDown moves the selection', s.active === s.rows[1], s.active);
  check('aria-activedescendant follows', !!s.activedesc && s.expanded === 'true', s.activedesc);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  s = await state();
  check('ArrowUp wraps to the end', s.active === s.rows[s.rows.length - 1], s.active);

  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  s = await state();
  check('Tab completes with a space (command takes arguments)', /^\/\w+ $/.test(s.value), JSON.stringify(s.value));
  check('then the menu shows only that command, as a usage hint', s.hint && s.rows.length === 1 && s.usage.startsWith('/'), s.usage);

  await page.fill('#hud-chat-input', '');
  await page.keyboard.type('/zzzz');
  await page.waitForTimeout(100);
  s = await state();
  check('no match says so', s.open && s.rows.length === 0 && /No command matches/.test(s.empty || ''), s.empty);

  await page.fill('#hud-chat-input', '/');
  await page.keyboard.type('stat');
  await page.keyboard.press('Escape');
  s = await state();
  check('Esc closes the menu and keeps the text', !s.open && s.value === '/stat');
  await page.keyboard.type('u');
  s = await state();
  check('typing again reopens it', s.open && s.rows[0] === 'status');

  // Enter completes, a second Enter runs it
  await page.fill('#hud-chat-input', '/stat');
  await page.keyboard.press('Enter');
  s = await state();
  check('Enter on a partial name completes it, nothing is sent', s.value === '/status' && (await page.locator('.chat-line').count()) === 0, JSON.stringify(s.value));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const lines = await page.locator('.chat-line .chat-text').allInnerTexts();
  check('second Enter runs /status', lines.some((t) => t.startsWith('Mode')), JSON.stringify(lines).slice(0, 120));
  s = await state();
  check('menu closed and field empty after sending', !s.open && s.value === '');

  // mouse
  await page.keyboard.type('/ti');
  await page.waitForTimeout(100);
  await page.locator('#command-palette li[data-name="time"]').click();
  s = await state();
  check('clicking a row completes it', s.value === '/time', JSON.stringify(s.value));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const t = await page.locator('.chat-line.system .chat-text').last().innerText();
  check('/time answers', /\d{1,2}:\d{2}/.test(t), t);

  // plain text never opens it; multi-line text neither
  await page.fill('#hud-chat-input', 'hello there');
  check('plain text: no menu', !(await state()).open);
  await page.fill('#hud-chat-input', '/clear\nsecond line');
  check('multi-line: no menu', !(await state()).open);

  // /help and /clear
  await page.fill('#hud-chat-input', '/help mem');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const help = await page.locator('.chat-line.system .chat-text').last().innerText();
  check('/help mem lists only matching commands', help.includes('/memories') && !help.includes('/voice'), help.split('\n').length + ' lines');
  await page.fill('#hud-chat-input', '/clear');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const after = await page.locator('.chat-line').count();
  check('/clear leaves only its own two lines', after === 2, `${after} lines`);

  // every registered command has a handler
  const names = (await page.evaluate(async () => (await import('/src/core/commands.js')).COMMANDS.map((c) => c.name))).filter((n) => n !== 'reload' && n !== 'attach'); // those two reload the page / open a file dialog
  const missing = [];
  for (const n of names) {
    const r = await page.evaluate(async (name) => (await (await import('/src/core/commands.js')).runCommand(`/${name}`)), n).catch((e) => `ERR ${e}`);
    if (/^Unknown command/.test(r)) missing.push(n);
  }
  check('every menu entry has a working handler', missing.length === 0, missing.join(','));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
