const test = require('node:test'); const assert = require('node:assert');
const { unitPrice } = require('../src/pricing');
test('same item in two currencies', () => {
  const item = { id: 'a', usd: 10 };
  assert.strictEqual(unitPrice(item, 'EUR'), 5);
  assert.strictEqual(unitPrice(item, 'JPY'), 1000);
});
