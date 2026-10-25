import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeRig } from '../rig.js';
import { request } from '../helpers.js';
import { createHttpHandler } from '../../server/api/http.js';

test('saved chats: list shows only chats with a message, open returns the spoken text, rename and pin stick, delete removes the file', async () => {
  const r = await makeRig();
  try {
    const a = r.conversations.create('c-one'); r.conversations.append(a, { role: 'user', content: 'hello' }); r.conversations.append(a, { role: 'tool', content: 'internal' }); r.conversations.append(a, { role: 'assistant', content: 'hi there' });
    r.conversations.create('c-empty');
    const server = http.createServer(createHttpHandler({ cfg: r.cfg, auth: { check: (h) => ({ ok: h === 'Bearer ui', status: 401, principal: { role: 'ui' } }) }, health: async () => ({}), audit: r.audit, conversations: r.conversations, buildState: async () => ({}) }));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${server.address().port}/api/conversations`;
    const h = { authorization: 'Bearer ui' };
    try {
      const list = (await request(url, { headers: h })).json.conversations;
      assert.deepEqual(list.map((c) => c.id), ['c-one']);
      const open = (await request(`${url}/c-one`, { headers: h })).json;
      assert.deepEqual(open.messages.map((m) => m.role), ['user', 'assistant']);
      await request(`${url}/c-one`, { method: 'PATCH', headers: h, body: { title: 'My name', pinned: true } });
      const after = (await request(url, { headers: h })).json.conversations[0];
      assert.equal(after.title, 'My name'); assert.equal(after.pinned, true);
      assert.equal((await request(`${url}/..%2Fx`, { headers: h })).status, 404);
      assert.equal((await request(`${url}/c-one`, { method: 'DELETE', headers: h })).status, 200);
      assert.equal((await request(`${url}/c-one`, { headers: h })).status, 404);
    } finally { server.closeAllConnections?.(); server.close(); }
  } finally { await r.close(); }
});
