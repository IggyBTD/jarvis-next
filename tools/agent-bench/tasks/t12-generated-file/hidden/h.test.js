const test = require("node:test"); const assert = require("node:assert"); const fs = require("fs"); const path = require("path");
const { rateFor } = require("../src/tax");
test("rates follow README", () => { for (const [r, v] of [["US", 0.07], ["DE", 0.19], ["FR", 0.2], ["JP", 0.1]]) assert.strictEqual(rateFor(r), v, r); });
test("case-insensitive", () => { assert.strictEqual(rateFor("de"), 0.19); assert.strictEqual(rateFor("Jp"), 0.1); });
test("unknown region", () => { for (const r of ["XX", "", "constructor", "__proto__"]) assert.throws(() => rateFor(r), RangeError, r); });
test("source of truth fixed, generated file consistent", () => { const src = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "tax-table.src.json"), "utf8")); assert.deepStrictEqual(src, { US: 0.07, DE: 0.19, FR: 0.2, JP: 0.1 }); assert.deepStrictEqual(require("../src/generated/tax-table"), src); });
