// Wires the chat input, mode buttons and transcript to llm-client.
// A reply is rendered as blocks: optional reasoning, then text and artifact cards in order.
import { hydrateIcons } from '../icons/index.js';
import { chat, setMode, getMode, getPreset, onEvent } from './llm-client.js';
import { hasImages, takeAsContent } from './attachments.js';
import { pulse, setThinking } from './mesh-state.js';
import { describeCall, summarizeSaved, summarizeKinds } from '../../shared/steps.js';
import { meshIcon, feedMesh, feedMeshTotal, resetMeshFeed, restMesh } from './node-mesh.js';
import { renderBlocks, highlightCode } from './markdown.js';
import { parseReply } from './tool-router.js';
import { upsertArtifact } from './artifacts.js';
import { runCommand, registerCommandHost, hasCommand } from './commands.js';
import { getModelHealth } from './model-panel.js';
import { estimateTokens, shouldCompact, trimToolResults, findCut, summaryRequest, applySummary } from './context-manager.js';
import { workContext, setPlanMode, isPlanMode, getTasks, setTasks, formatTasks, taskSummary } from './work-state.js';
import { projectInstructionsContext } from './project-instructions.js';
import { loadSkills, skillsContext, findSkill, skillPrompt, getSkills } from './skills.js';
import { newSessionId, sessionTitle, saveSession, listSessions, loadSession, deleteSession, patchSession, copySession, toMarkdown, exportSession, textOf as messageText } from './sessions.js';
import { projectContext } from './projects.js';
import { currentPage } from './whiteboard-mode.js';
import { handleCommandKey } from './command-palette.js';
import { buildContext } from './memory-client.js';
import { openArtifact, applyBoardSpec, isArtifactOpen, syncCards } from './whiteboard.js';
import { bindChat, beginTurn } from './voice.js';
import { toolDefinitions, runToolCall, registerActionHost, undoEdit, loadLocalRules } from './actions.js';
import { restoreProject } from './agent-client.js';
import { actionCard, approvalCard, planCard } from './tool-cards.js';
import { assistantToolMessage, toolResultMessage } from './tool-calls.js';
import { recordReply, statsLine } from './reply-stats.js';
import { serverMode, sendChat, abortChat, onLink, state as link, setConvId, runAction } from './server-link.js';

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

// A line that is still waiting has the orb beside its label; the label is the part that changes. Once the line is no longer
// pending (an error replaced it) the orb goes with the text.
const setText = (el, text) => {
  const box = el.querySelector('.chat-text');
  const label = el.classList.contains('pending') ? box.querySelector('.think-label') : null;
  (label ?? box).textContent = text;
};

// The loading icon is the node mesh from the old HUD (node-mesh.js). It opens and closes with the letters being written (feedMesh).
const orb = () => meshIcon();
// The stamp: ONE logo that rests under the newest reply. When you send a message it glides down into the new reply (and is that
// reply's loading icon while it is written), then rests under it. Ease-in-out, 280 ms; no glide with reduced motion.
let logo = null;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
function moveLogo(line, { rest = false } = {}) {
  logo ??= meshIcon({ keep: true });
  const from = logo.isConnected ? logo.getBoundingClientRect() : null;
  if (logo.parentElement !== line) line.append(logo);
  restMesh(logo, rest);
  if (!from || calm.matches) return;
  const to = logo.getBoundingClientRect();
  const dy = from.top - to.top, dx = from.left - to.left;
  if (!dy && !dx) return;
  const near = Math.abs(dy) < innerHeight * 1.5; // from far above: fade in at the new place instead of a long flight
  logo.animate(near ? [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-in-out' });
}
// The turn is over: the logo goes to the newest reply (nothing to show it under after an error with no reply at all).
function settleLogo() {
  const last = [...output.querySelectorAll('.chat-line.assistant')].at(-1);
  if (last) moveLogo(last, { rest: true }); else logo?.remove();
}
function pendingLine() {
  const el = addLine('assistant pending', '', { meta: '' });
  el.querySelector('.chat-text').append(Object.assign(document.createElement('span'), { className: 'think-label', textContent: 'Thinking...' }));
  moveLogo(el);
  return el;
}

// All tool calls of one stretch (until the model writes text again) share one quiet row: the running step while it works,
// "Ran 3 steps" after, opening to the list. The tool lines used to be one box each, plus a "Thinking..." line between them.
const parseArgs = (a) => { try { return typeof a === 'string' ? JSON.parse(a || '{}') : a; } catch { return {}; } };
const STEP_STATE = { running: '', ok: '', failed: 'failed', queued: 'waiting for your approval', denied: 'not approved', stopped: 'stopped' };
const secs = (ms) => (ms == null ? '' : ms < 950 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(ms < 9500 ? 1 : 0)} s`);
const shorten = (t, n = 46) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const agentRows = new Map(); // coding-agent task id -> its row, so what the agent does later still lands under that step
function stepsGroup() {
  const el = addLine('steps live', '', { meta: '' });
  el.querySelector('.chat-text').innerHTML = '<details class="steps-box"><summary class="steps-head"><span class="steps-lead"><span class="icon" data-icon="check" aria-hidden="true"></span></span>'
    + '<span class="steps-label"></span><span class="steps-count"></span><span class="icon" data-icon="chevron-right" aria-hidden="true"></span></summary><ol class="steps-list"></ol></details>';
  el.querySelector('.steps-lead').prepend(orb());
  hydrateIcons(el);
  const box = el.querySelector('.steps-box');
  const [label, count, list] = ['.steps-label', '.steps-count', '.steps-list'].map((s) => el.querySelector(s));
  const rows = [];
  let touched = false; // the user opened or closed it themselves: leave it alone
  box.open = true; // while it works, every step is on show; it folds to one line when the turn ends
  el.querySelector('.steps-head').addEventListener('click', () => { touched = true; });
  const refresh = () => {
    const running = rows.find((r) => r.state === 'running');
    const bad = rows.filter((r) => r.state === 'failed' || r.state === 'denied').length;
    el.classList.toggle('live', !!running);
    el.classList.toggle('bad', !running && bad > 0);
    const only = rows[0];
    label.textContent = running ? `${running.doing}...` : rows.length === 1 ? (only.state === 'ok' ? only.did : `${only.doing} (${STEP_STATE[only.state]})`) : summarizeKinds(rows.map((r) => ({ name: r.name, args: r.args, failed: r.state !== 'ok' })));
    count.textContent = '';
  };
  const add = (name, machine, state = 'running', args = {}) => {
    const { doing, did } = describeCall(name, args);
    const li = document.createElement('li');
    li.innerHTML = '<details class="step"><summary class="step-line"><span class="step-name"></span><span class="step-flag"></span></summary>'
      + '<div class="step-body"><div class="step-facts"></div><pre class="step-args"></pre><pre class="step-detail"></pre></div></details><ol class="step-sub"></ol>';
    const q = (s) => li.querySelector(s);
    q('.step-name').textContent = doing;
    let argText = '';
    try { argText = Object.keys(args ?? {}).length ? JSON.stringify(args, null, 1).slice(0, 700) : ''; } catch { /* arguments that cannot be shown */ }
    q('.step-args').textContent = argText ? `Request\n${argText}` : '';
    const subs = new Map();
    const row = {
      name, args, state, li, doing, did, ms: null, summary: '', note: '',
      set(s, r = {}) {
        row.state = s;
        li.dataset.state = s;
        if (r.ms != null) row.ms = r.ms;
        row.did = did;
        q('.step-name').textContent = s === 'ok' ? did : doing;
        q('.step-flag').textContent = STEP_STATE[s];
        if (r.summary !== undefined) row.summary = r.summary;
        row.facts();
        if (r.detail) q('.step-detail').textContent = `Result\n${r.detail}`;
        q('details.step').classList.toggle('plain', !argText && !r.detail && !q('.step-facts').textContent);
        refresh();
      },
      // "on PC · 1.2 s · 5 messages", shown when the step is opened
      facts() { q('.step-facts').textContent = [machine ? `on ${machine}` : '', secs(row.ms), row.summary, row.note].filter(Boolean).join(' · '); },
      // something the coding agent did inside this step: a command, a file read or edited
      sub({ id, text, status = 'running', output }) {
        let item = subs.get(id);
        if (!item) { item = document.createElement('li'); item.innerHTML = '<span class="sub-text"></span>'; subs.set(id, item); q('.step-sub').append(item); }
        item.dataset.state = status === 'done' ? 'ok' : status;
        item.querySelector('.sub-text').textContent = output && status === 'failed' ? `${text}: ${output}` : text;
        if (output) item.title = output;
        li.dataset.agent = 'on';
      },
      endSubs() { for (const item of subs.values()) if (item.dataset.state === 'running') item.dataset.state = 'ok'; },
    };
    rows.push(row);
    list.append(li);
    row.set(state);
    return row;
  };
  return {
    el,
    add,
    finish(state, r) {
      const row = rows.find((x) => x.state === 'running');
      row?.set(state, r);
      if (row && r?.taskId) agentRows.set(r.taskId, row);
    },
    settle() { // the turn ended: anything still marked running was stopped; the list folds to its one line
      rows.filter((r) => r.state === 'running').forEach((r) => r.set('stopped'));
      if (!touched) box.open = false;
    },
  };
}
// What the coding agent does inside a task shows under that task's step, even after the turn that started it has ended.
onLink((e) => {
  if (e.type === 'agent.step') agentRows.get(e.taskId)?.sub(e);
  else if (e.type === 'agent.status' && ['done', 'failed', 'aborted', 'timeout'].includes(e.task?.state)) {
    const row = agentRows.get(e.task.taskId);
    if (!row) return;
    row.endSubs();
    row.note = e.task.state === 'done' ? `Finished${e.task.summary ? `: ${e.task.summary.replace(/\s+/g, ' ').slice(0, 160)}` : ''}` : `Task ${e.task.state}${e.task.error ? `: ${e.task.error}` : ''}`;
    row.facts();
    row.li.querySelector('details.step').classList.remove('plain');
    agentRows.delete(e.task.taskId);
  }
});
// What a saved tool message says about how the call went (the router writes "[PC] name finished:", "... failed:", "... was not run:").
const resultState = (content) => { const s = String(content).slice(0, 300); return /needs approval and nobody/.test(s) ? 'queued' : /did not approve/.test(s) ? 'denied' : /Cancelled before/.test(s) ? 'stopped' : /\] \S+ finished:/.test(s) ? 'ok' : 'failed'; };

// --- assistant blocks ----------------------------------------------------
function artifactCard(p, done) {
  const usable = p.complete || (done && p.content);
  const title = p.opening ? 'Writing artifact...' : escapeHtml(p.title);
  const state = p.complete ? 'Open' : done ? 'Incomplete' : `Writing... ${fmtChars(p.content.length)}`;
  const type = p.opening ? '...' : p.type === 'code' && p.lang ? p.lang : p.type;
  return `<button type="button" class="artifact-card${usable ? '' : ' busy'}" data-artifact="${escapeHtml(p.id)}"${usable ? '' : ' disabled'}>`
    + `<span class="icon" data-icon="layers" aria-hidden="true"></span><span class="ac-type">${escapeHtml(type)}</span><span class="ac-title">${title}</span><span class="ac-state">${state}</span></button>`
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

// Puts a reply into its message without rebuilding what did not change. While a reply streams, every block above
// the one being written is the same as in the paint before; replacing it would restyle, relayout and (for the
// reader) drop a text selection on every paint. A reply is a list of parts: rendered markdown (a list of blocks) or
// plain html (artifact cards). The new list is compared with the last one and only the blocks that differ are made
// again; nothing unchanged is even parsed.
const shown = new WeakMap(); // the message text element -> the parts drawn in it
const nodesFrom = (html) => { const t = document.createElement('template'); t.innerHTML = html; return [...t.content.childNodes]; };
const dropNodes = (nodes) => nodes.forEach((n) => n.remove());
function swapNodes(oldNodes, newNodes, host) {
  if (oldNodes.length) { oldNodes[0].before(...newNodes); dropNodes(oldNodes); } else host.append(...newNodes);
}
function patchParts(host, parts) {
  if (!shown.has(host)) host.replaceChildren(); // the "Thinking..." text
  const old = shown.get(host) ?? [];
  const out = parts.map((p, i) => {
    const o = old[i];
    if (p.kind === 'md') {
      const made = (html) => ({ html, nodes: nodesFrom(html) });
      if (!o || o.kind !== 'md') {
        const el = Object.assign(document.createElement('div'), { className: 'md' });
        const blocks = p.blocks.map(made);
        el.append(...blocks.flatMap((x) => x.nodes));
        if (o) { o.nodes[0].before(el); dropNodes(o.nodes); } else host.append(el);
        return { kind: 'md', nodes: [el], blocks };
      }
      const el = o.nodes[0];
      // a block that drew nothing has no node to put its replacement next to: start this part over (rare)
      if (p.blocks.some((html, j) => o.blocks[j] && o.blocks[j].html !== html && !o.blocks[j].nodes.length)) {
        const blocks = p.blocks.map(made);
        el.replaceChildren(...blocks.flatMap((x) => x.nodes));
        return { kind: 'md', nodes: [el], blocks };
      }
      const blocks = p.blocks.map((html, j) => {
        const b = o.blocks[j];
        if (b && b.html === html) return b;
        const fresh = made(html);
        if (b) swapNodes(b.nodes, fresh.nodes, el); else el.append(...fresh.nodes);
        return fresh;
      });
      o.blocks.slice(p.blocks.length).forEach((x) => dropNodes(x.nodes));
      return { kind: 'md', nodes: [el], blocks };
    }
    if (o && o.kind === 'html' && o.html === p.html) return o;
    const nodes = nodesFrom(p.html);
    if (o) swapNodes(o.nodes, nodes, host); else host.append(...nodes);
    return { kind: 'html', html: p.html, nodes };
  });
  old.slice(parts.length).forEach((o) => dropNodes(o.nodes));
  shown.set(host, out);
}

// quiet: redrawing a saved conversation: artifacts are registered again but nothing is opened or arranged.
function renderAssistant(el, content, { done, quiet = false }) {
  const parts = [];
  for (const p of parseReply(content)) {
    if (p.kind === 'board') {
      if (done && !quiet) applyBoardSpec(p); // arrange the panels once the whole reply is in
      continue;
    }
    if (p.kind === 'text') {
      parts.push({ kind: 'md', blocks: renderBlocks(p.text) });
      continue;
    }
    parts.push({ kind: 'html', html: artifactCard(p, done) });
    if (p.id && p.content && (p.complete || done)) {
      const { changed } = upsertArtifact({ ...p, partial: !p.complete });
      // A source file has nothing to preview: it is already written out in the session, so it
      // gets no panel of its own unless the user clicks its card. Everything else opens beside it.
      if (quiet) { /* registered above, left closed */ }
      else if (changed) openArtifact(p.id, { auto: true });
    }
  }
  patchParts(el.querySelector('.chat-text'), parts);
  hydrateIcons(el);
  syncCards(el);
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
  if (serverTurn) abortChat();
  turn?.controller.abort();
  approval?.cancel();
}
stopBtn?.addEventListener('click', stopTurn);
document.addEventListener('jarvis:stop', stopTurn); // Ctrl+. (shortcuts.js)

// --- the JARVIS server path -------------------------------------------------
// The server streams the reply, runs tools on the active computer and asks for approval itself (server-ui.js shows the
// dialog). This function only draws what arrives. It never falls back to the local model or local tools: if the server is
// not reachable, nothing is sent and the message goes back into the box.
let serverTurn = null;
async function sendViaServer(text) {
  const { content, names } = takeAsContent(text);
  const body = typeof content === 'string' ? content : textOf(content);
  const sent = sendChat(body, { code: currentPage() === 'code' });
  if (!sent.ok) {
    addLine('system', sent.reason, { meta: '' });
    input.value = text;
    input.dispatchEvent(new Event('input'));
    busy = false;
    return;
  }
  lastSent = text;
  document.dispatchEvent(new CustomEvent('jarvis:message-sent'));
  setWorking(true);
  const target = (link.machines[link.target]?.label ?? link.target).toUpperCase();
  addLine('user', text, { files: names, meta: `${clock()}  ${target}` });
  workspace.classList.add('has-output');
  let pending = pendingLine();
  let latest = '';
  let afterTool = false;
  let steps = null; // the row that holds this stretch of tool calls
  let frame = 0;
  const paint = (final) => { if (latest) renderAssistant(pending, latest, { done: final }); };
  const stamp = (line, stats = null) => {
    const m = document.createElement('span');
    m.className = 'chat-meta';
    m.textContent = `${clock()}  ${target}`;
    line.append(m);
    if (stats?.completionTokens) line.append(Object.assign(document.createElement('div'), { className: 'chat-stats', textContent: statsLine(stats), title: 'What this reply cost the local model' }));
  };
  output.scrollTop = output.scrollHeight;

  await new Promise((finish) => {
    const end = () => { cancelAnimationFrame(frame); steps?.settle(); settleLogo(); off(); serverTurn = null; setThinking(false); busy = false; setWorking(false); document.dispatchEvent(new CustomEvent('jarvis:sessions-changed')); finish(); };
    serverTurn = { end };
    const fail = (message, kind = 'error') => { pending.className = `chat-line ${kind}`; pending.querySelector('.thought')?.remove(); setText(pending, message); end(); };
    const off = onLink((e) => {
      switch (e.type) {
        case 'chat.delta':
          if (!e.text) break; // an empty chunk is not a letter yet: the line stays "Thinking..."
          if (afterTool) { paint(true); pending = addLine('assistant pending', '', { meta: '' }); latest = ''; afterTool = false; }
          pending.className = 'chat-line assistant';
          latest += e.text;
          pulse();
          feedMesh(e.text);
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; const stick = nearBottom(); paint(false); follow(stick); });
          break;
        case 'resume': // reconnected while the reply was being written: the server sends what it has so far
          if (!e.text) break;
          latest = e.text;
          pending.className = 'chat-line assistant';
          paint(false);
          break;
        case 'tool.call':
          if (latest) { cancelAnimationFrame(frame); frame = 0; paint(true); stamp(pending); steps = null; pending.querySelector(':scope > .orb')?.remove(); } else if (pending.classList.contains('pending')) pending.remove();
          steps ??= stepsGroup();
          steps.add(e.name, link.machines[e.target]?.label ?? e.target, 'running', e.args);
          follow(following);
          afterTool = true;
          break;
        case 'tool.result':
          steps?.finish(e.ok ? 'ok' : e.queued ? 'queued' : e.denied ? 'denied' : 'failed', { summary: e.summary, detail: e.detail, ms: e.ms, taskId: e.taskId });
          pending = pendingLine();
          latest = '';
          afterTool = false;
          break;
        case 'chat.done':
          cancelAnimationFrame(frame);
          if (e.text) { latest = e.text; pending.className = 'chat-line assistant'; paint(true); stamp(pending, e.stats); recordReply(e.stats); } else pending.remove();
          follow(following);
          end();
          break;
        case 'chat.error': fail(e.reason === 'aborted' ? 'Stopped' : e.reason, e.reason === 'aborted' ? 'system' : 'error'); break;
        case 'status':
          if (link.status !== 'online' && link.status !== 'connecting') setText(pending, 'Lost the connection to the JARVIS server. Reconnecting; the reply continues there.');
          break;
        case 'state': { // back online: if the reply finished while we were away, it is in the snapshot
          if (link.conversation.streaming) break;
          const last = link.conversation.messages.at(-1);
          if (last?.role === 'assistant' && last.content) { latest = last.content; pending.className = 'chat-line assistant'; paint(true); stamp(pending); end(); }
          break;
        }
        case 'title': document.getElementById('chat-title').textContent = e.title; break;
        default: break;
      }
    });
  });
}

// Leaving a chat that is still being answered (a new chat, another chat, Code) does not stop it: with the server on, the reply keeps being
// written there, saved in that chat, and the chat list shows the chat as working. Returns false only when something here is busy and cannot let go.
function detachRunning() {
  if (!working) return true;
  if (!serverTurn) return false;
  serverTurn.end();
  return true;
}

async function send() {
  const quiet = input.dataset.quiet === '1'; // a command the app typed (open a chat, new chat): not shown as the user's message
  delete input.dataset.quiet;
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
  if (busy && serverTurn && /^\/(clear|new|resume)(\s|$)/i.test(text)) detachRunning();
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
      if (!quiet) addLine('user', text, { meta: '' });
      if (reply && !(quiet && /^(Resumed|Conversation cleared)/.test(reply))) addLine('system', reply, { meta: '' });
      output.scrollTop = output.scrollHeight;
    } finally {
      busy = false;
    }
    return;
  }

  // With the JARVIS server on, the server owns the model, the tools, the approvals and the conversation.
  if (serverMode()) { await sendViaServer(text); return; }

  // Images only work on the vision model.
  if (hasImages() && getMode() !== 'visual') selectMode('visual');
  const { content, names } = takeAsContent(skillText ?? text);
  lastSent = text;
  document.dispatchEvent(new CustomEvent('jarvis:message-sent'));

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
  let pending = pendingLine();
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

<voice-mode>This reply will be spoken aloud.</voice-mode>`.trim() : memoryContext, projectInstructionsContext(), projectContext(session.project), skillsContext(), titleNote()].filter(Boolean).join('\n\n');
    let spoken = ''; // text of the rounds already finished, so speech sees one growing text
    for (let round = 0; ; round++) {
      latest = { content: '', reasoning: '' };
      resetMeshFeed();
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
          feedMeshTotal('content', visible ?? '');
          feedMeshTotal('reasoning', reasoning ?? '', 0.5); // thought text is writing too, a little quieter
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
      pending = pendingLine();
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
    settleLogo();
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
    session.mode ||= currentPage() === 'code' ? 'code' : 'chat';
    saveSession({ ...session, updated: Date.now(), messages: history.length }, history)
      .then(() => document.dispatchEvent(new CustomEvent('jarvis:sessions-changed')))
      .catch(() => { /* a plain browser cannot save */ });
  }, 400);
}
const announceName = (animate) => document.dispatchEvent(new CustomEvent('jarvis:session-name', { detail: { id: session.id, name: session.name, animate } }));
const startSession = (keep = {}) => { session = { id: newSessionId(), name: '', created: Date.now(), ...keep }; announceName(false); };

// The model names the chat itself: it is asked (in the turn's context) to start its reply with a <jarvis-title> tag
// after the first exchange and again every 10 of the user's messages, only when the old name no longer fits.
// llm-client.js cuts the tag out of the reply and announces it; nothing of it reaches the conversation.
const userCount = () => history.filter((m) => m.role === 'user' && !m.summary).length;
function titleNote() {
  if (session.manual) return '';
  const users = userCount(); // this turn's message is already in the history
  if (!session.named) return '<chat-title>This chat has no name yet. Start your reply with <jarvis-title>a name of 2 to 5 words</jarvis-title> on its own, before any other text. The app removes the tag and the user never sees it. Do not mention it.</chat-title>';
  if (users - (session.namedAt ?? 0) >= 10) return `<chat-title>The chat is named "${session.name.replaceAll('"', "'")}". Judge whether that still fits what the conversation is about now. Only if it no longer fits, start your reply with <jarvis-title>a new name of 2 to 5 words</jarvis-title> before any other text; otherwise write no tag at all. The app removes the tag and the user never sees it. Do not mention it.</chat-title>`;
  return '';
}
onEvent((e) => {
  if (e.type !== 'title' || session.manual || !e.title || e.title.length > 60) return;
  session.named = true;
  session.namedAt = userCount();
  if (e.title !== session.name) { session.name = e.title; announceName(true); }
  saveSoon();
});
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
  let steps = null; // calls and results between two pieces of text share one row
  const rowOf = new Map(); // tool_call_id -> its row
  for (const m of history) {
    if (m.summary) { if (m.role === 'user') addLine('system', 'Earlier conversation summarised', { meta: '' }); continue; }
    if (m.role === 'user') { steps = null; markUser(addLine('user', m.shown ?? messageText(m.content), { meta: '' }), m); }
    else if (m.role === 'assistant') {
      const text = messageText(m.content);
      if (text) { steps = null; renderAssistant(addLine('assistant', '', { meta: '' }), text, { done: true, quiet: true }); }
      if (m.tool_calls) {
        steps ??= stepsGroup();
        for (const c of m.tool_calls) rowOf.set(c.id, steps.add(c.function.name, link.machines[m.target]?.label ?? m.target, 'stopped', parseArgs(c.function.arguments)));
      }
    } else if (m.role === 'tool') rowOf.get(m.tool_call_id)?.set(resultState(m.content), summarizeSaved(m.name, m.content));
  }
  const lastReply = [...output.querySelectorAll('.chat-line.assistant')].at(-1);
  if (lastReply) moveLogo(lastReply, { rest: true }); // a saved chat: the stamp is already under its last reply
  workspace.classList.toggle('has-output', history.length > 0);
  output.scrollTop = output.scrollHeight;
}

async function resumeCommand(arg) {
  if (!detachRunning()) return 'JARVIS is busy. Use /stop first.';
  const q = arg.trim();
  if (!q) return sessionsCommand();
  if (!lastListing.length) lastListing = await listSessions();
  const pick = /^\d+$/.test(q) ? lastListing[Number(q) - 1]
    : lastListing.find((s) => s.id === q) ?? lastListing.find((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  if (!pick) return `No saved session matches "${q}". Type /sessions.`;
  const saved = await loadSession(pick.id);
  if (serverMode()) setConvId(pick.id);
  history.length = 0;
  history.push(...saved);
  turnEdits.clear();
  const { updated, messages, ...meta } = pick;
  session = { ...meta, created: pick.created ?? Date.now() };
  announceName(false);
  lastSent = '';
  lastUsed = 0;
  turn = null;
  renderHistory();
  return `Resumed "${pick.name}" (${history.length} messages). File changes from before cannot be rewound, but the conversation can.`;
}

// A note the model saved for later chats shows in every window at once, whole, with Undo (a note planted by a page or a mail is seen
// before it matters). The server announces removals, so the row follows a removal made anywhere.
const memos = new Map(); // note id -> row
onLink((e) => {
  if (e.type === 'memory.added' && typeof e.id === 'string' && !memos.has(e.id)) {
    const row = document.createElement('div');
    row.className = 'chat-memo';
    row.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = `Saved for later chats: ${e.text ?? ''}`;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'av-btn';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => { undo.disabled = true; runAction('forget', { note: e.id }); });
    row.append(text, undo);
    output.appendChild(row);
    memos.set(e.id, row);
  } else if (e.type === 'memory.removed' && memos.has(e.id)) {
    const row = memos.get(e.id);
    row.firstChild.textContent = 'Note removed.';
    row.querySelector('button')?.remove();
    memos.delete(e.id);
  }
});

// With the server on, a reload (or another device) shows the chat this window was in, and the list of chats appears once connected.
onLink((e) => {
  if (!serverMode()) return;
  if (e.type === 'status' && link.status === 'online') document.dispatchEvent(new CustomEvent('jarvis:sessions-changed'));
  if (e.type === 'state' && !working && !history.length && !output.querySelector('.chat-line') && link.conversation.messages.length) {
    history.push(...link.conversation.messages.map(({ role, content }) => ({ role, content })));
    session.name = link.conversation.title || session.name;
    renderHistory();
    announceName(false);
  }
  // A reply finished in the open chat, but this window was not waiting for it (it was started, then the chat was left and opened again):
  // the server has saved it, so read it back.
  if (e.type === 'chat.done' && !serverTurn && !working) {
    loadSession(link.conversation.id).then((saved) => {
      if (working || !saved.length || saved.length <= history.length) return;
      history.length = 0;
      history.push(...saved);
      renderHistory();
    }).catch(() => {});
  }
});

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

// --- actions on saved chats, asked for by the sidebar and the Projects page --------------------------
const toast = (text) => document.dispatchEvent(new CustomEvent('jarvis:toast', { detail: { text } }));
document.addEventListener('jarvis:session-op', async (e) => {
  const { op, id = session.id, ...rest } = e.detail;
  const mine = id === session.id;
  const changed = () => document.dispatchEvent(new CustomEvent('jarvis:sessions-changed'));
  try {
    if (op === 'patch') {
      if (mine) {
        Object.assign(session, rest.patch);
        if (rest.patch.name !== undefined) announceName(true);
        if (history.length) saveSoon();
        if (serverMode()) await patchSession(id, rest.patch); // the server keeps the chat; its name, pin and folder are saved there
      } else await patchSession(id, rest.patch);
      changed();
    } else if (op === 'delete') {
      if (working && mine) { toast('JARVIS is busy. Stop it first.'); return; }
      if (mine) await runCommand('/clear');
      await deleteSession(id);
      changed();
    } else if (op === 'duplicate') {
      if (mine && history.length) await saveSession({ ...session, updated: Date.now(), messages: history.length }, history);
      await copySession(id);
      changed();
      toast('Chat duplicated');
    } else if (op === 'export') {
      if (mine) { toast(await exportCommand()); return; }
      const meta = (await listSessions()).find((s) => s.id === id);
      toast(`Saved to ${await exportSession(id, toMarkdown(meta?.name ?? 'Chat', await loadSession(id)))}`);
    } else if (op === 'new') {
      if (!detachRunning()) { toast('JARVIS is busy. Stop it first.'); return; }
      await runCommand('/clear');
      session.project = rest.project;
      if (rest.mode) session.mode = rest.mode;
    }
  } catch (err) { toast(`Could not do that: ${err.message ?? err}`); }
});

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
  selectMode: (name) => { selectMode(name); },
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
  },
  clear: () => {
    if (!detachRunning()) return 'JARVIS is busy. Use /stop first.';
    document.dispatchEvent(new CustomEvent('jarvis:cleared'));
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
    session.manual = true;
    announceName(true);
    saveSoon();
    return `Renamed to "${session.name}".`;
  },
  branch: async (name) => {
    if (working) return 'JARVIS is busy. Use /stop first.';
    if (!history.length) return 'Nothing to branch yet.';
    session.name ||= sessionTitle(history);
    await saveSession({ ...session, updated: Date.now(), messages: history.length }, history); // keep the original as it is
    const original = session.name;
    session = { id: newSessionId(), name: name || `${original} (branch)`, created: Date.now(), project: session.project, manual: !!name };
    announceName(false);
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
