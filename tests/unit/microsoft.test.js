import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMicrosoftAccounts } from '../../server/accounts/microsoft-accounts.js';
import { registerMicrosoftTools } from '../../server/core/microsoft-tools.js';
import { loadToken } from '../../server/digest/google.js';
import { tmpDir, rmDir } from '../helpers.js';

const ok = (o) => ({ ok: true, status: 200, json: async () => o });

test('microsoft accounts: sign-in link, loopback redirect, stored token, remove', async () => {
  process.env.JARVIS_TOKEN_KEY = 'test-key-at-least-16-chars';
  const dir = tmpDir('msacc');
  try {
    fs.mkdirSync(path.join(dir, 'tokens'));
    const clientFile = path.join(dir, 'tokens', 'client.json');
    fs.writeFileSync(clientFile, JSON.stringify({ client_id: 'cid', tenant: 'uni.edu' }));
    const fetchImpl = async (url, init) => {
      if (String(url).endsWith('/token')) { assert.match(String(init.body), /code_verifier=/); assert.doesNotMatch(String(init.body), /client_secret/); return ok({ access_token: 'acc', refresh_token: 'ref' }); }
      return ok({ mail: 'me@uni.edu' });
    };
    const m = createMicrosoftAccounts({ dataDir: dir, clientFile, fetchImpl, loginBase: (t) => `http://x/${t}` });
    const { id, url } = await m.start({ kind: 'School', name: 'Uni' });
    assert.match(url, /^http:\/\/x\/uni\.edu\/authorize\?/);
    const q = new URL(url).searchParams;
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('scope'), /Mail\.Read/);
    assert.equal(m.list()[0].status, 'pending');
    const back = new URL(q.get('redirect_uri')); back.hostname = '127.0.0.1'; // the browser resolves localhost; the test goes straight to the listener
    assert.equal((await fetch(`${back.origin}/?state=wrong&code=c`)).status, 400);
    assert.equal((await fetch(`${back.origin}/?state=${q.get('state')}&code=c`)).status, 200);
    assert.deepEqual([m.list()[0].status, m.list()[0].email, m.list()[0].kind], ['connected', 'me@uni.edu', 'School']);
    assert.equal(loadToken(path.join(dir, 'tokens', `microsoft-${id}.enc`)).refresh_token, 'ref');
    assert.equal(m.connected()[0].id, id);
    assert.equal(await m.remove(id), true);
    assert.deepEqual(m.list(), []);
  } finally { rmDir(dir); }
});

test('microsoft accounts: no client file gives a clear 409; a refusal from Microsoft is shown', async () => {
  const dir = tmpDir('msacc2');
  try {
    await assert.rejects(createMicrosoftAccounts({ dataDir: dir, clientFile: path.join(dir, 'none.json') }).start({}), (e) => e.status === 409 && /microsoft-client/.test(e.message));
    fs.mkdirSync(path.join(dir, 'tokens'));
    const clientFile = path.join(dir, 'c.json');
    fs.writeFileSync(clientFile, JSON.stringify({ client_id: 'cid' }));
    const m = createMicrosoftAccounts({ dataDir: dir, clientFile, loginBase: () => 'http://x' });
    const { url } = await m.start({});
    const q = new URL(url).searchParams;
    await fetch(`http://127.0.0.1:${new URL(q.get('redirect_uri')).port}/?state=${q.get('state')}&error=access_denied&error_description=${encodeURIComponent('AADSTS90094: admin approval needed')}`);
    assert.match(m.list()[0].error, /admin approval needed/);
  } finally { rmDir(dir); }
});

test('microsoft tools: mail search and read, calendar, rotated refresh token, one account failing', async () => {
  process.env.JARVIS_TOKEN_KEY = 'test-key-at-least-16-chars';
  const dir = tmpDir('mstools');
  try {
    fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ client_id: 'cid' }));
    const accounts = [{ id: 'a1', name: 'Uni', kind: 'School', email: 'me@uni.edu', tokenFile: path.join(dir, 'a1.enc') }];
    const { saveToken } = await import('../../server/digest/google.js');
    saveToken(accounts[0].tokenFile, { refresh_token: 'old' });
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/token')) return ok({ access_token: 'acc', refresh_token: 'new', expires_in: 3600 });
      if (String(url).includes('/calendarView')) return ok({ value: [{ subject: 'Lecture', start: { dateTime: '2026-11-03T09:00:00.0000000' }, end: { dateTime: '2026-11-03T10:00:00.0000000' }, isAllDay: false, location: { displayName: 'Room 4' } }, { subject: 'Gone', isCancelled: true }] });
      if (String(url).includes('/messages/')) return ok({ subject: 'Hi', from: { emailAddress: { name: 'Prof', address: 'p@uni.edu' } }, toRecipients: [], body: { content: 'Hello\n> quoted\nSee you' }, attachments: [{ name: 'a.pdf' }] });
      if (String(url).includes('/messages')) return ok({ value: [{ id: 'm1abcde', subject: 'Hi', from: { emailAddress: { name: 'Prof', address: 'p@uni.edu' } }, receivedDateTime: '2026-11-02T08:00:00Z', isRead: false, bodyPreview: 'Hello' }] });
      return ok({});
    };
    const tools = new Map();
    const { createMicrosoft } = await import('../../server/core/microsoft-tools.js');
    registerMicrosoftTools({ register: (d) => tools.set(d.name, d.handler) }, { accounts: { connected: () => accounts }, clientFile: path.join(dir, 'client.json'), create: (o) => createMicrosoft({ ...o, fetchImpl, loginBase: () => 'http://x' }), now: () => Date.UTC(2026, 10, 2, 12, 0) });

    const cal = await tools.get('microsoft_calendar_events')({});
    assert.deepEqual(cal.items.map((e) => [e.title, e.start, e.location]), [['Lecture', '2026-11-03T09:00:00.000Z', 'Room 4']]);
    assert.equal(loadToken(accounts[0].tokenFile).refresh_token, 'new'); // Microsoft rotates refresh tokens
    const found = await tools.get('microsoft_mail_search')({ query: 'exam' });
    assert.deepEqual([found.items[0].from, found.items[0].unread, found.items[0].id], ['Prof <p@uni.edu>', true, 'm1abcde']);
    assert.ok(urls.some((u) => u.includes('%24search') || u.includes('$search')));
    const mail = await tools.get('microsoft_mail_read')({ id: 'm1abcde' });
    assert.equal(mail.body, 'Hello\nSee you');
    assert.deepEqual(mail.attachments, ['a.pdf']);
    await assert.rejects(tools.get('microsoft_mail_search')({ account: 'work' }), /No connected account matches "work"\. Connected: me@uni\.edu/);
  } finally { rmDir(dir); }
});

test('accounts: the address the Mac browser ended on, pasted, finishes a waiting sign-in (Microsoft and Google); a wrong or old one does not', async () => {
  process.env.JARVIS_TOKEN_KEY = 'test-key-at-least-16-chars';
  const dir = tmpDir('pasteacc');
  try {
    fs.mkdirSync(path.join(dir, 'tokens'));
    const msFile = path.join(dir, 'tokens', 'ms.json');
    const gFile = path.join(dir, 'tokens', 'g.json');
    fs.writeFileSync(msFile, JSON.stringify({ client_id: 'cid' }));
    fs.writeFileSync(gFile, JSON.stringify({ installed: { client_id: 'gid', client_secret: 'sec' } }));
    const fetchImpl = async (url) => (String(url).endsWith('/token') ? ok({ access_token: 'acc', refresh_token: 'ref' }) : ok({ mail: 'me@uni.edu', emailAddress: 'me@gmail.com' }));
    const ms = createMicrosoftAccounts({ dataDir: dir, clientFile: msFile, fetchImpl, loginBase: () => 'http://x/t' });
    const { createGoogleAccounts } = await import('../../server/accounts/google-accounts.js');
    const g = createGoogleAccounts({ dataDir: path.join(dir, 'g'), clientFile: gFile, fetchImpl, endpoints: { token: 'http://x/token', profile: 'http://x/profile', revoke: 'http://x/revoke' }, authUrl: 'http://x/auth' });
    for (const [acc, email] of [[ms, 'me@uni.edu'], [g, 'me@gmail.com']]) {
      const { url } = await acc.start({ kind: 'Personal', name: 'Mine' });
      const state = new URL(url).searchParams.get('state');
      await assert.rejects(acc.complete('not an address'), (e) => e.status === 400);
      await assert.rejects(acc.complete('http://127.0.0.1:1/?state=wrong&code=c'), (e) => e.status === 400 && /No sign-in is waiting/.test(e.message));
      // the Mac's browser ended on its own 127.0.0.1 with the code in the address
      const out = await acc.complete(`http://127.0.0.1:55555/?state=${state}&code=abc&scope=x`);
      assert.equal(out.ok, true);
      assert.deepEqual([acc.list()[0].status, acc.list()[0].email], ['connected', email]);
      await assert.rejects(acc.complete(`http://127.0.0.1:55555/?state=${state}&code=abc`), (e) => e.status === 400); // used once
    }
  } finally { rmDir(dir); }
});
