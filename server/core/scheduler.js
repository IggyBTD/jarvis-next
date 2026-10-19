// Jobs from config/server/schedules.json. Daily jobs ("at": "07:00") are decided on the LOCAL calendar date and minute in the
// configured timezone (never "last run + 24 h"), so daylight saving cannot skip or double a run. A run missed because the server
// was off executes at the next start if still inside the catch-up window. A job never overlaps itself, a hung job keeps its slot,
// a failed daily job retries twice, 10 minutes apart, and a failed state write never stops the loop.
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../../shared/util.js';

export function localParts(ms, timeZone) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function createScheduler({ schedules, dataDir, run, now = Date.now, tickMs = 30_000, log = () => {}, retryMs = 600_000 }) {
  const file = path.join(dataDir, 'scheduler-state.json');
  const state = readJson(file, {});               // job -> { date | at, attempts, nextTry }
  const running = new Set();
  let timer = null;

  const save = () => { try { writeJsonAtomic(file, state); } catch (e) { log(`scheduler state not saved: ${e.message}`); } };
  const atMin = (at) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3));

  async function runJob(name, missed) {
    if (running.has(name)) return;
    running.add(name);
    try {
      await run(name, { missed });
      state[name] = { ...state[name], attempts: 0, nextTry: null };
    } catch (e) {
      const s = state[name] ?? {};
      s.attempts = (s.attempts ?? 0) + 1;
      s.nextTry = s.attempts <= 2 ? now() + retryMs : null; // two retries, then wait for the next day
      state[name] = s;
      log(`job ${name} failed (attempt ${s.attempts}): ${e.message}`);
    } finally { running.delete(name); save(); }
  }

  function tick() {
    const t = now();
    const { date, minutes } = localParts(t, schedules.timezone);
    for (const [name, job] of Object.entries(schedules.jobs)) {
      if (!job.enabled || running.has(name)) continue;
      const s = state[name] ?? (state[name] = {});
      if (job.at) {
        const due = atMin(job.at);
        if (s.date === date) { if (s.nextTry && t >= s.nextTry) { s.nextTry = null; runJob(name, false); } continue; }
        if (minutes < due) continue;
        s.date = date; // mark the day first: even a run that is skipped as too old is not retried all day
        save();
        const late = minutes - due;
        if (late <= schedules.catchUpWindowMinutes) runJob(name, late > 2);
        else log(`job ${name}: today's ${job.at} run was missed by ${late} minutes, beyond the catch-up window`);
      } else if (job.everyMinutes && (!s.at || t - s.at >= job.everyMinutes * 60_000)) {
        s.at = t;
        runJob(name, false);
      }
    }
  }

  return {
    start() { tick(); timer = setInterval(tick, tickMs); timer.unref?.(); },
    stop() { clearInterval(timer); },
    tick, isRunning: (n) => running.has(n), state: () => structuredClone(state),
    list: () => Object.entries(schedules.jobs).map(([name, j]) => ({ name, enabled: j.enabled, at: j.at ?? null, everyMinutes: j.everyMinutes ?? null, lastDate: state[name]?.date ?? null })),
    runNow: (name) => runJob(name, false),
  };
}
