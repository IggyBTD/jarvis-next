import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGoogleAccounts } from '../../server/accounts/google-accounts.js';
import { loadToken } from '../../server/digest/google.js';
import { tmpDir, rmDir } from '../helpers.js';

test('google accounts: consent link, loopback redirect, stored token, remove', async () => {
  process.env.JARVIS_TOKEN_KEY = 'test-key-at-least-16-chars';
  const dir = tmpDir('gacc');
  try {
    fs.mkdirSync(path.join(dir, 'tokens'));
    const clientFile = path.join(dir, 'tokens', 'client.json');
    fs.writeFileSync(clientFile, JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } }));
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(String(url));
      const body = (o) => ({ ok: true, json: async () => o });
      if (String(url).endsWith('/token')) { assert.match(String(init.body), /code_verifier=/); return body({ access_token: 'acc', refresh_token: 'ref' }); }
      if (String(url).endsWith('/profile')) return body({ emailAddress: 'me@example.com' });
      return body({});
    };
    const g = createGoogleAccounts({ dataDir: dir, clientFile, fetchImpl, endpoints: { token: 'http://x/token', profile: 'http://x/profile', revoke: 'http://x/revoke' } });
    const { id, url } = await g.start({ kind: 'School', name: 'Uni' });
    const q = new URL(url).searchParams;
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('scope'), /gmail\.readonly/);
    assert.equal(g.list()[0].status, 'pending');

    assert.equal((await fetch(`${q.get('redirect_uri')}/?state=wrong&code=c`)).status, 400); // wrong state is refused
    assert.equal((await fetch(`${q.get('redirect_uri')}/?state=${q.get('state')}&code=c`)).status, 200);
    const [a] = g.list();
    assert.deepEqual([a.status, a.email, a.kind, a.name], ['connected', 'me@example.com', 'School', 'Uni']);
    assert.equal(loadToken(path.join(dir, 'tokens', `google-${id}.enc`)).refresh_token, 'ref');

    assert.equal(await g.remove(id), true);
    assert.deepEqual(g.list(), []);
    assert.ok(calls.some((c) => c.startsWith('http://x/revoke')));
    assert.equal(fs.existsSync(path.join(dir, 'tokens', `google-${id}.enc`)), false);
  } finally { rmDir(dir); }
});

test('google accounts: no client file gives a clear 409', async () => {
  const dir = tmpDir('gacc2');
  try {
    const g = createGoogleAccounts({ dataDir: dir, clientFile: path.join(dir, 'none.json') });
    await assert.rejects(g.start({}), (e) => e.status === 409 && /client JSON/.test(e.message));
  } finally { rmDir(dir); }
});
