// Timers and reminders, kept on the server (so they survive the client closing) in data/reminders.json. A reminder that fires
// while no client is connected is kept and delivered at the next hello. Times are whole minutes.
import path from 'node:path';
import { readJson, writeJsonAtomic, newId, clip } from '../../shared/util.js';
import { localParts } from './scheduler.js';

// "2026-10-18 21:30" in the schedule timezone -> epoch ms (null if it is not a real time). Works across DST by searching
// for the instant whose local reading matches, not by adding an offset.
export function localToMs(text, timeZone) {
  const m = String(text).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const want = `${m[1]}-${m[2]}-${m[3]}`;
  const wantMin = Number(m[4]) * 60 + Number(m[5]);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  for (let h = -14 * 60; h <= 14 * 60; h += 30) {
    for (const adj of [0, 15]) {
      const t = guess + (h + adj) * 60_000;
      const p = localParts(t, timeZone);
      if (p.date === want && p.minutes === wantMin) return t;
    }
  }
  return null;
}

export function createReminders({ dataDir, bus, clientCount, timezone, now = Date.now }) {
  const file = path.join(dataDir, 'reminders.json');
  let items = readJson(file, []);
  const save = () => { try { writeJsonAtomic(file, items); } catch (e) { console.error(`[reminders] cannot save: ${e.message}`); } };
  const fire = (r) => { bus.publish('reminder.fire', { id: r.id, text: r.text, when: new Date(r.at).toISOString(), kind: r.kind }); };

  return {
    add({ text, at, kind = 'reminder' }) { const r = { id: newId('r-').slice(0, 12), text: clip(text, 300), at, kind, state: 'pending' }; items.push(r); save(); return r; },
    addInMinutes(minutes, label) { return this.add({ text: label || `Timer: ${minutes} min`, at: now() + minutes * 60_000, kind: 'timer' }); },
    // called by the scheduler job and on a short interval
    tick() {
      let changed = false;
      for (const r of items) if (r.state === 'pending' && r.at <= now()) {
        changed = true;
        if (clientCount() > 0) { r.state = 'done'; fire(r); } else r.state = 'missed';
      }
      if (changed) save();
      return changed;
    },
    deliverMissed() { for (const r of items.filter((x) => x.state === 'missed')) { r.state = 'done'; fire(r); } save(); },
    missedFor: () => items.filter((r) => r.state === 'missed').map((r) => ({ id: r.id, text: r.text, when: new Date(r.at).toISOString() })),
    dismiss(id) { items = items.filter((r) => r.id !== id); save(); },
    list: () => items.filter((r) => r.state === 'pending').map((r) => ({ id: r.id, kind: r.kind, text: r.text, at: new Date(r.at).toISOString() })),
    timezone,
  };
}

// The model-facing time tools (internal contract entries in actions.json: they run here, not on an agent).
export function registerTimeTools(router, { reminders, scheduler, timezone, now = Date.now }) {
  const reg = (name, handler) => router.register({ name, handler });
  reg('set_timer', ({ minutes, label }) => { const r = reminders.addInMinutes(minutes, label); return { id: r.id, firesAt: new Date(r.at).toISOString() }; });
  reg('set_reminder', ({ when, text }) => {
    const at = localToMs(when, timezone);
    if (at === null) return { error: `"${when}" is not a time. Use YYYY-MM-DD HH:MM in ${timezone}.` };
    if (at <= now()) return { error: 'that time has already passed' };
    const r = reminders.add({ text, at });
    return { id: r.id, firesAt: new Date(r.at).toISOString() };
  });
  reg('list_schedules', () => ({ reminders: reminders.list(), jobs: scheduler?.list() ?? [] }));
}
