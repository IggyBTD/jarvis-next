// The three pages behind the tab bar besides Chat. Projects: the server's project list and the chats in each. Code: the computers JARVIS
// can work on (tap one to make it the target) and the coding agent's sessions. Artifacts: opened on the PC for now, the page says so.
import { hydrateIcons, icon } from '../icons/index.js';
import { state, onLink, listChats, listProjects, saveProjects, patchChat, setTarget } from './link.js';
import { openSheet } from './sheets.js';
import { scan, list as artifactList, openArtifact, kindOf } from './artifacts.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const ago = (t) => { const m = Math.max(0, (Date.now() - Date.parse(t)) / 60000); return m < 1 ? 'now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : m < 20160 ? `${Math.round(m / 1440)} days ago` : 'a while ago'; };

let handlers = {};
let projects = [];
let chats = [];
const queries = { projects: '', code: '' };

const tile = (name) => { const t = el('span', 'm-ptile'); t.innerHTML = icon(name, { size: 24 }); return t; };
const empty = (text) => el('p', 'm-empty-list', text);
const match = (page, ...fields) => !queries[page].trim() || fields.join(' ').toLowerCase().includes(queries[page].trim().toLowerCase());

// ---- projects --------------------------------------------------------------------------------------------------------------------------
function paintProjects() {
  const box = $('m-projects');
  const shown = projects.filter((p) => match('projects', p.name, p.instructions));
  if (!shown.length) { box.replaceChildren(empty(projects.length ? 'No projects match.' : 'No projects yet. A project groups chats and gives them standing instructions.')); return; }
  box.replaceChildren(...shown.map((p) => {
    const mine = chats.filter((c) => c.project === p.id);
    const b = el('button', 'm-prow'); b.type = 'button';
    const text = el('span', 'm-prow-text');
    text.append(el('span', 'm-prow-title', p.name), el('span', 'm-prow-sub', `${mine.length} chat${mine.length === 1 ? '' : 's'}${p.instructions ? ` · ${p.instructions.replace(/\s+/g, ' ').slice(0, 60)}` : ''}`));
    b.append(tile('folder'), text);
    b.addEventListener('click', () => openProject(p));
    return b;
  }));
}
// One project, fully managed: name, instructions, its chats (take one out, add more, start a new one), delete.
function openProject(p0) {
  let p = projects.find((x) => x.id === p0.id) ?? p0;
  const content = el('div', 'm-proj');
  const name = el('input', 'm-search'); Object.assign(name, { type: 'text', value: p.name, maxLength: 60, autocomplete: 'off' }); name.setAttribute('aria-label', 'Project name');
  const ins = el('textarea', 'm-textarea'); Object.assign(ins, { value: p.instructions ?? '', rows: 5, placeholder: 'Instructions JARVIS follows in every chat of this project' }); ins.setAttribute('aria-label', 'Project instructions');
  const save = el('button', 'm-primary', 'Save'); save.type = 'button';
  const chatsBox = el('div', 'm-list');
  const paintChats = () => {
    const mine = chats.filter((c) => c.project === p.id);
    chatsBox.replaceChildren(el('div', 'm-dhead', `Chats (${mine.length})`), ...(mine.length ? mine.map((c) => {
      const r = el('div', 'm-row-wrap'); const o = el('button', 'm-row'); o.type = 'button';
      o.append(el('span', 'm-row-title', c.title || 'New chat'), el('span', 'm-row-sub', ago(c.updatedAt)));
      o.addEventListener('click', () => { sheet.close(); handlers.openChat(c.id); });
      const rm = el('button', 'm-danger-btn', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', `Remove ${c.title || 'chat'} from the project`);
      rm.addEventListener('click', async () => { rm.disabled = true; try { await patchChat(c.id, { project: null }); c.project = undefined; paintChats(); paintProjects(); } catch { rm.disabled = false; } });
      r.append(o, rm); return r;
    }) : [empty('No chats in this project yet.')]));
  };
  const addBtn = el('button', 'm-secondary', 'Add chats'); addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    const unfiled = chats.filter((c) => !c.project);
    const box = el('div', 'm-list');
    if (!unfiled.length) box.append(empty('Every chat is already in a project.'));
    for (const c of unfiled) {
      const b = el('button', 'm-row'); b.type = 'button';
      b.append(el('span', 'm-row-title', c.title || 'New chat'), el('span', 'm-row-sub', ago(c.updatedAt)));
      b.addEventListener('click', async () => { b.disabled = true; try { await patchChat(c.id, { project: p.id }); c.project = p.id; b.remove(); paintChats(); paintProjects(); } catch { b.disabled = false; } });
      box.append(b);
    }
    openSheet({ title: 'Add chats', content: box, label: 'Add chats' });
  });
  const newBtn = el('button', 'm-secondary', 'New chat in this project'); newBtn.type = 'button';
  newBtn.addEventListener('click', () => { sheet.close(); handlers.newChatIn(p); });
  const del = el('button', 'm-danger-row', 'Delete project'); del.type = 'button';
  del.addEventListener('click', async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Tap again: its chats are kept, the project goes'; setTimeout(() => { delete del.dataset.sure; del.textContent = 'Delete project'; }, 4000); return; }
    try { projects = (await saveProjects(projects.filter((x) => x.id !== p.id))).projects; sheet.close(); paintProjects(); } catch { del.textContent = 'Try again'; }
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { projects = (await saveProjects(projects.map((x) => (x.id === p.id ? { ...x, name: name.value.trim() || x.name, instructions: ins.value } : x)))).projects; p = projects.find((x) => x.id === p.id); save.textContent = 'Saved'; paintProjects(); setTimeout(() => { save.textContent = 'Save'; save.disabled = false; }, 1200); }
    catch { save.textContent = 'Try again'; save.disabled = false; }
  });
  content.append(name, ins, save, chatsBox, addBtn, newBtn, del);
  paintChats();
  const sheet = openSheet({ title: 'Project', content, label: p.name });
}
function newProject() {
  const content = el('div', 'm-pad');
  const name = el('input', 'm-search'); Object.assign(name, { type: 'text', placeholder: 'Project name', maxLength: 60, autocomplete: 'off' });
  name.setAttribute('aria-label', 'Project name');
  const go = el('button', 'm-primary', 'Create'); go.type = 'button';
  content.append(name);
  const sheet = openSheet({ title: 'New project', content, footer: go, label: 'New project' });
  const create = async () => {
    const n = name.value.trim(); if (!n) return;
    go.disabled = true;
    try { projects = (await saveProjects([...projects, { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: n, instructions: '', created: Date.now() }])).projects; sheet.close(); paintProjects(); }
    catch { go.disabled = false; go.textContent = 'Try again'; }
  };
  go.addEventListener('click', create);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  setTimeout(() => name.focus(), 350);
}

// ---- code ------------------------------------------------------------------------------------------------------------------------------
function paintCode() {
  const box = $('m-code');
  const nodes = [el('div', 'm-dhead', 'Computers')];
  for (const [id, m] of Object.entries(state.machines ?? {})) {
    if (!match('code', m.label ?? id)) continue;
    const b = el('button', 'm-prow'); b.type = 'button';
    const dot = el('span', 'm-dot'); dot.dataset.state = m.online ? 'ok' : 'off';
    const t = el('span', 'm-ptile'); t.append(dot);
    const text = el('span', 'm-prow-text');
    text.append(el('span', 'm-prow-title', m.label ?? id), el('span', 'm-prow-sub', `${m.online ? 'Online' : 'Offline'}${state.target === id ? ' · working here' : ''}`));
    b.append(t, text);
    if (state.target === id) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => setTarget(id));
    nodes.push(b);
  }
  if (nodes.length === 1) nodes.push(empty('No computers yet. Connect to the JARVIS server first.'));
  nodes.push(el('div', 'm-dhead', 'Sessions'));
  const codeChats = chats.filter((x) => x.mode === 'code' && match('code', x.title ?? ''));
  for (const c of codeChats) { // chats that are coding sessions
    const b = el('button', 'm-prow'); b.type = 'button';
    const text = el('span', 'm-prow-text');
    text.append(el('span', 'm-prow-title', c.title || 'New session'), el('span', 'm-prow-sub', `Coding session · ${ago(c.updatedAt)}`));
    b.append(tile('code'), text);
    b.addEventListener('click', () => handlers.openChat(c.id));
    nodes.push(b);
  }
  const tasks = (state.agentTasks ?? []).filter((t) => match('code', t.prompt ?? '', t.taskId ?? '')).slice(-20).reverse();
  if (!tasks.length && !codeChats.length) nodes.push(empty('No coding sessions yet. Start one to give JARVIS a coding task.'));
  for (const t of tasks) {
    const b = el('div', 'm-prow');
    const text = el('span', 'm-prow-text');
    text.append(el('span', 'm-prow-title', t.prompt || t.taskId), el('span', 'm-prow-sub', String(t.state ?? '')));
    b.append(tile('code'), text);
    nodes.push(b);
  }
  box.replaceChildren(...nodes);
}

// ---- artifacts -------------------------------------------------------------------------------------------------------------------------
async function paintArtifacts() {
  const box = $('m-artifacts');
  const draw = (items, loading) => {
    if (!items.length) { box.replaceChildren(empty(loading ? 'Looking through your chats...' : 'No artifacts yet. Ask JARVIS for a chart, a page, a diagram or a document and it appears here.')); return; }
    box.replaceChildren(...items.map(({ a, from }) => {
      const r = el('button', 'm-prow'); r.type = 'button';
      const text = el('span', 'm-prow-text');
      text.append(el('span', 'm-prow-title', a.title), el('span', 'm-prow-sub', `${kindOf(a)}${from?.chat ? ` · ${from.chat}` : ''}${from?.at ? ` · ${ago(new Date(from.at).toISOString())}` : ''}`));
      r.append(tile('artifacts'), text);
      r.addEventListener('click', () => openArtifact(a.id));
      return r;
    }));
  };
  draw(artifactList(), true);
  draw(await scan(), false);
}

// ---- the page API ----------------------------------------------------------------------------------------------------------------------
export async function showPage(page) {
  if (page === 'projects') {
    paintProjects();
    try { [projects, chats] = await Promise.all([listProjects(), listChats()]); } catch { /* keep what is shown */ }
    paintProjects();
  } else if (page === 'code') { paintCode(); try { chats = await listChats(); } catch { /* keep what is shown */ } paintCode(); }
  else if (page === 'artifacts') paintArtifacts();
}
export function searchPage(page) {
  const input = $(`m-q-${page}`);
  if (!input) return;
  input.hidden = !input.hidden;
  if (input.hidden) { input.value = ''; queries[page] = ''; showPage(page); } else input.focus();
}
export function initPages(h) {
  handlers = h;
  hydrateIcons($('m-app'));
  for (const page of ['projects', 'code']) $(`m-q-${page}`).addEventListener('input', () => { queries[page] = $(`m-q-${page}`).value; if (page === 'projects') paintProjects(); else paintCode(); });
  $('m-fab-project').addEventListener('click', newProject);
  $('m-fab-session').addEventListener('click', () => h.newSession());
  onLink((e) => {
    const page = $('m-app').dataset.page;
    if (page === 'code' && ['state', 'target', 'health', 'agent.status'].includes(e.type)) paintCode();
    if (page === 'projects' && (e.type === 'projects.changed' || e.type === 'conversations.changed')) showPage('projects');
  });
}
