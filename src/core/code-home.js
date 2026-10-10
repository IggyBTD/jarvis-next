// The Code page's home: usage of this machine's JARVIS (counts, a year-ish heat map, models), shown while the
// session is empty. Overview and Models tabs, All / 30d / 7d. Built from usage.js; nothing here talks to a model.
import { summarise, dayKey } from './usage.js';
import { currentPage } from './whiteboard-mode.js';

const host = document.getElementById('chat-empty');
const root = Object.assign(document.createElement('section'), { id: 'code-home' });
root.setAttribute('aria-label', 'Usage');
host.append(root);

const WEEKS = 26;
let tab = 'overview';
let range = 'all';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString('en-US'));
const hour = (h) => (h === null ? '--' : `${String(h).padStart(2, '0')}:00`);

function seg(options, current, set, label) {
  const box = el('div', { className: 'ch-seg', role: 'group' });
  box.setAttribute('aria-label', label);
  options.forEach(([id, text]) => {
    const b = el('button', { type: 'button', textContent: text });
    b.setAttribute('aria-pressed', String(id === current));
    b.addEventListener('click', () => { set(id); paint(); });
    box.append(b);
  });
  return box;
}

const tile = (label, value, small = false) => el('div', { className: 'ch-tile' }, el('span', { className: 'ch-label', textContent: label }), el('span', { className: `ch-value${small ? ' small' : ''}`, textContent: value }));

// Seven rows (Sunday to Saturday) by 26 weeks, the last column being this week. A cell's level is its share of the busiest day.
function heat(s) {
  const grid = el('div', { className: 'ch-heat', role: 'img' });
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (WEEKS - 1) * 7);
  const counts = [];
  for (let i = 0; i < WEEKS * 7; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    counts.push([d, d > today ? -1 : s.perDay(dayKey(d))]);
  }
  const max = Math.max(1, ...counts.map(([, n]) => n));
  counts.forEach(([d, n]) => {
    const cell = el('span', { className: 'ch-cell' });
    if (n < 0) cell.dataset.future = '';
    else { cell.dataset.level = n === 0 ? '0' : String(Math.min(4, Math.ceil((n / max) * 4))); cell.title = `${dayKey(d)}: ${n} message${n === 1 ? '' : 's'}`; }
    grid.append(cell);
  });
  grid.setAttribute('aria-label', `Messages per day over the last ${WEEKS} weeks`);
  return grid;
}

function overview(s) {
  const avg = s.messages ? Math.round(s.tokens / s.messages) : 0;
  const note = s.busiest
    ? `busiest day ${s.busiest.day} (${s.busiest.messages} message${s.busiest.messages === 1 ? '' : 's'})${avg ? `  |  ~${fmt(avg)} tokens per message` : ''}`
    : 'nothing recorded yet: messages you send from now on show up here';
  return [
    el('div', { className: 'ch-tiles' },
      tile('Sessions', fmt(s.sessions)), tile('Messages', fmt(s.messages)), tile('Tokens', s.tokens ? fmt(s.tokens) : '--'),
      tile('Active days', fmt(s.activeDays)), tile('Peak hour', hour(s.peak)), tile('Top model', s.favourite ?? '--', true)),
    heat(s),
    el('div', { className: 'ch-foot' }, el('span', { textContent: note }), el('span', { className: 'ch-legend' }, 'less', ...[0, 1, 2, 3, 4].map((l) => { const c = el('span', { className: 'ch-cell' }); c.dataset.level = String(l); return c; }), 'more')),
  ];
}

function models(s) {
  if (!s.models.length) return [el('div', { className: 'ch-foot', textContent: 'no model replies recorded in this range' })];
  const top = s.models[0][1].t || 1;
  return [el('div', { className: 'ch-models' }, ...s.models.map(([name, v]) => el('div', { className: 'ch-model' },
    el('span', { className: 'ch-mname', textContent: name }),
    el('span', { className: 'ch-bar' }, Object.assign(el('i'), { style: `transform: scaleX(${(v.t / top).toFixed(3)})` })),
    el('span', { className: 'ch-mnum', textContent: `${fmt(v.t)} tok  ${fmt(v.r)} rpl` }))))];
}

let painting = 0;
async function paint() {
  if (currentPage() !== 'code') return;
  const mine = ++painting;
  const s = await summarise(range);
  if (mine !== painting) return;
  root.replaceChildren(
    el('div', { className: 'ch-head' },
      el('span', { className: 'ch-title', textContent: 'usage' }),
      seg([['overview', 'Overview'], ['models', 'Models']], tab, (v) => { tab = v; }, 'View'),
      el('span', { className: 'grow' }),
      seg([['all', 'All'], ['30d', '30d'], ['7d', '7d']], range, (v) => { range = v; }, 'Range')),
    ...(tab === 'overview' ? overview(s) : models(s)),
  );
}

document.addEventListener('jarvis:page', paint);
document.addEventListener('jarvis:usage', paint);
document.addEventListener('jarvis:sessions-changed', paint);
paint();
