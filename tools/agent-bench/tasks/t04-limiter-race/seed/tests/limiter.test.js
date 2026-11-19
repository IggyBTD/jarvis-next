const test = require("node:test"); const assert = require("node:assert"); const { createLimiter } = require("../src/limiter");
test("runs a job", async () => { const run = createLimiter(2); assert.strictEqual(await run(async () => 5), 5); });
