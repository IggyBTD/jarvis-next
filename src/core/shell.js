// The app shell: sidebar, page switching, chat list, live readout, settings and artifacts pages.
// It only moves and fills DOM; every behaviour (chat, tools, telemetry, voice) stays in its module.
import { hydrateIcons } from '../icons/index.js';
import { PAGES, setPage, currentPage } from './whiteboard-mode.js';
import { openWidget, openArtifact } from './whiteboard.js';
import { listArtifacts, onArtifactsChange } from './artifacts.js';
import { getTelemetry, onTelemetry } from './telemetry-view.js';
import { getModelHealth, onModelHealth } from './model-panel.js';
import { getServices } from './service-status.js';
import { listSessions } from './sessions.js';
import { SHORTCUTS } from './shortcuts.js';
import { getPreset } from './llm-client.js';

const $ = (id) => document.getElementById(id);
const input = $('hud-chat-input');
const stack = $('chat-stack');
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const level = (ratio) => (ratio > 0.9 ? 'high' : ratio > 0.7 ? 'mid' : '');

hydrateIcons();

// A control that is on (pressed, listening) carries data-active; its icon then uses the set's filled variant.
const isOn = (b) => b.getAttribute('aria-pressed') === 'true' || (b.id === 'dock-mic' && b.classList.contains('is-on')) || b.classList.contains('recording');
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
let current = '';
async function refreshChats() {
  let sessions = [];
  try { sessions = (await listSessions()) ?? []; } catch { /* a plain browser has no session store */ }
  sessions.sort((a, b) => b.updated - a.updated);
  if (!sessions.length) { list.replaceChildren(Object.assign(document.createElement('div'), { className: 'chat-list-empty', textContent: 'No saved chats yet.' })); return; }
  list.replaceChildren(...sessions.slice(0, 40).map((s) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: `chat-item${s.id === current ? ' current' : ''}`, textContent: s.name || 'Untitled' });
    b.title = s.name;
    b.addEventListener('click', () => { current = s.id; setPage('chat'); run(`/resume ${s.id}`); });
    return b;
  }));
}
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
// "Show me a chart of my cpu load" becomes "Chart of cpu load": lead-ins and filler dropped, 3 to 5 words kept.
const LEAD = /^(?:(?:hey|hi|hello|ok|okay|please|so|and|now|then)[\s,]+)*(?:(?:can|could|would|will) you\s+)?(?:(?:please)\s+)?(?:(?:show|give|make|tell|write|build|create|draw|plot|find|get)(?:\s+me)?|i (?:want|need|would like)(?: you)? to|i (?:want|need)|help me(?: to)?|let'?s|explain|what is|what's|how (?:do|can|does) i?)\s+/i;
const FILLER = new Set(['a', 'an', 'the', 'my', 'some', 'please']);
function titleFrom(text) {
  const cleaned = text.trim().split('\n')[0].replace(/[?!.:,;]+$/g, '').replace(LEAD, '');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w.toLowerCase()));
  const pick = (kept.length >= 2 ? kept : words).slice(0, 5);
  if (!pick.length) return 'New chat';
  const t = pick.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
new MutationObserver(() => {
  const first = out.querySelector('.chat-line.user .chat-text')?.textContent.trim();
  title.textContent = first ? titleFrom(first) : 'New chat';
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
  // memory shows what is used out of what there is, so its bar reads like the other two
  mini('ram', ram == null || !ramTotal ? null : ram / ramTotal, ram == null ? 'N/A' : ramTotal ? `${ram.toFixed(1)} / ${Math.round(ramTotal)} GB` : `${ram.toFixed(1)} GB`);
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
