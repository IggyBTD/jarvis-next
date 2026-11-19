// Full UI audit: every screen, light and dark, three window sizes. Screenshots + automated checks.
// Run: node tools/ui-checks/ui-audit/mock.mjs (fake LM Studio on :1234), npx vite --port 5174, then
// node tools/ui-checks/ui-audit/audit.cjs. Env: SIZES=1600x900,1200x780,900x700 THEMES=light,dark OUT=shots.
// Checks per screen: contrast (WCAG AA), text under 12 px, targets under 24 px, clipped text, sideways
// scroll, unnamed buttons. Screenshots go to OUT (do not commit them).
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || 'shots';
fs.mkdirSync(OUT, { recursive: true });
const STUB = fs.readFileSync(__dirname + '/stub.js', 'utf8');
const SIZES = (process.env.SIZES || '1600x900,1200x780,900x700').split(',').map((s) => s.split('x').map(Number));
const THEMES = (process.env.THEMES || 'light,dark').split(',');

function checks() {
  const out = [];
  const name = (el) => { const id = el.id ? `#${el.id}` : ''; const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const t = (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24).replace(/\s+/g, ' '); return `${el.tagName.toLowerCase()}${id}${cls}${t ? ` "${t}"` : ''}`; };
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; } return true; };
  const rgba = (c) => { const m = c.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : null; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let base = rgba(getComputedStyle(document.body).backgroundColor); for (const c of layers.reverse()) base = [0, 1, 2].map((i) => c[i] * c[3] + base[i] * (1 - c[3])).concat(1); return base; };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(['overflow', `page scrolls sideways (${document.documentElement.scrollWidth}px)`]);
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg') || el.tagName === 'IFRAME') continue;
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      const fs = parseFloat(s.fontSize);
      if (fs < 12) out.push(['small-text', `${name(el)} ${fs}px`]);
      const disabled = el.closest('button:disabled, [aria-disabled="true"]');
      const fg = rgba(s.color); const bg = bgOf(el); const op = opacityOf(el) * fg[3];
      const eff = [0, 1, 2].map((i) => fg[i] * op + bg[i] * (1 - op));
      const r = ratio(eff, bg); const big = fs >= 24 || (fs >= 18.66 && +s.fontWeight >= 700);
      if (!disabled && r < (big ? 3 : 4.5)) out.push(['contrast', `${name(el)} ${r.toFixed(2)}:1`]);
      if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis') out.push(['clipped', name(el)]);
    }
    if (el.matches('button, a[href], input:not([type=hidden]), select, [role=tab], [role=menuitem]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) out.push(['target', `${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`]);
      if (el.tagName === 'BUTTON' && !el.innerText.trim() && !el.getAttribute('aria-label') && !el.dataset.tip && !el.title) out.push(['unnamed', name(el)]);
    }
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const theme of THEMES) for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 });
    await ctx.addInitScript(STUB);
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(process.env.URL || 'http://localhost:5174/'); await p.waitForTimeout(1800);
    const tag = `${theme}-${w}`;
    const shot = async (screen) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${tag}-${screen}.png` }); report[`${tag}-${screen}`] = await p.evaluate(checks); };
    const side = async (sel) => { if (await p.evaluate(() => document.body.classList.contains('side-off'))) { await p.click('#side-toggle'); await p.waitForTimeout(300); } await p.click(sel); };
    const send = async (t, ms) => { await p.fill('#hud-chat-input', t); await p.press('#hud-chat-input', 'Enter'); await p.waitForTimeout(ms); };
    await shot('01-chat-empty');
    await p.click('#model-chip'); await shot('02-model-menu'); await p.keyboard.press('Escape');
    await p.fill('#hud-chat-input', '/'); await shot('03-palette'); await p.fill('#hud-chat-input', ''); await p.keyboard.press('Escape');
    await send('demo please', 3500); await p.mouse.move(w / 2, h / 2); await shot('04-chat-reply');
    await side('#nav-system'); await p.waitForTimeout(800); await shot('05-system-tab');
    await send('do this agent job', 3500); await shot('06-agent-approval');
    const allow = p.locator('.tool-card.approval button', { hasText: 'Allow once' }).last(); if (await allow.count()) { await allow.click(); await p.waitForTimeout(1500); }
    await p.locator('.chat-line.user').last().hover(); await shot('07-agent-done');
    await side('button[data-page="code"]'); await p.waitForTimeout(600); await shot('08-code');
    await side('.nav-item[data-page="artifacts"]'); await shot('09-artifacts');
    await side('.nav-item[data-page="settings"]'); await shot('10-settings');
    await side('button[data-page="chat"]'); await p.waitForTimeout(300);
    await p.focus('#hud-chat-input'); await p.keyboard.press('Shift+Tab'); await p.click('#think-btn');
    if (w >= 1024) await p.locator('.chat-row').nth(1).hover(); await shot('11-composer-states-and-list-hover');
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab');
    if (w < 1024) await p.click('#side-toggle'); await p.fill('#chat-search', 'delta'); await p.waitForTimeout(500); await shot('12-chat-search'); await p.fill('#chat-search', ''); if (w < 1024) { await p.mouse.click(w - 100, h / 2); await p.waitForTimeout(300); }
    if (w >= 1024) { await p.click('#side-toggle'); await p.waitForTimeout(300); await shot('13-sidebar-hidden'); if (!(await p.isVisible('#side-toggle'))) report[tag + '-toggle'] = [['bug', 'toggle hidden']]; await p.click('#side-toggle'); } else { await p.click('#side-toggle'); await p.waitForTimeout(400); await shot('13-sidebar-sheet'); await p.mouse.click(w - 100, h / 2); await p.waitForTimeout(400); }
    await p.click('#chat-output', { button: 'right', position: { x: 200, y: 200 } }); await shot('14-context-menu'); await p.keyboard.press('Escape');
    await p.hover('#dock-web'); await p.waitForTimeout(900); await shot('15-tooltip');
    report[`${tag}-errors`] = errors;
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  // summary: issue counts per kind, unique messages
  const uniq = {};
  for (const [k, v] of Object.entries(report)) if (Array.isArray(v)) for (const item of v) { if (typeof item === 'string') { (uniq.errors ||= new Set()).add(item); continue; } const [kind, msg] = item; ((uniq[kind] ||= new Map()).get(msg) || (uniq[kind].set(msg, []), uniq[kind].get(msg))).push(k.replace(/-\d\d-.*/, (m) => m.slice(0, 3))); }
  for (const [kind, m] of Object.entries(uniq)) { if (m instanceof Set) { console.log(`\n## page errors (${m.size})`); for (const e of m) console.log(`  ${e}`); continue; } console.log(`\n## ${kind} (${m.size})`); for (const [msg, where] of m) console.log(`  ${msg}   [${[...new Set(where)].length} screens]`); }
  if (!Object.keys(uniq).length) console.log('No findings.');
})();
