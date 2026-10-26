// The app shell: sidebar, page switching, chat list, live readout, settings and artifacts pages.
// It only moves and fills DOM; every behaviour (chat, tools, telemetry, voice) stays in its module.
import { hydrateIcons } from '../icons/index.js';
import { PAGES, setPage, currentPage } from './whiteboard-mode.js';
import { openWidget, openArtifact } from './whiteboard.js';
import { listArtifacts, onArtifactsChange } from './artifacts.js';
import { getTelemetry, onTelemetry } from './telemetry-view.js';
import { getModelHealth, onModelHealth } from './model-panel.js';
import { getServices } from './service-status.js';
import { SHORTCUTS } from './shortcuts.js';
import { getPreset } from './llm-client.js';
import { serverMode, state as link, onLink } from './server-link.js';
import { run } from './chat-list.js';
import './context-menus.js';
import './projects-page.js';
import './pages-extra.js';
import './pages-accounts.js';
import { prettyModelName } from './model-name.js';
import './panel-pc.js';
import './panel-llm.js';
import './panel-outputs.js';
import './panel-tasks.js';
import './panel-env.js';

const $ = (id) => document.getElementById(id);
const input = $('hud-chat-input');
const stack = $('chat-stack');
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const level = (ratio) => (ratio > 0.9 ? 'high' : ratio > 0.7 ? 'mid' : '');

hydrateIcons();

// The window buttons (and the computer switch next to them) float over the top right corner: every strip keeps clear of exactly that width.
const titlebar = $('titlebar');
new ResizeObserver(() => document.documentElement.style.setProperty('--wc-w', `${Math.ceil(titlebar.getBoundingClientRect().width) + 8}px`)).observe(titlebar);

// A control that is on (pressed, listening) carries data-active; its icon then uses the set's filled variant.
const isOn = (b) => !['dock-web', 'dock-link', 'dock-attach'].includes(b.id) && (b.getAttribute('aria-pressed') === 'true' || (b.id === 'dock-mic' && b.classList.contains('is-on')) || b.classList.contains('recording'));
function syncActive(b) {
  if (b.closest('#cli-float, .cli-float-panel')) return;
  const was = b.hasAttribute('data-active');
  const now = isOn(b);
  if (was === now) return;
  b.toggleAttribute('data-active', now);
  hydrateIcons(b);
}
document.querySelectorAll('button[aria-pressed], .tool-btn').forEach(syncActive);
new MutationObserver((records) => records.forEach((r) => { if (r.target.matches?.('button')) syncActive(r.target); }))
  .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'class'] });

// --- pages ---------------------------------------------------------------------
const pageButtons = [...document.querySelectorAll('[data-page]')].filter((b) => b.tagName === 'BUTTON' && PAGES.includes(b.dataset.page));
pageButtons.forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));
$('nav-system').addEventListener('click', () => openWidget('system'));

// The one conversation lives in the chat page (Chat and Code share it), or beside the browser on the Intel page.
function placeChat() {
  const host = { intel: $('intel-session-body') }[currentPage()] ?? $('chat-host');
  if (stack.parentElement === host) return;
  host.append(stack);
  const out = $('chat-output');
  out.scrollTop = out.scrollHeight;
}
document.addEventListener('jarvis:page', () => {
  placeChat();
  pageButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.page === currentPage())));
  if (currentPage() === 'artifacts') renderArtifacts();
  if (['chat', 'code', 'intel'].includes(currentPage())) input.focus();
});

// --- model menu ---------------------------------------------------------------------
const chip = $('model-chip');
const menu = $('model-menu');
const presets = [...menu.querySelectorAll('.matrix-btn')];
// The menu opens above the chip (the chip sits at the bottom of the window); below it when there is no room above.
const setMenu = (open) => {
  menu.hidden = !open;
  chip.setAttribute('aria-expanded', String(open));
  if (!open) return;
  menu.dataset.dir = 'up';
  const room = chip.getBoundingClientRect().top - 16;
  if (menu.offsetHeight > room) menu.dataset.dir = 'down';
};
chip.addEventListener('click', () => setMenu(menu.hidden));
presets.forEach((b) => b.addEventListener('click', () => setMenu(false)));
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#model-wrap')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); chip.focus(); } });
const syncChip = () => { $('model-chip-label').textContent = presets.find((b) => b.classList.contains('active-mode'))?.querySelector('.m-name').textContent ?? 'General'; };
new MutationObserver(syncChip).observe(menu, { subtree: true, attributes: true, attributeFilter: ['class'] });
syncChip();

// --- composer ---------------------------------------------------------------------
$('send-btn').addEventListener('click', () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 192)}px`; });
const ctx = $('ctx-meter');
const paintCtx = () => {
  const { ctxUsed, ctxMax } = getModelHealth();
  ctx.textContent = ctxMax ? `${ctxUsed == null ? '--' : fmtK(ctxUsed)} / ${fmtK(ctxMax)}` : '';
  const ratio = ctxMax && ctxUsed != null ? Math.min(1, ctxUsed / ctxMax) : 0;
  ctx.style.setProperty('--ctx', String(ratio));
  ctx.dataset.level = level(ratio);
  ctx.title = 'Context used / available (tokens)';
};
onModelHealth(paintCtx);

// --- chat list and title (chat-list.js), context menus, projects, toasts ---------------------------------------------------------------------
$('new-chat').addEventListener('click', () => { setPage('chat'); run('/clear'); });
document.addEventListener('jarvis:toast', (e) => {
  const t = $('toast');
  t.textContent = e.detail.text;
  t.classList.add('on');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('on'), 3200);
});

// --- services (sidebar footer and settings) ---------------------------------------------------------------------
let servicesSeen = '';
function paintServices() {
  const services = getServices();
  const signature = JSON.stringify(services); // the list is rebuilt only when a service changed, not every second
  if (signature === servicesSeen) return;
  servicesSeen = signature;
  const dot = (s, detail) => {
    const el = Object.assign(document.createElement('span'), { className: 'svc', textContent: s.label ?? s.id });
    el.dataset.state = s.state;
    if (detail) el.title = `${s.state}: ${s.detail}`;
    return el;
  };
  const names = { lmstudio: 'LM Studio', sensors: 'Sensors', voice: 'Voice', server: 'JARVIS server' };
  const named = services.map((s) => ({ ...s, label: names[s.id] ?? s.id }));
  $('mini-services').replaceChildren(...named.map((s) => dot(s, true)));
  $('set-services').replaceChildren(...named.map((s) => {
    const row = Object.assign(document.createElement('div'), { className: 'set-row' });
    row.append(dot(s, false), Object.assign(document.createElement('span'), { className: 'does', textContent: s.detail || s.state }));
    return row;
  }));
}
setInterval(paintServices, 1000);
paintServices();

// --- artifacts page ---------------------------------------------------------------------
function renderArtifacts() {
  const box = $('art-list');
  const all = listArtifacts();
  if (!all.length) { box.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty-note', textContent: 'No artifacts yet. Ask for a chart, a page, a diagram or a document and it will appear here.' })); return; }
  const grid = Object.assign(document.createElement('div'), { className: 'art-grid' });
  all.slice().reverse().forEach((a) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'art-tile' });
    b.append(
      Object.assign(document.createElement('span'), { className: 'a-type', textContent: a.type === 'code' && a.lang ? a.lang : a.type }),
      Object.assign(document.createElement('span'), { className: 'a-title', textContent: a.title }),
      Object.assign(document.createElement('span'), { className: 'a-sub', textContent: `${a.versions.length} version${a.versions.length === 1 ? '' : 's'}` }),
    );
    b.addEventListener('click', () => openArtifact(a.id));
    grid.append(b);
  });
  box.replaceChildren(grid);
}
onArtifactsChange(() => { if (currentPage() === 'artifacts') renderArtifacts(); });

// --- settings ---------------------------------------------------------------------
const THEME = 'jarvis.theme';
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  document.querySelectorAll('#theme-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
  document.dispatchEvent(new CustomEvent('jarvis:theme'));
}
document.querySelectorAll('#theme-seg button').forEach((b) => b.addEventListener('click', () => {
  applyTheme(b.dataset.theme);
  try { localStorage.setItem(THEME, b.dataset.theme); } catch { /* storage blocked */ }
}));
try { applyTheme(localStorage.getItem(THEME) ?? 'system'); } catch { applyTheme('system'); }

$('set-keys').replaceChildren(...SHORTCUTS.map((s) => {
  const row = Object.assign(document.createElement('div'), { className: 'set-row' });
  row.append(Object.assign(document.createElement('kbd'), { textContent: s.keys }), Object.assign(document.createElement('span'), { className: 'does', textContent: s.does }));
  return row;
}));
$('open-commands').addEventListener('click', () => {
  setPage('chat');
  input.value = '/';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
});

// --- sidebar: Apple HIG asks that it can be hidden; Ctrl+\ and the button do it -------------------------
const sideToggle = $('side-toggle');
function setSidebar(open) {
  document.body.classList.toggle('side-off', !open);
  sideToggle.setAttribute('aria-label', open ? 'Hide sidebar' : 'Show sidebar');
  sideToggle.title = `${open ? 'Hide' : 'Show'} sidebar (Ctrl+\\)`;
  try { localStorage.setItem('jarvis.side', open ? 'on' : 'off'); } catch { /* storage blocked */ }
}
sideToggle.addEventListener('click', () => setSidebar(document.body.classList.contains('side-off')));
document.addEventListener('jarvis:sidebar', () => setSidebar(document.body.classList.contains('side-off')));
try { if (localStorage.getItem('jarvis.side') === 'off') setSidebar(false); } catch { /* storage blocked */ }

// --- empty state: a greeting and what this machine is doing right now -------------------------------------
const greet = $('greet');
const machine = $('machine');
const hour = new Date().getHours();
greet.textContent = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
const fact = (label, value) => {
  const el = Object.assign(document.createElement('span'), { className: 'fact' });
  el.append(`${label} `, Object.assign(document.createElement('b'), { textContent: value }));
  return el;
};
function paintMachine() {
  if (document.getElementById('chat-stack')?.querySelector('.chat-line')) return;
  const { data: d, offline } = getTelemetry();
  const { ctxMax } = getModelHealth();
  const facts = [fact('Model', serverMode() ? (link.health?.model?.modelId ? prettyModelName(link.health.model.modelId) : 'server') : prettyModelName(getPreset().model))];
  if (ctxMax) facts.push(fact('Context', fmtK(ctxMax)));
  if (!offline && Number.isFinite(d.GPU_Temperature)) facts.push(fact('GPU', `${Math.round(d.GPU_Temperature)} °C`));
  if (!offline && Number.isFinite(d.Memory_Usage)) facts.push(fact('RAM', `${d.Memory_Usage.toFixed(1)} of ${Math.round(d.Memory_Total)} GB`));
  if (offline) facts.push(fact('Sensors', 'offline'));
  machine.replaceChildren(...facts);
}
onTelemetry(paintMachine);
onModelHealth(paintMachine);
onLink(paintMachine);
paintMachine();
