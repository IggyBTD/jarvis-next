const test = require("node:test"); const assert = require("node:assert"); const fs = require("fs"); const path = require("path");
const o = require("../src/order");
const order = { region: "FR", items: [{ sku: "Z", qty: 3, price: 4.2 }] };
test("tax module", () => { const t = require("../src/tax"); assert.strictEqual(t.taxFor("DE", 10000), 1900); assert.strictEqual(t.taxFor("JP", 999), 100); assert.strictEqual(typeof t.REGION_TAX, "undefined"); });
test("receipt module", () => { const r = require("../src/receipt"); const t = o.price(order); assert.strictEqual(r.formatReceipt(order, t), o.formatReceipt(order, t)); });
test("order.js delegates", () => { const src = fs.readFileSync(path.join(__dirname, "..", "src", "order.js"), "utf8"); assert.ok(!/REGION_TAX\s*=/.test(src)); assert.ok(/require\(["\x27]\.\/tax["\x27]\)/.test(src)); assert.ok(/require\(["\x27]\.\/receipt["\x27]\)/.test(src)); assert.ok(!/toFixed/.test(src)); });
test("behaviour unchanged", () => { assert.deepStrictEqual(o.processOrder(order).totals, { subtotal: 1260, tax: 252, shipping: 599, total: 2111 }); assert.strictEqual(o.processOrder(order).receipt, "Z x3  $12.60\nSubtotal  $12.60\nTax (20%)  $2.52\nShipping  $5.99\nTotal  $21.11"); });
