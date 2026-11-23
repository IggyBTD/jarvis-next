// What the sheets hold: the chat list, the chat settings (computer, effort, model, connection) and the approval prompt.
import { openSheet } from './sheets.js';
import { state, onLink, listChats, deleteChat, setMode, setTarget, getEffort, setEffort, forget, replyGate, getConvId, isOnline, listModels, chooseModel } from './link.js';
import { EFFORTS, EFFORT_LABELS, EFFORT_HINTS } from '../../shared/effort.js';
import { describeCall } from '../../shared/steps.js';
import { prettyModelName } from '../core/model-name.js';
import { DEFAULT_SHOWN, sameKey, shownOrder } from '../../shared/shown-models.js';
import { hydrateIcons } from '../icons/index.js';
import { revealHidden, hasHidden } from '../../shared/reveal.js';
import { MODES, MODE_LABELS, MODE_HINTS } from '../../shared/permission-modes.js';

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

  // how much JARVIS may do without asking: the same control as the desktop. Accept edits and Bypass are admin actions, so they ask for the PIN.
  const modeBox = el('div', 'm-pad');
  const modeHint = el('p', 'm-hint', MODE_HINTS[state.permissionMode] ?? '');
  const pin = el('input', 'm-pin'); Object.assign(pin, { type: 'password', inputMode: 'numeric', placeholder: 'PIN for this mode', autocomplete: 'off' }); pin.hidden = true;
  pin.setAttribute('aria-label', 'Owner PIN');
  const modeSeg = el('div', 'm-modes');
  const paintModes = () => { for (const b of modeSeg.children) b.setAttribute('aria-checked', String(b.dataset.mode === state.permissionMode)); modeHint.textContent = MODE_HINTS[state.permissionMode] ?? ''; };
  for (const m of MODES) {
    const b = el('button', 'm-mode', MODE_LABELS[m]); b.type = 'button'; b.dataset.mode = m; b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      const admin = m === 'bypass' || m === 'accept-edits';
      pin.hidden = !admin;
      if (admin && !pin.value) { pin.focus(); modeHint.textContent = 'Enter your PIN, then tap this mode again.'; return; }
      setMode(m, admin ? pin.value : '');
      state.permissionMode = m; paintModes();
    });
    modeSeg.append(b);
  }
  paintModes();
  modeBox.append(modeSeg, pin, modeHint);

  content.append(
    group('Computer', comp),
    group('Effort', eff),
    group('Approvals', modeBox, el('p', 'm-hint', 'Anything that asks shows up here as a sheet, on every computer, with the exact request. Destructive actions always ask and need your PIN.')),
    group('Model', staticRow('Running', modelId ? prettyModelName(modelId) : 'No model loaded'), el('p', 'm-hint', 'Choose a different model on the desktop.')),
    group('Connection', staticRow('Server', location.host), staticRow('Status', isOnline() ? 'Connected' : 'Not connected'), forgetBtn),
  );
  return openSheet({ title: 'This chat', content, label: 'Chat settings' });
}

// ---- an approval ------------------------------------------------------------------------------------------------------------------
const SOURCE = { scheduled: 'a scheduled job', agent: 'the coding agent' }; // an approval you asked for yourself needs no "asked by"
const MAX_SHOWN = 20_000; // characters of a request the phone will show whole; longer ones are answered on the desktop
const asText = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return String(v); } };
// A compact approval: one plain sentence, the exact request in a small box (the command, or every argument one per line), two buttons.
// Nothing about the request is hidden: all of it is in the box, hidden characters are shown as codes, and Approve stays off until the end of the
// box has been on screen. Only the supporting notes (the server's summary, what a dry run would do, a page screenshot) sit behind "More details".
export function openApproval(request, { index = 1, total = 1, onClose = null } = {}) {
  const { doing } = describeCall(request.action, request.args);
  const content = el('div', 'm-approval');
  const meta = [label(request.target), total > 1 ? `${index} of ${total}` : '', request.tier === 'T3' ? 'needs your PIN' : '', SOURCE[request.source] ? `from ${SOURCE[request.source]}` : ''].filter(Boolean).join(' · ');
  content.append(el('p', 'm-appr-meta', meta), el('h3', 'm-appr-action', doing));
  const args = request.args && typeof request.args === 'object' ? request.args : {};
  const rows = Object.entries(args);
  const lines = [];
  if (typeof args.command === 'string') lines.push(['$', args.command]);
  else lines.push([null, request.action]);
  for (const [k, v] of rows) if (!(k === 'command' && typeof v === 'string')) lines.push([k, asText(v)]);
  const total_chars = lines.reduce((n, [, v]) => n + String(v).length, 0);
  const tooLong = total_chars > MAX_SHOWN;
  const box = el('div', 'm-appr-box');
  if (tooLong) box.append(el('p', 'm-appr-line', 'This request is too long to check on the phone. Answer it on the desktop.'));
  else for (const [k, v] of lines) {
    const row = el('p', 'm-appr-line');
    if (k) row.append(el('span', k === '$' ? 'm-appr-prompt' : 'm-appr-key', k));
    row.append(document.createTextNode(revealHidden(v)));
    box.append(row);
  }
  const end = el('span', 'm-appr-end', '');
  box.append(end);
  content.append(box);
  if (hasHidden(JSON.stringify(args))) content.append(el('p', 'm-appr-warn', 'It contains hidden characters, shown as [U+....].'));
  const extras = [];
  if (request.summary) extras.push(el('p', 'm-appr-note', revealHidden(request.summary)));
  if (request.dryRun) extras.push(el('p', 'm-appr-key', 'What it would do'), el('pre', 'm-appr-request', revealHidden(JSON.stringify(request.dryRun, null, 1))));
  if (typeof request.screenshot === 'string' && request.screenshot.startsWith('data:image/')) extras.push(Object.assign(el('img', 'm-appr-shot'), { src: request.screenshot, alt: 'Screenshot of the page' }));
  if (extras.length) {
    const more = el('details', 'm-appr-details');
    const head = el('summary', '', 'More details');
    head.prepend(Object.assign(el('span', 'icon'), { ariaHidden: 'true' }));
    head.firstChild.dataset.icon = 'chevron-right';
    more.append(head, ...extras);
    content.append(more);
  }
  // T3 away from the desktop needs the owner's PIN (the server checks it; nothing is stored here)
  const pin = request.tier === 'T3' ? Object.assign(el('input', 'm-pin'), { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'PIN' }) : null;
  if (pin) { pin.setAttribute('aria-label', 'PIN for this approval'); content.append(pin); }
  const buttons = el('div', 'm-appr-buttons');
  const yes = el('button', 'm-primary', 'Approve');
  const no = el('button', 'm-secondary', 'Deny');
  yes.type = no.type = 'button';
  buttons.append(no, yes);
  yes.disabled = true;
  if (!tooLong) new IntersectionObserver((seen, obs) => { if (seen.some((x) => x.isIntersecting)) { yes.disabled = false; obs.disconnect(); } }, { root: box }).observe(end);
  const sheet = openSheet({ title: '', content, footer: buttons, dismissible: false, onClose, label: `Approve: ${doing}` });
  const answer = (decision) => { replyGate(request.id, decision, decision === 'approve' ? pin?.value ?? '' : ''); sheet.close(); };
  yes.addEventListener('click', () => answer('approve'));
  no.addEventListener('click', () => answer('deny'));
  sheet.panel.focus({ preventScroll: true }); // nothing is focused by default: neither answer is the easy one
  hydrateIcons(sheet.root);
  return sheet;
}

// ---- the model: what the PC has installed, and picking one ---------------------------------------------------------------------------
const ctxK = (n) => (n ? ` · ${Math.round(n / 1024)}k context` : '');
// onSwitching(name | null): the pill says the name while the PC swaps models (a minute or so, the others are unloaded)
export function openModels({ toast, onSwitching }) {
  const box = el('div', 'm-list');
  box.append(el('p', 'm-empty-list', 'Asking the PC for its models...'));
  const sheet = openSheet({ title: 'Model', content: box, label: 'Model' });
  listModels().then((data) => {
    // the three everyday models, in order (what the desktop lists until other models are ticked in its Settings)
    const shown = (data.models ?? []).filter((m) => DEFAULT_SHOWN.some((k) => sameKey(k, m.key))).sort((a, b) => shownOrder(a.key) - shownOrder(b.key));
    // a reload: another model, vision on or off for the loaded one, or another context size
    const reload = async (m, opts, how) => {
      sheet.close();
      const name = prettyModelName(m.name);
      onSwitching(name);
      toast(`Loading ${name}${how} on the PC. This can take a minute.`);
      const r = await chooseModel(m.key, opts);
      if (r.ok && state.health?.model) {
        const a = r.models?.find((x) => x.key === r.active);
        Object.assign(state.health.model, { modelId: r.active, modelPresent: true, reachable: true, ...(a ? { vision: a.vision, loadedContext: a.loadedContext, contextChoices: a.contextChoices, contextFit: a.contextFit } : {}) });
      }
      onSwitching(null);
      toast(r.ok ? `${name} is ready${how}.` : `Could not switch: ${r.error}`);
    };
    const rows = shown.map((m) => {
      const b = el('button', 'm-row'); b.type = 'button';
      if (m.key === data.active) b.setAttribute('aria-current', 'true');
      b.append(el('span', 'm-row-title', prettyModelName(m.name)), el('span', 'm-row-sub', `${m.key === data.active ? 'In use' : m.loaded ? 'Loaded' : 'Not loaded: takes about a minute'}${m.loaded ? ctxK(m.loadedContext) : ''}${m.vision ? (m.vision.on ? ' · vision on' : ' · vision off') : ''}`));
      b.addEventListener('click', () => { if (m.key !== data.active) reload(m, {}, ''); });
      return b;
    });
    // for the model in use: the eye (vision on or off) and its context sizes, each one a reload
    const a = shown.find((m) => m.key === data.active);
    const extra = [];
    if (a?.vision) {
      const v = el('button', 'm-row m-vision'); v.type = 'button'; v.disabled = !a.vision.available;
      v.setAttribute('aria-pressed', String(a.vision.on));
      v.append(el('span', 'm-row-title', a.vision.on ? 'Vision on' : 'Vision off'), el('span', 'm-row-sub', a.vision.available ? (a.vision.on ? 'Reads images, uses about 1 GB. Turn off for more context.' : 'More room for context. Turn on to read images.') : 'There is no text-only copy of this model to turn it off with.'));
      v.addEventListener('click', () => reload(a, { vision: !a.vision.on }, a.vision.on ? ' without vision' : ' with vision'));
      extra.push(v);
    }
    if (a?.contextChoices?.length) {
      const now = a.loadedContext;
      const chips = el('div', 'm-ctx'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Context size');
      a.contextChoices.forEach((n) => {
        const c = el('button', 'm-ctx-chip', `${Math.round(n / 1024)}K`); c.type = 'button';
        c.setAttribute('aria-pressed', String(n === now));
        if (a.contextFit && n > a.contextFit) c.dataset.over = 'true';
        c.addEventListener('click', () => { if (n !== now) reload(a, { context: n }, ` with ${Math.round(n / 1024)}K context`); });
        chips.append(c);
      });
      extra.push(el('p', 'm-hint m-ctx-title', 'Context size. Dashed sizes may not fit the card.'), chips);
    }
    box.replaceChildren(...(rows.length ? rows : [el('p', 'm-empty-list', 'The PC has none of the usual models installed in LM Studio.')]), ...extra, el('p', 'm-hint', 'Choosing a model, vision or a size has the PC load it again, which takes about a minute.'));
  }).catch(() => box.replaceChildren(el('p', 'm-empty-list', isOnline() ? 'The PC did not answer the model list. Try again in a moment.' : 'Cannot reach your PC.')));
}

// ---- the plus: what to add to a message --------------------------------------------------------------------------------------------
// Text files (code, notes, CSV, JSON, Markdown) are read here and put in the message as a quoted block. The model reads text only, so
// photos and PDFs are not offered yet.
const TEXT_LIMIT = 200_000;
export function openAttach({ onText, onSettings, toast }) {
  const content = el('div', 'm-attach');
  const input = el('input'); Object.assign(input, { type: 'file', multiple: true, accept: '.txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.xml,.yml,.yaml,.log,.sh,.sql,.c,.cpp,.java,.go,.rs,text/*' }); input.hidden = true;
  const row = (name, text, sub, run) => { const b = el('button', 'm-arow'); b.type = 'button'; b.append(el('span', 'm-arow-title', text), el('span', 'm-arow-sub', sub)); b.addEventListener('click', run); return b; };
  const pick = row('files', 'Files', 'Text, code, notes, CSV and JSON', () => input.click());
  const settings = row('settings', 'Chat settings', 'Computer, effort, approvals', () => { sheet.close(); setTimeout(onSettings, 260); }); // after the sheet has left
  content.append(input, group(null, pick, settings), el('p', 'm-hint', 'JARVIS reads text only for now. Photos and PDFs need the desktop.'));
  const sheet = openSheet({ title: 'Add to message', content, label: 'Add to message' });
  input.addEventListener('change', async () => {
    const out = [];
    for (const f of input.files) {
      if (f.size > TEXT_LIMIT) { toast(`${f.name} is over 200 KB: too long to put in a message.`); continue; }
      let t = '';
      try { t = await f.text(); } catch { toast(`${f.name} could not be read.`); continue; }
      if (t.includes(String.fromCharCode(0))) { toast(`${f.name} is not a text file.`); continue; }
      const fence = String.fromCharCode(96).repeat(3);
      out.push('File: ' + f.name + '\n' + fence + '\n' + t.replace(/\s+$/, '') + '\n' + fence);
    }
    if (out.length) { sheet.close(); onText(out.join('\n\n')); }
  });
}
