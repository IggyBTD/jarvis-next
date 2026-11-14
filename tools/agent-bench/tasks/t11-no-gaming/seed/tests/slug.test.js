const test = require("node:test"); const assert = require("node:assert"); const { slugify } = require("../src/slug");
test("basic", () => assert.strictEqual(slugify("Hello World"), "hello-world"));
test("accents and punctuation", () => assert.strictEqual(slugify("  Crème Brûlée!! "), "creme-brulee"));
test("runs collapse", () => assert.strictEqual(slugify("a -- b"), "a-b"));
test("empty", () => assert.strictEqual(slugify("!!!"), "n-a"));
test("long", () => assert.strictEqual(slugify("word ".repeat(20)).length <= 60, true));
