// The Intel page's tabs, like a browser's: + opens a Start tab (the home of the page, one tile per app), and
// picking an app turns that tab into the app. Each app has one tab (picking an app that is open goes to it).
// A page always has at least one tab. Panes announce themselves through `jarvis:intel-tab` so only the one in
// view does any work (draws, polls, streams). What is open is remembered.
import { icon } from '../icons/index.js';
import { currentPage } from './whiteboard-mode.js';

const APPS = {
  start: { label: 'Start', pane: 'intel-start' },
  osint: { label: 'OSINT', pane: 'intel-osint' },
  playwright: { label: 'Playwright', pane: 'intel-pw' },
};
const KEY = 'jarvis.intel.tabs.v2';

let tabs = ['start']; // kinds, in order: 'start' | 'osint' | 'playwright'
let active = 'start';
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  if (Array.isArray(saved?.tabs) && saved.tabs.length) {
    tabs = [...new Set(saved.tabs.filter((k) => APPS[k]))];
    active = tabs.includes(saved.active) ? saved.active : tabs[0];
  }
} catch { /* storage blocked */ }
if (!tabs.length) { tabs = ['start']; active = 'start'; }

const $ = (id) => document.getElementById(id);
const strip = $('intel-tabs');

export const activeIntelTab = () => (currentPage() === 'intel' ? active : '');

function save() { try { localStorage.setItem(KEY, JSON.stringify({ tabs, active })); } catch { /* storage blocked */ } }

function paint() {
  strip.replaceChildren(...tabs.map((kind) => {
    const tab = document.createElement('div');
    tab.className = 'ws-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(kind === active));
    const label = Object.assign(document.createElement('button'), { type: 'button', className: 't-label', textContent: APPS[kind].label });
    label.addEventListener('click', () => activate(kind));
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 't-x', innerHTML: icon('close', { size: 14 }), title: `Close ${APPS[kind].label}` });
    x.setAttribute('aria-label', `Close ${APPS[kind].label}`);
    x.addEventListener('click', () => close(kind));
    tab.append(label, x);
    return tab;
  }));
  Object.entries(APPS).forEach(([kind, a]) => { $(a.pane).hidden = kind !== active; });
  document.dispatchEvent(new CustomEvent('jarvis:intel-tab', { detail: { tab: activeIntelTab() } }));
}

function activate(kind) { active = kind; save(); paint(); }

function close(kind) {
  const i = tabs.indexOf(kind);
  tabs = tabs.filter((k) => k !== kind);
  if (!tabs.length) tabs = ['start'];
  if (active === kind) active = tabs[Math.min(i, tabs.length - 1)];
  save();
  paint();
}

// + : a new Start tab (there is only ever one, so a second click goes to it)
export function newIntelTab() {
  if (!tabs.includes('start')) tabs = [...tabs, 'start'];
  activate('start');
}

// An app was picked, in a Start tab or by JARVIS: it takes the Start tab's place, or goes to its own tab if it is already open.
export function openIntelTab(app) {
  if (!APPS[app] || app === 'start') return;
  if (tabs.includes(app)) tabs = tabs.filter((k) => k !== 'start');
  else if (tabs.includes('start')) tabs = tabs.map((k) => (k === 'start' ? app : k));
  else tabs = [...tabs, app];
  active = app;
  save();
  paint();
}

$('intel-add').addEventListener('click', newIntelTab);
document.querySelectorAll('.start-tile').forEach((t) => t.addEventListener('click', () => openIntelTab(t.dataset.app)));
// JARVIS opened the browser for the user: show its tab
document.addEventListener('jarvis:intel-open', (e) => openIntelTab(e.detail.tab));
document.addEventListener('jarvis:page', paint);
paint();
