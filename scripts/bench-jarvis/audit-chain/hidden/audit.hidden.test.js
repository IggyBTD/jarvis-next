const test = require('node:test');
const assert = require('node:assert');
const { append, verify, tail, GENESIS } = require('../src/audit');

test('redaction goes into arrays and nested objects', () => {
  const [r] = append([], { calls: [{ apiKey: 'x', n: 1 }, { inner: { Password: 'p', ok: true } }] });
  assert.deepEqual(r.entry.calls, [{ apiKey: '[redacted]', n: 1 }, { inner: { Password: '[redacted]', ok: true } }]);
});

test('a secret-looking object value is replaced whole', () => {
  const [r] = append([], { authorization: { scheme: 'Bearer', value: 'z' } });
  assert.equal(r.entry.authorization, '[redacted]');
});

test('redacted secrets do not change the hash', () => {
  assert.equal(append([], { token: 'a' })[0].hash, append([], { token: 'b' })[0].hash);
});

test('genesis and first link', () => {
  assert.equal(GENESIS, '0'.repeat(64));
  assert.equal(append([], { x: 1 })[0].prev, GENESIS);
});

test('verify reports the first broken link', () => {
  const log = append(append(append([], { n: 1 }), { n: 2 }), { n: 3 });
  const bad = log.map((r, i) => (i === 1 ? { ...r, prev: 'f'.repeat(64) } : r));
  assert.deepEqual(verify(bad), { ok: false, index: 1 });
});

test('tail with zero or negative n is empty', () => {
  const log = append([], { n: 1 });
  assert.deepEqual(tail(log, 0), []);
  assert.deepEqual(tail(log, -3), []);
});

test('an empty log verifies', () => {
  assert.deepEqual(verify([]), { ok: true });
});

test('append does not change the input log', () => {
  const log = append([], { n: 1 });
  const before = JSON.stringify(log);
  append(log, { n: 2 });
  assert.equal(JSON.stringify(log), before);
});
