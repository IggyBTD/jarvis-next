// Small builders shared by the panel's tabs: a key and value row, a meter, a note. Nothing here has a colour: the classes do (workspace.css, system.css).
export const $ = (id) => document.getElementById(id);
export const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
export const fmtK = (n) => (n == null ? '--' : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
export const fmtGB = (n, digits = 1) => (n == null ? '--' : `${n.toFixed(digits)} GB`);
export const levelOf = (ratio) => (ratio > 0.9 ? 'high' : ratio > 0.7 ? 'mid' : '');
export const fill = (id, nodes) => $(id)?.replaceChildren(...nodes);
export const note = (text) => el('div', { className: 'info-note', textContent: text });

// a key on the left, a value on the right, an optional state dot (ok, bad, idle) and an optional click
export function row(k, v, dot = null, onClick = null) {
  const r = el(onClick ? 'button' : 'div', { className: `info-row${onClick ? ' clickable' : ''}` });
  if (onClick) { r.type = 'button'; r.addEventListener('click', onClick); }
  if (dot) { const d = el('i', { className: 'dot' }); d.dataset.state = dot; r.append(d); }
  r.append(el('span', { className: 'k', textContent: k }), el('span', { className: 'v', textContent: v }));
  return r;
}

// a label, a value, and a bar that fills to `ratio` (null = no reading: grey, "N/A")
export function meter(label, value, ratio, { level = ratio == null ? '' : levelOf(ratio) } = {}) {
  const na = ratio == null;
  const val = el('span', { className: `mono-data${na ? ' na' : ''}`, textContent: na ? 'N/A' : value });
  const fillEl = el('div', { className: 'progress-fill' });
  fillEl.style.transform = `scaleX(${na ? 0 : Math.max(0, Math.min(1, ratio))})`;
  if (level) fillEl.dataset.level = level;
  return el('div', { className: 'metric-group' }, el('div', { className: 'metric-label' }, label, ' ', val), el('div', { className: 'progress-bar' }, fillEl));
}

// run `paint` for one tab: only while that tab is on screen, at most once per frame
export function onTabPaint(id, paint) {
  let active = document.querySelector('#ws-tabs [aria-selected="true"]')?.dataset.id ?? null; // whiteboard.js drew the tabs before this module loaded
  let queued = false;
  const on = () => active === id || active === 'overview'; // the cards of the Overview each have their own module
  const run = () => { if (!on() || queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (on()) paint(); }); };
  document.addEventListener('jarvis:tab', (e) => { active = e.detail.id; run(); });
  run();
  return { poke: run, isActive: on };
}

// The Overview's cards fold; which ones are open is kept on this device.
const CARDS = 'jarvis.cards';
const savedCards = () => { try { return JSON.parse(localStorage.getItem(CARDS)) ?? {}; } catch { return {}; } };
document.querySelectorAll('details.p-card').forEach((d) => {
  const was = savedCards()[d.dataset.card];
  if (typeof was === 'boolean') d.open = was;
  d.addEventListener('toggle', () => { try { localStorage.setItem(CARDS, JSON.stringify({ ...savedCards(), [d.dataset.card]: d.open })); } catch { /* storage blocked */ } });
});
