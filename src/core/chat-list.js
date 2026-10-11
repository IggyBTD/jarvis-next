// The sidebar's list of saved chats and the title of the chat that is open.
// Pinned chats first, search, inline rename, a right-click menu, and a typing animation when the model names a chat.
// Everything that changes a chat goes through `jarvis:session-op` (chat-ui.js owns the open conversation).
import { listSessions } from './sessions.js';
import { setPage } from './whiteboard-mode.js';
import { registerContext } from './native-chrome.js';
import { listProjects, getProjectById, onProjects } from './projects.js';
import { icon } from '../icons/index.js';

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
  if (still.matches || !text) { el.textContent = text; return; }
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
}

function label(text) {
  return Object.assign(document.createElement('div'), { className: 'list-label', textContent: text });
}

function row(s) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: `chat-item${s.id === current ? ' current' : ''}` });
  b.dataset.id = s.id;
  const name = Object.assign(document.createElement('span'), { className: 'ci-name' });
  if (typing?.id === s.id) { typeInto(name, typing.name); typing = null; } else name.textContent = s.name || 'Untitled';
  b.append(name);
  const project = s.project && getProjectById(s.project);
  if (project) b.append(Object.assign(document.createElement('span'), { className: 'ci-tag', textContent: project.name }));
  if (s.mode === 'code') b.insertAdjacentHTML('afterbegin', icon('code', { size: 14 }));
  b.title = s.name;
  b.addEventListener('click', () => openSession(s));
  b.addEventListener('dblclick', () => rename(b, s));
  return b;
}

function paint() {
  const q = query.trim().toLowerCase();
  const shown = sessions.filter((s) => !q || (s.name ?? '').toLowerCase().includes(q));
  if (!shown.length) {
    list.replaceChildren(Object.assign(document.createElement('div'), { className: 'chat-list-empty', textContent: q ? 'No chat matches.' : 'No saved chats yet.' }));
    return;
  }
  const pinned = shown.filter((s) => s.pinned);
  const rest = shown.filter((s) => !s.pinned).slice(0, 60);
  const nodes = [];
  if (pinned.length) nodes.push(label('Pinned'), ...pinned.map(row));
  if (rest.length) nodes.push(...(pinned.length ? [label('Recent')] : []), ...rest.map(row));
  list.replaceChildren(...nodes);
}

// --- rename in place ---------------------------------------------------------------------
function rename(btn, s) {
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
registerContext('.chat-item', (el) => {
  const s = sessions.find((x) => x.id === el.dataset.id);
  if (!s) return [];
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
});

// --- events ---------------------------------------------------------------------
document.addEventListener('jarvis:sessions-changed', refreshChats);
onProjects(paint);
setInterval(() => { if (!document.hidden && !list.querySelector('.ci-edit')) refreshChats(); }, 5000);

// The header shows the model's name for the chat once there is one; until then a short title from the first message.
let named = false;
document.addEventListener('jarvis:session-name', (e) => {
  const { id, name, animate } = e.detail;
  current = id;
  named = !!name;
  if (name) {
    if (animate) { typing = { id, name }; typeInto(title, name); } else title.textContent = name;
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
  const first = out.querySelector('.chat-line.user .chat-text')?.textContent.trim();
  title.textContent = first ? titleFrom(first) : 'New chat';
}).observe(out, { childList: true });

refreshChats();
