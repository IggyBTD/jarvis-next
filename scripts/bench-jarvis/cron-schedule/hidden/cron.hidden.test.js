const test = require('node:test');
const assert = require('node:assert');
const { nextRun } = require('../src/cron');

const at = (s) => new Date(s);
const iso = (expr, from) => nextRun(expr, at(from)).toISOString();

test('day of month OR day of week when both are restricted', () => {
  assert.equal(iso('0 0 13 * 5', '2026-01-01T00:00:00Z'), '2026-01-02T00:00:00.000Z');
});

test('only day of month counts when day of week is *', () => {
  assert.equal(iso('0 0 15 * *', '2026-01-01T00:00:00Z'), '2026-01-15T00:00:00.000Z');
});

test('only day of week counts when day of month starts with *', () => {
  assert.equal(iso('0 0 */10 * 1', '2026-01-01T00:00:00Z'), '2026-01-05T00:00:00.000Z');
});

test('months wrap into the next year', () => {
  assert.equal(iso('0 0 1 3 *', '2026-01-01T00:00:00Z'), '2026-03-01T00:00:00.000Z');
  assert.equal(iso('0 0 1 1 *', '2026-06-01T00:00:00Z'), '2027-01-01T00:00:00.000Z');
});

test('leap day', () => {
  assert.equal(iso('0 0 29 2 *', '2026-03-01T00:00:00Z'), '2028-02-29T00:00:00.000Z');
});

test('lists, ranges and steps', () => {
  assert.equal(iso('0,30 8-10/2 * * *', '2026-01-01T08:31:00Z'), '2026-01-01T10:00:00.000Z');
});

test('a step of zero throws', () => {
  assert.throws(() => nextRun('*/0 * * * *', at('2026-01-01T00:00:00Z')));
});

test('an impossible date throws', () => {
  assert.throws(() => nextRun('0 0 30 2 *', at('2026-01-01T00:00:00Z')));
});

test('leading and trailing spaces are fine', () => {
  assert.equal(iso('  5 4 * * *  ', '2026-01-01T00:00:00Z'), '2026-01-01T04:05:00.000Z');
});

test('seconds in from are dropped and the result is the next minute', () => {
  assert.equal(iso('* * * * *', '2026-01-01T00:00:45Z'), '2026-01-01T00:01:00.000Z');
});

test('an out of range value throws', () => {
  assert.throws(() => nextRun('0 24 * * *', at('2026-01-01T00:00:00Z')));
  assert.throws(() => nextRun('0 0 0 * *', at('2026-01-01T00:00:00Z')));
});
