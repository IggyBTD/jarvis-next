// Frame stalls while a long reply streams: the chat's own redraw loop (paint every frame vs. paint
// at most as often as it can afford) run on a 10 s simulated stream of ~12K characters with code and
// math, counting frames longer than 24 ms. Needs the dev server on :5173.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { transformCallback: () => 0, invoke: async () => { throw new Error('stub'); } }; });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/src/core/markdown.js'));
    const { renderMarkdown } = await import(url);
    const block = (i) => `## Section ${i}\n\nSome **bold** text with \`inline code\`, a list:\n\n- item one\n- item two with a [link](https://example.com)\n\n\`\`\`js\nfunction f${i}(a, b) {\n  const c = a + b * ${i};\n  return c > 10 ? c : -c;\n}\n\`\`\`\n\nAnd a formula $x_${i}^2 + y^2 = z^2$ in the middle of a sentence.\n\n`;
    const full = Array.from({ length: 28 }, (_, i) => block(i)).join('');
    const host = document.createElement('div'); document.body.append(host);
    const run = (throttled) => new Promise((resolve) => {
      let shown = 0; let paintCost = 0; let lastPaint = 0; let last = performance.now(); let long = 0; let frames = 0; let paints = 0; let worst = 0;
      const t0 = last;
      const tick = (now) => {
        const dt = now - last; last = now; frames++; if (dt > 24) long++; worst = Math.max(worst, dt);
        shown = Math.min(full.length, Math.round(((now - t0) / 10000) * full.length)); // the text that has "arrived" so far
        const due = !throttled || performance.now() - lastPaint >= paintCost * 4;
        if (due) { const s = performance.now(); host.innerHTML = `<div class="md">${renderMarkdown(full.slice(0, shown))}</div>`; host.offsetHeight; paintCost = performance.now() - s; lastPaint = performance.now(); paints++; }
        if (now - t0 < 10000) requestAnimationFrame(tick); else resolve({ throttled, frames, paints, stalls: long, worstMs: Math.round(worst) });
      };
      requestAnimationFrame(tick);
    });
    const a = await run(false);
    const b = await run(true);
    host.remove();
    return [a, b];
  });
  for (const r of res) console.log(`${r.throttled ? 'paint when affordable' : 'paint every frame    '}  frames ${r.frames}  paints ${r.paints}  stalls (>24 ms) ${r.stalls}  worst frame ${r.worstMs} ms`);
  await browser.close();
})();
