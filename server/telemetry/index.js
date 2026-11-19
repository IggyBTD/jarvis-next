// Telemetry: polls each machine's provider on its own timer, caches the last value, pushes it on the bus (the WebSocket layer
// sends it at 1 Hz) and appends a one-minute-resolution rolling log that the digest reads. It imports nothing from the agent,
// OpenCode, browser or digest code, and an error in one provider never stops another: kill everything else and it keeps running.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseLhm } from '../../shared/lhm.js';

export const LHM_DEFAULT = 'http://127.0.0.1:8085';

export function createLhmProvider({ url = LHM_DEFAULT, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  return {
    async sample() {
      const res = await fetchImpl(`${url}/data.json`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`LibreHardwareMonitor answered ${res.status}`);
      return parseLhm(await res.json());
    },
  };
}

// The numbers that need no sensor program: processor load, memory and free space on the home drive.
// LibreHardwareMonitor adds the temperatures, the graphics card and the video memory.
export function createBasicProvider({ homeDir = os.homedir() } = {}) {
  let prev = null;
  const cpuTimes = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times); a.total += t.reduce((x, y) => x + y, 0); a.idle += c.times.idle; return a; }, { total: 0, idle: 0 });
  return {
    async sample() {
      const m = {};
      const cur = cpuTimes();
      if (prev && cur.total > prev.total) m.CPU_Load = Number((100 * (1 - (cur.idle - prev.idle) / (cur.total - prev.total))).toFixed(1));
      prev = cur;
      m.Memory_Total = Number((os.totalmem() / 2 ** 30).toFixed(2));
      m.Memory_Usage = Number(((os.totalmem() - os.freemem()) / 2 ** 30).toFixed(2));
      try { const s = fs.statfsSync(homeDir); m.Storage_Total_Space = Number(((s.blocks * s.bsize) / 2 ** 30).toFixed(1)); m.Storage_Free_Space = Number(((s.bavail * s.bsize) / 2 ** 30).toFixed(1)); } catch { /* no drive reading */ }
      return m;
    },
  };
}

// The PC: sensor readings from LibreHardwareMonitor when it answers, the basic numbers under them either way. Sensors_Basic = 1
// says the sensor program is not running, so the temperatures and the graphics card are missing.
export function createPcProvider({ lhm, basic = createBasicProvider() }) {
  return {
    async sample() {
      const [fromBasic, fromLhm] = await Promise.allSettled([basic.sample(), lhm.sample()]);
      const m = { ...(fromBasic.status === 'fulfilled' ? fromBasic.value : {}), ...(fromLhm.status === 'fulfilled' ? fromLhm.value : {}) };
      m.Sensors_Basic = fromLhm.status === 'fulfilled' ? 0 : 1;
      if (!Object.keys(m).length) throw new Error('no readings from this PC');
      return m;
    },
  };
}

// Mac numbers come from agent actions (slow rate). `invoke(name)` resolves the action's data or throws.
export function createMacProvider({ invoke }) {
  return {
    async sample() {
      const [cpu, mem, batt] = await Promise.allSettled([invoke('cpu_usage'), invoke('memory_usage'), invoke('battery_status')]);
      const m = {};
      if (cpu.status === 'fulfilled' && cpu.value?.loadPercent != null) m.CPU_Load = cpu.value.loadPercent;
      if (mem.status === 'fulfilled' && mem.value) { m.Memory_Usage = mem.value.usedGiB; m.Memory_Total = mem.value.totalGiB; }
      if (batt.status === 'fulfilled' && batt.value?.percent != null) { m.Battery_Percent = batt.value.percent; m.Battery_State = batt.value.state ?? null; }
      if (!Object.keys(m).length) throw new Error('the Mac agent returned no numbers');
      return m;
    },
  };
}

const minuteOf = (ms) => Math.floor(ms / 60_000) * 60_000;
const dayFile = (dir, ms) => path.join(dir, `${new Date(ms).toISOString().slice(0, 10)}.jsonl`);

export function createTelemetry({ bus, dataDir, providers, intervals = { pc: 1000, mac: 60_000 }, now = Date.now, retentionDays = 30, log = () => {} }) {
  const dir = path.join(dataDir, 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  const lastValue = new Map();   // machine -> { ts, metrics, offline?, error? }
  const buckets = new Map();     // machine -> { minute, n, sum, max, min }
  const timers = new Map();
  let running = false;

  function flush(machine, bucket) {
    if (!bucket?.n) return;
    const avg = Object.fromEntries(Object.entries(bucket.sum).map(([k, v]) => [k, Number((v / bucket.n).toFixed(2))]));
    try { fs.appendFileSync(dayFile(dir, bucket.minute), `${JSON.stringify({ ts: new Date(bucket.minute).toISOString(), machine, samples: bucket.n, avg, max: bucket.max, min: bucket.min })}\n`); } catch (e) { log(`telemetry log write failed: ${e.message}`); }
  }
  function record(machine, metrics, t) {
    const minute = minuteOf(t);
    let b = buckets.get(machine);
    if (!b || b.minute !== minute) { flush(machine, b); b = { minute, n: 0, sum: {}, max: {}, min: {} }; buckets.set(machine, b); }
    b.n += 1;
    for (const [k, v] of Object.entries(metrics)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      b.sum[k] = (b.sum[k] ?? 0) + v;
      b.max[k] = Math.max(b.max[k] ?? v, v);
      b.min[k] = Math.min(b.min[k] ?? v, v);
    }
  }

  async function poll(machine) {
    const t = now();
    try {
      const metrics = await providers[machine].sample();
      lastValue.set(machine, { ts: t, metrics });
      record(machine, metrics, t);
      bus.publish('telemetry', { machine, ts: t, metrics });
      return true;
    } catch (e) {
      const prev = lastValue.get(machine);
      lastValue.set(machine, { ts: t, metrics: prev?.metrics ?? {}, offline: true, error: e.message });
      bus.publish('telemetry', { machine, ts: t, offline: true, error: e.message, metrics: prev?.metrics ?? {} });
      return false;
    }
  }

  function loop(machine) {
    let failures = 0;
    const tick = async () => {
      if (!running) return;
      const ok = await poll(machine).catch(() => false);
      failures = ok ? 0 : Math.min(failures + 1, 5);
      const wait = intervals[machine] * (ok ? 1 : Math.min(2 ** failures, 10));
      timers.set(machine, setTimeout(tick, wait));
      timers.get(machine).unref?.();
    };
    tick();
  }

  return {
    start() { running = true; for (const m of Object.keys(providers)) loop(m); },
    stop() { running = false; for (const t of timers.values()) clearTimeout(t); for (const [m, b] of buckets) flush(m, b); buckets.clear(); },
    last: (machine) => lastValue.get(machine) ?? null,
    snapshot: () => Object.fromEntries(lastValue),
    poll,
    // deletes log files older than retentionDays; called by the log-rotate job
    prune() {
      const cutoff = now() - retentionDays * 86_400_000;
      let n = 0;
      for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && Date.parse(f.slice(0, 10)) + 86_400_000 < cutoff) { fs.rmSync(path.join(dir, f)); n += 1; }
      return n;
    },
    dir,
  };
}
