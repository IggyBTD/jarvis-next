import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig } from '../rig.js';
import { registerBrowserTools } from '../../server/core/browser-tools.js';

test('browser tools: a submit challenge goes to the gate with its screenshot; only an approval sends the confirmation', async () => {
  const r = await makeRig();
  try {
    registerBrowserTools(r.router);
    r.pc.route('POST browser/click', () => ({ status: 200, json: { status: 'needs_approval', id: 'ch1', kind: 'submit', element: 'button "Buy now"', url: 'https://shop.example/pay', reason: 'x', screenshot: 'AAAA' } }));
    r.pc.route('POST browser/confirm', () => ({ status: 200, json: { status: 'ok', url: 'https://shop.example/done' } }));
    const ctx = { target: 'pc', source: 'user' };

    const stop = r.approveNext('deny');
    const denied = await r.router.invoke({ id: '1', name: 'browser_click', args: { text: 'Buy now' } }, ctx);
    stop();
    assert.equal(denied.ok, false);
    assert.match(denied.content, /did not approve/);
    const req = r.events.find((e) => e.type === 'gate.request').request;
    assert.deepEqual([req.action, req.tier, req.target], ['browser_submit', 'T3', 'pc']);
    assert.equal(req.screenshot, 'data:image/jpeg;base64,AAAA');
    assert.ok(!r.pc.proxied.some((p) => p.path === '/confirm'));

    const stop2 = r.approveNext('approve');
    const ok = await r.router.invoke({ id: '2', name: 'browser_click', args: { text: 'Buy now' } }, ctx);
    stop2();
    assert.equal(ok.ok, true);
    assert.deepEqual(r.pc.proxied.filter((p) => p.path === '/confirm').map((p) => p.body), [{ id: 'ch1' }]);
    assert.match(ok.content, /<untrusted/);
  } finally { await r.close(); }
});

test('browser tools: captcha and refusals come back as errors; tools appear only for web requests', async () => {
  const r = await makeRig();
  try {
    registerBrowserTools(r.router);
    r.pc.route('POST browser/navigate', () => ({ status: 200, json: { status: 'captcha', message: 'solve it' } }));
    r.pc.route('POST browser/type', () => ({ status: 200, json: { status: 'refused', reason: 'password fields are never typed into' } }));
    const ctx = { target: 'pc', source: 'user' };
    assert.match((await r.router.invoke({ id: 'a', name: 'browser_navigate', args: { url: 'https://example.com' } }, ctx)).content, /solve it/);
    assert.match((await r.router.invoke({ id: 'b', name: 'browser_type', args: { selector: '#pw', text: 'x' } }, ctx)).content, /never typed into/);
    assert.ok(!r.router.toolDefs('pc', { text: 'turn the volume down' }).names.some((n) => n.startsWith('browser_')));
    assert.ok(r.router.toolDefs('pc', { text: 'open the website example.com' }).names.includes('browser_navigate'));
  } finally { await r.close(); }
});
