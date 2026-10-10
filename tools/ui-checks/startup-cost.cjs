// How long the page takes to become ready, and how many requests it makes. Needs the dev server on :5173.
// Median of 5 loads with a warm browser cache cleared each time. Stubbed backend, no LM Studio.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    let requests = 0; let bytes = 0;
    page.on('response', async (r) => { requests++; try { bytes += (await r.body()).length; } catch { /* streamed */ } });
    await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { transformCallback: () => 0, invoke: async () => { throw new Error('stub'); } }; });
    const t0 = Date.now();
    await page.goto('http://localhost:5173', { waitUntil: 'load' });
    // ready = the mesh has drawn and the dock exists
    await page.waitForFunction(() => document.getElementById('dock-mic') && document.getElementById('node-mesh-canvas')?.width > 0, null, { timeout: 30000 });
    const ready = Date.now() - t0;
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
    runs.push({ ready, dcl: nav.dcl, load: nav.load, requests, kb: Math.round(bytes / 1024) });
    await ctx.close();
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[2];
  console.log(`ready ${med('ready')} ms   DOMContentLoaded ${Math.round(med('dcl'))} ms   load ${Math.round(med('load'))} ms   requests ${med('requests')}   transferred ${med('kb')} KB`);
  await browser.close();
})();
