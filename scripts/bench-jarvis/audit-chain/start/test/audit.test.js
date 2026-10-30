const test = require('node:test');
const assert = require('node:assert');
const { append, verify, tail } = require('../src/audit');

test('a fresh chain verifies', () => {
  const log = append(append([], { tool: 'files.read' }), { tool: 'shell.run' });
  assert.deepEqual(verify(log), { ok: true });
});

test('key order does not change the hash', () => {
  const log = append([], { b: 1, a: { d: 2, c: 3 } });
  const reordered = [{ ...log[0], entry: { a: { c: 3, d: 2 }, b: 1 } }];
  assert.deepEqual(verify(reordered), { ok: true });
});

test('a changed entry is found at its index', () => {
  const log = append(append(append([], { n: 1 }), { n: 2 }), { n: 3 });
  const bad = log.map((r, i) => (i === 1 ? { ...r, entry: { n: 99 } } : r));
  assert.deepEqual(verify(bad), { ok: false, index: 1 });
});

test('secrets are redacted before they are stored', () => {
  const [r] = append([], { tool: 'mail.send', token: 'abc' });
  assert.equal(r.entry.token, '[redacted]');
  assert.equal(r.entry.tool, 'mail.send');
});

test('tail returns the last n records', () => {
  const log = append(append(append([], { n: 1 }), { n: 2 }), { n: 3 });
  assert.deepEqual(tail(log, 2).map((r) => r.entry.n), [2, 3]);
});
