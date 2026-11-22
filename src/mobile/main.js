// JARVIS on iPhone: the page's entry. Wires the server link to the conversation, the composer, the sheets and the on-screen keyboard.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-serif/latin-400.css';
import '@fontsource/ibm-plex-serif/latin-400-italic.css';
import '@fontsource/ibm-plex-serif/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import { hydrateIcons, setIcon } from '../icons/index.js';
import { mountLogos } from '../core/node-mesh.js';
import { prettyModelName } from '../core/model-name.js';
import { state, onLink, connect, retry, hasToken, sendChat, abort, newChat, openChat, forgetNote, pair, patchChat, getConvId } from './link.js';
import * as chat from './chat.js';
import { openChats, openSettings, openApproval, openAttach } from './panels.js';
import { sheetOpen } from './sheets.js';
import { initDrawer, openDrawer, closeDrawer, drawerOpen } from './drawer.js';
import { initPages, showPage, searchPage } from './pages.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const app = $('m-app');
const input = $('m-input');
const send = $('m-send');
const label = (id) => state.machines[id]?.label ?? (id === 'mac' ? 'Mac' : 'PC');

hydrateIcons(document);
mountLogos();

// ---- the screen and the keyboard ----------------------------------------------------------------------------------------------------
// iOS keeps the layout viewport where it is when the keyboard opens and only shrinks the visual one, so the app follows the visual viewport:
// the composer always sits on the keyboard (or on the home indicator) and the conversation above it stays in view.
const vv = window.visualViewport;
function fit() {
  const h = vv ? vv.height : innerHeight;
  const top = vv ? vv.offsetTop : 0;
  const open = innerHeight - h - top > 120;
  // Only with the keyboard up does the app follow the visual viewport. Closed, the CSS default (the full dynamic viewport) is used:
  // in a home-screen app iOS can report a visual viewport shorter than the screen, which left an empty strip at the bottom.
  if (open) { root.style.setProperty('--vvh', `${Math.round(h)}px`); root.style.setProperty('--vvt', `${Math.round(top)}px`); }
  else { root.style.removeProperty('--vvh'); root.style.removeProperty('--vvt'); }
  if ((app.dataset.kb === 'open') !== open) { app.dataset.kb = open ? 'open' : 'closed'; if (open) chat.afterSend(); }
}
fit();
if (vv) {
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', () => { window.scrollTo(0, 0); fit(); }); // iOS scrolls the page to show the field: put it back, the app is already placed
}
window.addEventListener('orientationchange', () => setTimeout(fit, 200));

// A real app does not zoom: iOS Safari ignores the viewport's no-zoom hint, so pinch and double-tap zoom are stopped here.
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTap = 0;
document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTap < 300) e.preventDefault(); lastTap = n; }, { passive: false });

// the status bar colour of the home-screen app follows the page background
const theme = document.querySelector('meta[name="theme-color"]');
const paintTheme = () => { if (theme) theme.content = getComputedStyle(root).getPropertyValue('--bg').trim(); };
paintTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);

// Dragging the conversation with the keyboard open puts the keyboard away, like Messages does.
let touchY = 0;
$('m-scroll').addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
$('m-scroll').addEventListener('touchmove', (e) => { if (document.activeElement === input && Math.abs(e.touches[0].clientY - touchY) > 24) input.blur(); }, { passive: true });

// ---- the composer --------------------------------------------------------------------------------------------------------------------
function grow() {
  input.style.height = 'auto';
  const max = parseFloat(getComputedStyle(input).maxHeight) || 160;
  input.style.height = `${Math.min(input.scrollHeight, max)}px`;
}
function refreshSend() {
  const busy = chat.isBusy();
  const ready = busy || input.value.trim().length > 0;
  send.setAttribute('aria-disabled', String(!ready));
  send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  send.dataset.mode = busy ? 'stop' : 'send';
  setIcon(send.querySelector('.icon'), busy ? 'stop' : 'send');
}
chat.onBusyChange(refreshSend);
input.addEventListener('input', () => { grow(); refreshSend(); });
// the button does not take focus, so sending does not close the keyboard
send.addEventListener('pointerdown', (e) => e.preventDefault());
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitMessage(); } }); // a hardware keyboard: Cmd+Enter sends; plain Return is a new line

let toastTimer = 0;
function toast(text) {
  let t = $('m-toast');
  if (!t) { t = document.createElement('div'); t.id = 'm-toast'; t.className = 'm-toast'; t.setAttribute('role', 'status'); app.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

send.addEventListener('click', submitMessage);
function submitMessage() {
  if (chat.isBusy()) { abort(); return; }
  const text = input.value.trim();
  if (!text) return;
  const r = sendChat(text, { code: codeMode });
  if (!r.ok) { toast(r.reason); return; } // your text stays in the field
  chat.addUser(text);
  chat.beginTurn();
  chat.afterSend();
  input.value = '';
  grow();
  refreshSend();
  renderBar();
}

// ---- the bar, the banner, the greeting ----------------------------------------------------------------------------------------------
function renderBar() {
  const empty = app.dataset.empty === 'true';
  $('m-title-main').textContent = empty ? 'JARVIS' : (state.conv.title || 'New chat');
  const machine = state.machines[state.target];
  const model = state.health?.model?.modelId;
  const bits = [label(state.target)];
  if (codeMode) bits.unshift('Code');
  if (!state.machines[state.target]) bits.length = 0;
  else if (machine && !machine.online) bits.push('offline');
  else if (model) bits.push(prettyModelName(model));
  $('m-title-sub').textContent = bits.join(' · ');
  $('m-title-sub').dataset.warn = machine && !machine.online ? 'true' : 'false';
  const hour = new Date().getHours();
  $('m-greet').textContent = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('m-greet-sub').textContent = `Running on your ${label(state.target)}.`;
}
function renderStatus() {
  app.dataset.state = state.status;
  const banner = $('m-banner');
  const act = $('m-banner-act');
  const text = $('m-banner-text');
  act.hidden = true;
  if (state.status === 'online') { banner.hidden = true; return; }
  banner.hidden = false;
  if (state.status === 'connecting') text.textContent = 'Connecting to your PC...';
  else if (state.status === 'offline') { text.textContent = 'Cannot reach your PC. Trying again...'; act.hidden = false; act.textContent = 'Retry now'; }
  else if (state.status === 'refused') { text.textContent = state.lastError || 'Cannot connect.'; act.hidden = false; act.textContent = 'Retry'; }
}
$('m-banner-act').addEventListener('click', retry);

// ---- approvals ------------------------------------------------------------------------------------------------------------------------
let approval = null;
const answered = new Set();
function syncApprovals() {
  const waiting = state.pending.filter((p) => !p.queued && !answered.has(p.id));
  const first = waiting[0];
  if (approval && (!first || first.id !== approval.id)) { approval.sheet.close(); approval = null; } // answered on another device or timed out
  if (first && !approval) {
    const request = first;
    const sheet = openApproval(request, { index: 1, total: waiting.length, onClose: () => { answered.add(request.id); if (approval?.id === request.id) approval = null; setTimeout(syncApprovals, 60); } });
    approval = { id: request.id, sheet };
  }
}

// ---- the server's events ----------------------------------------------------------------------------------------------------------------
onLink((e) => {
  switch (e.type) {
    case 'status': renderStatus(); break;
    case 'state':
      chat.renderConversation();
      if (state.running.has(state.conv.id) && !state.conv.streaming) chat.beginTurn(); // answering right now: show that it is working
      renderBar();
      renderStatus();
      syncApprovals();
      refreshSend();
      break;
    case 'resume': chat.onResume(e.text); refreshSend(); break;
    case 'conversation': chat.clearConversation(); renderBar(); refreshSend(); break;
    case 'chat.delta': chat.onDelta(e.text); break;
    case 'tool.call': chat.onToolCall(e); break;
    case 'tool.result': chat.onToolResult(e); break;
    case 'chat.note': chat.onNote(e); break;
    case 'memory.added': case 'memory.removed': chat.onMemory(e, forgetNote); break;
    case 'security.alert': toast(`Security: ${e.reason}`); break;
    case 'chat.done': chat.onDone(e); renderBar(); refreshSend(); if (pendingProject) { patchChat(getConvId(), { project: pendingProject }).catch(() => {}); pendingProject = null; } break;
    case 'chat.error': chat.onError(e); refreshSend(); break;
    case 'title': case 'target': case 'health': renderBar(); break;
    case 'gate': case 'gate.resolved': syncApprovals(); break;
    case 'agent.step': case 'agent.status': chat.agentEvent(e); break;
    case 'server-error': toast(e.reason || 'The server reported an error.'); break;
    default: break;
  }
});

// ---- the pages, the tab bar, the drawer ---------------------------------------------------------------------------------------------------
// Four pages behind a floating tab bar (Chat, Projects, Code, Artifacts), like Claude's phone app. The bar goes away while you type.
let codeMode = false; // a "New session" from the Code page: the next messages go to the coding agent
const startChat = ({ code = false } = {}) => { codeMode = code; newChat(); setPage('chat'); input.placeholder = code ? 'Describe the coding task' : 'Message JARVIS'; input.focus(); };
const goChat = (id) => { codeMode = false; input.placeholder = 'Message JARVIS'; openChat(id); setPage('chat'); };
const openList = () => openChats({ onOpen: goChat, onNew: () => startChat() });

const barRight = $('m-bar-right');
const roundButton = (name, label, run) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'm-round'; b.setAttribute('aria-label', label);
  b.innerHTML = '<span class="icon" aria-hidden="true"></span>';
  b.firstChild.dataset.icon = name;
  b.addEventListener('click', run);
  return b;
};
function renderBarRight(page) {
  const nodes = page === 'chat' ? [composeButton()]
    : page === 'artifacts' ? []
      : [roundButton('search', page === 'projects' ? 'Search projects' : 'Search sessions', () => searchPage(page))];
  barRight.replaceChildren(...nodes);
  hydrateIcons(barRight);
}
// New chat: the chat icon with a small plus on its top right corner, drawn so the two never touch
function composeButton() {
  const b = roundButton('chat', 'New chat', () => startChat());
  b.classList.add('m-compose');
  const plus = document.createElement('span'); plus.className = 'icon m-compose-plus'; plus.dataset.icon = 'plus'; plus.setAttribute('aria-hidden', 'true');
  b.append(plus);
  return b;
}
let page = 'chat';
let chatPos = { top: 0, atEnd: true }; // a hidden element forgets its scroll: the conversation is put back where it was
function setPage(next) {
  const sc = $('m-scroll');
  if (page === 'chat' && next !== 'chat') chatPos = { top: sc.scrollTop, atEnd: sc.scrollHeight - sc.scrollTop - sc.clientHeight < 96 };
  const back = next === 'chat' && page !== 'chat';
  page = next;
  app.dataset.page = next;
  for (const p of ['projects', 'code', 'artifacts']) $(`m-p-${p}`).hidden = p !== next;
  for (const b of document.querySelectorAll('#m-tabs [data-tab]')) { if (b.dataset.tab === next) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  renderBarRight(next);
  if (back) { if (chatPos.atEnd) chat.afterSend(); else sc.scrollTop = chatPos.top; }
  if (next !== 'chat') showPage(next);
  renderBar();
}
for (const b of document.querySelectorAll('#m-tabs [data-tab]')) b.addEventListener('click', () => setPage(b.dataset.tab));
// typing hides the tab bar so the field sits right on the keyboard; it comes back when the keyboard goes
input.addEventListener('focus', () => { app.dataset.typing = 'true'; });
// (a beat later, so a tap on the conversation that ended the typing is not moved out from under the finger by the bar coming back)
input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) delete app.dataset.typing; }, 250));

initDrawer({ onOpen: goChat, onNew: () => startChat(), onSettings: () => { if (!sheetOpen()) openSettings(); }, onViewAll: openList });
let pendingProject = null; // a "New chat in this project": filed as soon as the server has the chat
initPages({ openChat: goChat, newSession: () => startChat({ code: true }), newChatIn: (p) => { startChat(); pendingProject = p.id; } });
$('m-menu').addEventListener('click', () => { if (!sheetOpen()) { if (drawerOpen()) closeDrawer(); else openDrawer(); } });
$('m-plus').addEventListener('click', () => { if (sheetOpen()) return; input.blur(); openAttach({ onText: (t) => { input.value = (input.value ? input.value + '\n\n' : '') + t; grow(); refreshSend(); input.focus(); }, onSettings: () => openSettings(), toast }); });
$('m-title').addEventListener('click', () => { if (!sheetOpen()) openSettings(); });
renderBarRight('chat');

// ---- start ------------------------------------------------------------------------------------------------------------------------------------
if (!hasToken()) {
  app.dataset.state = 'off';
  $('m-greet').textContent = 'Pair this phone';
  $('m-greet-sub').textContent = 'On your PC run node scripts/client-link.js phone, then type the code for the app here.';
  const form = document.createElement('form');
  form.className = 'm-pair';
  const code = Object.assign(document.createElement('input'), { id: 'm-pair-code', placeholder: 'XXXX-XXXX', maxLength: 9, autocomplete: 'off', spellcheck: false });
  code.setAttribute('autocapitalize', 'characters');
  code.setAttribute('aria-label', 'Pairing code');
  const go = Object.assign(document.createElement('button'), { type: 'submit', className: 'm-primary', textContent: 'Pair' });
  form.append(code, go);
  $('m-greet-sub').after(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    const r = await pair(code.value);
    go.disabled = false;
    if (r.error) { $('m-greet-sub').textContent = `Not paired: ${r.error}`; return; }
    form.remove();
    app.dataset.state = 'connecting';
    $('m-greet').textContent = 'Hello';
    $('m-greet-sub').textContent = 'Running on your PC.';
    renderBar();
    renderStatus();
    connect();
  });
} else {
  renderBar();
  renderStatus();
  connect();
}
refreshSend();
