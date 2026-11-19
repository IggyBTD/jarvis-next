const test = require("node:test"); const assert = require("node:assert"); const { rateFor } = require("../src/tax");
test("US", () => assert.strictEqual(rateFor("US"), 0.07));
test("DE", () => assert.strictEqual(rateFor("DE"), 0.19));
