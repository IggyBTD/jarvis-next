const test = require("node:test"); const assert = require("node:assert"); const { parseDuration } = require("../src/duration"); const { scheduleIn } = require("../src/scheduler");
const ok = [["30m", 1800], ["2h", 7200], ["1h30m", 5400], ["1.5h", 5400], ["90", 90], ["  45s ", 45], ["2d 4h", 187200], ["30m1h", 5400], ["1H30M", 5400], ["0s", 0], ["0.5m", 30], ["1h 1h", 7200], ["10 s", 10]];
for (const [input, secs] of ok) test("parses " + JSON.stringify(input), () => assert.strictEqual(parseDuration(input), secs));
const bad = ["", "   ", "h", "-5s", "1x", "1h30", "1..5h", ".5h", "5 5", "1h junk", "abc", "1h,30m"];
for (const input of bad) test("rejects " + JSON.stringify(input), () => assert.throws(() => parseDuration(input), (e) => e instanceof RangeError && e.message === "invalid duration: " + input));
test("non-string", () => { for (const v of [undefined, null, 5, {}]) assert.throws(() => parseDuration(v), TypeError); });
test("scheduler", () => assert.strictEqual(scheduleIn("1h30m", 1000), 1000 + 5400000));
