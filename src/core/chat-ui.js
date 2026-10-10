// Wires the chat input, mode buttons and transcript to llm-client.
// A reply is rendered as blocks: optional reasoning, then text and artifact cards in order.
import { chat, setMode, getMode, getPreset, syncModel, onEvent } from './llm-client.js';
import { hasImages, takeAsContent } from './attachments.js';
import { pulse, setThinking } from './mesh-state.js';
import { renderMarkdown, highlightCode } from './markdown.js';
import { parseReply } from './tool-router.js';
import { upsertArtifact } from './artifacts.js';
import { runCommand, registerCommandHost, hasCommand } from './commands.js';
import { getModelHealth } from './model-panel.js';
import { estimateTokens, shouldCompact, trimToolResults, findCut, summaryRequest, applySummary } from './context-manager.js';
import { workContext, setPlanMode, isPlanMode, getTasks, setTasks, formatTasks, taskSummary } from './work-state.js';
import { projectInstructionsContext } from './project-instructions.js';
import { loadSkills, skillsContext, findSkill, skillPrompt, getSkills } from './skills.js';
import { newSessionId, sessionTitle, saveSession, listSessions, loadSession, toMarkdown, exportSession, textOf as messageText } from './sessions.js';
import { handleCommandKey } from './command-palette.js';
import { buildContext } from './memory-client.js';
import { openArtifact, applyBoardSpec } from './whiteboard.js';
import { bindChat, beginTurn } from './voice.js';
import { toolDefinitions, runToolCall, registerActionHost, undoEdit, loadLocalRules } from './actions.js';
import { restoreProject } from './agent-client.js';
import { actionCard, approvalCard, planCard } from './tool-cards.js';
import { assistantToolMessage, toolResultMessage } from './tool-calls.js';

const input = document.getElementById('hud-chat-input');
const output = document.getElementById('chat-output');
const workspace = document.getElementById('center-workspace');
const modeButtons = document.querySelectorAll('.matrix-btn[data-preset]:not([disabled])');

const history = [];
const MAX_TOOL_ROUNDS = 24; // a turn may run this many rounds of actions before it must answer in words
let busy = false;
let working = false; // a message is with the model (busy is also set while a slash command runs)
const stopBtn = document.getElementById('dock-stop');
// The stop button in the dock exists only while a message is with the model.
function setWorking(on) {
  working = on;
  if (stopBtn) stopBtn.hidden = !on;
}
let swapTimer = null;
let approval = null; // the approval card waiting for an answer, if any
let lastSent = ''; // the last message that went to the model, for /retry

function selectMode(name) {
  setMode(name);
  modeButtons.forEach((b) => {
    const active = b.dataset.preset === name;
    b.classList.toggle('active-mode', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

// Load the newly selected model right away (after a short pause so rapid
// clicking doesn't trigger a load for every button passed over).
function scheduleSwap() {
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => syncModel().catch((e) => console.warn('[jarvis] model swap failed:', e)), 500);
}

// Keep the newest text in view until the reader scrolls up themselves; then leave them alone
// until they come back to the bottom (or send the next message). This is a flag, not a measurement
// of the distance to the bottom: a layout change (the chat moving into the whiteboard session, a
// panel opening beside it) moves the bottom away without anyone having scrolled, and measuring then
// would give up following for good.
let following = true;
let lastUserScroll = 0;
const distanceFromBottom = () => output.scrollHeight - output.scrollTop - output.clientHeight;
const nearBottom = () => following;
const follow = (stick) => { if (stick) output.scrollTop = output.scrollHeight; };
const noteUserScroll = () => { lastUserScroll = performance.now(); };
['wheel', 'touchmove', 'pointerdown', 'keydown'].forEach((type) => output.addEventListener(type, noteUserScroll, { passive: true }));
output.addEventListener('pointermove', (e) => { if (e.buttons & 1) noteUserScroll(); }, { passive: true }); // dragging the scrollbar
// Any move upwards lets go of the stream at once, without waiting for the scroll event: the next
// streamed chunk would otherwise pull the reader back down before that event arrives. This is
// listened for in the capture phase on the whole panel, so a nested scroller (thinking text, a diff,
// command output) that is already at its end cannot swallow the gesture either.
output.addEventListener('wheel', (e) => { if (e.deltaY < 0) following = false; }, { passive: true, capture: true });
output.addEventListener('touchmove', () => { following = false; }, { passive: true, capture: true });
output.addEventListener('keydown', (e) => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) following = false; }, { passive: true });
output.addEventListener('scroll', () => {
  if (performance.now() - lastUserScroll < 400) following = distanceFromBottom() < 48;
});
// Whenever the transcript's box changes (window or panel resized, moved into the whiteboard),
// stay on the newest text if that is where the reader was.
new ResizeObserver(() => follow(following)).observe(output);

const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtChars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

// Transcript line: text container plus a small dim timestamp (and attachment names).
function addLine(role, text, { files = [], meta = clock() } = {}) {
  const el = document.createElement('div');
  el.className = `chat-line ${role}`;
  const body = document.createElement('div');
  body.className = 'chat-text';
  body.textContent = text;
  el.append(body);
  files.forEach((name) => {
    const f = document.createElement('span');
    f.className = 'chat-attach';
    f.textContent = `+ ${name}`;
    el.append(f);
  });
  if (meta) {
    const m = document.createElement('span');
    m.className = 'chat-meta';
    m.textContent = meta;
    el.append(m);
  }
  output.appendChild(el);
  return el;
}

const setText = (el, text) => { el.querySelector('.chat-text').textContent = text; };

// --- assistant blocks ----------------------------------------------------
function artifactCard(p, done) {
  const usable = p.complete || (done && p.content);
  const title = p.opening ? 'Writing artifact...' : escapeHtml(p.title);
  const state = p.complete ? 'Open' : done ? 'Incomplete' : `Writing... ${fmtChars(p.content.length)}`;
  const type = p.opening ? '...' : p.type === 'code' && p.lang ? p.lang : p.type;
  return `<button type="button" class="artifact-card${usable ? '' : ' busy'}" data-artifact="${escapeHtml(p.id)}"${usable ? '' : ' disabled'}>`
    + `<span class="ac-type">${escapeHtml(type)}</span><span class="ac-title">${title}</span><span class="ac-state">${state}</span></button>`
    + artifactSource(p);
}

// The source of a code-like artifact, written out under its card. Only the whiteboard's session
// panel shows it (CSS), so the conversation there reads like a coding tool: you watch the code
// being written. Highlighting waits for the finished artifact; while it streams it is plain text.
const SOURCE_LANG = { html: 'xml', svg: 'xml' };
function artifactSource(p) {
  if (p.opening || !p.content || !(p.type === 'code' || p.type in SOURCE_LANG)) return '';
  const lang = p.type === 'code' ? p.lang : SOURCE_LANG[p.type];
  const body = p.complete ? highlightCode(p.content, lang) : escapeHtml(p.content);
  return `<div class="code-box ac-source"><div class="code-head"><span>${escapeHtml(lang || 'code')}</span><button type="button" class="copy-btn">Copy</button></div><pre><code class="hljs">${body}</code></pre></div>`;
}

// quiet: redrawing a saved conversation: artifacts are registered again but nothing is opened or arranged.
function renderAssistant(el, content, { done, quiet = false }) {
  let html = '';
  for (const p of parseReply(content)) {
    if (p.kind === 'board') {
      if (done && !quiet) applyBoardSpec(p); // arrange the panels once the whole reply is in
      continue;
    }
    if (p.kind === 'text') {
      html += `<div class="md">${renderMarkdown(p.text)}</div>`;
      continue;
    }
    html += artifactCard(p, done);
    if (p.id && p.content && (p.complete || done)) {
      const { changed } = upsertArtifact({ ...p, partial: !p.complete });
      // A source file has nothing to preview: it is already written out in the session, so it
      // gets no panel of its own unless the user clicks its card. Everything else opens beside it.
      if (quiet) { /* registered above, left closed */ }
      else if (changed) openArtifact(p.id);
    }
  }
  el.querySelector('.chat-text').innerHTML = html;
}

// Collapsible reasoning block above the answer.
function renderThought(el, reasoning, { startedAt, answered }) {
  if (!reasoning) return;
  let box = el.querySelector('.thought');
  if (!box) {
    box = document.createElement('details');
    box.className = 'thought';
    box.innerHTML = '<summary></summary><div class="thought-body"></div>';
    el.prepend(box);
  }
  const secs = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
  box.querySelector('summary').textContent = answered ? `Thought for ${secs}s` : 'Thinking...';
  box.querySelector('.thought-body').textContent = reasoning;
}

// The message in flight, so that a voice message that only sounded finished can be taken back when
// the speaker carries on (voice.js, tryContinue): the reply is cancelled, the message and the
// half-made reply disappear, and the caller continues with the returned text. Null when there is
// nothing to take back or the message carried attachments (those were already consumed). The turn
// stays available after the reply has streamed in: voice.js only asks while nothing has been said
// aloud yet, and a new message replaces it.
let turn = null;
function interrupt() {
  const t = turn;
  if (!t || t.files || t.taken) return null;
  t.taken = true;
  t.controller.abort();
  t.speech?.abort();
  t.userLine.remove();
  t.lines.forEach((l) => l.remove()); // the reply lines and action lines of this turn
  history.length = t.base;            // the user message and everything the turn added
  turn = null;
  busy = false;
  setWorking(false);
  setThinking(false);
  return t.text;
}

// /stop ends a running turn (a long agent job) without waiting for it.
function stopTurn() {
  turn?.controller.abort();
  approval?.cancel();
}
stopBtn?.addEventListener('click', stopTurn);
document.addEventListener('jarvis:stop', stopTurn); // Ctrl+. (shortcuts.js)

async function send() {
  const text = input.value.trim();
  if (busy && text.toLowerCase() === '/stop') {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    stopTurn();
    return;
  }
  const side = text.match(/^\/btw(?:\s+([\s\S]*))?$/i); // a side question works while JARVIS is busy
  if (side) {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    btw((side[1] ?? '').trim());
    return;
  }
  if (!text || busy) return;
  busy = true;
  following = true; // a new message always brings the reader back to the bottom
  clearTimeout(swapTimer);
  input.value = '';
  input.dispatchEvent(new Event('input')); // shrink the field back to one line

  // /<skill> task sends the skill's instructions as the message; every other slash command runs locally.
  const named = text.match(/^\/([\w-]+)\s*([\s\S]*)$/);
  const skill = named && !hasCommand(named[1]) ? findSkill(named[1]) : null;
  const skillText = skill ? skillPrompt(skill, named[2].trim()) : null;

  // Slash commands run locally and never reach the model.
  if (text.startsWith('/') && !skill) {
    try {
      const reply = await runCommand(text);
      addLine('user', text, { meta: '' });
      if (reply) addLine('system', reply, { meta: '' });
      output.scrollTop = output.scrollHeight;
    } finally {
      busy = false;
    }
    return;
  }

  // Images only work on the vision model.
  if (hasImages() && getMode() !== 'visual') selectMode('visual');
  const { content, names } = takeAsContent(skillText ?? text);
  lastSent = text;

  setWorking(true);
  try { await maybeCompact(); } catch (e) { console.warn('[jarvis] compaction failed:', e); } // between turns, so no index shifts mid-turn
  const base = history.length;
  history.push({ role: 'user', content });
  const userMsg = history[base];
  if (skillText) userMsg.shown = text;
  let consistent = history.length; // the history up to here is complete, with no tool call left unanswered
  const userLine = addLine('user', text, { files: names });
  markUser(userLine, userMsg);
  workspace.classList.add('has-output');
  let pending = addLine('assistant pending', 'Thinking...', { meta: '' });
  // The line says what is really happening: a model is loaded or unloaded only when LM Studio is
  // doing that (llm-client phase events); every other wait before the first token is the model
  // reading the message, which is thinking.
  const shortName = (key) => String(key ?? '').split('/').pop();
  const offPhase = onEvent((e) => {
    if (e.type !== 'phase' || !pending?.classList.contains('pending')) return;
    if (e.phase === 'loading') setText(pending, `Loading ${shortName(e.model)}...`);
    else if (e.phase === 'unloading') setText(pending, `Unloading ${shortName(e.model)}...`);
    else setText(pending, 'Thinking...');
  });
  output.scrollTop = output.scrollHeight;

  let latest = { content: '', reasoning: '' };
  let thinkStart = null;
  let frame = 0;
  // The whole reply is redrawn on every paint, so a long reply gets expensive (about 10 ms at 5K
  // characters, 20 ms at 10K): drawing it every frame stalls the page. While it streams, a paint
  // waits until four times its own last cost has passed (so redrawing takes about a fifth of the
  // time at most); short replies still update every frame. The final paint is never delayed.
  let paintCost = 0;
  let lastPaint = 0;
  function paintStreaming() {
    frame = 0;
    if (mine.taken) return;
    if (performance.now() - lastPaint < paintCost * 4) { frame = requestAnimationFrame(paintStreaming); return; }
    const started = performance.now();
    const stick = nearBottom();
    paint(false);
    follow(stick);
    lastPaint = performance.now();
    paintCost = lastPaint - started;
  }
  const paint = (done) => {
    renderThought(pending, latest.reasoning, { startedAt: thinkStart ?? performance.now(), answered: !!latest.content || done });
    if (latest.content) renderAssistant(pending, latest.content, { done });
  };
  const stamp = () => {
    const m = document.createElement('span');
    m.className = 'chat-meta';
    m.textContent = `${clock()}  ${getPreset().model}`;
    pending.append(m);
  };

  const speech = beginTurn(); // null unless the reply is to be spoken (voice.js)
  const controller = new AbortController();
  const mine = { controller, text, userLine, speech, base, lines: [pending], files: names.length > 0, taken: false };
  turn = mine;
  try {
    const memoryContext = await buildContext(text);
    const context = [speech ? `${memoryContext}

<voice-mode>This reply will be spoken aloud.</voice-mode>`.trim() : memoryContext, projectInstructionsContext(), skillsContext()].filter(Boolean).join('\n\n');
    let spoken = ''; // text of the rounds already finished, so speech sees one growing text
    for (let round = 0; ; round++) {
      latest = { content: '', reasoning: '' };
      thinkStart = null;
      if (round > 0 && shouldCompact(lastUsed, contextMax())) trimToolResults(history, 8); // long agent job: shorten old tool output
      const result = await chat(history, {
        context: [context, workContext()].filter(Boolean).join('\n\n'), // the task list and plan mode can change between rounds
        signal: controller.signal,
        tools: round < MAX_TOOL_ROUNDS ? toolDefinitions() : null,
        onDelta({ content: visible, reasoning, thinking }) {
          if (mine.taken) return;
          pending.className = 'chat-line assistant';
          setThinking(thinking);
          if (thinkStart === null) thinkStart = performance.now();
          if (thinking) speech?.thinking();
          if (!thinking) { pulse(); speech?.push(spoken + visible); }
          if (thinking && !reasoning) setText(pending, 'Thinking...');
          latest = { content: visible, reasoning };
          if (!frame) frame = requestAnimationFrame(paintStreaming);
        },
      });
      cancelAnimationFrame(frame);
      frame = 0;
      if (mine.taken) return;
      lastUsed = (result.stats.promptTokens ?? 0) + (result.stats.completionTokens ?? 0);
      const { reply } = result;
      // Past the round limit the model was given no tools; ignore any call it makes anyway.
      const toolCalls = round < MAX_TOOL_ROUNDS ? result.toolCalls : [];
      const stick = nearBottom();
      pending.className = 'chat-line assistant';
      latest.content = reply;
      if (reply) paint(true);
      else {
        renderThought(pending, latest.reasoning, { startedAt: thinkStart ?? performance.now(), answered: true });
        if (!latest.reasoning && !toolCalls.length) setText(pending, result.toolCalls.length ? `(Stopped after ${MAX_TOOL_ROUNDS} rounds of actions. Send a message to carry on.)` : '(empty response)');
      }

      if (!toolCalls.length) {
        history.push({ role: 'assistant', content: reply || (result.toolCalls.length ? `(Stopped after ${MAX_TOOL_ROUNDS} rounds of actions.)` : '') });
        speech?.end(spoken + reply);
        stamp();
        follow(stick);
        break;
      }

      // The model asked for actions: run each through the permission gate, record the round in the
      // history (the model must see its own calls and their results), then let it continue.
      history.push(assistantToolMessage(reply, toolCalls));
      if (!reply && !latest.reasoning) { pending.remove(); mine.lines.splice(mine.lines.indexOf(pending), 1); }
      else stamp();
      if (reply) spoken += `${reply}\n\n`;
      for (const call of toolCalls) {
        const r = await runToolCall(call);
        if (mine.taken) return;
        history.push(toolResultMessage(call, r.content));
        if (r.display?.undo) turnEdits.set(userMsg, [...(turnEdits.get(userMsg) ?? []), r.display.undo]); // for rewind
        if (r.display) {
          const card = actionCard(r.display, { onUndo: async (u) => { await undoEdit(u); u.undone = true; } });
          output.appendChild(card);
          follow(following);
          mine.lines.push(card);
        } else {
          const label = r.ok ? 'Action' : r.decision === 'deny' ? 'Refused' : 'Failed';
          mine.lines.push(addLine('system', `${label}  ${call.name}  ${r.content}`, { meta: '' }));
        }
      }
      consistent = history.length;
      pending = addLine('assistant pending', 'Thinking...', { meta: '' });
      mine.lines.push(pending);
      follow(stick);
    }
  } catch (e) {
    cancelAnimationFrame(frame);
    if (mine.taken) return; // taken back by interrupt(): it already cleaned up
    speech?.abort();
    approval?.cancel();
    const stopped = e?.name === 'AbortError';
    // Work already done in earlier rounds stays in the history, so the model knows about it; a turn
    // that never got an answer is dropped as before so the message can be sent again.
    if (stopped) { history.length = consistent; history.push({ role: 'assistant', content: '(Stopped by the user.)' }); }
    else history.length = consistent > base + 1 ? consistent : base;
    pending.className = stopped ? 'chat-line system' : 'chat-line error';
    pending.querySelector('.thought')?.remove();
    setText(pending, stopped ? 'Stopped' : `Could not reach the model: ${e.message}`);
  } finally {
    offPhase();
    if (!mine.taken) { setThinking(false); busy = false; setWorking(false); saveSoon(); }
  }
}

// --- context: keeping the conversation inside the model's window ---------
const DEFAULT_CTX = 32768; // used until LM Studio has told us the loaded context length
let lastUsed = 0;          // tokens the server counted for the last request (prompt + reply)
const contextMax = () => getModelHealth().ctxMax || DEFAULT_CTX;
const countToolResults = () => history.filter((m) => m.role === 'tool').length;

// Before a new message: shorten old tool output; if that is not enough, summarise the old part.
async function maybeCompact() {
  const max = contextMax();
  if (!shouldCompact(Math.max(lastUsed, estimateTokens(history, 3000)), max)) return;
  trimToolResults(history, 8);
  lastUsed = 0; // the server's number no longer describes this history
  if (shouldCompact(estimateTokens(history, 3000), max)) await compactNow('');
}

// Replaces everything but the last few messages by a summary the model writes. Returns '' (it writes its own line).
async function compactNow(focus) {
  const cut = findCut(history, 6);
  if (cut < 2) { addLine('system', 'Nothing to compact yet: the conversation is still short.', { meta: '' }); return ''; }
  const note = addLine('system', 'Compacting the conversation...', { meta: '' });
  try {
    const { reply } = await chat(summaryRequest(history.slice(0, cut), focus), { tools: null });
    if (!reply.trim()) throw new Error('the model wrote no summary');
    const removed = applySummary(history, cut, reply);
    for (const m of removed) {
      const l = userLines.get(m);
      if (l) { l.querySelector('.chat-edit')?.remove(); l.classList.add('summarised'); userLines.delete(m); }
      turnEdits.delete(m);
    }
    lastUsed = 0;
    setText(note, `Compacted: ${removed.length} messages became a summary. About ${estimateTokens(history).toLocaleString()} tokens now. Messages above this line can no longer be rewound to.`);
    saveSoon();
  } catch (e) {
    setText(note, `Compact failed: ${e.message ?? e}`);
  }
  return '';
}

function contextReport() {
  const max = contextMax();
  const est = estimateTokens(history);
  const used = Math.max(lastUsed, est);
  const pct = Math.round((used / max) * 100);
  const bar = '#'.repeat(Math.min(20, Math.round(pct / 5))).padEnd(20, '.');
  return [
    `Context  [${bar}] ${pct}%  about ${used.toLocaleString()} of ${max.toLocaleString()} tokens`,
    `Messages ${history.length} (${countToolResults()} tool results), about ${est.toLocaleString()} tokens`,
    `Tasks    ${getTasks().length ? taskSummary() : 'none'}    Plan mode ${isPlanMode() ? 'on' : 'off'}`,
    `Auto-compact at ${Math.round(max * 0.75).toLocaleString()} tokens. /compact [focus] summarises now.`,
  ].join('\n');
}

// --- rewind and edit from here -------------------------------------------
// Every user line remembers its history message. EDIT puts the conversation back to just before
// that message and the message back in the field; the files the agent changed since then are put
// back too (Shift+click leaves them). A file you changed yourself afterwards is not overwritten.
const turnEdits = new Map(); // user message -> the undo records of the edits made in its turn
const userLines = new Map(); // user message -> its line in the transcript
const lineMsgs = new WeakMap(); // line -> message

function markUser(line, msg) {
  userLines.set(msg, line);
  lineMsgs.set(line, msg);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chat-edit';
  b.textContent = 'Edit';
  b.title = 'Rewind to here and edit this message. The files JARVIS changed since are put back; Shift+click leaves them.';
  line.append(b);
}

async function rewindTo(msg, { code = true } = {}) {
  if (working) return 'JARVIS is busy. Use /stop first.';
  const at = history.indexOf(msg);
  if (at < 0) return 'That message was summarised by /compact, so it cannot be rewound to.';
  let restored = 0;
  const failed = [];
  if (code) {
    const undos = history.slice(at).filter((m) => m.role === 'user').flatMap((m) => turnEdits.get(m) ?? []).filter((u) => !u.undone).reverse();
    for (const u of undos) {
      try { await undoEdit(u); u.undone = true; restored++; } catch (e) { failed.push(`${u.path} (${e?.message ?? e})`); }
    }
  }
  const text = msg.shown ?? messageText(msg.content);
  history.slice(at).forEach((m) => { turnEdits.delete(m); userLines.delete(m); });
  history.length = at;
  const line = [...output.children].find((l) => lineMsgs.get(l) === msg);
  if (line) { while (line.nextSibling) line.nextSibling.remove(); line.remove(); }
  turn = null;
  lastSent = '';
  lastUsed = 0;
  if (!history.length) workspace.classList.remove('has-output');
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.focus();
  saveSoon();
  const parts = [`Rewound to before that message. Edit it and send it again.`];
  if (restored) parts.push(`${restored} file change${restored === 1 ? '' : 's'} put back.`);
  if (failed.length) parts.push(`Not put back: ${failed.join('; ')}.`);
  addLine('system', parts.join(' '), { meta: '' });
  return '';
}

// /rewind lists your messages; /rewind <n> [chat] rewinds to message n.
async function rewindCommand(args) {
  const users = history.filter((m) => m.role === 'user' && !m.summary);
  const [n, flag] = args.trim().split(/\s+/);
  if (!n) {
    if (!users.length) return 'Nothing to rewind to yet.';
    return `${users.map((m, i) => `${i + 1}  ${(m.shown ?? messageText(m.content)).split('\n')[0].slice(0, 80)}`).join('\n')}\n/rewind <n> goes back to just before that message (add "chat" to leave the files alone). The EDIT button on a message does the same.`;
  }
  const msg = users[Number(n) - 1];
  if (!msg) return `No message ${n}. Type /rewind to list them.`;
  return rewindTo(msg, { code: flag !== 'chat' });
}

// --- saved sessions ------------------------------------------------------
let session = { id: newSessionId(), name: '', created: Date.now() };
let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!history.length) return;
    session.name ||= sessionTitle(history);
    saveSession({ ...session, updated: Date.now(), messages: history.length }, history).catch(() => { /* a plain browser cannot save */ });
  }, 400);
}
const startSession = () => { session = { id: newSessionId(), name: '', created: Date.now() }; };
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
let lastListing = [];

async function sessionsCommand() {
  lastListing = (await listSessions()).filter((s) => s.id !== session.id || history.length);
  if (!lastListing.length) return 'No saved sessions yet. Conversations are saved after every reply.';
  return `${lastListing.map((s, i) => `${i + 1}  ${s.name}  (${s.messages} messages, ${ago(s.updated)})${s.id === session.id ? '  <- this one' : ''}`).join('\n')}\n/resume <n or part of the name> opens one.`;
}

// Redraws a saved conversation from its history (replies as text, actions as short lines).
function renderHistory() {
  output.replaceChildren();
  userLines.clear();
  for (const m of history) {
    if (m.summary) { if (m.role === 'user') addLine('system', 'Earlier conversation summarised', { meta: '' }); continue; }
    if (m.role === 'user') markUser(addLine('user', m.shown ?? messageText(m.content), { meta: '' }), m);
    else if (m.role === 'assistant') {
      const text = messageText(m.content);
      if (text) renderAssistant(addLine('assistant', '', { meta: '' }), text, { done: true, quiet: true });
      if (m.tool_calls) addLine('system', `Action  ${m.tool_calls.map((c) => c.function.name).join(', ')}`, { meta: '' });
    } else if (m.role === 'tool') addLine('system', `Result  ${String(m.content).split('\n')[0].slice(0, 140)}`, { meta: '' });
  }
  workspace.classList.toggle('has-output', history.length > 0);
  output.scrollTop = output.scrollHeight;
}

async function resumeCommand(arg) {
  if (working) return 'JARVIS is busy. Use /stop first.';
  const q = arg.trim();
  if (!q) return sessionsCommand();
  if (!lastListing.length) lastListing = await listSessions();
  const pick = /^\d+$/.test(q) ? lastListing[Number(q) - 1]
    : lastListing.find((s) => s.id === q) ?? lastListing.find((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  if (!pick) return `No saved session matches "${q}". Type /sessions.`;
  const saved = await loadSession(pick.id);
  history.length = 0;
  history.push(...saved);
  turnEdits.clear();
  session = { id: pick.id, name: pick.name, created: pick.created ?? Date.now() };
  lastSent = '';
  lastUsed = 0;
  turn = null;
  renderHistory();
  return `Resumed "${pick.name}" (${history.length} messages). File changes from before cannot be rewound, but the conversation can.`;
}

async function exportCommand() {
  if (!history.length) return 'Nothing to export yet.';
  const name = session.name || sessionTitle(history);
  const md = toMarkdown(name, history);
  try {
    return `Saved to ${await exportSession(session.id, md)}`;
  } catch {
    return (await copyText(md)) ? 'Export copied to the clipboard (saving a file needs the desktop app).' : 'Could not export.';
  }
}

// --- /btw: a side question that sees the conversation but is not part of it -------
function btw(question) {
  if (!question) { addLine('system', 'Usage: /btw <question>. It sees this conversation, answers briefly, and is not added to it.', { meta: '' }); return; }
  const line = addLine('system', '', { meta: '' });
  line.classList.add('btw');
  const head = document.createElement('div');
  head.className = 'btw-q';
  head.textContent = `By the way: ${question}`;
  const body = document.createElement('div');
  body.className = 'btw-a';
  body.textContent = working ? 'Thinking (JARVIS is busy with your task, so this may be slow)...' : 'Thinking...';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'chat-edit btw-x';
  close.textContent = '×';
  close.title = 'Dismiss this answer';
  close.addEventListener('click', () => line.remove());
  line.replaceChildren(head, body, close);
  follow(following);
  // Only the spoken text of the conversation: no tool traffic, so a turn in progress cannot leave a dangling call.
  const talk = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls && messageText(m.content)).slice(-24);
  const messages = [...talk, { role: 'user', content: `(A side question. Answer briefly from the conversation so far. Do not use tools. It is not part of the conversation.)\n${question}` }];
  chat(messages, { tools: null, onDelta: ({ content }) => { if (content) body.textContent = content; } })
    .then(({ reply }) => { body.textContent = reply || '(no answer)'; })
    .catch((e) => { body.textContent = `Could not answer: ${e.message ?? e}`; });
}

// --- transcript clicks: artifact cards, code copy, inert links ----------
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

output.addEventListener('click', async (e) => {
  const edit = e.target.closest('.chat-edit:not(.btw-x)');
  if (edit) {
    const msg = lineMsgs.get(edit.closest('.chat-line'));
    if (msg) rewindTo(msg, { code: !e.shiftKey });
    return;
  }
  const card = e.target.closest('.artifact-card');
  if (card && !card.disabled) { openArtifact(card.dataset.artifact); return; }

  const copy = e.target.closest('.copy-btn');
  if (copy) {
    const code = copy.closest('.code-box')?.querySelector('code');
    const ok = code && await copyText(code.innerText);
    copy.textContent = ok ? 'Copied' : 'Failed';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    return;
  }

  if (e.target.closest('a')) e.preventDefault(); // links must not navigate the app window away
});

// Fade the top edge only while text is scrolled beneath it, so the first message is never dimmed.
output.addEventListener('scroll', () => output.classList.toggle('fade-top', output.scrollTop > 4));

modeButtons.forEach((b) => b.addEventListener('click', () => {
  selectMode(b.dataset.preset);
  if (!busy) scheduleSwap();
}));
// Enter sends; Shift+Enter starts a new line (the field is a textarea that grows, input-grow.js).
input.addEventListener('keydown', (e) => {
  if (handleCommandKey(e)) return; // the "/" menu takes arrows, Tab, Esc and Enter while it is open
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
bindChat({
  input,
  submit: send,
  interrupt,
  notify: (text) => { addLine('system', text, { meta: '' }); follow(following); },
});
registerActionHost({
  selectMode: (name, { swap = false } = {}) => { selectMode(name); if (swap && !busy) scheduleSwap(); },
  // The approval card: shown in the transcript, answered with a click. Resolves once | always | deny.
  approve: (request) => {
    const card = approvalCard(request);
    approval = card;
    output.appendChild(card.el);
    document.dispatchEvent(new CustomEvent('jarvis:approval', { detail: { el: card.el } })); // the CLI page shows it as a floating panel too
    turn?.lines.push(card.el);
    follow(following); // a reader who scrolled up is left where they are
    return card.answer.finally(() => { if (approval === card) approval = null; });
  },
  // The plan card (plan mode): approve or reject. Resolves 'approve' | 'reject'.
  askPlan: (plan) => {
    const card = planCard(plan);
    approval = card;
    output.appendChild(card.el);
    document.dispatchEvent(new CustomEvent('jarvis:approval', { detail: { el: card.el } }));
    turn?.lines.push(card.el);
    follow(following);
    return card.answer.finally(() => { if (approval === card) approval = null; });
  },
});
// What the slash commands may do to the conversation (commands.js).
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : '');
registerCommandHost({
  count: () => history.length,
  selectMode: (name) => {
    selectMode(name);
    if (!busy) scheduleSwap();
  },
  clear: () => {
    if (working) return 'JARVIS is busy. Use /stop first.';
    history.length = 0;
    turn = null;
    lastSent = '';
    lastUsed = 0;
    turnEdits.clear();
    userLines.clear();
    startSession(); // the cleared conversation stays saved under its old id
    setTasks([]);
    setPlanMode(false);
    output.replaceChildren();
    workspace.classList.remove('has-output');
    return 'Conversation cleared. Memories, habits and open panels are untouched. The old one is still saved: /sessions.';
  },
  context: contextReport,
  compact: (focus) => (working ? 'JARVIS is busy. Use /stop first.' : compactNow(focus)),
  rewind: rewindCommand,
  sessions: sessionsCommand,
  resume: resumeCommand,
  rename: (name) => {
    if (!name) return `This session is called "${session.name || sessionTitle(history)}". Usage: /rename <name>`;
    session.name = name.slice(0, 80);
    saveSoon();
    return `Renamed to "${session.name}".`;
  },
  branch: async (name) => {
    if (working) return 'JARVIS is busy. Use /stop first.';
    if (!history.length) return 'Nothing to branch yet.';
    session.name ||= sessionTitle(history);
    await saveSession({ ...session, updated: Date.now(), messages: history.length }, history); // keep the original as it is
    const original = session.name;
    session = { id: newSessionId(), name: name || `${original} (branch)`, created: Date.now() };
    saveSoon();
    return `Branched. You are now in "${session.name}"; "${original}" is saved as it was (/resume to go back).`;
  },
  export: exportCommand,
  plan: (arg) => {
    const text = arg.trim();
    if (text.toLowerCase() === 'off') { setPlanMode(false); return 'Plan mode off.'; }
    setPlanMode(true);
    if (!text) return 'Plan mode on: JARVIS can read and search but not change anything until you approve a plan. /plan off leaves it.';
    setTimeout(() => { input.value = text; send(); }, 0); // after this command has released the field
    return 'Plan mode on. Planning that now.';
  },
  tasks: (arg) => {
    if (arg.trim().toLowerCase() === 'clear') { setTasks([]); return 'Task list cleared.'; }
    const t = getTasks();
    return t.length ? `${taskSummary(t)}\n${formatTasks(t)}` : 'No tasks. JARVIS keeps a list for jobs with several steps (or approve a plan).';
  },
  skills: async (arg) => {
    if (arg.trim() === 'reload') return `Loaded ${await loadSkills()} skill(s).`;
    const list = getSkills();
    return list.length ? `${list.map((s) => `${s.name}  ${s.description}`).join('\n')}\n/<skill name> <task> runs one; the model can load them too.` : 'No skills. Add skills/<name>/SKILL.md (name and description in the first lines) and type /skills reload.';
  },
  retry: () => {
    if (working) return 'JARVIS is busy. Use /stop first.';
    if (!lastSent) return 'Nothing to retry yet.';
    const at = history.map((m) => m.role).lastIndexOf('user');
    if (at >= 0) history.length = at; // the old question and everything it led to, so the model sees it once
    const again = lastSent;
    setTimeout(() => { input.value = again; send(); }, 0); // after this command has released the field
    return 'Asking again.';
  },
  transcript: (all) => {
    const talk = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && textOf(m.content));
    if (!all) return textOf(talk.filter((m) => m.role === 'assistant').pop()?.content);
    return talk.map((m) => `${m.role === 'user' ? 'You' : 'JARVIS'}: ${textOf(m.content)}`).join('\n\n');
  },
});
loadLocalRules();
loadSkills();
restoreProject();
selectMode(getMode());
