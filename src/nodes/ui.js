// The nodes interface's own behaviour, on top of the shared modules: the core on the empty page, the
// small live core that sits on the reply being written, the moment the core becomes the first atom
// of a conversation, the starter prompts, the services strip and the interface switch.
import { createCore } from './core.js';
import { openWidget, closeWidget, isWidgetOpen } from '../core/whiteboard.js';
import { currentPage } from '../core/whiteboard-mode.js';
import { getSwitches, onSwitchChange } from '../core/switches.js';

const $ = (id) => document.getElementById(id);
const input = $('hud-chat-input');
const out = $('chat-output');
const stack = $('chat-stack');
const composer = $('composer');
const stopBtn = $('dock-stop');
const coreCanvas = $('core-canvas');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// --- the core on the empty page -----------------------------------------------------------------
const coreSize = () => (innerHeight <= 700 ? 120 : 168);
const bigCore = createCore(coreCanvas, { size: coreSize() });
addEventListener('resize', () => { if (coreSize() !== Number.parseInt(coreCanvas.style.width, 10)) bigCore.resize(coreSize()); });

// --- the live core: rides on the newest reply while JARVIS works ---------------------------------
const liveCanvas = Object.assign(document.createElement('canvas'), { className: 'live-core' });
liveCanvas.setAttribute('aria-hidden', 'true');
createCore(liveCanvas, { atoms: 18, neighbours: 3, size: 26, interactive: false, atomScale: 2.4 });

const working = () => !stopBtn.hidden;
function placeLive() {
  if (!working()) { liveCanvas.remove(); return; }
  const replies = out.querySelectorAll(':scope > .chat-line.assistant');
  const target = replies[replies.length - 1];
  const lastUser = [...out.querySelectorAll(':scope > .chat-line.user')].pop();
  // only a reply that belongs to the turn in progress (after the newest message)
  if (!target || (lastUser && !(lastUser.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING))) { liveCanvas.remove(); return; }
  if (liveCanvas.parentElement !== target) target.prepend(liveCanvas);
}
new MutationObserver(placeLive).observe(stopBtn, { attributes: true, attributeFilter: ['hidden'] });

// --- the moment: the core becomes the first atom of the conversation -----------------------------
// Positions are noted while the page is still empty (before a message is sent), because once the
// first line lands the layout has already changed.
let before = null;
const note = () => {
  if (stack.querySelector('.chat-line')) before = { composer: composer.getBoundingClientRect(), core: null };
  else before = { composer: composer.getBoundingClientRect(), core: coreCanvas.getBoundingClientRect() };
};
document.addEventListener('keydown', (e) => { if (e.target === input && e.key === 'Enter' && !e.shiftKey) note(); }, true);
$('new-chat').addEventListener('click', note, true);

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
function slideComposer() {
  if (!before) return;
  const now = composer.getBoundingClientRect();
  const dy = before.composer.top - now.top;
  if (Math.abs(dy) < 2) return;
  composer.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
}
// Where the first reply's atom is: the live core when it is there, else the reply line's own atom.
function atomRect() {
  if (liveCanvas.isConnected) return liveCanvas.getBoundingClientRect();
  const line = out.querySelector(':scope > .chat-line.assistant');
  if (!line) return null;
  const r = line.getBoundingClientRect();
  return { left: r.left + 4, top: r.top + 4, width: 16, height: 16 };
}
function coreToAtom() {
  if (!before?.core?.width) return;
  const to = atomRect();
  if (!to || to.top < 0 || to.top > innerHeight - to.height) return; // already scrolled away: no flight
  const from = before.core;
  const ghost = document.createElement('canvas');
  ghost.width = coreCanvas.width;
  ghost.height = coreCanvas.height;
  ghost.getContext('2d').drawImage(coreCanvas, 0, 0);
  Object.assign(ghost.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, zIndex: 50, pointerEvents: 'none', transformOrigin: '0 0' });
  ghost.setAttribute('aria-hidden', 'true');
  document.body.append(ghost);
  const s = to.width / from.width;
  liveCanvas.style.opacity = '0';
  const anim = ghost.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${s})`, opacity: 1, offset: 0.85 },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${s})`, opacity: 0 },
  ], { duration: 560, easing: EASE });
  const done = () => { ghost.remove(); liveCanvas.style.opacity = ''; };
  setTimeout(done, 700); // a backgrounded window may never finish the animation
  anim.onfinish = done;
  anim.oncancel = done;
}

let hadLines = !!out.querySelector('.chat-line');
new MutationObserver(() => {
  placeLive();
  const has = !!out.querySelector('.chat-line');
  if (has !== hadLines && currentPage() === 'chat' && !reduced.matches) {
    slideComposer();
    if (has) coreToAtom();
  }
  hadLines = has;
  before = null;
}).observe(out, { childList: true });

// --- starters ------------------------------------------------------------------------------
document.querySelectorAll('.starter').forEach((b) => b.addEventListener('click', () => {
  input.value = b.dataset.fill;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}));
const webStarter = document.querySelector('.starter[data-needs="web"]');
const paintStarters = () => { webStarter.hidden = !getSwitches().internet; };
onSwitchChange(paintStarters);
paintStarters();

// --- services strip and the System item -----------------------------------------------------------
$('svc-open').addEventListener('click', () => openWidget('system'));
const navSystem = $('nav-system');
const sysPane = $('ws-system');
const paintNavSystem = () => navSystem.setAttribute('aria-pressed', String(currentPage() === 'chat' && isWidgetOpen('system') && !sysPane.hidden && !document.body.classList.contains('ws-off')));
new MutationObserver(paintNavSystem).observe(sysPane, { attributes: true, attributeFilter: ['hidden'] });
document.addEventListener('jarvis:page', paintNavSystem);
document.addEventListener('jarvis:workspace', paintNavSystem);
paintNavSystem();

// The workspace stays closed until something is opened in it, as in Claude. The first time this
// interface runs, the System tab the classic interface opened at start is closed once.
if (!store.get('jarvis.nodes.seen')) {
  if (isWidgetOpen('system')) closeWidget('system');
  store.set('jarvis.nodes.seen', '1');
}

// --- interface switch -------------------------------------------------------------------------
document.querySelectorAll('[data-ui]').forEach((b) => b.addEventListener('click', () => {
  store.set('jarvis.ui', b.dataset.ui);
  if (b.dataset.ui === 'classic') location.href = './classic.html';
}));
