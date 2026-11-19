// What JARVIS has been used for, kept as small per-day counts in this browser's storage:
// messages sent, tokens processed, which hours, which model. Nothing about the content is stored.
// The first time it runs, saved sessions give the message counts and hours of the past (tokens were never recorded).
import { onEvent } from './llm-client.js';
import { listSessions } from './sessions.js';

const KEY = 'jarvis.usage';
let store = { days: {}, seeded: false };
try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s?.days) store = s; } catch { /* storage blocked */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage blocked */ } };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = (key) => (store.days[key] ??= { m: 0, t: 0, h: Array(24).fill(0), mo: {} });
const model = (day, name) => (day.mo[name] ??= { r: 0, t: 0 });

// a message of the user's goes to the model
document.addEventListener('jarvis:message-sent', () => {
  const now = new Date();
  const d = dayOf(dayKey(now));
  d.m += 1;
  d.h[now.getHours()] += 1;
  save();
  document.dispatchEvent(new CustomEvent('jarvis:usage'));
});

// a reply came back: its tokens and the model that wrote it
onEvent((e) => {
  if (e.type !== 'stats') return;
  const tokens = (e.stats.promptTokens ?? 0) + (e.stats.completionTokens ?? 0);
  const d = dayOf(dayKey());
  d.t += tokens;
  const mo = model(d, e.model.split('/').pop());
  mo.r += 1;
  mo.t += tokens;
  save();
  document.dispatchEvent(new CustomEvent('jarvis:usage'));
});

async function seed() {
  if (store.seeded) return;
  let sessions;
  try { sessions = await listSessions(); } catch { return; } // no session store (a plain browser): try again later
  if (!Array.isArray(sessions)) return;
  sessions.forEach((s) => {
    if (!s.updated) return;
    const when = new Date(s.updated);
    const d = dayOf(dayKey(when));
    d.m += s.messages ?? 0;
    d.h[when.getHours()] += s.messages ?? 0;
  });
  store.seeded = true;
  save();
}
seed();

const RANGES = { all: Infinity, '30d': 30, '7d': 7 };

// Numbers for one range: totals, the favourite model, the busiest hour and day, and a count per day for the heat map.
export async function summarise(range = 'all') {
  const span = RANGES[range] ?? Infinity;
  const from = Number.isFinite(span) ? Date.now() - span * 86400000 : 0;
  const keys = Object.keys(store.days).filter((k) => new Date(`${k}T12:00:00`).getTime() >= from).sort();
  const hours = Array(24).fill(0);
  const models = {};
  let messages = 0;
  let tokens = 0;
  let busiest = null;
  for (const k of keys) {
    const d = store.days[k];
    messages += d.m;
    tokens += d.t;
    d.h.forEach((n, i) => { hours[i] += n; });
    Object.entries(d.mo).forEach(([name, v]) => { const t = (models[name] ??= { r: 0, t: 0 }); t.r += v.r; t.t += v.t; });
    if (!busiest || d.m > store.days[busiest].m) busiest = k;
  }
  let sessions = 0;
  try { sessions = ((await listSessions()) ?? []).filter((s) => (s.updated ?? 0) >= from).length; } catch { /* no session store */ }
  const peak = hours.some((n) => n) ? hours.indexOf(Math.max(...hours)) : null;
  const ranked = Object.entries(models).sort((a, b) => b[1].t - a[1].t);
  return {
    sessions, messages, tokens,
    activeDays: keys.filter((k) => store.days[k].m || store.days[k].t).length,
    peak, favourite: ranked[0]?.[0] ?? null, models: ranked,
    busiest: busiest && store.days[busiest].m ? { day: busiest, messages: store.days[busiest].m } : null,
    perDay: (key) => store.days[key]?.m ?? 0,
  };
}
export { dayKey };
