// Workspace: the tabs beside the chat. A tab is an artifact (live preview or source) or the
// System view (telemetry); every tab can be closed, System included, and reopened from the
// sidebar. Replaces the old floating-panel whiteboard but keeps its public API, because
// chat-ui, actions, commands, shortcuts and native-chrome call it. On the Code page there is no
// workspace column, so an artifact opens as a floating panel there (cli-page.js listens).
import { getArtifact, onArtifactsChange } from './artifacts.js';
import { buildSrcdoc } from './artifact-renderer.js';
import { renderMarkdown, highlightCode } from './markdown.js';
import { icon } from './icons.js';
import { currentPage, setPage, setWorkspaceShown, isWhiteboardMode } from './whiteboard-mode.js';

const $ = (id) => document.getElementById(id);
const tabsEl = $('ws-tabs');
const bodyEl = $('ws-body');
const sysPane = $('ws-system');

const PREVIEWABLE = new Set(['html', 'svg', 'mermaid', 'chart', 'markdown', 'table']);
const EXTENSIONS = { html: 'html', svg: 'svg', mermaid: 'mmd', chart: 'json', markdown: 'md', table: 'json' };
const SYSTEM = 'system';

export const fileNameFor = (a) => {
  const base = (a.id || 'artifact').replace(/[^\w.-]+/g, '-');
  return `${base}.${a.type === 'code' ? (a.lang || 'txt') : EXTENSIONS[a.type]}`;
};

// --- artifact view (used by tabs and by the Code page's floating panels) ---------------------
function sourceView(a, v) {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'hljs';
  const lang = a.type === 'code' ? a.lang : ({ html: 'xml', svg: 'xml', chart: 'json', table: 'json', markdown: 'markdown' }[a.type] ?? '');
  code.innerHTML = highlightCode(v.content, lang);
  pre.append(code);
  pre.className = 'wb-source';
  return pre;
}

// A table artifact is {"columns": [...], "rows": [[...], ...]} as JSON, or plain CSV. Cells are
// set with textContent, so nothing the model writes is ever parsed as markup.
function parseTable(text) {
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j?.columns) && Array.isArray(j?.rows)) return { columns: j.columns.map(String), rows: j.rows.map((r) => (Array.isArray(r) ? r : Object.values(r)).map(String)) };
    if (Array.isArray(j) && j.every((r) => r && typeof r === 'object')) {
      const columns = [...new Set(j.flatMap(Object.keys))];
      return { columns, rows: j.map((r) => columns.map((c) => String(r[c] ?? ''))) };
    }
  } catch { /* not JSON: fall through to CSV */ }
  const lines = text.trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  return { columns: lines[0] ?? [], rows: lines.slice(1) };
}

function tableView(v) {
  const { columns, rows } = parseTable(v.content);
  const t = document.createElement('table');
  t.className = 'wb-table';
  const head = t.createTHead().insertRow();
  columns.forEach((c) => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = c; head.append(th); });
  const tb = t.createTBody();
  rows.forEach((r) => { const tr = tb.insertRow(); r.forEach((c) => { tr.insertCell().textContent = c; }); });
  const wrap = document.createElement('div');
  wrap.className = 'wb-table-wrap';
  wrap.append(t);
  return wrap;
}

async function previewView(a, v) {
  if (a.type === 'markdown') {
    const doc = document.createElement('div');
    doc.className = 'md wb-doc';
    doc.innerHTML = renderMarkdown(v.content);
    return doc;
  }
  if (a.type === 'table') return tableView(v);
  let srcdoc;
  try {
    srcdoc = await buildSrcdoc(a.type, v.content);
  } catch (e) {
    srcdoc = `<body style="font-family:monospace;padding:16px;color:#c93b3b">Renderer failed: ${String(e.message).replace(/</g, '&lt;')}</body>`;
  }
  const frame = document.createElement('iframe');
  frame.className = 'wb-frame';
  frame.setAttribute('sandbox', 'allow-scripts'); // deliberately no allow-same-origin
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = a.title;
  frame.srcdoc = srcdoc;
  return frame;
}

const btn = (cls, text) => Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: text });

export function artifactView(id) {
  const el = document.createElement('div');
  el.className = 'av';
  const bar = document.createElement('div');
  bar.className = 'av-bar';
  const title = Object.assign(document.createElement('span'), { className: 'av-title' });
  const prev = btn('av-btn', '‹');
  const ver = Object.assign(document.createElement('span'), { className: 'av-ver' });
  const next = btn('av-btn', '›');
  prev.setAttribute('aria-label', 'Previous version');
  next.setAttribute('aria-label', 'Next version');
  const seg = Object.assign(document.createElement('span'), { className: 'seg' });
  const tabPreview = btn('wb-tab-preview', 'Preview');
  const tabSource = btn('wb-tab-source', 'Source');
  seg.append(tabPreview, tabSource);
  const copyBtn = btn('av-btn', 'Copy');
  const saveBtn = btn('av-btn', 'Save');
  bar.append(title, prev, ver, next, seg, copyBtn, saveBtn);
  const body = Object.assign(document.createElement('div'), { className: 'av-body' });
  el.append(bar, body);

  const state = { idx: (getArtifact(id)?.versions.length ?? 1) - 1, tab: 'preview', token: 0 };

  async function render() {
    const a = getArtifact(id);
    if (!a) return;
    const v = a.versions[state.idx];
    const token = ++state.token;
    title.textContent = a.title;
    ver.textContent = `v${state.idx + 1}/${a.versions.length}${v.partial ? ' incomplete' : ''}`;
    prev.disabled = state.idx === 0;
    next.disabled = state.idx === a.versions.length - 1;
    const previewable = PREVIEWABLE.has(a.type);
    tabPreview.disabled = !previewable;
    const source = state.tab === 'source' || !previewable;
    tabPreview.classList.toggle('active', !source);
    tabSource.classList.toggle('active', source);
    const view = source ? sourceView(a, v) : await previewView(a, v);
    if (view && token === state.token) body.replaceChildren(view);
  }

  prev.addEventListener('click', () => { state.idx = Math.max(0, state.idx - 1); render(); });
  next.addEventListener('click', () => { state.idx += 1; render(); });
  tabPreview.addEventListener('click', () => { state.tab = 'preview'; render(); });
  tabSource.addEventListener('click', () => { state.tab = 'source'; render(); });
  copyBtn.addEventListener('click', async () => {
    let label = 'Copied';
    try { await navigator.clipboard.writeText(getArtifact(id).versions[state.idx].content); } catch { label = 'Failed'; }
    copyBtn.textContent = label;
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
  });
  // Save: native Save dialog + write in the desktop app; plain download when run in a browser.
  saveBtn.addEventListener('click', async () => {
    const a = getArtifact(id);
    const name = fileNameFor(a);
    const { content } = a.versions[state.idx];
    let label = 'Saved';
    try {
      if (window.__TAURI_INTERNALS__) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({ defaultPath: name });
        if (!path) return; // cancelled
        await writeTextFile(path, content);
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn('[jarvis] save failed:', e);
      label = 'Failed';
    }
    saveBtn.textContent = label;
    setTimeout(() => { saveBtn.textContent = 'Save'; }, 1200);
  });
  // A new version of this artifact (the model edited it): show the latest.
  const offVersions = onArtifactsChange((a) => { if (a.id === id) { state.idx = a.versions.length - 1; render(); } });
  // The page inside the frame is built with the current theme, so it is built again when the theme changes.
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const redraw = () => render();
  scheme.addEventListener('change', redraw);
  document.addEventListener('jarvis:theme', redraw);
  render();
  return { el, dispose: () => { offVersions(); scheme.removeEventListener('change', redraw); document.removeEventListener('jarvis:theme', redraw); } };
}

// --- tabs --------------------------------------------------------------------
const tabs = new Map(); // id -> { id, label, pane, dispose? }, in tab order
let active = null;
const stored = (() => { try { return localStorage.getItem('jarvis.ws.system') !== 'off'; } catch { return true; } })();

const empty = Object.assign(document.createElement('div'), { className: 'ws-empty', textContent: 'Nothing open. Artifacts the assistant makes open here; System shows the live readings.' });
bodyEl.append(empty);

function paint() {
  tabsEl.replaceChildren(...[...tabs.values()].map((t) => {
    const tab = document.createElement('div');
    tab.className = 'ws-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(t.id === active));
    const label = Object.assign(document.createElement('button'), { type: 'button', className: 't-label', textContent: t.label });
    label.addEventListener('click', () => activate(t.id));
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 't-x', innerHTML: icon('close', 14), title: `Close ${t.label}` });
    x.setAttribute('aria-label', `Close ${t.label}`);
    x.addEventListener('click', () => closeTab(t.id));
    tab.append(label, x);
    return tab;
  }));
  tabs.forEach((t) => { t.pane.hidden = t.id !== active; });
  empty.hidden = tabs.size > 0;
}

function activate(id) {
  if (!tabs.has(id)) return;
  active = id;
  paint();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  t.dispose?.();
  if (t.id === SYSTEM) {
    t.pane.hidden = true;
    try { localStorage.setItem('jarvis.ws.system', 'off'); } catch { /* storage blocked */ }
  } else t.pane.remove();
  tabs.delete(id);
  if (active === id) active = [...tabs.keys()].pop() ?? null;
  paint();
}

function ensureArtifactTab(id) {
  if (tabs.has(id)) return tabs.get(id);
  const a = getArtifact(id);
  const view = artifactView(id);
  const pane = Object.assign(document.createElement('div'), { className: 'ws-pane', hidden: true });
  pane.setAttribute('role', 'tabpanel');
  pane.append(view.el);
  bodyEl.append(pane);
  const t = { id, label: a.title, pane, dispose: view.dispose };
  tabs.set(id, t);
  return t;
}
onArtifactsChange((a) => { const t = tabs.get(a.id); if (t && t.label !== a.title) { t.label = a.title; paint(); } });

// --- public API (names kept from the floating-panel whiteboard) -------------------------------
export const isWidgetOpen = (id) => id === SYSTEM && tabs.has(SYSTEM);

export function openWidget(id) {
  if (id !== SYSTEM) return;
  if (currentPage() !== 'chat') setPage('chat');
  setWorkspaceShown(true);
  if (!tabs.has(SYSTEM)) {
    tabs.set(SYSTEM, { id: SYSTEM, label: 'System', pane: sysPane });
    try { localStorage.removeItem('jarvis.ws.system'); } catch { /* storage blocked */ }
  }
  activate(SYSTEM);
}
export function closeWidget(id) { if (id === SYSTEM) closeTab(SYSTEM); }
export const toggleWidget = (id) => (isWidgetOpen(id) ? closeWidget(id) : openWidget(id));

// The conversation is always visible next to the workspace now, so these are only kept for callers.
export const showSession = () => {};
export const isSessionShown = () => true;
export const toggleSession = () => setWorkspaceShown(!isWhiteboardMode());

// An artifact finished (or its card was clicked): show it. On the Code page, as a floating panel.
export function openArtifact(id) {
  const a = getArtifact(id);
  if (!a) return;
  if (currentPage() === 'code') {
    document.dispatchEvent(new CustomEvent('jarvis:float', { detail: { id: `art:${id}`, title: a.title, mount: (body) => { const v = artifactView(id); body.append(v.el); return v.dispose; } } }));
    return;
  }
  if (currentPage() !== 'chat') setPage('chat');
  setWorkspaceShown(true);
  ensureArtifactTab(id);
  activate(id);
}

// The model's <jarvis-board> tag: show exactly these tabs. Layout names are ignored (tabs have
// one layout); the order is kept and the first named tab is shown. Ids that name nothing are
// ignored; artifact tabs not listed are closed (their artifacts stay in the chat).
export function applyBoardSpec({ panels: ids = [] }) {
  const wanted = [...new Set(ids)].filter((id) => getArtifact(id));
  const wantSystem = ids.includes(SYSTEM);
  if (!wanted.length && !wantSystem) return;
  if (currentPage() !== 'chat') setPage('chat');
  setWorkspaceShown(true);
  if (wantSystem && !tabs.has(SYSTEM)) openWidget(SYSTEM);
  if (wanted.length) {
    [...tabs.keys()].filter((id) => id !== SYSTEM && !wanted.includes(id)).forEach(closeTab);
    wanted.forEach(ensureArtifactTab);
    const order = new Map();
    if (tabs.has(SYSTEM)) order.set(SYSTEM, tabs.get(SYSTEM));
    wanted.forEach((id) => order.set(id, tabs.get(id)));
    tabs.clear();
    order.forEach((t, id) => tabs.set(id, t));
    activate(wanted[0]);
  }
}

export const panelCount = () => [...tabs.keys()].filter((id) => id !== SYSTEM).length;
export function closePanelById(id) {
  if (!tabs.has(id)) return null;
  const kind = id === SYSTEM ? 'widget' : 'panel';
  closeTab(id);
  return kind;
}
export const openPanelIds = () => [...tabs.keys()];
export const closeWhiteboard = () => setWorkspaceShown(false);

// --- workspace toggle, splitter, System tab at start ------------------------------------------
const toggle = $('ws-toggle');
toggle.addEventListener('click', () => setWorkspaceShown(!isWhiteboardMode()));
const syncToggle = () => toggle.setAttribute('aria-pressed', String(isWhiteboardMode()));
document.addEventListener('jarvis:workspace', syncToggle);
syncToggle();

const split = $('ws-split');
const chatPage = $('page-chat');
const WS_KEY = 'jarvis.ws.width';
const clampW = (w) => Math.round(Math.min(Math.max(w, 320), chatPage.clientWidth * 0.7) / 8) * 8;
const setW = (w) => chatPage.style.setProperty('--ws-w', `${clampW(w)}px`);
try { const w = Number(localStorage.getItem(WS_KEY)); if (w) setW(w); } catch { /* storage blocked */ }
split.addEventListener('pointerdown', (e) => {
  split.setPointerCapture(e.pointerId);
  split.classList.add('dragging');
  const move = (m) => setW(chatPage.getBoundingClientRect().right - m.clientX);
  const done = () => {
    split.classList.remove('dragging');
    split.removeEventListener('pointermove', move);
    split.removeEventListener('pointerup', done);
    split.removeEventListener('pointercancel', done);
    try { localStorage.setItem(WS_KEY, String(parseInt(getComputedStyle(chatPage).getPropertyValue('--ws-w'), 10) || 0)); } catch { /* storage blocked */ }
  };
  split.addEventListener('pointermove', move);
  split.addEventListener('pointerup', done);
  split.addEventListener('pointercancel', done);
});
split.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const cur = parseInt(getComputedStyle(chatPage).getPropertyValue('--ws-w'), 10) || document.getElementById('workspace').offsetWidth;
  setW(cur + (e.key === 'ArrowLeft' ? 16 : -16));
});

if (stored) { tabs.set(SYSTEM, { id: SYSTEM, label: 'System', pane: sysPane }); active = SYSTEM; }
paint();
