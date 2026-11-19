// The Projects page: a grid of projects, and one project's page (name, instructions, its chats and code sessions).
import { listProjects, getProjectById, createProject, updateProject, deleteProject, onProjects } from './projects.js';
import { listSessions } from './sessions.js';
import { currentPage, setPage } from './whiteboard-mode.js';
import { registerContext } from './native-chrome.js';
import { openSession } from './chat-list.js';
import { icon } from '../icons/index.js';

const root = document.getElementById('proj-root');
let openId = null;

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const op = (detail) => document.dispatchEvent(new CustomEvent('jarvis:session-op', { detail }));

async function chatsOf(id) {
  try { return ((await listSessions()) ?? []).filter((s) => s.project === id).sort((a, b) => b.updated - a.updated); } catch { return []; }
}

async function paintGrid() {
  const all = listProjects();
  const counts = new Map();
  try { ((await listSessions()) ?? []).forEach((s) => { if (s.project) counts.set(s.project, (counts.get(s.project) ?? 0) + 1); }); } catch { /* no session store */ }
  const add = el('button', { type: 'button', className: 'av-btn', textContent: 'New project' });
  add.addEventListener('click', () => { openId = createProject().id; paint(); });
  const head = el('div', { className: 'proj-head' }, el('h1', { textContent: 'Projects' }), add);
  if (!all.length) {
    root.replaceChildren(head, el('div', { className: 'empty-note', textContent: 'A project groups chats and code sessions and gives them shared instructions. Create one to start.' }));
    return;
  }
  const grid = el('div', { className: 'art-grid' });
  all.slice().reverse().forEach((p) => {
    const tile = el('button', { type: 'button', className: 'art-tile proj-card' },
      el('span', { className: 'a-title', textContent: p.name }),
      el('span', { className: 'a-sub', textContent: `${counts.get(p.id) ?? 0} chat${counts.get(p.id) === 1 ? '' : 's'}${p.instructions.trim() ? ', has instructions' : ''}` }));
    tile.dataset.id = p.id;
    tile.addEventListener('click', () => { openId = p.id; paint(); });
    grid.append(tile);
  });
  root.replaceChildren(head, grid);
}

async function paintProject() {
  const p = getProjectById(openId);
  if (!p) { openId = null; paintGrid(); return; }
  const back = el('button', { type: 'button', className: 'av-btn', textContent: 'All projects' });
  back.addEventListener('click', () => { openId = null; paint(); });
  const name = el('input', { className: 'proj-name', value: p.name, maxLength: 60, spellcheck: false });
  name.setAttribute('aria-label', 'Project name');
  name.addEventListener('input', () => updateProject(p.id, { name: name.value.trim() || 'Untitled project' }));
  const del = el('button', { type: 'button', className: 'av-btn danger', textContent: 'Delete project' });
  del.addEventListener('click', () => { if (confirm(`Delete the project "${p.name}"? Its chats are kept.`)) { deleteProject(p.id); openId = null; paint(); } });

  const notes = el('textarea', { className: 'proj-notes', value: p.instructions, placeholder: 'How should JARVIS behave in this project? Tone, conventions, what to remember. It is added to every chat that belongs to the project.', rows: 6, spellcheck: false });
  notes.setAttribute('aria-label', 'Project instructions');
  notes.addEventListener('input', () => updateProject(p.id, { instructions: notes.value }));

  const start = (mode) => { op({ op: 'new', project: p.id, mode }); setPage(mode === 'code' ? 'code' : 'chat'); };
  const newChat = el('button', { type: 'button', className: 'av-btn av-act' });
  newChat.innerHTML = `${icon('chat')}<span>New chat</span>`;
  newChat.addEventListener('click', () => start('chat'));
  const newCode = el('button', { type: 'button', className: 'av-btn av-act' });
  newCode.innerHTML = `${icon('code')}<span>New code session</span>`;
  newCode.addEventListener('click', () => start('code'));

  const rows = el('div', { className: 'proj-chats' });
  const mine = await chatsOf(p.id);
  if (!mine.length) rows.append(el('div', { className: 'empty-note', textContent: 'No chats yet. Start one above, or right-click any chat in the sidebar and move it here.' }));
  mine.forEach((s) => {
    const b = el('button', { type: 'button', className: 'proj-row' });
    b.innerHTML = `${icon(s.mode === 'code' ? 'code' : 'chat', { size: 16 })}`;
    b.append(el('span', { className: 'ci-name', textContent: s.name || 'Untitled' }), el('span', { className: 'a-sub', textContent: ago(s.updated) }));
    b.addEventListener('click', () => openSession(s));
    rows.append(b);
  });
  root.replaceChildren(
    el('div', { className: 'proj-head' }, back, del),
    name,
    el('div', { className: 'set-card' }, el('h2', { textContent: 'Instructions' }), notes),
    el('div', { className: 'proj-head' }, el('h2', { textContent: 'Chats and code sessions' }), el('div', { className: 'wb-controls' }, newChat, newCode)),
    rows,
  );
}

function paint() { if (currentPage() === 'projects') (openId ? paintProject() : paintGrid()); }

document.addEventListener('jarvis:page', () => { if (currentPage() === 'projects') paint(); });
document.addEventListener('jarvis:sessions-changed', paint);
document.addEventListener('jarvis:new-project', () => { openId = createProject().id; paint(); });
// typing in the name or the notes repaints through onProjects; keep the field being typed in
onProjects(() => { if (currentPage() === 'projects' && !openId) paint(); });

registerContext('.proj-card', (card) => {
  const p = getProjectById(card.dataset.id);
  if (!p) return [];
  return [
    ['Open', () => { openId = p.id; paint(); }, true],
    'sep',
    ['Delete project', () => { if (confirm(`Delete the project "${p.name}"? Its chats are kept.`)) deleteProject(p.id); }, true, 'danger'],
  ];
});
