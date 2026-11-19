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
import { state, onLink, connect, retry, hasToken, sendChat, abort, newChat, openChat, forgetNote, pair } from './link.js';
import * as chat from './chat.js';
import { openChats, openSettings, openApproval } from './panels.js';
import { sheetOpen } from './sheets.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const app = $('m-app');
const input = $('m-input');
const send = $('m-send');
const form = $('m-composer');
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
  root.style.setProperty('--vvh', `${Math.round(h)}px`);
  root.style.setProperty('--vvt', `${Math.round(top)}px`);
  const open = innerHeight - h - top > 120;
  if ((app.dataset.kb === 'open') !== open) { app.dataset.kb = open ? 'open' : 'closed'; if (open) chat.afterSend(); }
}
fit();
if (vv) {
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', () => { window.scrollTo(0, 0); fit(); }); // iOS scrolls the page to show the field: put it back, the app is already placed
}
window.addEventListener('orientationchange', () => setTimeout(fit, 200));

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
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } }); // a hardware keyboard: Cmd+Enter sends; plain Return is a new line

let toastTimer = 0;
function toast(text) {
  let t = $('m-toast');
  if (!t) { t = document.createElement('div'); t.id = 'm-toast'; t.className = 'm-toast'; t.setAttribute('role', 'status'); app.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (chat.isBusy()) { abort(); return; }
  const text = input.value.trim();
  if (!text) return;
  const r = sendChat(text);
  if (!r.ok) { toast(r.reason); return; } // your text stays in the field
  chat.addUser(text);
  chat.beginTurn();
  chat.afterSend();
  input.value = '';
  grow();
  refreshSend();
  renderBar();
});

// ---- the bar, the banner, the greeting ----------------------------------------------------------------------------------------------
function renderBar() {
  const empty = app.dataset.empty === 'true';
  $('m-title-main').textContent = empty ? 'JARVIS' : (state.conv.title || 'New chat');
  const machine = state.machines[state.target];
  const model = state.health?.model?.modelId;
  const bits = [label(state.target)];
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
    case 'chat.done': chat.onDone(e); renderBar(); refreshSend(); break;
    case 'chat.error': chat.onError(e); refreshSend(); break;
    case 'title': case 'target': case 'health': renderBar(); break;
    case 'gate': case 'gate.resolved': syncApprovals(); break;
    case 'agent.step': case 'agent.status': chat.agentEvent(e); break;
    case 'server-error': toast(e.reason || 'The server reported an error.'); break;
    default: break;
  }
});

// ---- the buttons ------------------------------------------------------------------------------------------------------------------------
$('m-chats').addEventListener('click', () => openChats({ onOpen: (id) => openChat(id), onNew: () => { newChat(); input.focus(); } }));
$('m-new').addEventListener('click', () => { newChat(); input.focus(); });
$('m-title').addEventListener('click', () => { if (!sheetOpen()) openSettings(); });

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
