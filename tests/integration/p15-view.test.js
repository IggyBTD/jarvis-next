import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, settle } from '../rig.js';
import { request } from '../helpers.js';
import { createHttpHandler } from '../../server/api/http.js';
import http from 'node:http';
import crypto from 'node:crypto';

// The view wiring lives in server/index.js; here the same object is built over the rig's router to test the routes and the audit.
function viewFor(r) {
  const VIEW = { navigate: 'view_navigate', click: 'view_click', type: 'view_type', press: 'view_press', scroll: 'view_scroll', back: 'view_back', forward: 'view_forward', reload: 'view_reload', close: 'close' };
  return {
    async shot(ifNoneMatch) {
      const target = r.target.get();
      const caps = r.router.capabilities(target);
      const st = await caps.browser('GET', '/state').catch(() => null);
      if (!st?.json?.running) return null;
      const s = await caps.browser('GET', '/screenshot');
      const jpeg = Buffer.from(s.json.jpeg, 'base64');
      const etag = `"${target}-${crypto.createHash('sha1').update(jpeg).digest('hex')}"`;
      return ifNoneMatch === etag ? { unchanged: true, etag } : { jpeg, etag, url: st.json.url, target };
    },
    async act(body) {
      const route = Object.hasOwn(VIEW, body?.type) ? VIEW[body.type] : null;
      if (!route) return { status: 'refused', reason: 'unknown action' };
      const { type, ...args } = body;
      await r.audit.append({ component: 'browser-view', source: 'user', target: r.target.get(), action: `view_${type}`, args: type === 'type' ? { characters: String(args.text ?? '').length } : args, tier: 'T1', decision: 'auto', outcome: 'sent' });
      return (await r.router.capabilities(r.target.get()).browser('POST', `/${route}`, args)).json;
    },
  };
}

test('browser view routes: picture with etag, 304 when unchanged, 204 when closed, actions mapped, typed text never logged, follows the target', async () => {
  const r = await makeRig();
  try {
    let running = true;
    const jpeg = Buffer.from('fake-jpeg-bytes').toString('base64');
    for (const m of [r.pc, r.mac]) {
      m.route('GET browser/state', () => ({ status: 200, json: { running, url: `https://${m === r.pc ? 'pc' : 'mac'}.example/` } }));
      m.route('GET browser/screenshot', () => ({ status: 200, json: { status: 'ok', jpeg: m === r.pc ? jpeg : Buffer.from('mac-picture').toString('base64') } }));
      m.route('POST browser/view_click', (b) => ({ status: 200, json: { status: 'ok', got: b } }));
      m.route('POST browser/view_type', () => ({ status: 200, json: { status: 'ok' } }));
    }
    const view = viewFor(r);
    const server = http.createServer(createHttpHandler({ cfg: r.cfg, auth: { check: (h) => ({ ok: h === 'Bearer ui', status: 401, principal: { role: 'ui' } }) }, health: async () => ({}), audit: r.audit, conversations: r.conversations, browserView: view, buildState: async () => ({}) }));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${server.address().port}`;
    const ui = { authorization: 'Bearer ui' };
    try {
      assert.equal((await request(`${url}/api/browser/shot`)).status, 401);
      const a = await request(`${url}/api/browser/shot`, { headers: ui });
      assert.equal(a.status, 200);
      assert.equal(a.headers['content-type'], 'image/jpeg');
      assert.equal(a.text, 'fake-jpeg-bytes');
      assert.equal(decodeURIComponent(a.headers['x-url']), 'https://pc.example/');
      assert.equal((await request(`${url}/api/browser/shot`, { headers: { ...ui, 'if-none-match': a.headers.etag } })).status, 304);

      const click = await request(`${url}/api/browser/do`, { method: 'POST', headers: ui, body: { type: 'click', x: 10, y: 20 } });
      assert.deepEqual(click.json.got, { x: 10, y: 20 });
      await request(`${url}/api/browser/do`, { method: 'POST', headers: ui, body: { type: 'type', text: 'my-secret-password' } });
      assert.equal((await request(`${url}/api/browser/do`, { method: 'POST', headers: ui, body: { type: 'view_click shell' } })).json.status, 'refused');
      assert.equal((await request(`${url}/api/browser/do`, { method: 'POST', headers: ui, body: { type: '__proto__' } })).json.status, 'refused');
      await settle();
      const log = JSON.stringify(r.audit.tail(10));
      assert.ok(!log.includes('my-secret-password'));
      assert.match(log, /"characters":18/);

      r.target.set('mac', { by: 'ui' });
      const b = await request(`${url}/api/browser/shot`, { headers: ui });
      assert.equal(b.text, 'mac-picture');
      assert.equal(r.mac.proxied.filter((p) => p.path === '/screenshot').length, 1);
      running = false;
      assert.equal((await request(`${url}/api/browser/shot`, { headers: ui })).status, 204);
    } finally { server.closeAllConnections?.(); server.close(); }
  } finally { await r.close(); }
});

test('the view routes are the only way a person reaches view_ actions: no model tool has them', async () => {
  const r = await makeRig({ enableAll: true });
  try {
    const { registerBrowserTools } = await import('../../server/core/browser-tools.js');
    registerBrowserTools(r.router);
    const names = r.router.toolDefs('pc', { text: 'open the website example.com', unlocked: new Set(['browser']) }).names;
    assert.ok(names.includes('browser_navigate'));
    assert.ok(!names.some((n) => n.includes('view')));
    assert.match((await r.router.invoke({ id: 'x', name: 'view_click', args: { x: 1, y: 1 } }, { target: 'pc', source: 'user' })).content, /unknown or unavailable/);
  } finally { await r.close(); }
});
