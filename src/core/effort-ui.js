// The effort level, shown as plain text beside the model name. It looks like text until you hover it (then it gets a button outline);
// a click opens the four levels. The choice is kept on this device and sent with every message (server-link.js).
import { EFFORTS, DEFAULT_EFFORT, EFFORT_LABELS, EFFORT_HINTS } from '../../shared/effort.js';

const KEY = 'jarvis.effort';
export function getEffort() {
  try { const v = localStorage.getItem(KEY); return EFFORTS.includes(v) ? v : DEFAULT_EFFORT; } catch { return DEFAULT_EFFORT; }
}

const chip = document.getElementById('effort-chip');
const menu = document.getElementById('effort-menu');

function paint() {
  const now = getEffort();
  chip.textContent = EFFORT_LABELS[now];
  chip.title = `Effort: ${EFFORT_HINTS[now]}`;
  menu.querySelectorAll('[data-effort]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.effort === now)));
}
const setMenu = (open) => {
  menu.hidden = !open;
  chip.setAttribute('aria-expanded', String(open));
  if (!open) return;
  menu.dataset.dir = 'up';
  if (menu.offsetHeight > chip.getBoundingClientRect().top - 16) menu.dataset.dir = 'down';
};

if (chip && menu) {
  menu.replaceChildren(...EFFORTS.map((e) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'matrix-btn' });
    b.dataset.effort = e;
    b.setAttribute('role', 'menuitem');
    const name = Object.assign(document.createElement('span'), { className: 'm-name', textContent: EFFORT_LABELS[e] });
    const sub = Object.assign(document.createElement('span'), { className: 'm-sub', textContent: EFFORT_HINTS[e] });
    b.append(name, sub);
    b.addEventListener('click', () => { try { localStorage.setItem(KEY, e); } catch { /* storage blocked: lasts until reload */ } paint(); setMenu(false); });
    return b;
  }));
  chip.addEventListener('click', () => setMenu(menu.hidden));
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#effort-wrap')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); chip.focus(); } });
  paint();
}
