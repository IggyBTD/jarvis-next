const test = require("node:test"); const assert = require("node:assert"); const { createLimiter } = require("../src/limiter");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("never exceeds max, all finish, FIFO start", async () => {
  const run = createLimiter(3); let active = 0, peak = 0; const started = [];
  const jobs = Array.from({ length: 60 }, (_, i) => run(async () => { started.push(i); active++; peak = Math.max(peak, active); await sleep(1 + (i * 7) % 5); active--; return i; }));
  const res = await Promise.all(jobs);
  assert.ok(peak <= 3, "peak " + peak); assert.deepStrictEqual(res, Array.from({ length: 60 }, (_, i) => i)); assert.deepStrictEqual(started, Array.from({ length: 60 }, (_, i) => i));
});
test("max 1 serialises", async () => { const run = createLimiter(1); let active = 0, bad = false; await Promise.all(Array.from({ length: 20 }, () => run(async () => { if (++active > 1) bad = true; await sleep(1); active--; }))); assert.strictEqual(bad, false); });
test("rejections free slot", async () => { const run = createLimiter(1); await assert.rejects(run(async () => { throw new Error("x"); }), /x/); assert.strictEqual(await run(async () => "ok"), "ok"); });
test("sync throw frees slot", async () => { const run = createLimiter(1); await assert.rejects(run(() => { throw new Error("sync"); }), /sync/); assert.strictEqual(await run(async () => 1), 1); });
test("late callers do not barge", async () => { const run = createLimiter(1); const order = []; const a = run(async () => { order.push("a"); await sleep(5); }); const b = run(async () => { order.push("b"); }); await sleep(1); const c = run(async () => { order.push("c"); }); await Promise.all([a, b, c]); assert.deepStrictEqual(order, ["a", "b", "c"]); });
test("bad max", () => { for (const m of [0, -1, 1.5, NaN, undefined]) assert.throws(() => createLimiter(m), RangeError); });
