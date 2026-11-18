// Security fix F4-3: the browser guard challenges Space and Enter on any focused control, keeps the person's browser and the model's
// apart (separate contexts, so separate cookie jars), checks WebSockets like every other request, and pins DNS through its own proxy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createBrowserService } from '../../sidecars/browser-guard/server.js';
import { loadConfig } from '../../server/core/config.js';

const policy = loadConfig({ only: ['policy.json'] }).policy.browser;
const PAGES = {
  '/form': '<form method="post" action="/done"><input name="q" placeholder="Search"><div role="button" tabindex="0" onkeydown="if(event.key===\' \')this.closest(\'form\').submit()">Go</div></form>',
  '/login': '<h1>Login</h1><script>document.cookie="session=person-secret; path=/"</script>',
  '/whoami': '<h1>Who</h1><script>document.title = document.cookie || "nobody"</script>',
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

test('F4-3: Tab then Space on a fixture form returns needs_approval, and nothing is posted', async () => {
  assert.equal((await svc.handle('navigate', { url: `${base}/form` })).status, 'ok');
  hits.length = 0;
  await svc.handle('press', { key: 'Tab' });
  await svc.handle('press', { key: 'Tab' });
  const space = await svc.handle('press', { key: 'Space' });
  assert.equal(space.status, 'needs_approval', JSON.stringify(space).slice(0, 200));
  const enter = await svc.handle('press', { key: 'Enter' });
  assert.equal(enter.status, 'needs_approval');
  assert.ok(!hits.some((h) => h.startsWith('POST')), hits.join(', '));
});

test('F4-3: the person signs in in the view; the model\'s browser does not have that session', async () => {
  assert.equal((await svc.handle('view_navigate', { url: `${base}/login` })).status, 'ok');
  await svc.handle('view_navigate', { url: `${base}/whoami` });
  assert.equal((await svc.handle('view_state')).url, `${base}/whoami`);
  await svc.handle('navigate', { url: `${base}/whoami` });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await svc.handle('read')).title, 'nobody', 'the model sees no cookie of the person');
  assert.ok((await svc.handle('view_screenshot')).jpeg.length > 100, 'the view has its own screenshot');
});

test('F4-3: DNS is pinned: the browser reaches a name only at the address the guard resolved and checked', async () => {
  // Chromium cannot resolve fixture.test itself; the page loads only because the pinning proxy resolved it (to the fixture) and
  // connected there. A name that answers private is refused by the same resolver.
  const answers = { 'fixture.test': [{ address: '127.0.0.1', family: 4 }], 'rebind.test': [{ address: '10.0.0.9', family: 4 }] };
  const pinned = createBrowserService({ token: 't', policy, allowLoopback: true, resolve: async (h) => answers[h] ?? [] });
  try {
    const port = new URL(base).port;
    const ok = await pinned.handle('navigate', { url: `http://fixture.test:${port}/whoami` });
    assert.equal(ok.status, 'ok', JSON.stringify(ok));
    assert.match((await pinned.handle('read')).text, /Who/);
    assert.equal((await pinned.handle('navigate', { url: `http://rebind.test:${port}/` })).status, 'refused');
  } finally { await pinned.stop(); }
});

test('F4-3: a WebSocket is checked like any other request: one to a denied host never connects', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let connected = 0;
  wss.on('connection', () => { connected += 1; });
  await new Promise((ok) => wss.once('listening', ok));
  const wsPort = wss.address().port;
  PAGES['/ws'] = `<h1>WS</h1><script>const w = new WebSocket("ws://localhost:${wsPort}/x"); w.onopen = () => { document.title = "open"; }; w.onerror = w.onclose = () => { document.title = "closed"; };</script>`;
  const strict = createBrowserService({ token: 't', policy: { ...policy, denyDomains: [...(policy.denyDomains ?? []), 'localhost'] }, allowLoopback: true });
  try {
    assert.equal((await strict.handle('navigate', { url: `${base}/ws` })).status, 'ok');
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await strict.handle('read')).title, 'closed');
    assert.equal(connected, 0);
  } finally { await strict.stop(); wss.close(); }
});
