const test = require("node:test"); const assert = require("node:assert"); const r = require("../src/report");
test("small", () => {
  assert.deepStrictEqual(r.uniqueSorted([3, 1, 3, 2]), [1, 2, 3]);
  assert.deepStrictEqual(r.groupCounts([{ a: "x" }, { a: "y" }, { a: "x" }], "a"), [{ key: "x", count: 2 }, { key: "y", count: 1 }]);
  assert.deepStrictEqual(r.topK([5, 1, 9, 9, 3], 3), [9, 9, 5]);
});
