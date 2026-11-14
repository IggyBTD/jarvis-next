// Summarise results.jsonl: per task and overall, base vs ft. Usage: node report.cjs
const fs = require("fs"), path = require("path");
const rows = fs.readFileSync(path.join(__dirname, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const models = ["base", "ft"], tasks = [...new Set(rows.map((r) => r.task))].sort();
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const cell = (m, t) => { const r = rows.filter((x) => x.model === m && x.task === t); return r.length ? `${r.filter((x) => x.solved).length}/${r.length}` : "-"; };
console.log("task".padEnd(24) + models.map((m) => m.padEnd(8)).join(""));
for (const t of tasks) console.log(t.padEnd(24) + models.map((m) => cell(m, t).padEnd(8)).join(""));
console.log("\nmodel  runs solved%  partial%  steps  toolErr  loops  timeouts  secs/run  out-tok/run");
for (const m of models) {
  const r = rows.filter((x) => x.model === m); if (!r.length) continue;
  const f = (x) => x.toFixed(1);
  console.log(`${m.padEnd(6)} ${String(r.length).padEnd(4)} ${f(100 * avg(r.map((x) => +x.solved))).padEnd(8)} ${f(100 * avg(r.map((x) => (x.total ? x.pass / x.total : 0)))).padEnd(9)} ${f(avg(r.map((x) => x.steps))).padEnd(6)} ${f(avg(r.map((x) => x.toolErrors))).padEnd(8)} ${f(avg(r.map((x) => x.loops))).padEnd(6)} ${String(r.filter((x) => x.timedOut).length).padEnd(9)} ${String(Math.round(avg(r.map((x) => x.secs)))).padEnd(9)} ${Math.round(avg(r.map((x) => x.outputTokens)))}`);
}
