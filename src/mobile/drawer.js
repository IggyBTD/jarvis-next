// The chat drawer: slides in from the left over the screen. Pinned and recent chats, a search field, Settings at the bottom left and
// "New chat" at the bottom right (the layout of Claude's phone app). "View all" opens the full list sheet, where chats can be deleted.
import { hydrateIcons, icon } from '../icons/index.js';
import { state, onLink, listChats, getConvId } from './link.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const RECENT_SHOWN = 12;

let items = [];
let handlers = {};
let query = '';
let refreshTimer = 0;

const root = $('m-drawer');
export const drawerOpen = () => root.classList.contains('open');

function row(c) {
  const b = el('button', 'm-drow');
  b.type = 'button';
  if (c.id === getConvId()) b.setAttribute('aria-current', 'true');
  const ic = el('span', 'm-drow-icon'); ic.innerHTML = icon('chat', { size: 20 });
  b.append(ic, el('span', 'm-drow-title', c.title || 'New chat'));
  if (state.running.has(c.id)) { const d = el('span', 'm-drow-live'); d.setAttribute('aria-label', 'Working'); b.append(d); }
  b.addEventListener('click', () => { closeDrawer(); handlers.onOpen(c.id); });
  return b;
}

function head(text, action) {
  const h = el('div', 'm-dhead', text);
  if (action) { const a = el('button', 'm-dhead-act', action.label); a.type = 'button'; a.addEventListener('click', action.run); h.append(a); }
  return h;
}

export function paintDrawer() {
  const list = $('m-d-list');
  const q = query.trim().toLowerCase();
  if (q) {
    const shown = items.filter((c) => (c.title || 'New chat').toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map(row) : [el('p', 'm-empty-list', 'No chats match.')]));
    return;
  }
  if (!items.length) { list.replaceChildren(el('p', 'm-empty-list', 'No saved chats yet.')); return; }
  const pinned = items.filter((c) => c.pinned);
  const recent = items.filter((c) => !c.pinned);
  const nodes = [];
  if (pinned.length) nodes.push(head('Pinned'), ...pinned.map(row));
  nodes.push(head('Recents', { label: 'View all', run: () => { closeDrawer(); handlers.onViewAll(); } }), ...recent.slice(0, RECENT_SHOWN).map(row));
  list.replaceChildren(...nodes);
}

export function refreshDrawer() {
  return listChats().then((c) => { items = c; paintDrawer(); }).catch(() => { $('m-d-list').replaceChildren(el('p', 'm-empty-list', 'The chat list could not be loaded.')); });
}

export function openDrawer() {
  root.inert = false;
  root.classList.add('open');
  refreshDrawer();
}
export function closeDrawer() {
  root.classList.remove('open');
  root.inert = true;
  $('m-d-q').hidden = true; $('m-d-q').value = ''; query = '';
}

export function initDrawer(h) {
  handlers = h;
  hydrateIcons(root);
  $('m-drawer-scrim').addEventListener('click', closeDrawer);
  $('m-d-search').addEventListener('click', () => { const q = $('m-d-q'); q.hidden = !q.hidden; if (q.hidden) { q.value = ''; query = ''; paintDrawer(); } else q.focus(); });
  $('m-d-q').addEventListener('input', () => { query = $('m-d-q').value; paintDrawer(); });
  $('m-d-new').addEventListener('click', () => { closeDrawer(); h.onNew(); });
  $('m-d-me').addEventListener('click', () => { closeDrawer(); h.onSettings(); });
  // a swipe to the left closes it, like the scrim tap
  let x0 = null;
  root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => { if (x0 != null && x0 - e.changedTouches[0].clientX > 60) closeDrawer(); x0 = null; }, { passive: true });
  // other devices change the list; the open drawer follows
  onLink((e) => {
    if (!drawerOpen()) return;
    if (e.type === 'conversations.changed') { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshDrawer, 400); }
    else if (e.type === 'chat.state' || e.type === 'running') paintDrawer();
  });
}
