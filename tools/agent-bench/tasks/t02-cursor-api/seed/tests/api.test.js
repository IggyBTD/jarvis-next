const test = require('node:test'); const assert = require('node:assert'); const { createApi } = require('../src/api');
test('create and list', () => { const a = createApi(); a.handle({ method: 'POST', path: '/items', body: { name: 'x' } }); assert.strictEqual(a.handle({ method: 'GET', path: '/items' }).body.items.length, 1); });
