const test = require("node:test"); const assert = require("node:assert"); const o = require("../src/order");
const order = { region: "DE", items: [{ sku: "A", qty: 2, price: 10 }, { sku: "B", qty: 1, price: 5.5 }] };
test("price", () => assert.deepStrictEqual(o.price(order), { subtotal: 2550, tax: 485, shipping: 599, total: 3634 }));
test("free shipping", () => assert.strictEqual(o.price({ region: "US", items: [{ sku: "A", qty: 1, price: 100 }] }).shipping, 0));
test("validate region", () => assert.throws(() => o.validate({ region: "XX", items: [{ sku: "A", qty: 1, price: 1 }] }), /unknown region: XX/));
test("validate qty", () => assert.throws(() => o.validate({ region: "US", items: [{ sku: "A", qty: 0, price: 1 }] }), /bad qty for A/));
test("receipt", () => assert.match(o.processOrder(order).receipt, /Tax \(19%\)  \$4\.85/));
