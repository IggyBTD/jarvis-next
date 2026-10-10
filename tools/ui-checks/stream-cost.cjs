// What re-rendering a streaming reply costs as it grows: the chat redraws the whole reply on every
// animation frame while it streams. Times renderMarkdown + innerHTML on a growing markdown text.
// Needs the dev server on :5173.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { transformCallback: () => 0, invoke: async () => { throw new Error('stub'); } }; });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const rows = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/src/core/markdown.js'));
    const { renderMarkdown } = await import(url);
    const block = (i) => `## Section ${i}\n\nSome **bold** text with \`inline code\`, a list:\n\n- item one\n- item two with a [link](https://example.com)\n\n\`\`\`js\nfunction f${i}(a, b) {\n  const c = a + b * ${i};\n  return c > 10 ? c : -c;\n}\n\`\`\`\n\nAnd a formula $x_${i}^2 + y^2 = z^2$ in the middle of a sentence.\n\n`;
    const host = document.createElement('div'); document.body.append(host);
    const out = [];
    for (const blocks of [2, 8, 20, 40]) {
      const text = Array.from({ length: blocks }, (_, i) => block(i)).join('');
      const times = [];
      for (let i = 0; i < 7; i++) { const t = performance.now(); host.innerHTML = `<div class="md">${renderMarkdown(text)}</div>`; times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      out.push(`${String(text.length).padStart(6)} chars: ${times[3].toFixed(1)} ms per redraw`);
    }
    host.remove();
    return out;
  });
  console.log(rows.join('\n'));
  await browser.close();
})();
