// The PC-Mac clipboard copy (ws.js clipboard.copy, /clip in the app): both halves go through the router as the person's own press,
// nothing asks for T2, the text lands on the other machine whole, and it never reaches the audit log, not even as a hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, startApi, wsClient } from '../rig.js';
import { createPolicy } from '../../server/core/policy.js';
import { clipboardText, CLIP_MAX } from '../../agent/registry/common.js';

const SECRET = 'hunter2-pässwörd ✓';

async function rigWs() {
  const r = await makeRig();
  const api = await startApi(r);
  const c = wsClient(api.wsUrl, { token: api.uiToken });
  await c.opened;
  c.send({ type: 'hello', clientId: 'clip' });
  await c.next((m) => m.type === 'state');
  return { r, c, async close() { c.ws.terminate(); await api.close(); await r.close(); } };
}

test('clipboard: the PC text lands on the Mac whole, without an approval, and stays out of the audit', async () => {
  const t = await rigWs();
  try {
    t.r.pc.result('get_clipboard', () => ({ ok: true, data: { text: SECRET } }));
    t.c.send({ type: 'clipboard.copy', id: 'k1', from: 'pc', to: 'mac' });
    const res = await t.c.next((m) => m.type === 'clipboard.result');
    assert.equal(res.ok, true, res.message);
    assert.match(res.message, /Copied 18 characters from the PC to the Mac/);
    assert.ok(!JSON.stringify(res).includes(SECRET)); // the text never comes back to the client
    assert.deepEqual(t.r.mac.calls.filter((x) => !x.dryRun).map((x) => [x.name, x.args]), [['set_clipboard', { text: SECRET }]]);
    assert.equal(t.c.messages.filter((m) => m.type === 'gate.request').length, 0);
    const log = JSON.stringify(t.r.audit.tail(20));
    assert.ok(!log.includes('hunter2'), 'the clipboard text is not in the audit');
    const set = t.r.audit.tail(20).find((l) => l.action === 'set_clipboard' && l.outcome === 'ok');
    assert.equal(set.source, 'click');
    assert.equal(set.args.text, '[clipboard, 18 chars]');
  } finally { await t.close(); }
});

test('clipboard: an over-long, empty or same-machine copy is refused and nothing is written', async () => {
  const t = await rigWs();
  try {
    t.r.pc.result('get_clipboard', () => ({ ok: true, data: { text: 'x'.repeat(CLIP_MAX), truncated: true, chars: 50_000 } }));
    t.c.send({ type: 'clipboard.copy', id: 'k2', from: 'pc', to: 'mac' });
    assert.match((await t.c.next((m) => m.id === 'k2')).message, /too long.*50000/);
    t.r.pc.result('get_clipboard', () => ({ ok: true, data: { text: '' } }));
    t.c.send({ type: 'clipboard.copy', id: 'k3', from: 'pc', to: 'mac' });
    assert.match((await t.c.next((m) => m.id === 'k3')).message, /no text/);
    t.c.send({ type: 'clipboard.copy', id: 'k4', from: 'mac', to: 'mac' });
    assert.equal((await t.c.next((m) => m.id === 'k4')).ok, false);
    assert.equal(t.r.mac.calls.filter((x) => x.name === 'set_clipboard').length, 0);
  } finally { await t.close(); }
});

test('clipboard: a press is approval for T0 to T2 only; T3 and a policy.json ask still ask', () => {
  const modes = { chat: { T0: 'auto', T1: 'auto', T2: 'ask', T3: 'ask' }, scheduled: { T0: 'auto', T1: 'auto', T2: 'deny', T3: 'deny' } };
  const p = createPolicy({ modes, actions: { asked: 'ask', banned: 'deny' } });
  assert.equal(p.decide({ name: 'get_clipboard', tier: 'T2', source: 'click' }).mode, 'auto');
  assert.equal(p.decide({ name: 'get_clipboard', tier: 'T2', source: 'user' }).mode, 'ask'); // the model's own call still asks
  assert.equal(p.decide({ name: 'x', tier: 'T3', source: 'click' }).mode, 'ask');
  assert.equal(p.decide({ name: 'asked', tier: 'T1', source: 'click' }).mode, 'ask');
  assert.equal(p.decide({ name: 'banned', tier: 'T1', source: 'click' }).mode, 'deny');
});

test('clipboard: the agent returns the text whole up to the limit, and marks a longer one', () => {
  assert.deepEqual(clipboardText('a\nb'), { text: 'a\nb' });
  const long = clipboardText('y'.repeat(CLIP_MAX + 5));
  assert.equal(long.truncated, true);
  assert.equal(long.chars, CLIP_MAX + 5);
  assert.equal(long.text.length, CLIP_MAX);
});
