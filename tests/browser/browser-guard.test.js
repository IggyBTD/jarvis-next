// Real Chromium against a local fixture site: the guardrails are enforced by the sidecar itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBrowserService } from '../../sidecars/browser-guard/server.js';
import { loadConfig } from '../../server/core/config.js';

const policy = loadConfig({ only: ['policy.json'] }).policy.browser;
const PAGES = {
  '/': '<h1>Home</h1><a href="/about">About us</a> <button type="button" onclick="document.title=\'clicked\'">Show more</button>',
  '/about': '<h1>About</h1>',
  '/form': '<form method="post" action="/done"><input name="q" placeholder="Search"><input type="password" name="pw"><input name="card_number"><button>Buy now</button></form>',
  '/captcha': '<h1>Checking</h1><p>Please verify you are human</p>',
  '/leak': '<img src="http://10.255.255.1/x.png"><script>fetch("http://169.254.169.254/latest").then(()=>document.title="leaked").catch(()=>document.title="blocked")</script><h1>Leak</h1>',
  '/done': '<h1>Submitted</h1>',
};
let server; let svc; let base; const hits = [];
before(async () => {
  server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGES[req.url.split('?')[0]] ?? 'not found'); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  svc = createBrowserService({ token: 't', policy, allowLoopback: true });
});
after(async () => { await svc?.stop(); server?.close(); });

test('navigates, reads and clicks a harmless button', async () => {
  const nav = await svc.handle('navigate', { url: `${base}/` });
  assert.equal(nav.status, 'ok');
  const read = await svc.handle('read');
  assert.match(read.text, /Home/);
  assert.equal((await svc.handle('click', { text: 'Show more' })).status, 'ok');
  assert.equal((await svc.handle('click', { text: 'About us' })).status, 'ok');
  assert.match((await svc.handle('read')).text, /About/);
});

test('private networks are refused as addresses and as subresources of a page', async () => {
  assert.equal((await svc.handle('navigate', { url: 'http://10.0.0.1/' })).status, 'refused');
  assert.equal((await svc.handle('navigate', { url: 'file:///c:/windows/win.ini' })).status, 'refused');
  await svc.handle('navigate', { url: `${base}/leak` });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await svc.handle('read')).title, 'blocked');
});

test('password and payment fields are refused; typing asks once per site; a submit needs a bound single-use confirmation', async () => {
  await svc.handle('navigate', { url: `${base}/form` });
  assert.match((await svc.handle('type', { selector: 'input[name=pw]', text: 'x' })).reason, /never typed/);
  assert.match((await svc.handle('type', { selector: 'input[name=card_number]', text: '4111' })).reason, /never typed/);
  const first = await svc.handle('type', { selector: 'input[name=q]', text: 'hello' });
  assert.equal(first.status, 'needs_approval');
  assert.equal(first.kind, 'type');
  assert.ok(first.screenshot.length > 100);
  assert.equal((await svc.handle('confirm', { id: first.id })).status, 'ok');
  assert.equal((await svc.handle('type', { selector: 'input[name=q]', text: 'again' })).status, 'ok'); // site already approved
  assert.equal((await svc.handle('confirm', { id: first.id })).status, 'refused'); // single use

  hits.length = 0;
  const buy = await svc.handle('click', { text: 'Buy now' });
  assert.equal(buy.status, 'needs_approval');
  assert.equal(buy.kind, 'submit');
  assert.ok(!hits.some((h) => h.startsWith('POST')));
  await svc.handle('navigate', { url: `${base}/` }); // the page changed: the confirmation no longer applies
  assert.match((await svc.handle('confirm', { id: buy.id })).reason, /page changed/);
  assert.ok(!hits.some((h) => h.startsWith('POST')));

  await svc.handle('navigate', { url: `${base}/form` });
  const enter = await svc.handle('press', { key: 'Enter' }).catch(() => null);
  assert.ok(enter === null || enter.status !== 'ok' || !hits.some((h) => h.startsWith('POST')));
  const buy2 = await svc.handle('click', { text: 'Buy now' });
  assert.equal((await svc.handle('confirm', { id: buy2.id })).status, 'ok');
  assert.ok(hits.some((h) => h.startsWith('POST /done')));
  assert.match((await svc.handle('press', { key: 'Delete; rm' })).reason, /not allowed/);
});

test('a CAPTCHA pauses everything until resume', async () => {
  const r = await svc.handle('navigate', { url: `${base}/captcha` });
  assert.equal(r.status, 'captcha');
  assert.equal((await svc.handle('navigate', { url: `${base}/` })).status, 'captcha');
  assert.equal((await svc.handle('click', { text: 'x' })).status, 'captcha');
  await svc.handle('navigate', { url: `${base}/` }).catch(() => {});
  const back = await svc.handle('resume');
  assert.ok(['ok', 'captcha'].includes(back.status));
});
