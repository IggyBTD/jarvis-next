// The conversation on the phone: your messages as bubbles, JARVIS's replies as plain serif text, one quiet steps line for what it did, the node
// mesh as its loading icon, and the same mesh resting under the newest reply (it glides down to the next one when you send).
import { renderBlocks } from '../core/markdown.js';
import { meshIcon, feedMesh, resetMeshFeed, restMesh } from '../core/node-mesh.js';
import { createSteps, agentEvent } from './steps.js';
import { state } from './link.js';

// Copy on a code block. The clipboard API needs a secure page; over plain http (the home network) the old way still works from a tap.
function copyText(text) {
  if (navigator.clipboard?.writeText && isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((ok, no) => {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(t);
    t.select();
    t.setSelectionRange(0, text.length);
    const worked = document.execCommand('copy');
    t.remove();
    worked ? ok() : no(new Error('copy refused'));
  });
}

const log = document.getElementById('m-log');
const scroller = document.getElementById('m-scroll');
const app = document.getElementById('m-app');
const jump = document.getElementById('m-jump');
const calm = matchMedia('(prefers-reduced-motion: reduce)');

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const machineLabel = (id) => state.machines[id]?.label ?? (id === 'mac' ? 'Mac' : 'PC');

// ---- scrolling ------------------------------------------------------------------------------------------------------------------
// It follows the reply while you are at the bottom; once you scroll up it leaves you where you are and offers a way back down.
let stick = true;
const fromBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
export function scrollToEnd({ smooth = false } = {}) {
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !calm.matches ? 'smooth' : 'auto' });
}
scroller.addEventListener('scroll', () => {
  stick = fromBottom() < 96;
  jump.hidden = stick || !log.children.length;
  app.dataset.scrolled = scroller.scrollTop > 8 ? 'true' : 'false';
}, { passive: true });
jump.addEventListener('click', () => { stick = true; jump.hidden = true; scrollToEnd({ smooth: true }); });
const follow = () => { if (stick) scrollToEnd(); };

log.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  const code = btn?.closest('.code-box')?.querySelector('code');
  if (!code) return;
  copyText(code.textContent).then(() => { btn.textContent = 'COPIED'; setTimeout(() => { btn.textContent = 'COPY'; }, 1400); }, () => { btn.textContent = 'FAILED'; setTimeout(() => { btn.textContent = 'COPY'; }, 1400); });
});

const syncEmpty = () => { app.dataset.empty = log.children.length ? 'false' : 'true'; };

// ---- the logo: one mesh, resting under the newest reply, loading while JARVIS works ---------------------------------------------------
let logo = null;
function moveLogo(host, { rest = false } = {}) {
  logo ??= meshIcon({ keep: true });
  logo.classList.add('m-logo');
  const from = logo.isConnected ? logo.getBoundingClientRect() : null;
  if (logo.parentElement !== host) host.append(logo);
  restMesh(logo, rest);
  if (!from || calm.matches) return;
  const to = logo.getBoundingClientRect();
  const dy = from.top - to.top, dx = from.left - to.left;
  if (!dy && !dx) return;
  const near = Math.abs(dy) < innerHeight * 1.5; // from far above: fade in at the new place instead of a long flight
  logo.animate(near ? [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-in-out' });
}
function settleLogo() {
  const last = [...log.querySelectorAll('.m-msg.assistant')].at(-1);
  if (last) moveLogo(last, { rest: true }); else logo?.remove();
}

// ---- messages ---------------------------------------------------------------------------------------------------------------------
export function addUser(text, { animate = true } = {}) {
  const m = el('div', 'm-msg user');
  m.append(el('div', 'm-bubble', text));
  if (animate && !calm.matches) { m.classList.add('enter'); m.addEventListener('animationend', () => m.classList.remove('enter'), { once: true }); }
  log.append(m);
  syncEmpty();
  return m;
}

// Replies are written block by block: a block that did not change is left alone, so a long reply costs the same per frame as a short one.
function newAssistant() {
  const m = el('div', 'm-msg assistant');
  const prose = el('div', 'm-prose');
  m.append(prose);
  m.prose = prose;
  m.blocks = [];
  return m;
}
function paintProse(m, text) {
  const next = renderBlocks(text);
  let i = 0;
  while (i < next.length && i < m.blocks.length && next[i] === m.blocks[i]) i++;
  while (m.prose.children.length > i) m.prose.lastChild.remove();
  for (let k = i; k < next.length; k++) {
    const holder = el('div', 'm-blk');
    holder.innerHTML = next[k]; // sanitised by DOMPurify in markdown.js
    m.prose.append(holder);
  }
  m.blocks = next;
}
function addAssistant(text) {
  const m = newAssistant();
  log.append(m);
  paintProse(m, text);
  syncEmpty();
  return m;
}

// ---- a turn -----------------------------------------------------------------------------------------------------------------------
let turn = null; // { thinking, live, steps, text, frame }
export const isBusy = () => !!turn;
let onBusy = () => {};
export const onBusyChange = (cb) => { onBusy = cb; };

function addThinking() {
  const t = el('div', 'm-think');
  t.append(el('span', 'm-think-label', 'Thinking...'));
  log.append(t);
  moveLogo(t);
  syncEmpty();
  return t;
}
export function beginTurn() {
  if (turn) return;
  turn = { thinking: addThinking(), live: null, steps: null, groups: [], text: '', frame: 0 };
  log.setAttribute('aria-busy', 'true'); // VoiceOver waits for the finished reply instead of reading every fragment
  resetMeshFeed();
  app.dataset.busy = 'true';
  onBusy(true);
  if (stick) scrollToEnd();
}
function paint() {
  turn.frame = 0;
  if (turn.live) { paintProse(turn.live, turn.text); follow(); }
}
export function onDelta(text) {
  if (!text) return;
  if (!turn) beginTurn();
  if (!turn.live) { // the first letters: the thinking line is replaced by the reply (the logo stays under it)
    turn.thinking?.remove();
    turn.thinking = null;
    if (turn.steps) { turn.groups.push(turn.steps); turn.steps = null; } // the next tool call starts a new group
    turn.live = newAssistant();
    log.append(turn.live);
    moveLogo(turn.live);
  }
  turn.text += text;
  feedMesh(text);
  if (!turn.frame) turn.frame = requestAnimationFrame(paint);
}
export function onResume(text) { // coming back to a reply that was still being written
  if (!turn) beginTurn();
  turn.text = '';
  if (turn.live) { turn.live.remove(); turn.live = null; }
  onDelta(text);
}
export function onToolCall(e) {
  if (!turn) beginTurn();
  if (turn.live) { cancelAnimationFrame(turn.frame); paint(); turn.live = null; turn.text = ''; if (turn.steps) { turn.groups.push(turn.steps); turn.steps = null; } }
  turn.thinking?.remove();
  turn.thinking = null;
  if (!turn.steps) turn.steps = createSteps(log);
  turn.steps.add(e.name, machineLabel(e.target), 'running', e.args);
  moveLogo(turn.steps.lead);
  syncEmpty();
  follow();
}
export function onToolResult(e) {
  if (!turn?.steps) return;
  turn.steps.finish(e.ok ? 'ok' : e.queued ? 'queued' : e.denied ? 'denied' : 'failed', { summary: e.summary, detail: e.detail, ms: e.ms, taskId: e.taskId });
  if (!turn.thinking) { turn.thinking = addThinking(); } // the model is working on what came back
  follow();
}
function endTurn() {
  if (!turn) return;
  cancelAnimationFrame(turn.frame);
  turn.thinking?.remove();
  for (const g of [...turn.groups, turn.steps]) g?.settle();
  turn = null;
  log.setAttribute('aria-busy', 'false');
  settleLogo();
  delete app.dataset.busy;
  onBusy(false);
}
export function onDone(e) {
  if (!turn) { if (e.text) addAssistant(e.text); settleLogo(); return; }
  if (e.text) { // the server's text is the whole reply: show exactly that
    if (!turn.live) { turn.thinking?.remove(); turn.thinking = null; turn.live = newAssistant(); log.append(turn.live); }
    turn.text = e.text;
    paintProse(turn.live, e.text);
  } else if (turn.live && !turn.text) turn.live.remove();
  endTurn();
  follow();
}
export function onError(e) {
  const stopped = e.reason === 'aborted';
  if (turn?.live && turn.text) { paintProse(turn.live, turn.text); }
  const note = el('div', stopped ? 'm-note' : 'm-note bad', stopped ? 'Stopped' : (e.reason || 'Something went wrong.'));
  log.append(note);
  endTurn();
  follow();
}
export function onNote(e) {
  if (!e.text) return;
  log.append(el('div', 'm-note', e.text));
  follow();
}
export { agentEvent };

// ---- the whole conversation, from the server's snapshot ---------------------------------------------------------------------------
export function renderConversation() {
  if (turn) { cancelAnimationFrame(turn.frame); turn = null; delete app.dataset.busy; onBusy(false); }
  log.replaceChildren();
  logo?.remove();
  for (const m of state.conv.messages ?? []) {
    if (!m.content) continue;
    if (m.role === 'user') addUser(m.content, { animate: false });
    else if (m.role === 'assistant') addAssistant(m.content);
  }
  settleLogo();
  syncEmpty();
  stick = true;
  scrollToEnd();
}
export function clearConversation() {
  if (turn) { cancelAnimationFrame(turn.frame); turn = null; delete app.dataset.busy; onBusy(false); }
  log.replaceChildren();
  logo?.remove();
  syncEmpty();
}
export function afterSend() { stick = true; scrollToEnd(); }
syncEmpty();
