// The app shell: sidebar, page switching, chat list, live readout, settings and artifacts pages.
// It only moves and fills DOM; every behaviour (chat, tools, telemetry, voice) stays in its module.
import { hydrate } from './icons.js';
import { PAGES, setPage, currentPage } from './whiteboard-mode.js';
import { openWidget, openArtifact } from './whiteboard.js';
import { listArtifacts, onArtifactsChange } from './artifacts.js';
import { getTelemetry, onTelemetry } from './telemetry-view.js';
import { getModelHealth, onModelHealth } from './model-panel.js';
import { getServices } from './service-status.js';
import { listSessions, loadSession, saveSession, deleteSession, searchSessions } from './sessions.js';
import { SHORTCUTS } from './shortcuts.js';
import { getPreset } from './llm-client.js';

const $ = (id) => document.getElementById(id);
const input = $('hud-chat-input');
const stack = $('chat-stack');
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const level = (ratio) => (ratio > 0.9 ? 'high' : ratio > 0.75 ? 'mid' : '');

hydrate();

// --- pages ---------------------------------------------------------------------
const pageButtons = [...document.querySelectorAll('[data-page]')].filter((b) => b.tagName === 'BUTTON' && PAGES.includes(b.dataset.page));
pageButtons.forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));
$('nav-system').addEventListener('click', () => openWidget('system'));

// The one conversation lives in the chat page, or in the Code page's session column.
function placeChat() {
  const host = currentPage() === 'code' ? $('cli-session-body') : $('chat-host');
  if (stack.parentElement === host) return;
  host.append(stack);
  const out = $('chat-output');
  out.scrollTop = out.scrollHeight;
}
document.addEventListener('jarvis:page', () => {
  placeChat();
  pageButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.page === currentPage())));
  if (currentPage() === 'artifacts') renderArtifacts();
  if (currentPage() === 'chat' || currentPage() === 'code') input.focus();
  refreshChats();
});

// --- model menu ---------------------------------------------------------------------
const chip = $('model-chip');
const menu = $('model-menu');
const presets = [...menu.querySelectorAll('.matrix-btn')];
const setMenu = (open) => { menu.hidden = !open; chip.setAttribute('aria-expanded', String(open)); };
chip.addEventListener('click', () => setMenu(menu.hidden));
presets.forEach((b) => b.addEventListener('click', () => setMenu(false)));
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#model-wrap')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); chip.focus(); } });
const syncChip = () => { $('model-chip-label').textContent = presets.find((b) => b.classList.contains('active-mode'))?.querySelector('.m-name').textContent ?? 'General'; };
new MutationObserver(syncChip).observe(menu, { subtree: true, attributes: true, attributeFilter: ['class'] });
syncChip();

// --- composer ---------------------------------------------------------------------
$('send-btn').addEventListener('click', () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 224)}px`; });
const ctx = $('ctx-meter');
const paintCtx = () => {
  const { ctxUsed, ctxMax } = getModelHealth();
  ctx.textContent = ctxMax ? `${ctxUsed == null ? '--' : fmtK(ctxUsed)} / ${fmtK(ctxMax)}` : '';
  ctx.title = 'Context used / available (tokens)';
};
onModelHealth(paintCtx);

// --- chat list and title ---------------------------------------------------------------------
const list = $('chat-list');
const search = $('chat-search');
let current = '';
const el = (tag, props) => Object.assign(document.createElement(tag), props);

// One row: the chat (click resumes it), and on hover Rename and Delete. Delete asks once more on the
// same button instead of a browser dialog.
function chatRow(s, snippet = '') {
  const row = el('div', { className: `chat-row${s.id === current ? ' current' : ''}`, role: 'listitem' });
  const open = el('button', { type: 'button', className: 'chat-item', textContent: s.name || 'Untitled', title: s.name || 'Untitled' });
  if (snippet) open.append(el('span', { className: 'chat-snippet', textContent: snippet }));
  open.addEventListener('click', () => { current = s.id; setPage('chat'); run(`/resume ${s.id}`); });
  const rename = el('button', { type: 'button', className: 'chat-act', textContent: 'Rename', title: 'Rename this chat' });
  const del = el('button', { type: 'button', className: 'chat-act', textContent: 'Delete', title: 'Delete this chat' });
  rename.addEventListener('click', () => {
    const field = el('input', { type: 'text', className: 'chat-rename', value: s.name || '', ariaLabel: 'New name' });
    row.replaceChildren(field);
    field.focus();
    field.select();
    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      const name = field.value.trim().slice(0, 80);
      if (keep && name && name !== s.name) {
        try { await saveSession({ ...s, name }, await loadSession(s.id)); } catch (e) { console.warn('[jarvis] rename failed:', e); }
        document.dispatchEvent(new CustomEvent('jarvis:session-renamed', { detail: { id: s.id, name } }));
      }
      field.remove(); // before refreshing, which skips while a rename field is open
      refreshChats();
    };
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    field.addEventListener('blur', () => finish(true));
  });
  del.addEventListener('click', async () => {
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm');
      del.textContent = 'Sure?';
      setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Delete'; }, 3000);
      return;
    }
    try { await deleteSession(s.id); } catch (e) { console.warn('[jarvis] delete failed:', e); return; }
    document.dispatchEvent(new CustomEvent('jarvis:session-deleted', { detail: { id: s.id } }));
    if (current === s.id) current = '';
    refreshChats();
  });
  row.append(open, rename, del);
  return row;
}

async function refreshChats() {
  const q = search.value.trim();
  let sessions = [];
  try { sessions = (await (q ? searchSessions(q) : listSessions())) ?? []; } catch { /* a plain browser has no session store */ }
  if (!q) sessions.sort((a, b) => b.updated - a.updated);
  if (!sessions.length) { list.replaceChildren(el('div', { className: 'chat-list-empty', textContent: q ? 'No chat matches.' : 'No saved chats yet.' })); return; }
  if (list.querySelector('.chat-rename')) return; // do not throw away a name being typed
  list.replaceChildren(...sessions.slice(0, 40).map((s) => chatRow(s, q ? s.snippet : '')));
}
let searchTimer = 0;
search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refreshChats, 200); });
search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; refreshChats(); } });
document.addEventListener('jarvis:saved', (e) => { current = e.detail.id; refreshChats(); });
// Slash commands go through the message field, the one door chat-ui.js guards.
function run(text) {
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
$('new-chat').addEventListener('click', () => { current = ''; setPage('chat'); run('/clear'); });
setInterval(() => { if (!document.hidden) refreshChats(); }, 5000);
refreshChats();

const title = $('chat-title');
const out = $('chat-output');
new MutationObserver(() => {
  const first = out.querySelector('.chat-line.user .chat-text')?.textContent.trim();
  title.textContent = first ? first.split('\n')[0].slice(0, 60) : 'New chat';
}).observe(out, { childList: true });

// --- live readout in the sidebar ---------------------------------------------------------------------
function mini(id, ratio, text) {
  $(`mini-${id}`).textContent = text;
  const bar = $(`mini-${id}-bar`);
  bar.style.transform = `scaleX(${ratio ?? 0})`;
  bar.dataset.level = ratio == null ? '' : level(ratio);
}
function paintMini() {
  const { data: d, offline } = getTelemetry();
  const n = (k) => (!offline && typeof d[k] === 'number' ? d[k] : null);
  const cpu = n('CPU_Load');
  const gpu = n('GPU_Compute_Load');
  const ram = n('Memory_Usage');
  const ramTotal = n('Memory_Total');
  mini('cpu', cpu == null ? null : cpu / 100, cpu == null ? 'N/A' : `${Math.round(cpu)}%`);
  mini('gpu', gpu == null ? null : gpu / 100, gpu == null ? 'N/A' : `${Math.round(gpu)}%`);
  mini('ram', ram == null || !ramTotal ? null : ram / ramTotal, ram == null ? 'N/A' : `${ram.toFixed(1)} GB`);
}
onTelemetry(paintMini);
paintMini();

// --- services (sidebar footer and settings) ---------------------------------------------------------------------
function paintServices() {
  const services = getServices();
  const dot = (s, detail) => {
    const el = Object.assign(document.createElement('span'), { className: 'svc', textContent: s.label ?? s.id });
    el.dataset.state = s.state;
    if (detail) el.title = `${s.state}: ${s.detail}`;
    return el;
  };
  const names = { lmstudio: 'LM Studio', sensors: 'Sensors', voice: 'Voice' };
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
// Under 1024 px the sidebar would squeeze the chat, so it starts hidden and opens as a sheet over
// the content (app.css); a click outside closes it. Only a choice made in a wide window is saved.
const narrow = matchMedia('(max-width: 1023px)');
function setSidebar(open, { save = !narrow.matches } = {}) {
  document.body.classList.toggle('side-off', !open);
  sideToggle.setAttribute('aria-label', open ? 'Hide sidebar' : 'Show sidebar');
  sideToggle.title = `${open ? 'Hide' : 'Show'} sidebar (Ctrl+\\)`;
  if (save) try { localStorage.setItem('jarvis.side', open ? 'on' : 'off'); } catch { /* storage blocked */ }
}
const savedSide = () => { try { return localStorage.getItem('jarvis.side') !== 'off'; } catch { return true; } };
narrow.addEventListener('change', () => setSidebar(!narrow.matches && savedSide(), { save: false }));
document.addEventListener('pointerdown', (e) => {
  if (narrow.matches && !document.body.classList.contains('side-off') && !e.target.closest('#sidebar, #side-toggle')) setSidebar(false);
});
// In the sheet, choosing somewhere to go closes it (search and Rename / Delete keep it open).
$('sidebar').addEventListener('click', (e) => { if (narrow.matches && e.target.closest('.nav-item, .chat-item, #new-chat, .mode-btn')) setSidebar(false); });
sideToggle.addEventListener('click', () => setSidebar(document.body.classList.contains('side-off')));
document.addEventListener('jarvis:sidebar', () => setSidebar(document.body.classList.contains('side-off')));
if (narrow.matches || !savedSide()) setSidebar(false, { save: false });

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
  const facts = [fact('Model', getPreset().model.split('/').pop())];
  if (ctxMax) facts.push(fact('Context', fmtK(ctxMax)));
  if (!offline && Number.isFinite(d.GPU_Temperature)) facts.push(fact('GPU', `${Math.round(d.GPU_Temperature)} °C`));
  if (!offline && Number.isFinite(d.Memory_Usage)) facts.push(fact('RAM', `${d.Memory_Usage.toFixed(1)} of ${Math.round(d.Memory_Total)} GB`));
  if (offline) facts.push(fact('Sensors', 'offline'));
  machine.replaceChildren(...facts);
}
onTelemetry(paintMachine);
onModelHealth(paintMachine);
paintMachine();
