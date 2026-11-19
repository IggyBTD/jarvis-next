const fs = require("fs");

function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === "\"") { if (text[i + 1] === "\"") { field += "\""; i++; } else q = false; } else field += c;
    } else if (c === "\"") q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
    i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const esc = (f) => (/[",\n\r]/.test(f) ? "\"" + f.replace(/"/g, "\"\"") + "\"" : f);
const toCsv = (rows) => rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
const fail = (msg) => { process.stderr.write(msg + "\n"); process.exit(2); };

function stats(vals) {
  const n = vals.map((v) => v.trim()).filter((v) => v !== "" && Number.isFinite(Number(v))).map(Number);
  if (!n.length) return { count: 0 };
  const sum = n.reduce((a, b) => a + b, 0);
  return { count: n.length, min: Math.min(...n), max: Math.max(...n), mean: sum / n.length };
}
const plain = (s) => (s.count === 0 ? "count=0" : "count=" + s.count + ",min=" + s.min + ",max=" + s.max + ",mean=" + s.mean.toFixed(2));
const jsonStats = (s) => (s.count === 0 ? { count: 0 } : { count: s.count, min: s.min, max: s.max, mean: Number(s.mean.toFixed(2)) });

const [cmd, file, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf("--" + name); return i < 0 ? undefined : rest[i + 1]; };
if (!["stats", "filter", "sort"].includes(cmd)) fail("unknown command: " + cmd);
let text; try { text = fs.readFileSync(file, "utf8"); } catch { fail("cannot read " + file); }
const all = parseCsv(text); const header = all[0] || []; const body = all.slice(1);
const idx = (name) => { const i = header.indexOf(name); if (i < 0) fail("no such column: " + name); return i; };
const json = opt("format") === "json";
const col = idx(opt("col"));
if (cmd === "stats") {
  const g = opt("group-by");
  if (g === undefined) {
    const s = stats(body.map((r) => r[col] ?? ""));
    process.stdout.write(json ? JSON.stringify(jsonStats(s)) + "\n" : (s.count === 0 ? "count=0\n" : "count=" + s.count + "\nmin=" + s.min + "\nmax=" + s.max + "\nmean=" + s.mean.toFixed(2) + "\n"));
  } else {
    const gi = idx(g); const groups = new Map();
    for (const r of body) { const k = r[gi] ?? ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r[col] ?? ""); }
    const keys = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (json) process.stdout.write(JSON.stringify(keys.map((k) => ({ group: k, ...jsonStats(stats(groups.get(k))) }))) + "\n");
    else process.stdout.write(keys.map((k) => k + "\t" + plain(stats(groups.get(k)))).join("\n") + "\n");
  }
} else if (cmd === "filter") {
  const rows = body.filter((r) => (r[col] ?? "") === opt("eq"));
  if (json) process.stdout.write(JSON.stringify(rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])))) + "\n");
  else process.stdout.write(toCsv([header, ...rows]));
} else {
  const desc = rest.includes("--desc");
  const vals = body.map((r) => r[col] ?? "");
  const numeric = vals.filter((v) => v !== "").every((v) => Number.isFinite(Number(v)));
  const cmp = (a, b) => (numeric ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0);
  const sorted = body.map((r, i) => ({ r, i, v: r[col] ?? "" })).sort((x, y) => {
    if (x.v === "" || y.v === "") return x.v === y.v ? x.i - y.i : x.v === "" ? 1 : -1;
    const c = cmp(x.v, y.v); return c !== 0 ? (desc ? -c : c) : x.i - y.i;
  });
  process.stdout.write(toCsv([header, ...sorted.map((x) => x.r)]));
}
