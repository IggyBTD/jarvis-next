import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, lastAudit } from '../rig.js';
import { registerGoogleTools, mailBody } from '../../server/core/google-tools.js';
import { AuthError } from '../../server/digest/google.js';

const b64 = (s) => Buffer.from(s).toString('base64url');
const ACCOUNTS = [
  { id: 'a1', name: 'Personal', kind: 'Personal', email: 'me@example.com', tokenFile: 'a1.enc' },
  { id: 'a2', name: 'Uni', kind: 'School', email: 'me@uni.edu', tokenFile: 'a2.enc' },
];

// A fake Google: answers by URL path, per account (the token file names the account).
function fakeGoogle(routes) {
  const seen = [];
  const create = ({ tokenFile }) => ({
    endpoints: { calendar: 'cal', gmail: 'gm', drive: 'dr' },
    async api(base, path, as = 'json') {
      seen.push({ tokenFile, url: base + path, as });
      const hit = routes(tokenFile, base + path, as);
      if (hit instanceof Error) throw hit;
      return hit;
    },
  });
  return { create, seen };
}
const setup = (routes, accounts = ACCOUNTS) => {
  const tools = new Map();
  const g = fakeGoogle(routes);
  registerGoogleTools({ register: (d) => tools.set(d.name, d.handler) }, { accounts: { connected: () => accounts }, clientFile: 'client.json', create: g.create, now: () => Date.UTC(2026, 9, 30, 12, 0) });
  return { run: (name, args = {}) => tools.get(name)(args), seen: g.seen };
};

test('calendar: covers every connected account, sorted by start, one account may fail without hiding the other', async () => {
  const { run, seen } = setup((file, url) => {
    if (file === 'a2.enc') return new AuthError('Google refused the request (403: Calendar API has not been used)');
    assert.match(url, /timeMin=2026-10-30T12%3A00%3A00.000Z/);
    assert.match(url, /timeMax=2026-11-06T12%3A00%3A00.000Z/); // 7 days by default
    return { items: [{ summary: 'Dentist', start: { dateTime: '2026-11-02T10:00:00+01:00' }, end: { dateTime: '2026-11-02T11:00:00+01:00' } }, { summary: 'Cancelled', status: 'cancelled', start: { date: '2026-11-01' } }, { summary: 'Holiday', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }] };
  });
  const r = await run('google_calendar_events', {});
  assert.deepEqual(r.items.map((e) => [e.title, e.allDay, e.account]), [['Holiday', true, 'me@example.com'], ['Dentist', false, 'me@example.com']]);
  assert.match(r.errors[0], /me@uni\.edu: Google refused.*remove the account on the Accounts page/);
  assert.equal(seen.length, 2);
});

test('an account can be picked by name, address or type; an unknown one lists what is connected; none connected says so', async () => {
  const { run, seen } = setup(() => ({ items: [] }));
  await run('google_calendar_events', { account: 'school' });
  assert.deepEqual(seen.map((s) => s.tokenFile), ['a2.enc']);
  await assert.rejects(run('google_calendar_events', { account: 'work' }), /No connected account matches "work"\. Connected: me@example\.com, me@uni\.edu/);
  await assert.rejects(setup(() => ({}), []).run('google_gmail_search', {}), /No Google account is connected/);
  const bad = setup(() => new AuthError('Google refused the request (403)'));
  await assert.rejects(bad.run('google_calendar_events', {}), /me@example\.com.*me@uni\.edu/s); // every account failed: an error, not an empty list
});

test('gmail search returns sender, subject, unread flag and preview; read returns the plain text body and attachment names', async () => {
  const { run, seen } = setup((file, url) => {
    if (url.includes('/messages?q=')) { assert.match(url, /q=is%3Aunread/); assert.match(url, /maxResults=5/); return { messages: [{ id: 'm1' }] }; }
    if (url.includes('format=metadata')) return { snippet: 'hello', labelIds: ['UNREAD'], payload: { headers: [{ name: 'From', value: 'Ann <ann@x.com>' }, { name: 'Subject', value: 'Lunch' }, { name: 'Date', value: 'Fri, 30 Oct 2026 10:00:00 +0100' }] } };
    if (file === 'a1.enc') return Object.assign(new Error('Google answered 404'), { status: 404 }); // the message lives in the second account
    return { snippet: 'snip', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Lunch' }], parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('See you at 1.') } }, { mimeType: 'text/html', body: { data: b64('<p>See you at 1.</p>') } }] }, { filename: 'menu.pdf', mimeType: 'application/pdf', body: {} }] } };
  });
  const s = await run('google_gmail_search', { account: 'Personal', query: 'is:unread', max: 5 });
  assert.deepEqual(s.items[0], { account: 'me@example.com', id: 'm1', from: 'Ann <ann@x.com>', subject: 'Lunch', date: 'Fri, 30 Oct 2026 10:00:00 +0100', unread: true, snippet: 'hello' });
  const m = await run('google_gmail_read', { id: 'abc123' });
  assert.equal(m.account, 'me@uni.edu');
  assert.equal(m.body, 'See you at 1.');
  assert.deepEqual(m.attachments, ['menu.pdf']);
  assert.ok(seen.every((x) => !/messages\/abc123.*(send|modify|trash)/.test(x.url)), 'only GETs of read endpoints');
  assert.equal(mailBody({ mimeType: 'text/html', body: { data: b64('<style>p{}</style><p>Hi&nbsp;<b>you</b> &amp; me</p>') } }), 'Hi you & me');
});

test('drive: search escapes the query; read exports Docs as text and Sheets as CSV and refuses binary files', async () => {
  const { run, seen } = setup((file, url, as) => {
    if (url.includes('/files?q=')) return { files: [{ id: 'f1', name: "Ann's notes", mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-29T08:00:00Z', owners: [{ displayName: 'Ann' }] }] };
    if (url.includes('/files/doc1/export')) { assert.match(url, /mimeType=text%2Fplain/); assert.equal(as, 'text'); return 'doc text'; }
    if (url.includes('/files/sheet1/export')) { assert.match(url, /mimeType=text%2Fcsv/); return 'a,b\n1,2'; }
    if (url.includes('/files/doc1?')) return { name: 'Plan', mimeType: 'application/vnd.google-apps.document' };
    if (url.includes('/files/sheet1?')) return { name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' };
    if (url.includes('/files/pic01?')) return { name: 'cat.png', mimeType: 'image/png', size: '1000' };
    throw new Error(`unexpected ${url}`);
  }, [ACCOUNTS[0]]);
  const s = await run('google_drive_search', { query: "Ann's \\ notes" });
  const q = decodeURIComponent(seen[0].url.match(/q=([^&]+)/)[1]);
  assert.equal(q, "trashed = false and (name contains 'Ann\\'s \\\\ notes' or fullText contains 'Ann\\'s \\\\ notes')");
  assert.deepEqual([s.items[0].name, s.items[0].type, s.items[0].owner], ["Ann's notes", 'document', 'Ann']);
  assert.equal((await run('google_drive_read', { id: 'doc1' })).content, 'doc text');
  assert.equal((await run('google_drive_read', { id: 'sheet1' })).content, 'a,b\n1,2');
  const pic = await run('google_drive_read', { id: 'pic01' });
  assert.match(pic.note, /not a text file/);
  assert.ok(!('content' in pic));
});

test('through the router: the tools are defined in actions.json, offered for calendar and mail questions, validated, audited and wrapped as untrusted', async () => {
  const r = await makeRig();
  try {
    registerGoogleTools(r.router, { accounts: { connected: () => [ACCOUNTS[0]] }, clientFile: 'client.json', create: fakeGoogle(() => ({ items: [] })).create });
    const names = r.router.toolDefs('pc', { text: 'Do I have anything coming up in my google calendar?' }).names;
    assert.ok(names.includes('google_calendar_events') && names.includes('google_gmail_search') && names.includes('google_drive_read'));
    assert.ok(!r.router.toolDefs('pc', { text: 'set the volume to 20' }).names.includes('google_calendar_events'));

    const out = await r.router.invoke({ id: 'c1', name: 'google_calendar_events', args: { days: 3 } }, { target: 'pc', source: 'user' });
    assert.equal(out.ok, true);
    assert.match(out.content, /<untrusted/);
    assert.equal(lastAudit(r, 5).at(-1).action, 'google_calendar_events');

    const bad = await r.router.invoke({ id: 'c2', name: 'google_gmail_read', args: { id: '../../x' } }, { target: 'pc', source: 'user' });
    assert.equal(bad.ok, false);
    assert.match(bad.content, /bad arguments/); // an id can never carry a path
    const noTarget = await r.router.invoke({ id: 'c3', name: 'google_gmail_search', args: { machine: 'mac' } }, { target: 'pc', source: 'user' });
    assert.match(noTarget.content, /only the user chooses the computer/);
  } finally { await r.close(); }
});
