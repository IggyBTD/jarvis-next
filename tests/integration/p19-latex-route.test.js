import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeRig } from '../rig.js';
import { request } from '../helpers.js';
import { createHttpHandler } from '../../server/api/http.js';

test('/api/latex needs the UI token, caps the text, and returns what the model function gives', async () => {
  const r = await makeRig();
  try {
    let seen;
    const latex = async (text) => { seen = text; return { latex: String.raw`\int_0^1 x^2\,dx` }; };
    const server = http.createServer(createHttpHandler({ cfg: r.cfg, auth: { check: (h) => ({ ok: h === 'Bearer ui', status: 401, principal: { role: 'ui' } }) }, health: async () => ({}), audit: r.audit, conversations: r.conversations, latex, buildState: async () => ({}) }));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${server.address().port}/api/latex`;
    try {
      assert.equal((await request(url, { method: 'POST', body: { text: 'x' } })).status, 401);
      const ok = await request(url, { method: 'POST', headers: { authorization: 'Bearer ui' }, body: { text: 'y'.repeat(900) } });
      assert.equal(ok.json.latex, String.raw`\int_0^1 x^2\,dx`);
      assert.equal(seen.length, 500);
    } finally { server.closeAllConnections?.(); server.close(); }
  } finally { await r.close(); }
});
