// Dev only (imported from main.js behind import.meta.env.DEV): Ctrl+Shift+I toggles a bar at the top edge to
// cycle icon sets live, tune stroke and size, compare, and pick one.
import { listSets, getIconSet, setIconSet, onIconSetChange, getSetData, semanticNames, renderFrom } from '../icons/index.js';

const SIZES = [16, 18, 20];
const STROKES = [1, 1.25, 1.5, 1.75, 2];
const root = document.documentElement;

const style = document.createElement('style');
style.textContent = `
#isw { position: fixed; top: 4px; left: 50%; translate: -50% 0; z-index: 900; display: none; align-items: center; gap: var(--s-2); padding: var(--s-1) var(--s-2); background: var(--surface-3); border: 1px solid var(--border-strong); border-radius: var(--r-md); box-shadow: var(--shadow); font: 12px var(--sans); color: var(--text); pointer-events: auto; }
#isw.on { display: flex; }
#isw select, #isw button { white-space: nowrap; height: 28px; padding: 0 var(--s-2); background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-sm); font: inherit; }
#isw button:hover, #isw select:hover { border-color: var(--border-strong); }
#isw button.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
#isw label { color: var(--text-3); display: inline-flex; align-items: center; gap: 4px; }
#isw .sep { width: 1px; height: 18px; background: var(--border); }
#isw-compare { position: fixed; inset: 0; z-index: 899; background: var(--bg); overflow: auto; padding: 56px var(--s-5) var(--s-5); display: none; color: var(--text); font: 12px var(--sans); }
#isw-compare.on { display: block; }
#isw-compare h2 { font: 600 16px var(--sans); margin-bottom: var(--s-3); }
#isw-compare table { border-collapse: collapse; }
#isw-compare th, #isw-compare td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap; }
#isw-compare th { color: var(--text-2); font-weight: 500; position: sticky; top: 0; background: var(--bg); }
#isw-compare td:first-child, #isw-compare th:first-child { text-align: left; color: var(--text-2); position: sticky; left: 0; background: var(--bg); }
#isw-compare .chip { display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--r-sm); color: var(--text); }
#isw-compare .on-bg { background: var(--bg); } #isw-compare .on-s1 { background: var(--surface-1); }
#isw-compare td svg { display: block; margin: auto; }
`;
document.head.append(style);

const bar = document.createElement('div');
bar.id = 'isw';
bar.setAttribute('role', 'toolbar');
bar.setAttribute('aria-label', 'Icon switcher (dev only)');
const sets = listSets();
bar.innerHTML = `
  <button type="button" id="isw-prev" aria-label="Previous set">‹</button>
  <select id="isw-set" aria-label="Icon set">${sets.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
  <button type="button" id="isw-next" aria-label="Next set">›</button>
  <span class="sep"></span>
  <label>Stroke <select id="isw-stroke">${STROKES.map((v) => `<option value="${v}"${v === 1.5 ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
  <label>Size <select id="isw-size">${SIZES.map((v) => `<option value="${v}"${v === 18 ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
  <span class="sep"></span>
  <button type="button" id="isw-cmp">Compare</button>
  <button type="button" id="isw-all">Compare all sets</button>
  <button type="button" id="isw-pick" class="primary">Pick this one</button>
  <button type="button" id="isw-x" aria-label="Close">×</button>`;
document.body.append(bar);
const view = document.createElement('div');
view.id = 'isw-compare';
document.body.append(view);

const $ = (id) => bar.querySelector(id);
const sel = $('#isw-set');
const stroke = $('#isw-stroke');
const size = $('#isw-size');
const isStroke = () => ['iconoir:regular', 'lucide:baseline', 'ref:outline', 'tabler:outline'].includes(getIconSet());
const sync = () => {
  sel.value = getIconSet();
  stroke.disabled = !isStroke(); // the other sets bake their weight into the shapes
  stroke.title = stroke.disabled ? 'This set has its weight built into the shapes' : 'Line weight';
};
const step = (d) => { const i = sets.findIndex((s) => s.id === getIconSet()); setIconSet(sets[(i + d + sets.length) % sets.length].id); };

sel.addEventListener('change', () => setIconSet(sel.value));
$('#isw-prev').addEventListener('click', () => step(-1));
$('#isw-next').addEventListener('click', () => step(1));
stroke.addEventListener('change', () => root.style.setProperty('--icon-stroke', stroke.value));
size.addEventListener('change', () => root.style.setProperty('--icon-size', `${size.value}px`));
$('#isw-x').addEventListener('click', () => bar.classList.remove('on'));
onIconSetChange(() => { sync(); if (view.classList.contains('on')) draw(); });
sync();

// ---- compare views ------------------------------------------------------------
let mode = null;
async function draw() {
  const names = semanticNames();
  if (mode === 'one') {
    const [set, variant] = getIconSet().split(':');
    const src = await getSetData(set, variant);
    view.innerHTML = `<h2>${getIconSet()} at 16, 18 and 24 px, on the page background and on surface-1</h2><table><thead><tr><th>name</th><th colspan="3">on bg</th><th colspan="3">on surface-1</th></tr></thead><tbody>${names.map((n) => `<tr><td>${n}</td>${['on-bg', 'on-s1'].map((cls) => [16, 18, 24].map((px) => `<td class="${cls}">${renderFrom(src, n, { size: px })}</td>`).join('')).join('')}</tr>`).join('')}</tbody></table>`;
  } else {
    const loaded = await Promise.all(sets.map(async (s) => ({ ...s, src: await getSetData(s.set, s.variant) })));
    view.innerHTML = `<h2>Every set, every variant, one row per icon (18 px)</h2><table><thead><tr><th>name</th>${loaded.map((s) => `<th>${s.label}</th>`).join('')}</tr></thead><tbody>${names.map((n) => `<tr><td>${n}</td>${loaded.map((s) => `<td>${renderFrom(s.src, n, { size: 18 })}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
}
const toggleView = (m) => { if (view.classList.contains('on') && mode === m) { view.classList.remove('on'); return; } mode = m; view.classList.add('on'); draw(); };
$('#isw-cmp').addEventListener('click', () => toggleView('one'));
$('#isw-all').addEventListener('click', () => toggleView('all'));

// ---- pick ----------------------------------------------------------------------
$('#isw-pick').addEventListener('click', async () => {
  const [set, variant] = getIconSet().split(':');
  const btn = $('#isw-pick');
  try {
    const res = await fetch('/__icons/choose', { method: 'POST', body: JSON.stringify({ set, variant }) });
    if (!res.ok) throw new Error(await res.text());
    btn.textContent = `Saved ${set}:${variant}. Run: npm run icons:finalise`;
  } catch {
    btn.textContent = `Could not save. Write icons/chosen.json: {"set":"${set}","variant":"${variant}"}`;
  }
});

// ---- keys ----------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); bar.classList.toggle('on'); if (bar.classList.contains('on')) sel.focus(); return; }
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && bar.classList.contains('on')) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); }
  if (e.key === 'Escape' && view.classList.contains('on')) view.classList.remove('on');
}, true);
if (new URLSearchParams(location.search).has('icons')) bar.classList.add('on');
