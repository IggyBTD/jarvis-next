// Small repos for the agent benchmark. Each task: files (what the agent sees), hidden (extra tests run after, never shown), prompt.
// A task is graded by running `node --test test test-hidden` in its folder: visible + hidden tests passed / total.
// `solution` holds a reference fix per task; tests/unit/p13-bench-agent.test.js proves the fix passes and the start state fails.
const T = "const test = require('node:test'); const assert = require('node:assert');\n";

export const AGENT_TASKS = [
  {
    id: 'fix-cart',
    prompt: 'The tests in test/ are failing. Find and fix the bugs in src/, following README.md. Run `node --test test` to check your work. Keep the change small.',
    files: {
      'README.md': '# cart\nPrices are integer cents.\n- `total(items, discountPercent = 0)`: sum of price*qty, minus the discount, rounded to the nearest cent. The discount is clamped to 0..100. An empty cart is 0.\n- `countItems(items)`: total quantity of all items.\n',
      'src/cart.js': 'function total(items, discountPercent = 0) {\n  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);\n  return Math.round(sum - (sum * discountPercent) / 100);\n}\n\nfunction countItems(items) {\n  return items.reduce((n, i) => n + i.qty, 1);\n}\n\nmodule.exports = { total, countItems };\n',
      'test/cart.test.js': `${T}const { total, countItems } = require('../src/cart');\ntest('total sums price*qty', () => assert.equal(total([{ price: 250, qty: 2 }, { price: 100, qty: 1 }]), 600));\ntest('discount', () => assert.equal(total([{ price: 1000, qty: 1 }], 10), 900));\ntest('discount over 100 is free', () => assert.equal(total([{ price: 1000, qty: 1 }], 150), 0));\ntest('countItems', () => assert.equal(countItems([{ price: 1, qty: 2 }, { price: 1, qty: 3 }]), 5));\ntest('countItems empty', () => assert.equal(countItems([]), 0));\n`,
    },
    hidden: {
      'test-hidden/cart.hidden.test.js': `${T}const { total, countItems } = require('../src/cart');\ntest('negative discount never raises the price', () => assert.equal(total([{ price: 1000, qty: 1 }], -20), 1000));\ntest('rounds half up', () => assert.equal(total([{ price: 333, qty: 1 }], 50), 167));\ntest('empty total', () => assert.equal(total([]), 0));\ntest('does not change the input', () => { const items = [{ price: 5, qty: 2 }]; total(items, 10); countItems(items); assert.deepEqual(items, [{ price: 5, qty: 2 }]); });\n`,
    },
    solution: {
      'src/cart.js': 'function total(items, discountPercent = 0) {\n  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);\n  const d = Math.min(100, Math.max(0, discountPercent));\n  return Math.round(sum - (sum * d) / 100);\n}\n\nfunction countItems(items) {\n  return items.reduce((n, i) => n + i.qty, 0);\n}\n\nmodule.exports = { total, countItems };\n',
    },
  },
  {
    id: 'implement-slugify',
    prompt: 'Implement `slugify` in src/slugify.js as described in README.md. The tests in test/ show the expected usage. Run `node --test test` to check your work.',
    files: {
      'README.md': '# slugify\n`slugify(text, { maxLength } = {})` turns text into a URL slug.\n- Lowercase letters and digits only; every run of other characters becomes one `-`.\n- Accents are removed (`Crème` becomes `creme`).\n- No leading or trailing `-`.\n- `maxLength` cuts the slug to at most that many characters and never leaves a trailing `-`.\n- A value that is not a string throws a `TypeError`.\n',
      'src/slugify.js': "function slugify(text, options = {}) {\n  throw new Error('not implemented');\n}\n\nmodule.exports = { slugify };\n",
      'test/slugify.test.js': `${T}const { slugify } = require('../src/slugify');\ntest('basic', () => assert.equal(slugify('Hello World'), 'hello-world'));\ntest('accents', () => assert.equal(slugify('Crème Brûlée'), 'creme-brulee'));\ntest('trims', () => assert.equal(slugify('  --Hi!--  '), 'hi'));\ntest('type error', () => assert.throws(() => slugify(42), TypeError));\n`,
    },
    hidden: {
      'test-hidden/slugify.hidden.test.js': `${T}const { slugify } = require('../src/slugify');\ntest('maxLength never ends with a dash', () => assert.equal(slugify('hello world again', { maxLength: 6 }), 'hello'));\ntest('maxLength exact', () => assert.equal(slugify('abcdef', { maxLength: 3 }), 'abc'));\ntest('digits and runs', () => assert.equal(slugify('A1   B2___C3'), 'a1-b2-c3'));\ntest('empty', () => assert.equal(slugify(''), ''));\ntest('only symbols', () => assert.equal(slugify('!!!'), ''));\ntest('null throws', () => assert.throws(() => slugify(null), TypeError));\n`,
    },
    solution: {
      'src/slugify.js': "function slugify(text, { maxLength } = {}) {\n  if (typeof text !== 'string') throw new TypeError('text must be a string');\n  let s = text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n  if (maxLength !== undefined) s = s.slice(0, maxLength).replace(/-+$/, '');\n  return s;\n}\n\nmodule.exports = { slugify };\n",
    },
  },
  {
    id: 'rename-format',
    prompt: 'Rename `formatPrice` to `formatMoney` everywhere in the repo (source files and tests), and give it an optional second argument `currency`: "USD" (default) gives `$12.50`, "EUR" gives `€12.50`, "GBP" gives `£12.50`; any other currency throws a RangeError. Update every caller. Run `node --test test` to check your work.',
    files: {
      'README.md': '# shop\n`formatPrice(cents)` turns integer cents into a string like `$12.50`. It is used by the invoice and the report.\n',
      'src/format.js': "function formatPrice(cents) {\n  const sign = cents < 0 ? '-' : '';\n  const abs = Math.abs(cents);\n  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;\n}\n\nmodule.exports = { formatPrice };\n",
      'src/invoice.js': "const { formatPrice } = require('./format');\n\nfunction invoiceLines(items) {\n  return items.map((i) => `${i.name} x${i.qty}: ${formatPrice(i.price * i.qty)}`);\n}\n\nfunction invoiceTotal(items) {\n  return formatPrice(items.reduce((s, i) => s + i.price * i.qty, 0));\n}\n\nmodule.exports = { invoiceLines, invoiceTotal };\n",
      'src/report.js': "const { formatPrice } = require('./format');\n\nfunction topSeller(sales) {\n  const best = [...sales].sort((a, b) => b.cents - a.cents)[0];\n  return best ? `${best.name} (${formatPrice(best.cents)})` : 'none';\n}\n\nmodule.exports = { topSeller };\n",
      'test/format.test.js': `${T}const { formatPrice } = require('../src/format');\ntest('formats cents', () => assert.equal(formatPrice(1250), '$12.50'));\ntest('pads cents', () => assert.equal(formatPrice(5), '$0.05'));\ntest('negative', () => assert.equal(formatPrice(-250), '-$2.50'));\n`,
      'test/shop.test.js': `${T}const { invoiceLines, invoiceTotal } = require('../src/invoice');\nconst { topSeller } = require('../src/report');\ntest('invoice lines', () => assert.deepEqual(invoiceLines([{ name: 'pen', qty: 3, price: 150 }]), ['pen x3: $4.50']));\ntest('invoice total', () => assert.equal(invoiceTotal([{ name: 'a', qty: 1, price: 999 }, { name: 'b', qty: 2, price: 1 }]), '$10.01'));\ntest('top seller', () => assert.equal(topSeller([{ name: 'a', cents: 100 }, { name: 'b', cents: 900 }]), 'b ($9.00)'));\n`,
    },
    hidden: {
      'test-hidden/rename.hidden.test.js': `${T}const fs = require('node:fs'); const path = require('node:path');\nconst fmt = require('../src/format');\ntest('formatMoney exists, formatPrice is gone', () => { assert.equal(typeof fmt.formatMoney, 'function'); assert.equal(fmt.formatPrice, undefined); });\ntest('currencies', () => { assert.equal(fmt.formatMoney(1250), '$12.50'); assert.equal(fmt.formatMoney(1250, 'EUR'), '€12.50'); assert.equal(fmt.formatMoney(1250, 'GBP'), '£12.50'); });\ntest('unknown currency', () => assert.throws(() => fmt.formatMoney(1, 'JPY'), RangeError));\ntest('no file still mentions formatPrice', () => { for (const d of ['src', 'test']) for (const f of fs.readdirSync(path.join(__dirname, '..', d))) assert.ok(!fs.readFileSync(path.join(__dirname, '..', d, f), 'utf8').includes('formatPrice'), f); });\ntest('callers still work', () => { assert.equal(require('../src/invoice').invoiceTotal([{ name: 'a', qty: 2, price: 500 }]), '$10.00'); assert.equal(require('../src/report').topSeller([{ name: 'z', cents: 5 }]), 'z ($0.05)'); });\n`,
    },
    solution: {
      'src/format.js': "const SYMBOL = { USD: '$', EUR: '€', GBP: '£' };\n\nfunction formatMoney(cents, currency = 'USD') {\n  if (!(currency in SYMBOL)) throw new RangeError(`unknown currency ${currency}`);\n  const sign = cents < 0 ? '-' : '';\n  const abs = Math.abs(cents);\n  return `${sign}${SYMBOL[currency]}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;\n}\n\nmodule.exports = { formatMoney };\n",
      'src/invoice.js': "const { formatMoney } = require('./format');\n\nfunction invoiceLines(items) {\n  return items.map((i) => `${i.name} x${i.qty}: ${formatMoney(i.price * i.qty)}`);\n}\n\nfunction invoiceTotal(items) {\n  return formatMoney(items.reduce((s, i) => s + i.price * i.qty, 0));\n}\n\nmodule.exports = { invoiceLines, invoiceTotal };\n",
      'src/report.js': "const { formatMoney } = require('./format');\n\nfunction topSeller(sales) {\n  const best = [...sales].sort((a, b) => b.cents - a.cents)[0];\n  return best ? `${best.name} (${formatMoney(best.cents)})` : 'none';\n}\n\nmodule.exports = { topSeller };\n",
      'test/format.test.js': `${T}const { formatMoney } = require('../src/format');\ntest('formats cents', () => assert.equal(formatMoney(1250), '$12.50'));\ntest('pads cents', () => assert.equal(formatMoney(5), '$0.05'));\ntest('negative', () => assert.equal(formatMoney(-250), '-$2.50'));\n`,
    },
  },
  {
    id: 'fix-lru',
    prompt: 'test/lru.test.js is failing, and README.md lists methods that src/lru.js does not have yet. Fix the bugs and add the missing methods. Run `node --test test` to check your work.',
    files: {
      'README.md': '# LRU cache\n`new LRU(capacity)`. The least recently used entry is evicted when the size goes over capacity.\n- `get(key)`: the value or undefined; counts as a use.\n- `set(key, value)`: stores the value; counts as a use; returns the cache.\n- `peek(key)`: the value or undefined; does NOT count as a use.\n- `has(key)`, `delete(key)` (returns true if something was removed), `clear()`, `size`.\n- `keys()`: keys from least to most recently used.\n',
      'src/lru.js': 'class LRU {\n  constructor(capacity) {\n    this.capacity = capacity;\n    this.map = new Map();\n  }\n\n  get(key) {\n    if (!this.map.has(key)) return undefined;\n    return this.map.get(key);\n  }\n\n  set(key, value) {\n    if (this.map.has(key)) this.map.delete(key);\n    this.map.set(key, value);\n    if (this.map.size > this.capacity) {\n      const newest = [...this.map.keys()].pop();\n      this.map.delete(newest);\n    }\n    return this;\n  }\n\n  get size() {\n    return this.map.size;\n  }\n}\n\nmodule.exports = { LRU };\n',
      'test/lru.test.js': `${T}const { LRU } = require('../src/lru');\ntest('evicts the least recently used', () => { const c = new LRU(2); c.set('a', 1).set('b', 2).set('c', 3); assert.equal(c.get('a'), undefined); assert.equal(c.get('c'), 3); });\ntest('get counts as a use', () => { const c = new LRU(2); c.set('a', 1).set('b', 2); c.get('a'); c.set('c', 3); assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 1); });\ntest('size', () => { const c = new LRU(3); c.set('a', 1).set('b', 2); assert.equal(c.size, 2); });\n`,
    },
    hidden: {
      'test-hidden/lru.hidden.test.js': `${T}const { LRU } = require('../src/lru');\ntest('peek does not count as a use', () => { const c = new LRU(2); c.set('a', 1).set('b', 2); assert.equal(c.peek('a'), 1); c.set('c', 3); assert.equal(c.has('a'), false); });\ntest('delete and has', () => { const c = new LRU(2); c.set('a', 1); assert.equal(c.delete('a'), true); assert.equal(c.delete('a'), false); assert.equal(c.has('a'), false); });\ntest('clear', () => { const c = new LRU(2); c.set('a', 1); c.clear(); assert.equal(c.size, 0); });\ntest('keys order', () => { const c = new LRU(3); c.set('a', 1).set('b', 2).set('c', 3); c.get('a'); assert.deepEqual(c.keys(), ['b', 'c', 'a']); });\ntest('set on an existing key refreshes it', () => { const c = new LRU(2); c.set('a', 1).set('b', 2).set('a', 9).set('c', 3); assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 9); });\ntest('capacity one', () => { const c = new LRU(1); c.set('a', 1).set('b', 2); assert.deepEqual(c.keys(), ['b']); });\n`,
    },
    solution: {
      'src/lru.js': 'class LRU {\n  constructor(capacity) {\n    this.capacity = capacity;\n    this.map = new Map();\n  }\n\n  get(key) {\n    if (!this.map.has(key)) return undefined;\n    const v = this.map.get(key);\n    this.map.delete(key);\n    this.map.set(key, v);\n    return v;\n  }\n\n  set(key, value) {\n    this.map.delete(key);\n    this.map.set(key, value);\n    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value);\n    return this;\n  }\n\n  peek(key) { return this.map.get(key); }\n  has(key) { return this.map.has(key); }\n  delete(key) { return this.map.delete(key); }\n  clear() { this.map.clear(); }\n  keys() { return [...this.map.keys()]; }\n\n  get size() {\n    return this.map.size;\n  }\n}\n\nmodule.exports = { LRU };\n',
    },
  },
];
