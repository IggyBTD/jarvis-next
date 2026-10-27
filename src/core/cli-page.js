// The code side of the panel: the project's files, what the agent changed, its task list, plan mode, the diff and approval
// panels that float over the page. The conversation is the real one (the same as Chat), and the files, changes and tasks
// live in the right panel's tabs (index.html, panel-info.js). Only real data is shown; see .md Files/JARVIS_CLI_Brief.md.
import { getProject, listDir } from './agent-client.js';
import { diffBody } from './tool-cards.js';
import { getTasks, onTasks, taskSummary, isPlanMode, setPlanMode, onPlanMode } from './work-state.js';

const $ = (id) => document.getElementById(id);
const chatOutput = $('chat-output');
const STEP = 8; // floating panels move and resize in 8 px steps

document.addEventListener('jarvis:page', (e) => {
  if (e.detail.page === 'code') { refreshTree(); syncApprovals(); }
});

// --- workspace -----------------------------------------------------------
const empty = (text) => {
  const d = document.createElement('div');
  d.className = 'cli-empty';
  d.textContent = text;
  return d;
};
const row = (name, depth, dir, tag = '', onClick = null) => {
  const r = document.createElement(onClick ? 'button' : 'div');
  if (onClick) { r.type = 'button'; r.addEventListener('click', onClick); }
  r.className = `cli-row${dir ? ' dir' : ''}`;
  r.style.paddingLeft = `${16 + depth * 16}px`;
  const n = document.createElement('span');
  n.className = 'cli-name';
  n.textContent = dir ? `${name}/` : name;
  r.append(n);
  if (tag) {
    const t = document.createElement('span');
    t.className = 'cli-tag';
    t.textContent = tag;
    r.append(t);
  }
  return r;
};

let treeToken = 0;
async function refreshTree() {
  const token = ++treeToken;
  const tree = $('cli-tree');
  let root = null;
  try { root = await getProject(); } catch { /* no backend */ }
  if (token !== treeToken) return;
  if (!root) {
    tree.replaceChildren(empty(window.__TAURI_INTERNALS__ ? 'No project folder. Use /project <path>' : 'Needs the desktop app'));
    return;
  }
  try {
    const { entries, truncated } = await listDir('.', 2);
    if (token !== treeToken) return;
    const rows = entries
      .map((e) => ({ ...e, parts: e.path.split('/') }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((e) => row(e.parts[e.parts.length - 1], e.parts.length - 1, e.kind === 'dir'));
    if (truncated) rows.push(empty('List cut short'));
    tree.replaceChildren(...(rows.length ? rows : [empty('Empty folder')]));
  } catch (err) {
    tree.replaceChildren(empty(`Cannot list: ${String(err).slice(0, 80)}`));
  }
}

// --- floating panels ------------------------------------------------------
// Extra panels over the frame. Drag by the title bar, resize from the corner; with the title bar
// focused, Alt + arrows move and Alt + Shift + arrows resize by 8 px. Kept inside the page area.
const layer = $('cli-float');
const floats = new Map(); // id -> { el, body, head, close }
let zTop = 10;
const snap = (v) => Math.round(v / STEP) * STEP;

function openFloat(id, title, { x, y, w = 560, h = 360, cls = '', sub = '' } = {}) {
  const had = floats.get(id);
  if (had) { had.el.style.zIndex = String(++zTop); return had; }
  const el = document.createElement('section');
  el.className = `cli-float-panel ${cls}`;
  el.setAttribute('aria-label', title);
  el.innerHTML = '<div class="panel-head" tabindex="0" role="group" aria-label="Panel title bar. Alt and arrow keys move it, Alt Shift and arrow keys resize it."><span class="title-main"></span><span class="title-sub sub"></span><button type="button" class="wb-btn" title="Close panel" aria-label="Close panel">×</button></div><div class="cli-body"></div><i class="cli-rz"></i>';
  const head = el.firstElementChild;
  head.querySelector('.title-main').textContent = title;
  head.querySelector('.title-sub').textContent = sub;
  const body = el.querySelector('.cli-body');
  const place = (nx, ny, nw, nh) => {
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    const ww = Math.min(Math.max(240, snap(nw)), W);
    const hh = Math.min(Math.max(120, snap(nh)), H);
    Object.assign(el.style, { width: `${ww}px`, height: `${hh}px`, left: `${Math.min(Math.max(0, snap(nx)), W - ww)}px`, top: `${Math.min(Math.max(0, snap(ny)), H - hh)}px` });
  };
  const n = floats.size;
  place(x ?? 48 + n * 24, y ?? 24 + n * 24, Math.min(w, layer.clientWidth - 48), h);
  el.style.zIndex = String(++zTop);
  const rect = () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const drag = (target, onMove) => target.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, ...rect() };
    const move = (m) => onMove(start, m.clientX - start.px, m.clientY - start.py);
    const done = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', done); target.removeEventListener('pointercancel', done); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', done);
    target.addEventListener('pointercancel', done);
  });
  drag(head, (s, dx, dy) => place(s.x + dx, s.y + dy, s.w, s.h));
  drag(el.querySelector('.cli-rz'), (s, dx, dy) => place(s.x, s.y, s.w + dx, s.h + dy));
  el.addEventListener('pointerdown', () => { el.style.zIndex = String(++zTop); });
  head.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !e.altKey) return;
    e.preventDefault();
    const r = rect();
    if (e.shiftKey) place(r.x, r.y, r.w + d[0] * STEP, r.h + d[1] * STEP);
    else place(r.x + d[0] * STEP, r.y + d[1] * STEP, r.w, r.h);
  });
  const close = () => { panel.onClose?.(); el.remove(); floats.delete(id); };
  head.querySelector('button').addEventListener('click', close);
  layer.append(el);
  const panel = { el, body, head, close, onClose: null };
  floats.set(id, panel);
  return panel;
}

// Anything else that wants a floating panel over the page (the diffs and approvals above use the same one).
document.addEventListener('jarvis:float', (e) => {
  const { id, title, mount } = e.detail;
  const had = floats.get(id);
  if (had) { had.el.style.zIndex = String(++zTop); return; }
  const panel = openFloat(id, title, { w: 640, h: 440 });
  panel.onClose = mount(panel.body);
});

// --- changes: files the agent edited or wrote this session ------------------
// Each file is a row (what happened, where it is, how many lines); a click opens its diff, first "before" to latest "after", under it.
const changed = new Map(); // path -> { kind, count, before, after }, oldest first
export const changedFiles = () => [...changed].map(([path, v]) => ({ path, ...v }));
const open = new Set(); // paths whose diff is open
const KIND = { NEW: 'New', WRITE: 'Written', EDIT: 'Edited' };
function renderChanges() {
  const box = $('cli-changes');
  const list = [...changed].reverse();
  let plus = 0; let minus = 0;
  const rows = list.map(([path, c]) => {
    const { body, added, removed } = diffBody({ before: c.before, after: c.after });
    plus += added; minus += removed;
    const d = document.createElement('details');
    d.className = 'chg';
    d.open = open.has(path);
    d.addEventListener('toggle', () => { if (d.open) open.add(path); else open.delete(path); });
    const dir = path.includes('/') || path.includes('\\') ? path.replace(/[\\/][^\\/]*$/, '') : '';
    const name = path.split(/[\\/]/).pop();
    const s = document.createElement('summary');
    s.innerHTML = '<span class="chg-kind"></span><span class="chg-name"></span><span class="chg-dir"></span><span class="chg-count"><b class="plus"></b> <b class="minus"></b></span>';
    s.querySelector('.chg-kind').textContent = KIND[c.kind] ?? c.kind;
    s.querySelector('.chg-kind').dataset.kind = c.kind;
    s.querySelector('.chg-name').textContent = name;
    s.querySelector('.chg-dir').textContent = dir;
    s.querySelector('.plus').textContent = `+${added}`;
    s.querySelector('.minus').textContent = `-${removed}`;
    s.title = path + (c.count > 1 ? `  (${c.count} edits)` : '');
    d.append(s, body);
    return d;
  });
  $('cli-changes-count').innerHTML = `<b class="plus">+${plus}</b> <b class="minus">-${minus}</b>`;
  box.replaceChildren(...(rows.length ? rows : [empty('Nothing changed yet')]));
  document.dispatchEvent(new CustomEvent('jarvis:changes'));
}
document.addEventListener('jarvis:action', (e) => {
  const { name, args, ok, display } = e.detail;
  if (!ok || (name !== 'edit_file' && name !== 'write_file') || !args?.path) return;
  const prev = changed.get(args.path);
  changed.delete(args.path); // re-insert so the latest change is last
  changed.set(args.path, {
    kind: prev?.kind ?? (display?.created ? 'NEW' : name === 'write_file' ? 'WRITE' : 'EDIT'),
    count: (prev?.count ?? 0) + 1,
    before: prev ? prev.before : display?.before ?? '',
    after: display?.after ?? prev?.after ?? '',
  });
  renderChanges();
  if (document.body.dataset.page === 'code') refreshTree();
});
renderChanges();

// --- approvals: a clear floating request for every pending approval card ------
// The buttons press the real card's buttons, so the one gate (action-runner, approvalCard) stays
// the only path: this panel only makes the question hard to miss.
const asked = new WeakSet();
let askCount = 0;
function syncApprovals() {
  chatOutput.querySelectorAll('.tool-card.approval:not(.approved):not(.denied)').forEach(showApproval);
}
function showApproval(card) {
  if (asked.has(card) || document.body.dataset.page !== 'code') return;
  const real = [...card.querySelectorAll('.tc-bar .tc-btn')]; // an action: allow once, always allow, deny; a plan: approve, reject
  if (real.length < 2) return;
  asked.add(card);
  const text = (sel) => card.querySelector(sel)?.textContent ?? '';
  const panel = openFloat(`ask:${++askCount}`, text('.tc-type').toLowerCase() === 'plan' ? 'Plan for approval' : 'Approval required', { w: 560, h: 280, y: 16, cls: 'approval' });
  panel.el.style.left = `${snap((layer.clientWidth - panel.el.offsetWidth) / 2)}px`;
  const info = document.createElement('div');
  info.className = 'cli-ask';
  const kind = document.createElement('div');
  kind.className = 'cli-ask-title';
  kind.textContent = `${text('.tc-type')}  ${text('.tc-title')}`;
  info.append(kind);
  const detail = card.querySelector('.tc-output');
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail.textContent;
    info.append(pre);
  }
  const why = text('.tc-note');
  if (why) {
    const w = document.createElement('div');
    w.textContent = why;
    info.append(w);
  }
  const bar = document.createElement('div');
  bar.className = 'cli-ask-bar';
  // One big button per real button: the first is the main one, a button marked deny is the refusal.
  real.forEach((btn, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cli-act${i === 0 ? ' primary' : btn.classList.contains('deny') ? ' deny' : ''}`;
    b.textContent = btn.textContent.replace(/^Allow once$/i, 'Approve');
    b.title = btn.title;
    b.addEventListener('click', () => btn.click());
    bar.append(b);
  });
  panel.body.append(info);
  panel.el.insertBefore(bar, panel.el.querySelector('.cli-rz'));
  bar.firstElementChild.focus();
  const watcher = new MutationObserver(() => {
    if (card.classList.contains('approved') || card.classList.contains('denied') || !card.isConnected) { watcher.disconnect(); panel.close(); }
  });
  watcher.observe(card, { attributes: true, attributeFilter: ['class'] });
}
document.addEventListener('jarvis:approval', (e) => {
  const card = e.detail.el.querySelector('.tool-card');
  if (card) showApproval(card);
});

// --- tasks and plan mode (work-state.js) ----------------------------------------
const MARK = { todo: '[ ]', doing: '[~]', done: '[x]' };
function renderTasks(list) {
  const box = $('cli-tasks');
  $('cli-tasks-count').textContent = list.length ? taskSummary(list) : '';
  if (!list.length) {
    box.replaceChildren(empty('No tasks yet'));
    return;
  }
  box.replaceChildren(...list.map((t) => {
    const r = row(`${MARK[t.status]} ${t.text}`, 0, false);
    r.classList.add(t.status);
    r.title = t.text;
    return r;
  }));
}
onTasks(renderTasks);
renderTasks(getTasks());

