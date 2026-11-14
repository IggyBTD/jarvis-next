// Mutation score: the agent's tests must pass on the real code and fail on every mutant.
const fs = require("fs"), path = require("path"), os = require("os"); const { spawnSync } = require("child_process");
const work = process.cwd();
const orig = fs.readFileSync(path.join(work, "__hidden__", "original.js"), "utf8");
const MUTANTS = [
  ["touching not merged", "iv[0] <= last[1]", "iv[0] < last[1]"],
  ["nested keeps inner end", "Math.max(last[1], iv[1])", "iv[1]"],
  ["input mutated", "list.map((iv) => [iv[0], iv[1]]).sort((a, b) => a[0] - b[0])", "list.sort((a, b) => a[0] - b[0])"],
  ["no sort", ".sort((a, b) => a[0] - b[0])", ""],
  ["zero length rejected", "iv[0] > iv[1]) throw new RangeError", "iv[0] >= iv[1]) throw new RangeError"],
  ["total off by one", "(iv[1] - iv[0])", "(iv[1] - iv[0] + 1)"],
  ["trailing gap dropped", "if (cur < hi) out.push([cur, hi]);", ""],
  ["empty gap emitted", "if (s > cur) out.push([cur, s]);", "if (s >= cur) out.push([cur, s]);"],
  ["gaps ignore lo", "let cur = lo;", "let cur = 0;"],
  ["NaN accepted", "!Number.isFinite(iv[0])", "typeof iv[0] !== \"number\""],
];
function runWith(code) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "mut-"));
  fs.cpSync(path.join(work, "tests"), path.join(t, "tests"), { recursive: true });
  fs.mkdirSync(path.join(t, "src")); fs.writeFileSync(path.join(t, "src", "interval.js"), code);
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap"], { cwd: t, encoding: "utf8", timeout: 60000 });
  const n = Number(((r.stdout || "").match(/# tests (\d+)/) || [])[1] || 0);
  return { ok: r.status === 0, n };
}
let pass = 0, total = 0;
const base = runWith(orig); total++;
if (base.ok && base.n >= 5) pass++; else console.log("original fails or fewer than 5 tests (" + base.n + ")");
for (const [name, from, to] of MUTANTS) {
  if (!orig.includes(from)) { console.log("BAD MUTANT SPEC " + name); process.exit(2); }
  total++;
  const r = runWith(orig.replace(from, to));
  if (!r.ok && base.ok) pass++; else console.log("survived: " + name);
}
console.log("# tests " + total + "\n# pass " + pass + "\n# fail " + (total - pass));
process.exit(pass === total ? 0 : 1);
