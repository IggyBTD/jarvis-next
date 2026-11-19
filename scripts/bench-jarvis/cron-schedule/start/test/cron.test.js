const test = require('node:test');
const assert = require('node:assert');
const { nextRun } = require('../src/cron');

const at = (s) => new Date(s);

test('every 15 minutes', () => {
  assert.equal(nextRun('*/15 * * * *', at('2026-01-01T10:07:00Z')).toISOString(), '2026-01-01T10:15:00.000Z');
});

test('weekdays at 09:00 from a Friday', () => {
  assert.equal(nextRun('0 9 * * 1-5', at('2026-01-02T10:00:00Z')).toISOString(), '2026-01-05T09:00:00.000Z');
});

test('day of week 7 is Sunday', () => {
  assert.equal(nextRun('0 12 * * 7', at('2026-01-03T00:00:00Z')).toISOString(), '2026-01-04T12:00:00.000Z');
});

test('strictly after the given time', () => {
  assert.equal(nextRun('30 10 * * *', at('2026-01-01T10:30:00Z')).toISOString(), '2026-01-02T10:30:00.000Z');
});

test('bad expressions throw', () => {
  assert.throws(() => nextRun('61 * * * *', at('2026-01-01T00:00:00Z')));
  assert.throws(() => nextRun('* * * *', at('2026-01-01T00:00:00Z')));
});
