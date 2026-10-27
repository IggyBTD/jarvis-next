// The permission mode of the coding agent, as plain text under the input (Code only): Auto, Manual, Accept edits, Plan, Bypass
// permissions. It looks like text until you hover it (then a button outline); a click opens the five modes. With the JARVIS server on, the
// server holds and enforces the mode (opencode-bridge.js) and tells every app; without it the choice is only kept here (Plan still
// switches the old local plan mode).
import { MODES, DEFAULT_MODE, MODE_LABELS, MODE_HINTS } from '../../shared/permission-modes.js';
import { state, onLink, serverMode, setPermissionMode } from './server-link.js';
import { setPlanMode } from './work-state.js';

const KEY = 'jarvis.mode';
const chip = document.getElementById('mode-chip');
const menu = document.getElementById('mode-menu');
const saved = () => { try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : DEFAULT_MODE; } catch { return DEFAULT_MODE; } };
let local = saved();
export const getMode = () => (serverMode() && MODES.includes(state.permissionMode) ? state.permissionMode : local);

function paint() {
  const now = getMode();
  chip.textContent = MODE_LABELS[now];
  chip.title = `Permissions: ${MODE_HINTS[now]}`;
  chip.dataset.mode = now;
  menu.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.mode === now)));
  setPlanMode(now === 'plan');
}
const setMenu = (open) => {
  menu.hidden = !open;
  chip.setAttribute('aria-expanded', String(open));
  if (!open) return;
  menu.dataset.dir = 'up';
  if (menu.offsetHeight > chip.getBoundingClientRect().top - 16) menu.dataset.dir = 'down';
};

if (chip && menu) {
  menu.replaceChildren(...MODES.map((m) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'matrix-btn' });
    b.dataset.mode = m;
    b.setAttribute('role', 'menuitem');
    b.append(Object.assign(document.createElement('span'), { className: 'm-name', textContent: MODE_LABELS[m] }), Object.assign(document.createElement('span'), { className: 'm-sub', textContent: MODE_HINTS[m] }));
    b.addEventListener('click', () => {
      local = m;
      try { localStorage.setItem(KEY, m); } catch { /* storage blocked */ }
      if (serverMode()) { state.permissionMode = m; setPermissionMode(m); }
      paint(); setMenu(false);
    });
    return b;
  }));
  chip.addEventListener('click', () => setMenu(menu.hidden));
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#mode-wrap')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); chip.focus(); } });
  onLink((e) => { if (e?.type === 'mode' || e?.type === 'state') paint(); });
  paint();
}
