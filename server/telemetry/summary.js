// Overnight (or any range) summary of the telemetry log, computed in code. The digest model only narrates these numbers;
// it never calculates. Pure apart from reading the log files.
import fs from 'node:fs';
import path from 'node:path';

export function readLog(dir, machine, fromMs, toMs) {
  const rows = [];
  for (let day = Math.floor(fromMs / 86_400_000) * 86_400_000; day <= toMs; day += 86_400_000) {
    const file = path.join(dir, `${new Date(day).toISOString().slice(0, 10)}.jsonl`);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); const t = Date.parse(r.ts); if (r.machine === machine && t >= fromMs && t < toMs) rows.push({ ...r, t }); } catch { /* skip torn line */ }
    }
  }
  return rows;
}

const r1 = (n) => Number(n.toFixed(1));

export function summarize({ dir, machine = 'pc', fromMs, toMs, thresholds }) {
  const rows = readLog(dir, machine, fromMs, toMs);
  const minutes = Math.max(1, Math.round((toMs - fromMs) / 60_000));
  const out = { machine, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), minutesWithData: rows.length, coverage: r1(rows.length / minutes), metrics: {}, anomalies: [] };
  if (!rows.length) return out;

  const series = (key, pick = (r) => r.avg[key], peak = (r) => r.max[key]) => {
    const pts = rows.filter((r) => pick(r) != null);
    if (!pts.length) return null;
    const top = pts.reduce((a, b) => (peak(b) > peak(a) ? b : a));
    const low = pts.reduce((a, b) => (pick(b) < pick(a) ? b : a));
    return { average: r1(pts.reduce((s, r) => s + pick(r), 0) / pts.length), peak: r1(peak(top)), peakAt: top.ts, lowest: r1(pick(low)), lowestAt: low.ts };
  };
  const cpu = series('CPU_Load');
  const gpuLoad = series('GPU_Compute_Load');
  const gpuTemp = series('GPU_Temperature');
  const cpuTemp = series('CPU_Temperature');
  const vram = series('GPU_VRAM_Usage');
  const mem = series('Memory_Usage');
  const memPct = rows.filter((r) => r.max.Memory_Usage != null && (r.avg.Memory_Total ?? r.max.Memory_Total))
    .map((r) => ({ ts: r.ts, pct: (r.max.Memory_Usage / (r.avg.Memory_Total ?? r.max.Memory_Total)) * 100 }));
  Object.assign(out.metrics, { ...(cpu && { cpuLoadPercent: cpu }), ...(gpuLoad && { gpuLoadPercent: gpuLoad }), ...(gpuTemp && { gpuTempC: gpuTemp }), ...(cpuTemp && { cpuTempC: cpuTemp }), ...(vram && { gpuMemoryUsedGB: vram }), ...(mem && { memoryUsedGB: mem }) });
  if (memPct.length) { const top = memPct.reduce((a, b) => (b.pct > a.pct ? b : a)); out.metrics.memoryPercent = { peak: r1(top.pct), peakAt: top.ts }; }

  const t = thresholds ?? {};
  const flag = (metric, value, at, threshold, unit) => { if (value != null && threshold != null && value > threshold) out.anomalies.push({ metric, value: r1(value), unit, at, threshold }); };
  flag('GPU temperature', gpuTemp?.peak, gpuTemp?.peakAt, t.gpuTempC, 'C');
  flag('CPU load', cpu?.peak, cpu?.peakAt, t.cpuLoadPct, '%');
  flag('Memory use', out.metrics.memoryPercent?.peak, out.metrics.memoryPercent?.peakAt, t.memoryPct, '%');
  return out;
}
