// The sidebar's list of saved chats and the title of the chat that is open.
// Pinned chats first, then folders (a project is a folder: open it to see its chats, drop a chat on it to file it), then recent
// chats; search, inline rename, a right-click menu, and a typing animation when the model names a chat.
// Everything that changes a chat goes through `jarvis:session-op` (chat-ui.js owns the open conversation).
import { listSessions } from './sessions.js';
import { setMathText } from './inline-math.js';
import { setPage } from './whiteboard-mode.js';
import { registerContext } from './native-chrome.js';
import { listProjects, getProjectById, onProjects, createProject, updateProject, deleteProject } from './projects.js';
import { icon } from '../icons/index.js';
import { serverMode, getConvId, chatStates, onLink } from './server-link.js';

const $ = (id) => document.getElementById(id);
const list = $('chat-list');
const title = $('chat-title');
const input = $('hud-chat-input');
const out = $('chat-output');

const still = matchMedia('(prefers-reduced-motion: reduce)');
let sessions = [];
let current = '';
let query = '';
let typing = null; // { id, name }: the chat the model just named, typed out once in the list

const op = (detail) => document.dispatchEvent(new CustomEvent('jarvis:session-op', { detail }));

// Slash commands go through the message field, the one door chat-ui.js guards.
// Typed by the app, not the user: chat-ui.js does not echo these into the conversation (quiet).
export function run(text) {
  input.dataset.quiet = '1';
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
export function openSession(s) {
  current = s.id;
  setPage(s.mode === 'code' ? 'code' : 'chat');
  run(`/resume ${s.id}`);
}

// --- typing animation ---------------------------------------------------------------------
const typers = new WeakMap();
export function typeInto(el, text) {
  clearInterval(typers.get(el));
  if (still.matches || !text || text.includes('$')) { setMathText(el, text); return; } // a name with maths in it appears whole, typeset
  let n = 0;
  el.textContent = '';
  el.classList.add('typing');
  const t = setInterval(() => {
    n += 1;
    el.textContent = text.slice(0, n);
    if (n >= text.length) { clearInterval(t); el.classList.remove('typing'); }
  }, 32);
  typers.set(el, t);
}

// --- the list ---------------------------------------------------------------------
export async function refreshChats() {
  let all = [];
  try { all = (await listSessions()) ?? []; } catch { /* a plain browser has no session store */ }
  sessions = Array.isArray(all) ? all.sort((a, b) => b.updated - a.updated) : [];
  paint();
  syncHead();
}

function label(text) {
  return Object.assign(document.createElement('div'), { className: 'list-label', textContent: text });
}

// A chat in the list: the row, and a "more" button at its right that shows on hover and opens the right-click menu.
function row(s) {
  const wrap = Object.assign(document.createElement('div'), { className: 'chat-row' });
  const b = chatButton(s);
  const more = Object.assign(document.createElement('button'), { type: 'button', className: 'ci-more', title: 'More', innerHTML: icon('more', { size: 16 }) });
  more.setAttribute('aria-label', `More for ${s.name || 'this chat'}`);
  more.addEventListener('click', (e) => { e.stopPropagation(); openMenuAt(b, more); });
  wrap.append(b, more);
  return wrap;
}
function openMenuAt(target, anchor) {
  const r = anchor.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left), clientY: Math.round(r.bottom) }));
}
function chatButton(s) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: `chat-item${s.id === current ? ' current' : ''}` });
  b.dataset.id = s.id;
  const name = Object.assign(document.createElement('span'), { className: 'ci-name' });
  if (typing?.id === s.id) { typeInto(name, typing.name); typing = null; } else setMathText(name, s.name || 'Untitled');
  b.append(name);
  const project = s.project && getProjectById(s.project);
  if (project) b.append(Object.assign(document.createElement('span'), { className: 'ci-tag', textContent: project.name }));
  if (s.mode === 'code') b.insertAdjacentHTML('afterbegin', icon('code', { size: 14 }));
  b.append(Object.assign(document.createElement('span'), { className: 'ci-state' })); // filled by syncStates
  b.title = s.name;
  b.addEventListener('click', () => openSession(s));
  b.addEventListener('dblclick', () => rename(b, s));
  return b;
}

// --- which chats are working ---------------------------------------------------------------------
// A spinner on a chat the model is answering in, an amber dot where an approval waits, a dot on a chat that finished while another
// was open. Set in place on the existing rows (no rebuild), so a click or drag in the list is not interrupted. A closed folder
// carries the most urgent state of its chats.
const STATE_TEXT = { running: 'Working', waiting: 'Needs your approval', unseen: 'New reply' };
const URGENCY = ['waiting', 'running', 'unseen'];
function setState(node, st, name) {
  if (st) node.dataset.state = st; else delete node.dataset.state;
  const mark = node.querySelector(':scope > .ci-state');
  if (mark) mark.textContent = st ? STATE_TEXT[st] : '';
  if (node.classList.contains('chat-item')) node.title = st ? `${name}: ${STATE_TEXT[st].toLowerCase()}` : name;
}
function syncStates() {
  const states = serverMode() ? chatStates() : new Map();
  const nameOf = new Map(sessions.map((s) => [s.id, s.name || 'Untitled']));
  for (const b of list.querySelectorAll('.chat-item')) setState(b, states.get(b.dataset.id) ?? null, nameOf.get(b.dataset.id) ?? '');
  for (const f of list.querySelectorAll('.folder-item')) {
    const mine = sessions.filter((s) => s.project === f.dataset.id).map((s) => states.get(s.id)).filter(Boolean);
    const st = openFolders.has(f.dataset.id) ? null : URGENCY.find((u) => mine.includes(u)) ?? null;
    if (st) f.dataset.state = st; else delete f.dataset.state;
  }
}
onLink((e) => { if (e.type === 'chat-states') syncStates(); });

// --- folders ---------------------------------------------------------------------
const OPEN_KEY = 'jarvis.folders.open';
let openFolders = new Set();
try { openFolders = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')); } catch { /* none open */ }
const saveOpen = () => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openFolders])); } catch { /* storage blocked */ } };
let renamingFolder = null;

function folderRow(p, chats) {
  const isOpen = openFolders.has(p.id);
  const b = Object.assign(document.createElement('div'), { className: 'folder-item', role: 'button', tabIndex: 0 });
  b.dataset.id = p.id;
  b.setAttribute('aria-expanded', String(isOpen));
  b.insertAdjacentHTML('beforeend', `<span class="chev">${icon('chevron-right', { size: 14 })}</span>${icon(isOpen ? 'folder-open' : 'folder', { size: 16 })}`);
  if (renamingFolder === p.id) {
    const field = Object.assign(document.createElement('input'), { className: 'ci-edit', value: p.name, maxLength: 60, spellcheck: false });
    field.setAttribute('aria-label', 'Folder name');
    b.append(field);
    queueMicrotask(() => { field.focus(); field.select(); });
    let done = false;
    const finish = (save) => { if (done) return; done = true; renamingFolder = null; const name = field.value.trim(); if (save && name && name !== p.name) updateProject(p.id, { name }); else paint(); };
    field.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    field.addEventListener('blur', () => finish(true));
    field.addEventListener('click', (e) => e.stopPropagation());
  } else {
    b.append(Object.assign(document.createElement('span'), { className: 'ci-name', textContent: p.name }), Object.assign(document.createElement('span'), { className: 'ci-count', textContent: String(chats.length) }));
  }
  const toggle = () => { if (openFolders.has(p.id)) openFolders.delete(p.id); else openFolders.add(p.id); saveOpen(); paint(); };
  b.addEventListener('click', () => { if (renamingFolder !== p.id) toggle(); });
  b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === b) { e.preventDefault(); toggle(); } });
  b.addEventListener('dblclick', () => { renamingFolder = p.id; paint(); });
  b.dataset.dropFolder = p.id; // a chat dragged here goes into the folder
  return b;
}

function foldersHeader() {
  const head = Object.assign(document.createElement('div'), { className: 'list-label with-action' });
  head.append(Object.assign(document.createElement('span'), { textContent: 'Folders' }));
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', id: 'folder-add', title: 'New folder', innerHTML: icon('folder-plus', { size: 16 }) });
  add.setAttribute('aria-label', 'New folder');
  add.addEventListener('click', () => { const p = createProject('New folder'); openFolders.add(p.id); saveOpen(); renamingFolder = p.id; paint(); });
  head.append(add);
  return head;
}

function paint() {
  const q = query.trim().toLowerCase();
  const shown = sessions.filter((s) => !q || (s.name ?? '').toLowerCase().includes(q));
  if (q) { // searching: one flat list across everything, folder or not
    list.replaceChildren(...(shown.length ? shown.slice(0, 60).map(row) : [Object.assign(document.createElement('div'), { className: 'chat-list-empty', textContent: 'No chat matches.' })]));
    syncStates();
    return;
  }
  const nodes = [];
  const pinned = shown.filter((s) => s.pinned);
  if (pinned.length) nodes.push(label('Pinned'), ...pinned.map(row));
  const projects = listProjects();
  nodes.push(foldersHeader());
  if (!projects.length) nodes.push(Object.assign(document.createElement('div'), { className: 'chat-list-empty', textContent: 'No folders yet.' }));
  projects.forEach((p) => {
    const mine = shown.filter((s) => s.project === p.id && !s.pinned);
    nodes.push(folderRow(p, mine));
    if (openFolders.has(p.id)) nodes.push(...(mine.length ? mine.map((s) => { const r = row(s); r.classList.add('in-folder'); r.querySelector('.ci-tag')?.remove(); return r; }) : [Object.assign(document.createElement('div'), { className: 'chat-list-empty in-folder', textContent: 'Empty. Drag a chat here.' })]));
  });
  const loose = shown.filter((s) => !s.pinned && !(s.project && getProjectById(s.project))).slice(0, 60);
  const recent = label('Recents');
  recent.dataset.dropFolder = ''; // a chat dragged onto Recents leaves its folder
  nodes.push(recent);
  nodes.push(...(loose.length ? loose.map(row) : [Object.assign(document.createElement('div'), { className: 'chat-list-empty', textContent: sessions.length ? 'Every chat is in a folder.' : 'No saved chats yet.' })]));
  list.replaceChildren(...nodes);
  syncStates();
}

// --- dragging a chat into a folder ---------------------------------------------------------------------
// Done with the pointer, not the webview's drag and drop: the desktop app switches that off (Tauri's file drop takes it over).
let drag = null;
let suppressClick = false;
list.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.chat-item');
  if (!b || e.button !== 0 || e.target.closest('.ci-edit')) return;
  const s = sessions.find((x) => x.id === b.dataset.id);
  if (s) drag = { s, x: e.clientX, y: e.clientY, on: false, ghost: null, over: null };
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.on = true;
    drag.ghost = Object.assign(document.createElement('div'), { className: 'drag-ghost', textContent: drag.s.name || 'Untitled' });
    document.body.append(drag.ghost);
    document.body.classList.add('dragging-chat');
  }
  drag.ghost.style.translate = `${e.clientX + 12}px ${e.clientY + 12}px`;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop-folder]') ?? null;
  if (over !== drag.over) { drag.over?.removeAttribute('data-drop'); over?.setAttribute('data-drop', 'on'); drag.over = over; }
});
function endDrag(commit) {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.ghost?.remove();
  document.body.classList.remove('dragging-chat');
  d.over?.removeAttribute('data-drop');
  if (!d.on) return;
  suppressClick = true; // the click that ends the drag must not open the chat
  setTimeout(() => { suppressClick = false; }, 0);
  if (!commit || !d.over) return;
  const folder = d.over.dataset.dropFolder || null;
  if (folder) { openFolders.add(folder); saveOpen(); }
  op({ op: 'patch', id: d.s.id, patch: { project: folder } });
}
document.addEventListener('pointerup', () => endDrag(true));
document.addEventListener('pointercancel', () => endDrag(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag?.on) { e.stopPropagation(); endDrag(false); } }, true);
list.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

// --- rename in place ---------------------------------------------------------------------
function rename(btn, s) {
  if (!btn.isConnected || !btn.classList.contains('chat-item')) { const name = prompt('Rename this chat', s.name ?? ''); if (name?.trim() && name.trim() !== s.name) op({ op: 'patch', id: s.id, patch: { name: name.trim(), manual: true } }); return; }
  const field = Object.assign(document.createElement('input'), { className: 'ci-edit', value: s.name ?? '', maxLength: 80, spellcheck: false });
  field.setAttribute('aria-label', 'Chat name');
  btn.replaceChildren(field);
  field.focus();
  field.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = field.value.trim();
    if (save && name && name !== s.name) { s.name = name; op({ op: 'patch', id: s.id, patch: { name, manual: true } }); }
    paint();
  };
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  field.addEventListener('blur', () => finish(true));
  field.addEventListener('click', (e) => e.stopPropagation());
}

// --- search ---------------------------------------------------------------------
const searchBtn = $('chat-search-btn');
const searchBox = $('chat-search');
function setSearch(open) {
  searchBox.hidden = !open;
  searchBtn.setAttribute('aria-pressed', String(open));
  if (open) searchBox.focus(); else { searchBox.value = ''; query = ''; paint(); }
}
searchBtn.addEventListener('click', () => setSearch(searchBox.hidden));
searchBox.addEventListener('input', () => { query = searchBox.value; paint(); });
searchBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setSearch(false); } });
document.addEventListener('jarvis:search-chats', () => { setSearch(true); });

// --- right-click on a chat ---------------------------------------------------------------------
function chatMenu(s, el) {
  const projects = listProjects();
  const items = [
    ['Open', () => openSession(s), true],
    ['Rename', () => rename(el, s), true],
    [s.pinned ? 'Unpin' : 'Pin to top', () => op({ op: 'patch', id: s.id, patch: { pinned: !s.pinned } }), true],
    'sep',
  ];
  projects.slice(0, 8).filter((p) => p.id !== s.project).forEach((p) => items.push([`Move to ${p.name}`, () => op({ op: 'patch', id: s.id, patch: { project: p.id } }), true]));
  if (s.project) items.push(['Remove from project', () => op({ op: 'patch', id: s.id, patch: { project: null } }), true]);
  if (projects.length || s.project) items.push('sep');
  items.push(
    ['Duplicate', () => op({ op: 'duplicate', id: s.id }), true],
    ['Export as Markdown', () => op({ op: 'export', id: s.id }), true],
    'sep',
    ['Delete', () => { if (confirm(`Delete "${s.name}"? This cannot be undone.`)) op({ op: 'delete', id: s.id }); }, true, 'danger'],
  );
  return items;
}
registerContext('.chat-item', (el) => { const s = sessions.find((x) => x.id === el.dataset.id); return s ? chatMenu(s, el) : []; });
// the title above the conversation opens the menu of the chat that is open (nothing to offer before the chat is saved)
const titleBtn = $('chat-title-btn');
registerContext('#chat-title-btn', () => {
  const s = sessions.find((x) => x.id === (current || (serverMode() ? getConvId() : '')));
  if (!s) return [];
  const rowBtn = list.querySelector(`.chat-item[data-id="${s.id}"]`);
  return chatMenu(s, rowBtn ?? titleBtn);
});
titleBtn.addEventListener('click', () => openMenuAt(titleBtn, titleBtn));

// --- the header's own buttons: back and forward through the chats opened so far, pin, export, search ---------------------
const hBack = $('head-back'), hFwd = $('head-fwd'), hPin = $('head-pin'), hExport = $('head-export'), hSearch = $('head-search');
const openId = () => current || (serverMode() ? getConvId() : '');
const openChat = () => sessions.find((x) => x.id === openId());
let hist = [], pos = -1;
function syncHead() {
  const s = openChat();
  hBack.disabled = pos <= 0;
  hFwd.disabled = pos >= hist.length - 1;
  hPin.disabled = hExport.disabled = !s;
  hPin.setAttribute('aria-pressed', String(!!s?.pinned));
  hPin.title = s?.pinned ? 'Unpin this chat' : 'Pin this chat to the top';
}
function go(d) {
  const s = sessions.find((x) => x.id === hist[pos + d]);
  if (!s) return;
  pos += d; // moved before the chat opens, so its session-name event finds it already at the end of the trail
  openSession(s);
  syncHead();
}
hBack.addEventListener('click', () => go(-1));
hFwd.addEventListener('click', () => go(1));
hPin.addEventListener('click', () => { const s = openChat(); if (s) op({ op: 'patch', id: s.id, patch: { pinned: !s.pinned } }); });
hExport.addEventListener('click', () => { const s = openChat(); if (s) op({ op: 'export', id: s.id }); });
hSearch.addEventListener('click', () => { document.dispatchEvent(new CustomEvent('jarvis:search-chats')); });
syncHead();

registerContext('.folder-item', (el) => {
  const p = getProjectById(el.dataset.id);
  if (!p) return [];
  return [
    ['New chat in this folder', () => { op({ op: 'new', project: p.id, mode: 'chat' }); setPage('chat'); }, true],
    ['Rename', () => { renamingFolder = p.id; paint(); }, true],
    'sep',
    ['Delete folder', () => { if (confirm(`Delete the folder "${p.name}"? Its chats are kept.`)) deleteProject(p.id); }, true, 'danger'],
  ];
});

// --- events ---------------------------------------------------------------------
document.addEventListener('jarvis:sessions-changed', refreshChats);
onProjects(paint);
// every save already announces itself (jarvis:sessions-changed); this only catches a change made elsewhere
setInterval(() => { if (!document.hidden && !list.querySelector('.ci-edit')) refreshChats(); }, 30000);

// The header shows the model's name for the chat once there is one; until then a short title from the first message.
let named = false;
document.addEventListener('jarvis:session-name', (e) => {
  const { id, name, animate } = e.detail;
  current = id;
  if (id && hist[pos] !== id) { hist = hist.slice(0, pos + 1); hist.push(id); pos = hist.length - 1; }
  named = !!name;
  if (name) {
    if (animate) { typing = { id, name }; typeInto(title, name); } else setMathText(title, name);
  } else title.textContent = 'New chat';
  refreshChats();
});

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
  if (named) return;
  const box = out.querySelector('.chat-line.user .chat-text');
  const first = (box?.dataset.raw ?? box?.textContent)?.trim();
  setMathText(title, first ? titleFrom(first) : 'New chat');
}).observe(out, { childList: true });

refreshChats();
