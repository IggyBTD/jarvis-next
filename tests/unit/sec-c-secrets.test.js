// Secret storage and child environments (docs/security/secrets-design.md). Fake values, temp dirs and a fake program runner:
// nothing here calls the real DPAPI, Credential Manager or Keychain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, rmDir } from '../helpers.js';
import { childEnv, isSecretName } from '../../shared/child-env.js';
import { createSecretStore, migrateFile, secretOrEnv, validName } from '../../shared/secret-store.js';

const VALUE = 'fake-value-Zq7 "quoted" $x `tick` ü';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const flip = (buf) => Buffer.from(buf.map((x) => x ^ 0x5a));

// Stands in for powershell.exe: "protects" by flipping bits and prefixing the name, so a blob only opens under its own name.
function fakeDpapi() {
  const calls = [];
  const runProgram = async (spec) => {
    calls.push(spec);
    const [name, data] = String(spec.stdin).split('\n');
    const script = spec.args.at(-1);
    if (script.includes('::Protect(')) return { code: 0, stdout: `${flip(Buffer.from(`${name}|${Buffer.from(data, 'base64').toString('utf8')}`)).toString('base64')}\r\n`, stderr: '' };
    const plain = flip(Buffer.from(data, 'base64')).toString('utf8');
    return plain.startsWith(`${name}|`) ? { code: 0, stdout: `${b64(plain.slice(name.length + 1))}\r\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'bad data' };
  };
  return { calls, runProgram };
}

// Stands in for /usr/bin/security with an in-memory keychain.
function fakeKeychain() {
  const calls = [];
  const items = new Map();
  const runProgram = async (spec) => {
    calls.push(spec);
    const arg = (list, flag) => list[list.indexOf(flag) + 1];
    if (spec.args[0] === '-i') {
      const words = String(spec.stdin).trim().split(' ');
      if (words[0] === 'add-generic-password') items.set(arg(words, '-s'), arg(words, '-w'));
      return { code: 0, stdout: '', stderr: '' };
    }
    const svc = arg(spec.args, '-s');
    if (!items.has(svc)) return { code: 44, stdout: '', stderr: 'could not be found' };
    if (spec.args[0] === 'delete-generic-password') items.delete(svc);
    return { code: 0, stdout: spec.args.includes('-w') ? `${items.get(svc)}\n` : 'keychain: "login"\n', stderr: '' };
  };
  return { calls, items, runProgram };
}

test('childEnv keeps what a program needs and drops everything else', () => {
  const base = { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', TEMP: 't', HOME: 'h', JARVIS_TOKEN_KEY: 'k', OPENCODE_SERVER_PASSWORD: 'p', GITHUB_TOKEN: 'g', MY_APP_SETTING: 'x', XDG_SESSION_ID: '1', HTTPS_PROXY: 'http://u:p@proxy' };
  const env = childEnv(base);
  assert.deepEqual(env, { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', TEMP: 't', HOME: 'h' });
  assert.notEqual(env, base);
  assert.notEqual(childEnv(base, {}), base);
  assert.deepEqual(childEnv(null, undefined), {});
});

test('childEnv: a secret-looking extra is dropped unless the caller names it', () => {
  const extra = { OPENCODE_SERVER_PASSWORD: 'p', OPENCODE_DISABLE_LSP_DOWNLOAD: '1', API_KEY: 'k', NPM_TOKEN: 'n', AWS_REGION: 'r', session_cookie: 'c', FAKE_OPENCODE_LOG: 'f', PORT: 4096, GONE: undefined, JARVIS_A_text: 'hello' };
  assert.deepEqual(childEnv({ PATH: 'p' }, extra), { PATH: 'p', FAKE_OPENCODE_LOG: 'f', PORT: '4096' });
  const env = childEnv({ PATH: 'p' }, extra, { allowSecret: ['opencode_server_password', /^OPENCODE_DISABLE_/, /^JARVIS_A_/g] });
  assert.deepEqual(env, { PATH: 'p', OPENCODE_SERVER_PASSWORD: 'p', OPENCODE_DISABLE_LSP_DOWNLOAD: '1', FAKE_OPENCODE_LOG: 'f', PORT: '4096', JARVIS_A_text: 'hello' });
  // allowSecret is about extras only: the same name in the parent's environment never gets through
  assert.deepEqual(childEnv({ OPENCODE_SERVER_PASSWORD: 'old', PATH: 'p' }, {}, { allowSecret: ['OPENCODE_SERVER_PASSWORD'] }), { PATH: 'p' });
  // an extra replaces the parent's variable whatever the letter case
  assert.deepEqual(childEnv({ Path: 'a' }, { PATH: 'b' }), { PATH: 'b' });
  assert.deepEqual(childEnv({}, { 'A=B': '1', OK: 'a\0b' }), {});
});

test('isSecretName', () => {
  for (const n of ['JARVIS_TOKEN_KEY', 'OPENCODE_CONFIG_CONTENT', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'AWS_PROFILE', 'GITHUB_SHA', 'NPM_TOKEN', 'PGPASSWORD', 'MYSQL_PWD', 'db_password', 'SSH_AUTH_SOCK', 'COOKIE_JAR', 'GOOGLE_APPLICATION_CREDENTIALS', 'SESSIONNAME', 42, null]) assert.equal(isSecretName(n), true, String(n));
  for (const n of ['PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'HOME', 'USERPROFILE', 'LANG', 'PWD', 'NODE_EXTRA_CA_CERTS', 'COMPUTERNAME']) assert.equal(isSecretName(n), false, n);
});

test('win32: the value is never on the command line, in the script text or in the child environment', async () => {
  const dir = tmpDir('sec');
  try {
    const { calls, runProgram } = fakeDpapi();
    const store = createSecretStore({ dir, platform: 'win32', runProgram });
    assert.equal(store.kind, 'dpapi');
    assert.equal(store.protected, true);
    assert.equal(await store.has('pc-token'), false);
    assert.deepEqual(await store.set('pc-token', VALUE), { ok: true });
    assert.deepEqual(await store.set('other', 'another-fake-value'), { ok: true });
    assert.equal(await store.get('pc-token'), VALUE);
    assert.equal(await store.has('pc-token'), true);
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.file, 'powershell.exe');
      assert.deepEqual(c.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(c.env, undefined);
      for (const form of [VALUE, b64(VALUE), hex(VALUE), 'another-fake-value', b64('another-fake-value')]) assert.ok(!c.args.join(' ').includes(form));
    }
    assert.equal(calls[0].args[3], calls[1].args[3], 'the script text is fixed, whatever the value');
    assert.ok(calls[0].stdin.includes(b64(VALUE)), 'the value goes in on stdin');
    const onDisk = fs.readFileSync(path.join(dir, 'pc-token.dpapi'), 'utf8');
    for (const form of [VALUE, b64(VALUE), hex(VALUE)]) assert.ok(!onDisk.includes(form), 'only the protected blob is on disk');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['other.dpapi', 'pc-token.dpapi']);
    assert.deepEqual(await store.remove('pc-token'), { ok: true });
    assert.equal(await store.get('pc-token'), null);
  } finally { rmDir(dir); }
});

test('win32: missing, damaged, swapped or unreadable entries are null', async () => {
  const dir = tmpDir('sec');
  try {
    const { calls, runProgram } = fakeDpapi();
    const store = createSecretStore({ dir, platform: 'win32', runProgram });
    assert.equal(await store.get('nothing'), null);
    assert.equal(calls.length, 0, 'no program is started for a missing entry');
    await store.set('a', VALUE);
    fs.copyFileSync(path.join(dir, 'a.dpapi'), path.join(dir, 'b.dpapi'));
    assert.equal(await store.get('b'), null, 'a blob does not open under another name');
    fs.writeFileSync(path.join(dir, 'a.dpapi'), 'not base64 !!');
    assert.equal(await store.get('a'), null);
    const broken = createSecretStore({ dir, platform: 'win32', runProgram: async () => { throw new Error('cannot start'); } });
    fs.writeFileSync(path.join(dir, 'c.dpapi'), 'QUJD');
    assert.equal(await broken.get('c'), null);
    assert.ok((await broken.set('c', VALUE)).error);
    assert.equal(fs.readFileSync(path.join(dir, 'c.dpapi'), 'utf8'), 'QUJD', 'a failed write leaves the old entry');
    const garbage = createSecretStore({ dir, platform: 'win32', runProgram: async () => ({ code: 0, stdout: 'Access is denied.', stderr: '' }) });
    assert.equal(await garbage.get('c'), null);
    assert.ok((await garbage.set('c', VALUE)).error);
    // no runner at all: the store stays the protected kind and refuses, it does not quietly become a plain file
    const none = createSecretStore({ dir, platform: 'win32' });
    assert.equal(none.kind, 'dpapi');
    assert.equal(await none.get('c'), null);
    assert.ok((await none.set('c', VALUE)).error);
  } finally { rmDir(dir); }
});

test('darwin: the value reaches the Keychain on stdin only', async () => {
  const dir = tmpDir('sec');
  try {
    const { calls, items, runProgram } = fakeKeychain();
    const store = createSecretStore({ dir, platform: 'darwin', runProgram });
    assert.equal(store.kind, 'keychain');
    assert.equal(await store.has('mac-token'), false);
    assert.equal(await store.get('mac-token'), null);
    assert.deepEqual(await store.set('mac-token', VALUE), { ok: true });
    assert.equal(await store.get('mac-token'), VALUE);
    assert.equal(await store.has('mac-token'), true);
    assert.equal(items.get('jarvis.mac-token'), hex(VALUE));
    const add = calls.filter((c) => c.stdin !== undefined);
    assert.equal(add.length, 1);
    assert.deepEqual(add[0].args, ['-i'], 'the add command is read from stdin, so argv holds nothing');
    assert.equal(add[0].stdin, `add-generic-password -U -a jarvis -s jarvis.mac-token -w ${hex(VALUE)}\n`);
    for (const c of calls) {
      assert.equal(c.file, 'security');
      assert.equal(c.env, undefined);
      for (const form of [VALUE, hex(VALUE), b64(VALUE)]) assert.ok(!c.args.join(' ').includes(form));
    }
    assert.deepEqual(fs.readdirSync(dir), [], 'nothing is written to disk');
    assert.deepEqual(await store.remove('mac-token'), { ok: true });
    assert.deepEqual(await store.remove('mac-token'), { ok: true });
    assert.equal(await store.get('mac-token'), null);
    // a locked keychain or a security program that does nothing: set reports the failure, get is null, has does not know
    const locked = createSecretStore({ dir, platform: 'darwin', runProgram: async () => ({ code: 36, stdout: '', stderr: 'interaction not allowed' }) });
    assert.ok((await locked.set('x', VALUE)).error);
    assert.equal(await locked.get('x'), null);
    assert.equal(await locked.has('x'), null);
    const odd = createSecretStore({ dir, platform: 'darwin', runProgram: async () => ({ code: 0, stdout: 'not hex\n', stderr: '' }) });
    assert.equal(await odd.get('x'), null);
  } finally { rmDir(dir); }
});

test('fallback: a 0600 file that says it is unprotected', async () => {
  const dir = tmpDir('sec');
  try {
    const sub = path.join(dir, 'secrets');
    for (const store of [createSecretStore({ dir: sub, platform: 'linux' }), createSecretStore({ dir: sub, platform: 'win32', fallbackOnly: true, runProgram: () => assert.fail('no program in fallback') })]) {
      assert.equal(store.kind, 'file');
      assert.equal(store.protected, false);
      assert.equal(await store.get('k'), null);
      assert.equal(await store.has('k'), false);
      assert.deepEqual(await store.set('k', VALUE), { ok: true });
      assert.equal(await store.get('k'), VALUE);
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(sub, 'k.secret')).mode & 0o777, 0o600);
      assert.deepEqual(await store.remove('k'), { ok: true });
      assert.equal(await store.get('k'), null);
    }
    fs.writeFileSync(path.join(sub, 'empty.secret'), '');
    assert.equal(await createSecretStore({ dir: sub, fallbackOnly: true }).get('empty'), null);
  } finally { rmDir(dir); }
});

test('names outside the pattern and odd values are refused, and nothing throws', async () => {
  const dir = tmpDir('sec');
  try {
    const { calls, runProgram } = fakeDpapi();
    const store = createSecretStore({ dir, platform: 'win32', runProgram });
    for (const name of ['', '../ui', 'a/b', 'a\\b', 'UI', '.hidden', 'a..b', 'x'.repeat(65), 'a b', 'a;b', null, undefined, 7, {}]) {
      assert.equal(validName(name), false);
      assert.equal(await store.get(name), null);
      assert.equal(await store.has(name), null);
      assert.ok((await store.set(name, VALUE)).error);
      assert.ok((await store.remove(name)).error);
    }
    for (const value of ['', null, undefined, 5, {}, 'a\0b', 'x'.repeat(1025)]) assert.ok((await store.set('ok', value)).error);
    assert.equal(calls.length, 0);
    assert.deepEqual(fs.readdirSync(dir), []);
    for (const s of [createSecretStore(), createSecretStore({ dir: 5, fallbackOnly: true }), createSecretStore({ dir: '', platform: 'darwin', runProgram })]) {
      assert.equal(await s.get('a'), null);
      assert.equal(await s.has('a'), null);
      assert.ok((await s.set('a', VALUE)).error);
      assert.ok((await s.remove('a')).error);
    }
    const r = await store.set('ok', 'x'.repeat(1025));
    assert.ok(!JSON.stringify(r).includes('xxxx'), 'an error never carries the value');
  } finally { rmDir(dir); }
});

test('migrateFile moves a plain token file into the store and leaves the file', async () => {
  const dir = tmpDir('sec');
  try {
    const { runProgram } = fakeDpapi();
    const store = createSecretStore({ dir: path.join(dir, 'secrets'), platform: 'win32', runProgram });
    const file = path.join(dir, 'pc.token');
    fs.writeFileSync(file, 'fake-token-0123456789abcdef\n');
    assert.deepEqual(await migrateFile(store, 'pc-token', file), { ok: true, migrated: true });
    assert.equal(await store.get('pc-token'), 'fake-token-0123456789abcdef');
    assert.equal(fs.readFileSync(file, 'utf8'), 'fake-token-0123456789abcdef\n', 'the old file is untouched');
    // a second run changes nothing, even when the file has changed since: the store wins
    fs.writeFileSync(file, 'something-else-entirely\n');
    assert.deepEqual(await migrateFile(store, 'pc-token', file), { ok: true, migrated: false });
    assert.equal(await store.get('pc-token'), 'fake-token-0123456789abcdef');
    assert.ok((await migrateFile(store, 'mac-token', path.join(dir, 'missing.token'))).error);
    assert.ok((await migrateFile(store, '../bad', file)).error);
    fs.writeFileSync(path.join(dir, 'empty.token'), '\n');
    assert.ok((await migrateFile(store, 'empty', path.join(dir, 'empty.token'))).error);
    assert.ok((await migrateFile(null, 'x', file)).error);
  } finally { rmDir(dir); }
});

test('secretOrEnv: the store first, then the variable (saved on first use), a new key only when nothing is there for certain', async () => {
  const dir = tmpDir('sec');
  try {
    const { runProgram } = fakeDpapi();
    const store = createSecretStore({ dir, platform: 'win32', runProgram });
    const ENV = 'fake-key-from-the-environment';
    assert.deepEqual(await secretOrEnv(store, 'google-token-key', undefined), { value: null, source: null, stored: false });
    assert.deepEqual(await secretOrEnv(store, 'google-token-key', 'short'), { value: null, source: null, stored: false });
    assert.deepEqual(await secretOrEnv(store, 'google-token-key', ENV), { value: ENV, source: 'env', stored: true });
    assert.deepEqual(await secretOrEnv(store, 'google-token-key', undefined), { value: ENV, source: 'store', stored: true });
    assert.deepEqual(await secretOrEnv(store, 'google-token-key', 'a-different-value-in-the-env'), { value: ENV, source: 'store', stored: true });
    // the variable still works when the store cannot be written
    const dead = createSecretStore({ dir, platform: 'win32', runProgram: async () => ({ code: 1, stdout: '', stderr: '' }) });
    assert.deepEqual(await secretOrEnv(dead, 'other-key', ENV), { value: ENV, source: 'env', stored: false });
    const made = await secretOrEnv(store, 'fresh-key', undefined, { create: true });
    assert.equal(made.source, 'new');
    assert.match(made.value, /^[0-9a-f]{64}$/);
    assert.equal(await store.get('fresh-key'), made.value);
    // an entry that exists but cannot be read is never replaced by a new key: that would orphan what it encrypts
    fs.writeFileSync(path.join(dir, 'damaged.dpapi'), 'QUJD\n');
    assert.deepEqual(await secretOrEnv(store, 'damaged', undefined, { create: true }), { value: null, source: null, stored: false });
    assert.equal(fs.readFileSync(path.join(dir, 'damaged.dpapi'), 'utf8'), 'QUJD\n');
    const unknown = createSecretStore({ dir, platform: 'darwin', runProgram: async () => ({ code: 36, stdout: '', stderr: '' }) });
    assert.deepEqual(await secretOrEnv(unknown, 'k', undefined, { create: true }), { value: null, source: null, stored: false });
    assert.deepEqual(await secretOrEnv(null, 'k', ENV), { value: null, source: null, stored: false });
  } finally { rmDir(dir); }
});
