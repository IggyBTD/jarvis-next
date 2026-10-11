// The Intel page's tabs: OSINT (map) and Playwright (browser). Open and close them like the workspace's tabs;
// the + button lists the ones that are closed. What is open is remembered. Panes announce themselves through
// `jarvis:intel-tab` so only the one in view does any work (draws, polls, streams).
import { icon } from '../icons/index.js';
import { currentPage } from './whiteboard-mode.js';

const TABS = {
  osint: { label: 'OSINT', pane: 'intel-osint' },
  playwright: { label: 'Playwright', pane: 'intel-pw' },
};
const KEY = 'jarvis.intel.tabs';

let open = ['osint'];
let active = 'osint';
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  if (Array.isArray(saved?.open)) { open = saved.open.filter((id) => TABS[id]); active = TABS[saved.active] && open.includes(saved.active) ? saved.active : open[0] ?? ''; }
} catch { /* storage blocked */ }

const $ = (id) => document.getElementById(id);
const strip = $('intel-tabs');
const menu = $('intel-menu');
const add = $('intel-add');

export const activeIntelTab = () => (currentPage() === 'intel' ? active : '');

function save() { try { localStorage.setItem(KEY, JSON.stringify({ open, active })); } catch { /* storage blocked */ } }

function paint() {
  strip.replaceChildren(...open.map((id) => {
    const tab = document.createElement('div');
    tab.className = 'ws-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(id === active));
    const label = Object.assign(document.createElement('button'), { type: 'button', className: 't-label', textContent: TABS[id].label });
    label.addEventListener('click', () => activate(id));
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 't-x', innerHTML: icon('close', { size: 14 }), title: `Close ${TABS[id].label}` });
    x.setAttribute('aria-label', `Close ${TABS[id].label}`);
    x.addEventListener('click', () => close(id));
    tab.append(label, x);
    return tab;
  }));
  Object.entries(TABS).forEach(([id, t]) => { $(t.pane).hidden = id !== active; });
  $('intel-none').hidden = open.length > 0;
  add.hidden = open.length === Object.keys(TABS).length;
  document.dispatchEvent(new CustomEvent('jarvis:intel-tab', { detail: { tab: activeIntelTab() } }));
}

function activate(id) { active = id; save(); paint(); }
function close(id) {
  open = open.filter((x) => x !== id);
  if (active === id) active = open[open.length - 1] ?? '';
  save();
  paint();
}
export function openIntelTab(id) {
  if (!TABS[id]) return;
  if (!open.includes(id)) open = [...open, id];
  active = id;
  save();
  paint();
}

// the + menu: the closed tabs
function setMenu(on) {
  menu.hidden = !on;
  add.setAttribute('aria-expanded', String(on));
  if (!on) return;
  menu.replaceChildren(...Object.entries(TABS).filter(([id]) => !open.includes(id)).map(([id, t]) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t.label });
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => { setMenu(false); openIntelTab(id); });
    return b;
  }));
}
add.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#intel-add-wrap')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); add.focus(); } });

// JARVIS opened the browser for the user: show its tab
document.addEventListener('jarvis:intel-open', (e) => openIntelTab(e.detail.tab));
document.addEventListener('jarvis:page', () => { paint(); });
paint();
