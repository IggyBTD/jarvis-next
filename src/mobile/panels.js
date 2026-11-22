// What the sheets hold: the chat list, the chat settings (computer, effort, model, connection) and the approval prompt.
import { openSheet } from './sheets.js';
import { state, onLink, listChats, deleteChat, setTarget, getEffort, setEffort, forget, replyGate, getConvId, isOnline } from './link.js';
import { EFFORTS, EFFORT_LABELS, EFFORT_HINTS } from '../../shared/effort.js';
import { describeCall } from '../../shared/steps.js';
import { prettyModelName } from '../core/model-name.js';
import { hydrateIcons } from '../icons/index.js';
import { revealHidden, hasHidden } from '../../shared/reveal.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const label = (id) => state.machines[id]?.label ?? (id === 'mac' ? 'Mac' : 'PC');

// ---- the chat list ----------------------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = Date.now() - t;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < DAY) return `${Math.round(d / 3_600_000)} h ago`;
  if (d < 2 * DAY) return 'yesterday';
  if (d < 7 * DAY) return `${Math.round(d / DAY)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const bucket = (iso) => { const d = Date.now() - Date.parse(iso); return d < DAY ? 'Today' : d < 2 * DAY ? 'Yesterday' : d < 7 * DAY ? 'Previous 7 days' : 'Earlier'; };

export function openChats({ onOpen, onNew }) {
  const content = el('div', 'm-chats');
  const search = el('input', 'm-search');
  Object.assign(search, { type: 'search', placeholder: 'Search', enterkeyhint: 'search', autocomplete: 'off' });
  search.setAttribute('aria-label', 'Search chats');
  search.setAttribute('autocapitalize', 'none');
  const list = el('div', 'm-list');
  content.append(search, list);

  const edit = el('button', 'm-text-btn', 'Edit');
  edit.type = 'button';
  const add = el('button', 'm-primary', 'New chat');
  add.type = 'button';
  const sheet = openSheet({ title: 'Chats', content, footer: add, left: edit, label: 'Chats' });
  let items = [];
  let editing = false;

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    const shown = items.filter((c) => !q || (c.title || 'New chat').toLowerCase().includes(q));
    if (!shown.length) { list.append(el('p', 'm-empty-list', items.length ? 'No chats match.' : 'No saved chats yet.')); return; }
    let last = '';
    for (const c of shown) {
      const b = bucket(c.updatedAt);
      if (b !== last) { list.append(el('h3', 'm-list-head', b)); last = b; }
      const row = el('div', 'm-row-wrap');
      const open = el('button', 'm-row');
      open.type = 'button';
      if (c.id === getConvId()) open.setAttribute('aria-current', 'true');
      const running = state.running.has(c.id);
      open.append(el('span', 'm-row-title', c.title || 'New chat'), el('span', running ? 'm-row-sub live' : 'm-row-sub', running ? 'Working...' : `${label(c.lastTarget ?? 'pc')} · ${ago(c.updatedAt)}`));
      if (c.summary) open.append(el('span', 'm-row-sum', c.summary)); // a summary line only when the chat has one
      open.addEventListener('click', () => { if (editing) return; sheet.close(); onOpen(c.id); });
      row.append(open);
      if (editing) {
        const del = el('button', 'm-danger-btn', 'Delete');
        del.type = 'button';
        del.setAttribute('aria-label', `Delete ${c.title || 'chat'}`);
        del.addEventListener('click', async () => {
          del.disabled = true;
          try { await deleteChat(c.id); items = items.filter((x) => x.id !== c.id); if (c.id === getConvId()) onNew(); draw(); } catch { del.disabled = false; del.textContent = 'Try again'; }
        });
        row.append(del);
      }
      list.append(row);
    }
  };
  search.addEventListener('input', draw);
  edit.addEventListener('click', () => { editing = !editing; edit.textContent = editing ? 'Done' : 'Edit'; content.dataset.editing = String(editing); draw(); });
  add.addEventListener('click', () => { sheet.close(); onNew(); });

  list.append(el('p', 'm-empty-list', 'Loading...'));
  listChats().then((c) => { items = c; draw(); }).catch(() => { list.replaceChildren(el('p', 'm-empty-list', 'The chat list could not be loaded.')); });
  // another device saved, renamed, pinned or deleted a chat: the open list follows (the server announces it)
  let refresh = 0;
  const off = onLink((e) => {
    if (!sheet.root.isConnected) { off(); clearTimeout(refresh); return; }
    if (e.type !== 'conversations.changed') return;
    clearTimeout(refresh);
    refresh = setTimeout(() => listChats().then((c) => { items = c; draw(); }).catch(() => {}), 400);
  });
  return sheet;
}

// ---- chat settings ----------------------------------------------------------------------------------------------------------------
function segmented({ name, options, value, onPick }) {
  const wrap = el('div', 'm-seg');
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', name);
  const buttons = options.map(({ id, text }) => {
    const b = el('button', 'm-seg-btn', text);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === value));
    b.addEventListener('click', () => {
      for (const o of buttons) o.setAttribute('aria-checked', String(o === b));
      onPick(id);
    });
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}
const group = (title, ...rows) => { const g = el('section', 'm-group'); if (title) g.append(el('h3', 'm-group-head', title)); const box = el('div', 'm-group-box'); box.append(...rows); g.append(box); return g; };
const staticRow = (k, v) => { const r = el('div', 'm-static'); r.append(el('span', 'm-static-k', k), el('span', 'm-static-v', v)); return r; };

export function openSettings() {
  const content = el('div', 'm-settings');
  const ids = Object.keys(state.machines);
  const comp = el('div', 'm-pad');
  const status = el('p', 'm-hint');
  const showStatus = () => { status.textContent = ids.map((id) => `${label(id)} ${state.machines[id]?.online ? 'is online' : 'is offline'}`).join(' · '); };
  showStatus();
  comp.append(segmented({ name: 'Computer', options: ids.map((id) => ({ id, text: label(id) })), value: state.target, onPick: setTarget }), status);

  const eff = el('div', 'm-pad');
  const hint = el('p', 'm-hint', EFFORT_HINTS[getEffort()]);
  eff.append(segmented({ name: 'Effort', options: EFFORTS.map((id) => ({ id, text: EFFORT_LABELS[id] })), value: getEffort(), onPick: (e) => { setEffort(e); hint.textContent = EFFORT_HINTS[e]; } }), hint);

  const modelId = state.health?.model?.modelId;
  const forgetBtn = el('button', 'm-danger-row', 'Forget this phone');
  forgetBtn.type = 'button';
  forgetBtn.addEventListener('click', () => {
    if (forgetBtn.dataset.sure) { forget(); return; }
    forgetBtn.dataset.sure = '1';
    forgetBtn.textContent = 'Tap again to forget this phone';
    setTimeout(() => { delete forgetBtn.dataset.sure; forgetBtn.textContent = 'Forget this phone'; }, 4000);
  });

  content.append(
    group('Computer', comp),
    group('Effort', eff),
    group('Model', staticRow('Running', modelId ? prettyModelName(modelId) : 'No model loaded'), el('p', 'm-hint', 'Choose a different model on the desktop.')),
    group('Connection', staticRow('Server', location.host), staticRow('Status', isOnline() ? 'Connected' : 'Not connected'), forgetBtn),
  );
  return openSheet({ title: 'This chat', content, label: 'Chat settings' });
}

// ---- an approval ------------------------------------------------------------------------------------------------------------------
const TIER_WORD = { T2: 'Asks you first', T3: 'Always asks you' };
const SOURCE = { user: 'you', voice: 'voice', scheduled: 'a scheduled job', agent: 'the coding agent' };
const MAX_SHOWN = 20_000; // characters of a request the phone will show whole; longer ones are answered on the desktop
export function openApproval(request, { index = 1, total = 1, onClose = null } = {}) {
  const { doing } = describeCall(request.action, request.args);
  const content = el('div', 'm-approval');
  content.append(el('p', 'm-appr-kicker', total > 1 ? `JARVIS wants to · ${index} of ${total}` : 'JARVIS wants to'));
  content.append(el('h3', 'm-appr-action', doing));
  content.append(el('p', 'm-appr-meta', [`on ${label(request.target)}`, TIER_WORD[request.tier] ?? 'Needs your OK', `asked by ${SOURCE[request.source] ?? request.source ?? 'unknown'}`].join(' · ')));
  // The whole request, never cut: the summary, the exact arguments with hidden characters shown as codes, what it would do, the
  // screenshot. Approve stays off until the end of the request has been on screen; a request too long to check here is for the desktop.
  if (request.summary) content.append(el('p', 'm-appr-note', revealHidden(request.summary)));
  let args = '';
  try { args = JSON.stringify(request.args ?? {}, null, 1); } catch { args = ''; }
  const tooLong = !args || args.length > MAX_SHOWN;
  const pre = el('pre', 'm-appr-request', tooLong ? 'This request is too long (or cannot be shown) to check on the phone. Answer it on the desktop.' : revealHidden(args));
  const end = el('span', 'm-appr-end', '');
  pre.append(end);
  content.append(el('p', 'm-appr-kicker', 'The exact request'), pre);
  if (hasHidden(args)) content.append(el('p', 'm-appr-note', 'It contains hidden characters, shown as [U+....].'));
  if (request.dryRun) content.append(el('p', 'm-appr-kicker', 'What it would do'), el('pre', 'm-appr-request', revealHidden(JSON.stringify(request.dryRun, null, 1))));
  if (typeof request.screenshot === 'string' && request.screenshot.startsWith('data:image/')) content.append(Object.assign(el('img', 'm-appr-shot'), { src: request.screenshot, alt: 'Screenshot of the page' }));
  // T3 away from the desktop needs the owner's PIN (the server checks it; nothing is stored here)
  const pin = request.tier === 'T3' ? Object.assign(el('input', 'm-pin'), { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'PIN' }) : null;
  if (pin) { pin.setAttribute('aria-label', 'PIN for this approval'); content.append(pin); }
  const buttons = el('div', 'm-appr-buttons');
  const yes = el('button', 'm-primary', 'Approve');
  const no = el('button', 'm-secondary', 'Deny');
  yes.type = no.type = 'button';
  buttons.append(yes, no);
  yes.disabled = true;
  if (!tooLong) new IntersectionObserver((seen, obs) => { if (seen.some((s) => s.isIntersecting)) { yes.disabled = false; obs.disconnect(); } }, { root: pre }).observe(end);
  const sheet = openSheet({ title: '', content, footer: buttons, dismissible: false, onClose, label: `Approve: ${doing}` });
  const answer = (decision) => { replyGate(request.id, decision, decision === 'approve' ? pin?.value ?? '' : ''); sheet.close(); };
  yes.addEventListener('click', () => answer('approve'));
  no.addEventListener('click', () => answer('deny'));
  sheet.panel.focus({ preventScroll: true }); // nothing is focused by default: neither answer is the easy one
  hydrateIcons(sheet.root);
  return sheet;
}
