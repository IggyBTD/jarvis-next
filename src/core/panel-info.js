// The panel's info tabs: environment (computer and model, tokens per second), context (window use, attachments),
// connectors (what JARVIS is connected to) and outputs (artifacts). Files, changes and tasks are filled by cli-page.js.
// Only the tab on screen is drawn, and only when something it shows has changed.
import { listArtifacts, onArtifactsChange } from './artifacts.js';
import { openArtifact } from './whiteboard.js';
import { getModelHealth, onModelHealth } from './model-panel.js';
import { getServices } from './service-status.js';
import { getPreset } from './llm-client.js';
import { serverMode, state, onLink } from './server-link.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const fmtK = (n) => (n == null ? '--' : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const tail = (id) => String(id ?? '').split('/').pop();

// one row: a key, a value, and optionally a state dot (ok, bad, idle)
function row(k, v, dot = null, onClick = null) {
  const r = el(onClick ? 'button' : 'div', { className: `info-row${onClick ? ' clickable' : ''}` });
  if (onClick) { r.type = 'button'; r.addEventListener('click', onClick); }
  const key = el('span', { className: 'k', textContent: k });
  const val = el('span', { className: 'v', textContent: v });
  if (dot) { const d = el('i', { className: 'dot' }); d.dataset.state = dot; r.append(d); }
  r.append(key, val);
  return r;
}
const note = (text) => el('div', { className: 'info-note', textContent: text });
const fill = (id, nodes) => $(id)?.replaceChildren(...nodes);

function paintEnv() {
  const h = state.health;
  const server = serverMode();
  const machines = Object.entries(state.machines ?? {});
  if (server) {
    const active = state.machines?.[state.target];
    fill('env-machine', [
      row('Controls', active?.label ?? state.target.toUpperCase(), active?.online ? 'ok' : 'bad'),
      row('Server link', state.status === 'online' ? 'connected' : state.status, state.status === 'online' ? 'ok' : 'bad'),
      ...machines.filter(([id]) => id !== state.target).map(([, m]) => row(m.label ?? 'Other computer', m.online ? 'online' : 'offline', m.online ? 'ok' : 'idle')),
    ]);
  } else {
    fill('env-machine', [row('Controls', 'This computer', 'ok'), row('Model server', 'LM Studio on this PC')]);
  }
  const live = getModelHealth();
  const m = h?.model;
  const name = server ? (m?.modelId ? tail(m.modelId) : '--') : tail(getPreset().model);
  const present = server ? !!m?.modelPresent : live.ctxMax != null || live.tps != null;
  const last = h?.last;
  const tps = server ? (last?.tokensPerSec ?? h?.tokensPerSec ?? null) : live.tps;
  fill('env-model', [
    row('Model', name, present ? 'ok' : 'idle'),
    row('State', present ? 'loaded' : server && m?.reachable === false ? 'not reachable' : 'not loaded'),
    row('Window', fmtK(server ? (m?.contextLength ?? live.ctxMax) : live.ctxMax)),
    row('Speed', tps == null ? '--' : `${Number(tps).toFixed(1)} tok/s`),
    ...(server ? [row('First token', last?.ttftMs == null ? '--' : `${(last.ttftMs / 1000).toFixed(1)} s`), row('Last prompt', last?.promptTokens == null ? '--' : `${fmtK(last.promptTokens)} tokens`), row('Waiting', String(h?.queueDepth ?? 0))] : []),
  ]);
}

function paintContext() {
  const { ctxUsed, ctxMax } = getModelHealth();
  const lines = document.querySelectorAll('#chat-output .chat-line');
  const mine = [...lines].filter((l) => l.classList.contains('user')).length;
  const theirs = [...lines].filter((l) => l.classList.contains('assistant')).length;
  fill('ctx-rows', [row('Messages', `${mine} sent, ${theirs} replies`), row('Window', ctxMax ? `${fmtK(ctxUsed)} of ${fmtK(ctxMax)}` : '--')]);
  const chips = [...document.querySelectorAll('#attach-row .attach-chip')].map((c) => c.textContent.trim());
  fill('ctx-attach', chips.length ? chips.map((c) => row('File', c)) : [note('Nothing attached.')]);
}

function paintConnectors() {
  const names = { lmstudio: 'LM Studio', sensors: 'Sensors', voice: 'Voice', server: 'JARVIS server' };
  const dot = (s) => (s === 'ok' ? 'ok' : s === 'error' ? 'bad' : 'idle');
  const rows = getServices().map((s) => row(names[s.id] ?? s.id, s.detail || s.state, dot(s.state)));
  if (serverMode()) Object.entries(state.machines ?? {}).forEach(([id, m]) => rows.push(row(`${m.label ?? id} agent`, m.online ? 'online' : 'offline', m.online ? 'ok' : 'idle')));
  fill('conn-list', rows);
}

function paintOutputs() {
  const all = listArtifacts().slice().reverse();
  $('out-count').textContent = all.length ? String(all.length) : '';
  fill('out-list', all.length ? all.map((a) => row(a.type === 'code' && a.lang ? a.lang : a.type, a.title, null, () => openArtifact(a.id))) : [note('Nothing made yet. Ask for a page, a chart, a diagram or a document and it appears here.')]);
}

const PAINT = { env: paintEnv, context: paintContext, connectors: paintConnectors, outputs: paintOutputs };
let activeTab = document.querySelector('#ws-tabs [aria-selected="true"]')?.dataset.id ?? null; // whiteboard.js drew the tabs before this module loaded
let queued = false;
function paint() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; PAINT[activeTab]?.(); });
}

document.addEventListener('jarvis:tab', (e) => { activeTab = e.detail.id; paint(); });
paint();
onLink(paint);
onModelHealth(paint);
onArtifactsChange(paint);
document.addEventListener('jarvis:sessions-changed', paint);
new MutationObserver(paint).observe($('chat-output'), { childList: true });
new MutationObserver(paint).observe($('attach-row'), { childList: true, subtree: true });
setInterval(() => { if (activeTab === 'connectors' || activeTab === 'env') paint(); }, 2000); // services and live speed change without an event
