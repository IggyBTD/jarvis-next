import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, isPrivateAddress, isSubmitLike, isSensitiveField, looksLikeCaptcha } from '../../sidecars/browser-guard/guard.js';
import { loadConfig } from '../../server/core/config.js';

const patterns = loadConfig({ only: ['policy.json'] }).policy.browser.submitPatterns;
const pub = async () => [{ address: '93.184.216.34' }];

test('private, local, metadata and hidden-IPv4 addresses are never opened', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '2002:7f00:1::1']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.equal(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://2130706433/', 'http://0x7f.1/', 'http://localhost:3000', 'http://printer.local/', 'http://[::ffff:127.0.0.1]/']) assert.equal((await checkUrl(u, { resolve: pub })).ok, false, u);
  assert.equal((await checkUrl('http://rebind.example/', { resolve: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }] })).ok, false); // any private answer blocks
  assert.equal((await checkUrl('http://nx.example/', { resolve: async () => { throw new Error('ENOTFOUND'); } })).ok, false);
});

test('schemes, credentials, allow and deny lists, data-carrying addresses', async () => {
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://x.example/', 'chrome://settings', 'http://user:pw@example.com/', 'not a url']) assert.equal((await checkUrl(u, { resolve: pub })).ok, false, u);
  assert.deepEqual(await checkUrl('https://example.com/a?b=1', { resolve: pub }), { ok: true });
  assert.equal((await checkUrl('https://evil.example/', { deny: ['evil.example'], resolve: pub })).ok, false);
  assert.equal((await checkUrl('https://sub.evil.example/', { deny: ['evil.example'], resolve: pub })).ok, false);
  assert.equal((await checkUrl('https://other.example/', { allow: ['example.com'], resolve: pub })).ok, false);
  assert.equal((await checkUrl('https://www.example.com/', { allow: ['example.com'], resolve: pub })).ok, true);
  assert.ok((await checkUrl(`https://example.com/?d=${'A'.repeat(200)}`, { resolve: pub })).ask);
  assert.ok((await checkUrl(`https://example.com/${'a'.repeat(400)}`, { resolve: pub })).ask);
  assert.ok((await checkUrl('https://example.com/?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9', { resolve: pub })).ask);
  assert.equal((await checkUrl('http://127.0.0.1:8080/', { allowLoopback: true })).ok, true); // test fixture switch only
  assert.equal((await checkUrl('http://10.0.0.1/', { allowLoopback: true })).ok, false);
});

test('submit-like elements and sensitive fields', () => {
  const s = (o) => isSubmitLike({ patterns, ...o });
  assert.equal(s({ tag: 'input', type: 'submit', text: 'Go' }), true);
  assert.equal(s({ tag: 'button', text: 'Place order' }), true);
  assert.equal(s({ tag: 'button', text: 'Pagar ahora' }), true);
  assert.equal(s({ tag: 'button', text: 'Next', insideForm: true }), true);
  assert.equal(s({ tag: 'a', text: 'Delete account' }), true);
  assert.equal(s({ tag: 'a', text: 'About us' }), false);
  assert.equal(s({ tag: 'button', type: 'button', text: 'Show more' }), false);
  assert.equal(s({ tag: 'div', text: 'Send' }), false);
  assert.equal(isSensitiveField({ type: 'password' }), true);
  assert.equal(isSensitiveField({ type: 'text', autocomplete: 'cc-number' }), true);
  assert.equal(isSensitiveField({ type: 'text', name: 'card_number' }), true);
  assert.equal(isSensitiveField({ type: 'text', placeholder: 'CVV' }), true);
  assert.equal(isSensitiveField({ type: 'tel', ariaLabel: 'One-time code' }), true);
  assert.equal(isSensitiveField({ type: 'text', name: 'q', placeholder: 'Search' }), false);
  assert.equal(looksLikeCaptcha({ frameUrls: ['https://www.google.com/recaptcha/api2/anchor'] }), true);
  assert.equal(looksLikeCaptcha({ text: 'Please verify you are human' }), true);
  assert.equal(looksLikeCaptcha({ text: 'Welcome' }), false);
});
