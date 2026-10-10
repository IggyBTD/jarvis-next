// Measures the running UI against docs/design-spacing-philosophy.md and fails on any violation.
//   npm run dev  (or the dev server of a version), then:  node scripts/measure-ui.mjs [url]
// Opens Chrome at 1440 x 900 with a stand-in LM Studio and telemetry (tools/ui-checks/fake-backend.mjs),
// puts a conversation with a chart on screen, and checks:
//   1. every child of a row has the row's vertical centre (0.5 px)
//   2. every control height is 28, 32 or 40
//   3. every gap between siblings in a row is on the spacing scale
//   4. buttons of the same kind have the same size
//   5. the left edges in the sidebar are all 16 from its edge
// Writes docs/spacing-audit-after.md.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5175/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await page.goto(url);
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  await (await import('/tools/ui-checks/fake-backend.mjs')).install();
  await window.__say('Show me a chart of my cpu load', 2600);
  await window.__say('Now explain what the peak means', 1200);
});
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const SCALE = [0, 4, 8, 12, 16, 24, 32, 48, 64];
  const TIERS = [28, 32, 40];
  const out = { centre: [], tier: [], gap: [], kind: [], edge: [], rows: 0, controls: 0 };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'fixed' && cs.position !== 'absolute'; };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}`;
  const near = (a, b, t = 0.5) => Math.abs(a - b) <= t;

  // 1 and 3: rows
  const ROWS = ['.side-top', '.col-head', '#ws-tabs', '.composer-bar', '#mini-services', '.mini-top', '.av-bar', '.window-controls-cluster', '.mode-switch', '.tools', '.nav-item', '.chat-item', '.ws-tab', '.chip-btn'];
  for (const sel of ROWS) {
    for (const row of document.querySelectorAll(sel)) {
      if (!visible(row) && !row.matches('.window-controls-cluster')) continue;
      const kids = [...row.children].filter((k) => visible(k) && !k.matches('.mode-thumb, .grow'));
      if (kids.length < 1) continue;
      out.rows += 1;
      const rb = row.getBoundingClientRect();
      const cy = rb.top + rb.height / 2;
      for (const k of kids) {
        const kb = k.getBoundingClientRect();
        if (!near(kb.top + kb.height / 2, cy)) out.centre.push(`${name(row)} > ${name(k)}: centre ${(kb.top + kb.height / 2 - cy).toFixed(1)} px off`);
      }
      const cs = getComputedStyle(row);
      if (cs.display.includes('flex') && cs.flexDirection.startsWith('row') && !/space-between|space-around/.test(cs.justifyContent)) {
        for (let i = 1; i < kids.length; i += 1) {
          const gap = kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right;
          const mr = parseFloat(getComputedStyle(kids[i - 1]).marginRight) + parseFloat(getComputedStyle(kids[i]).marginLeft);
          if (gap > 64 || mr > 0) continue; // flexible space (margin auto), not a chosen gap
          if (!SCALE.some((s) => near(gap, s))) out.gap.push(`${name(row)}: ${name(kids[i - 1])} to ${name(kids[i])} is ${gap.toFixed(1)} px`);
        }
      }
    }
  }

  // 2: control tiers
  const CONTROLS = '.icon-btn, .tool-btn, .send-btn, .stop-btn, #side-toggle, .win-control-btn, .mode-btn, .mode-switch, .chip-btn, .side-btn, .nav-item, .chat-item, .ws-tab, .t-x, .av-btn, .av-bar .seg, .av-bar .seg button, .wb-btn';
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (!visible(el)) continue;
    out.controls += 1;
    const h = el.getBoundingClientRect().height;
    if (!TIERS.some((t) => near(h, t))) out.tier.push(`${name(el)} is ${h.toFixed(1)} px tall`);
  }

  // 4: same kind, same size
  for (const sel of ['.nav-item', '.chat-item', '.tool-btn', '.icon-btn', '.win-control-btn', '.ws-tab', '.mode-btn', '.send-btn,.stop-btn']) {
    const els = [...document.querySelectorAll(sel)].filter(visible);
    if (els.length < 2) continue;
    const r0 = els[0].getBoundingClientRect();
    for (const el of els.slice(1)) {
      const r = el.getBoundingClientRect();
      if (!near(r.height, r0.height) || (!sel.startsWith('.nav') && !sel.startsWith('.chat') && !sel.startsWith('.ws-tab') && !near(r.width, r0.width))) out.kind.push(`${sel}: ${r.width.toFixed(0)} x ${r.height.toFixed(0)} against ${r0.width.toFixed(0)} x ${r0.height.toFixed(0)}`);
    }
  }

  // 5: sidebar edges (icon or text, whichever leads the row)
  const side = document.getElementById('sidebar').getBoundingClientRect().left;
  const leftOfText = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) }); const n = w.nextNode(); if (!n) return null; const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().left; };
  const edges = [
    ['nav icon', document.querySelector('.nav-item .icon')?.getBoundingClientRect().left],
    ['recent label', leftOfText(document.querySelector('.side-label'))],
    ['chat row', leftOfText(document.querySelector('.chat-item, .chat-list-empty'))],
    ['status', document.querySelector('#mini-services .svc')?.getBoundingClientRect().left],
    ['wordmark', document.querySelector('.brand .mark')?.getBoundingClientRect().left],
  ];
  for (const [label, left] of edges) if (left != null && !near(left - side, 16, 0.5)) out.edge.push(`${label} starts ${(left - side).toFixed(1)} px from the sidebar edge (want 16)`);
  return out;
});
await browser.close();

const sections = [['Centre lines', result.centre], ['Control heights not in 28, 32, 40', result.tier], ['Gaps not on the scale', result.gap], ['Same kind, different size', result.kind], ['Sidebar left edges', result.edge]];
const total = sections.reduce((n, [, v]) => n + v.length, 0);
let md = `# Spacing audit after\n\nGenerated by \`scripts/measure-ui.mjs\` at 1440 x 900, dark. Checked ${result.rows} rows and ${result.controls} controls.\n\n${total ? `${total} violations.` : 'No violations.'}\n`;
for (const [title, list] of sections) md += `\n## ${title}\n\n${list.length ? list.map((l) => `- ${l}`).join('\n') : 'None.'}\n`;
mkdirSync('docs', { recursive: true });
writeFileSync('docs/spacing-audit-after.md', md);
for (const [title, list] of sections) console.log(`${title}: ${list.length}${list.length ? `\n  ${list.slice(0, 12).join('\n  ')}` : ''}`);
console.log(total ? `\n${total} violations (docs/spacing-audit-after.md)` : '\nmeasure-ui: clean');
process.exit(total ? 1 : 0);
