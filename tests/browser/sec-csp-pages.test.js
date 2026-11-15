// Security fix F2-1: the built app (dist/) served by the server under its CSP loads without a CSP violation, desktop and phone page.
// Skipped when dist/ is not built. Run alone: node --test --test-force-exit tests/browser/sec-csp-pages.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeRig, startApi } from '../rig.js';
import { ROOT } from '../../server/core/config.js';

test('F2-1: the served app loads under its CSP with no violation', { skip: !fs.existsSync(path.join(ROOT, 'dist', 'index.html')) && 'dist/ is not built' }, async () => {
  const r = await makeRig();
  const api = await startApi(r);
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  try {
    for (const p of ['/', '/mobile.html']) {
      const page = await browser.newPage();
      // as on the Mac and the phone: the page talks to the server that served it (server mode)
      await page.addInitScript(([url, token]) => { localStorage.setItem('jarvis.server', JSON.stringify({ enabled: true, url, token })); localStorage.setItem('jarvis.mobile', JSON.stringify({ token })); }, [api.wsUrl, api.uiToken]);
      const violations = [];
      page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
      const res = await page.goto(`${api.url}${p}`);
      assert.match(res.headers()['content-security-policy'] ?? '', /img-src 'self' data: blob:/);
      await page.waitForTimeout(2500);
      assert.deepEqual(violations, [], `${p}: ${violations.join(' | ')}`);
      await page.close();
    }
  } finally { await browser.close(); await api.close(); await r.close(); }
});
