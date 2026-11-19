// The client side of the JARVIS server (spec section 4.12). A thin WebSocket client: it holds a cache of what the server
// said and sends the user's actions. It has no authority: the server decides the target, runs the tools and asks for approval.
// Settings (server address, UI token) live in localStorage; the desktop build can move the token to the OS keychain later.
// Reconnects with exponential backoff and jitter, never blocks the interface, and shows a plain "offline" state.
import { ingestTelemetry, useTelemetrySource } from './telemetry-view.js';
import { getEffort } from './effort-ui.js';
import { chatStates as chatStatesOf } from './chat-states.js';

const KEY = 'jarvis.server';
const CONV_KEY = 'jarvis.server.conv';
const DEFAULTS = { enabled: false, url: 'ws://pc:7410', token: '', pcMac: '' };

const read = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; } };
let settings = read();
// Served by the JARVIS server itself (a browser on the Mac): the address is this page's own, and a token in the #fragment
// (http://pc:7410/#token=...) is taken once, saved, and removed from the address bar. The fragment is never sent anywhere.
// The page's CSP (server/api/http.js) only lets it reach its own host, so a page the server served always talks to that host,
// whatever address was saved before (a saved Tailscale or LAN address here is blocked and the app stays offline).
const servedHere = !window.__TAURI_INTERNALS__ && /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.port === '7410';
const ownUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
if (servedHere) {
  const hash = new URLSearchParams(location.hash.slice(1));
  const fromHash = hash.get('token');
  if (fromHash || settings.url !== ownUrl()) {
    settings = { ...settings, url: ownUrl(), ...(fromHash ? { token: fromHash, enabled: true } : {}) };
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
    if (fromHash) history.replaceState(null, '', location.pathname + location.search);
  }
}
export const getSettings = () => ({ ...settings });
export function saveSettings(next) {
  settings = { ...settings, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked: lasts until the window closes */ }
  reconnect();
  emit({ type: 'settings' });
}

const newConv = () => `c-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
let convId = (() => { try { return localStorage.getItem(CONV_KEY) || newConv(); } catch { return newConv(); } })();
export const getConvId = () => convId;
// Opens a saved chat: this window talks in it from now on.
export function setConvId(id) {
  convId = id;
  unseen.delete(id);
  try { localStorage.setItem(CONV_KEY, convId); } catch { /* storage blocked */ }
  state.conversation = { id: convId, title: '', messages: [], streaming: null };
}
// An authenticated call to the server's HTTP API (saved chats, the globe's data).
export function serverFetch(path, init = {}) {
  const base = savedOrLocal().trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
  return fetch(`${base}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}), authorization: `Bearer ${settings.token}` } });
}
export function newConversation() {
  convId = newConv();
  try { localStorage.setItem(CONV_KEY, convId); } catch { /* storage blocked */ }
  state.conversation = { id: convId, title: '', messages: [], streaming: null };
  emit({ type: 'conversation' });
  return convId;
}

// 'off' (not enabled) | 'connecting' | 'online' | 'offline' | 'refused' (the server said no: wrong token or address)
export const state = {
  status: 'off', target: 'pc', machines: {}, health: null, pending: [], telemetry: {}, digest: null, agentTasks: [], reminders: [],
  conversation: { id: convId, title: '', messages: [], streaming: null }, voice: { enabled: false }, audit: [], lastError: '', attempts: 0,
  running: new Set(), // conversations the model is answering in right now (the server says when each starts and ends)
};

// What each chat in the list is doing (chat-states.js); `unseen` holds the chats that finished while another one was open.
const unseen = new Set();
export const chatStates = () => chatStatesOf({ running: state.running, agentTasks: state.agentTasks, pending: state.pending, unseen });

const listeners = new Set();
export const onLink = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
function emit(event) { for (const cb of [...listeners]) { try { cb(event, state); } catch (e) { console.warn('[jarvis] server-link listener failed:', e); } } }

export const serverMode = () => settings.enabled && !!settings.token && !!settings.url;
export const isOnline = () => state.status === 'online';

let ws = null;
let timer = 0;
let attempts = 0;
let wanted = false;

// The server usually runs on the PC this app runs on, and its LAN address changes (DHCP) while 127.0.0.1 does not. When the saved address
// fails twice in the desktop app, the next tries go to the same port on this computer; if that fails twice too, back to the saved one.
// The desktop app starts on this computer's own address: a saved LAN or Tailscale address that is unreachable hangs for ~20 s before it fails.
let viaLoopback = !!window.__TAURI_INTERNALS__;
const isLoopback = (url) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url.trim().replace(/^ws/i, 'http')).hostname); } catch { return false; } };
const savedOrLocal = () => {
  if (servedHere) return ownUrl();
  if (!viaLoopback) return settings.url;
  try { return `ws://127.0.0.1:${new URL(settings.url.trim().replace(/^ws/i, 'http')).port || 7410}`; } catch { return settings.url; }
};
function wsUrl() {
  const u = savedOrLocal().trim().replace(/^http/i, 'ws').replace(/\/+$/, '');
  return /\/ws$/.test(u) ? u : `${u}/ws`;
}

function setStatus(status, lastError = '') {
  if (state.status === status && state.lastError === lastError) return;
  state.status = status;
  state.lastError = lastError;
  emit({ type: 'status' });
}

export function connect() {
  wanted = true;
  clearTimeout(timer);
  if (!serverMode()) { setStatus('off'); useTelemetrySource('local'); return; }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  setStatus(attempts ? 'offline' : 'connecting');
  let socket;
  try { socket = new WebSocket(wsUrl(), ['jarvis.v1', `bearer.${settings.token}`]); } catch (e) { setStatus('refused', 'The server address is not valid.'); return; }
  ws = socket;
  socket.binaryType = 'arraybuffer';
  const openedAt = { t: 0 };
  const stall = setTimeout(() => { if (!openedAt.t) try { socket.close(); } catch { /* closed */ } }, 4000); // a silent address is given up on after 4 s
  socket.onopen = () => {
    openedAt.t = Date.now();
    attempts = 0;
    state.attempts = 0;
    socket.send(JSON.stringify({ type: 'hello', convId, clientId: `app-${Math.random().toString(36).slice(2, 8)}`, version: '1' }));
  };
  socket.onmessage = (ev) => { if (typeof ev.data === 'string') handle(JSON.parse(ev.data)); else emit({ type: 'voice.audio', frame: new Uint8Array(ev.data) }); };
  socket.onerror = () => {};
  socket.onclose = () => {
    clearTimeout(stall);
    if (ws !== socket) return;
    ws = null;
    attempts += 1;
    state.attempts = attempts;
    if (!openedAt.t && attempts % 2 === 0 && window.__TAURI_INTERNALS__ && !isLoopback(settings.url)) viaLoopback = !viaLoopback;
    state.streaming = null;
    // Browsers hide the HTTP status of a refused upgrade, so repeated instant failures are shown as a probable wrong token or address.
    setStatus(attempts >= 3 && !openedAt.t ? 'refused' : 'offline', attempts >= 3 && !openedAt.t ? 'Cannot connect. Check the server address and the token, and that the server is running.' : '');
    if (wanted && serverMode()) timer = setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempts, 7)) * (0.5 + Math.random() * 0.5));
  };
}
export function disconnect() { wanted = false; clearTimeout(timer); const s = ws; ws = null; try { s?.close(); } catch { /* closed */ } setStatus(serverMode() ? 'offline' : 'off'); }
function reconnect() { disconnect(); attempts = 0; viaLoopback = !!window.__TAURI_INTERNALS__; if (serverMode()) { useTelemetrySource('server'); connect(); } else useTelemetrySource('local'); }

const send = (obj) => { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; };
const reqId = () => Math.random().toString(36).slice(2, 10);

// The System readout shows the active computer.
function ingestActive() {
  const t = state.telemetry[state.target];
  if (t && !t.offline) ingestTelemetry(t.metrics, state.target !== 'pc');
}

function handle(m) {
  switch (m.type) {
    case 'state':
      Object.assign(state, { target: m.target, machines: m.machines, health: m.health, pending: m.pendingApprovals ?? [], telemetry: m.telemetry ?? {}, digest: m.digest, agentTasks: m.agentTasks ?? [], reminders: m.reminders ?? [], voice: m.voice ?? { enabled: false }, permissionMode: m.permissionMode ?? state.permissionMode, codeBackend: m.codeBackend ?? state.codeBackend });
      state.conversation = { ...m.conversation, id: m.conversation?.id ?? convId };
      state.running = new Set(m.running ?? []);
      emit({ type: 'chat-states' });
      setStatus('online');
      ingestActive();
      emit({ type: 'state' });
      // the server's default conversation is "main"; this window talks in its own
      if (m.conversation?.streaming && m.conversation.id === convId) emit({ type: 'resume', text: m.conversation.streaming.text });
      return;
    case 'mode': state.permissionMode = m.mode; emit({ type: 'mode' }); return;
    case 'backend': state.codeBackend = m.backend; emit({ type: 'backend' }); return;
    case 'target.changed': state.target = m.to; ingestActive(); emit({ type: 'target', from: m.from, to: m.to }); return;
    case 'target.rejected': state.target = m.target; emit({ type: 'target', rejected: true, reason: m.reason }); return;
    case 'health': state.health = m; for (const [id, v] of Object.entries(m.machines ?? {})) if (state.machines[id]) state.machines[id].online = v.online; emit({ type: 'health' }); return;
    case 'telemetry':
      state.telemetry[m.machine] = { ts: m.ts, metrics: m.metrics, offline: !!m.offline };
      if (m.machine === state.target) ingestActive();
      emit({ type: 'telemetry', machine: m.machine });
      return;
    case 'chat.state':
      if (m.running) state.running.add(m.convId); else state.running.delete(m.convId);
      emit({ type: 'chat-states' });
      return;
    case 'gate.request': state.pending = [...state.pending.filter((p) => p.id !== m.request.id), m.request]; emit({ type: 'gate.request', request: m.request }); emit({ type: 'chat-states' }); return;
    case 'gate.queued': state.pending = [...state.pending.filter((p) => p.id !== m.request.id), m.request]; emit({ type: 'gate.queued', request: m.request }); return;
    case 'gate.resolved': state.pending = state.pending.filter((p) => p.id !== m.id); emit({ type: 'gate.resolved', id: m.id, decision: m.decision }); emit({ type: 'chat-states' }); return;
    case 'agent.status': state.agentTasks = [...state.agentTasks.filter((t) => t.taskId !== m.taskId), m]; emit({ type: 'agent.status', task: m }); emit({ type: 'chat-states' }); return;
    case 'digest.ready': state.digest = { date: m.date, ...(state.digest ?? {}) }; emit({ type: 'digest.ready', date: m.date }); return;
    case 'chat.title': if (m.convId === convId) { state.conversation.title = m.title; emit({ type: 'title', title: m.title }); } return;
    case 'chat.delta': case 'chat.done': case 'chat.error': case 'tool.call': case 'tool.result':
      if (m.convId === convId) emit(m);
      else if (m.type === 'chat.done') { unseen.add(m.convId); emit({ type: 'chat-states' }); } // finished in a chat that is not open
      return;
    case 'clipboard.result': answer(m.id, m); return;
    case 'error': if (answer(m.id, { ok: false, message: m.reason })) return; emit({ type: 'server-error', reason: m.reason }); return;
    default: emit(m);
  }
}

// ---- actions ---------------------------------------------------------------------------------------------------------
export function sendChat(text, { code = false } = {}) {
  if (!isOnline()) return { ok: false, reason: state.status === 'connecting' ? 'Still connecting to the JARVIS server.' : 'The JARVIS server is not reachable. Nothing was sent, and nothing was run on this computer instead.' };
  send({ type: 'chat.send', convId, text, effort: getEffort(), ...(code ? { code: true } : {}) });
  return { ok: true };
}
export const abortChat = () => send({ type: 'chat.abort', convId });
export function setCodeBackend(backend) { if (isOnline()) { state.codeBackend = backend; send({ type: 'backend.set', backend }); emit({ type: 'backend' }); } }
export function setPermissionMode(mode) { if (isOnline()) send({ type: 'mode.set', mode }); }

export function setTarget(target) {
  if (!isOnline() || target === state.target) return;
  const previous = state.target;
  state.target = target; // optimistic; the server confirms or sends target.rejected with the real one
  emit({ type: 'target', optimistic: true, from: previous, to: target });
  send({ type: 'target.set', id: reqId(), target });
}
export const sendBinary = (bytes) => { if (ws?.readyState === 1) ws.send(bytes); };
export const voiceStart = (mode = 'push_to_talk') => send({ type: 'voice.start', mode });
export const voiceStop = () => send({ type: 'voice.stop' });
export const voiceBargeIn = () => send({ type: 'voice.barge_in' });
export const replyGate = (id, decision, pin = '') => send({ type: 'gate.reply', id, decision, ...(pin ? { pin } : {}) }); // the PIN: only for a T3 approval
// Replies that answer one request (clipboard.copy): request id -> resolve.
const waiting = new Map();
function answer(id, reply) { const r = waiting.get(id); if (!r) return false; waiting.delete(id); r(reply); return true; }
// One computer's clipboard onto the other's, through the server (ws.js clipboard.copy). Resolves { ok, message }; the text never comes here.
export function copyClipboard(from, to) {
  const id = reqId();
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    if (!send({ type: 'clipboard.copy', id, from, to })) answer(id, { ok: false, message: 'Not connected to the JARVIS server.' });
    setTimeout(() => answer(id, { ok: false, message: 'The server did not answer in time.' }), 30_000);
  });
}
export const runAction = (name, args = {}) => send({ type: 'action.invoke', id: reqId(), name, args });
export const requestDigest = () => send({ type: 'digest.run' });
export const sendAgentTask = (prompt) => send({ type: 'agent.task', id: reqId(), prompt });
export const abortAgentTask = (taskId) => send({ type: 'agent.abort', taskId });
export const dismissReminder = (reminderId) => send({ type: 'reminder.dismiss', reminderId });

export async function fetchAudit(n = 15) {
  const base = savedOrLocal().trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/audit?n=${n}`, { headers: { authorization: `Bearer ${settings.token}` } });
    if (!res.ok) return [];
    state.audit = (await res.json()).entries ?? [];
    emit({ type: 'audit' });
    return state.audit;
  } catch { return []; }
}

// The model menu: what LM Studio on the PC has installed (and which are loaded), and picking one (the PC loads it).
const apiBase = () => savedOrLocal().trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
export async function fetchModels() {
  try {
    const res = await fetch(`${apiBase()}/api/models`, { headers: { authorization: `Bearer ${settings.token}` } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
export async function chooseModel(model) {
  try {
    const res = await fetch(`${apiBase()}/api/model`, { method: 'POST', headers: { authorization: `Bearer ${settings.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model }) });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...body } : { ok: false, error: body.error ?? `HTTP ${res.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Wake the PC when it is unreachable: the desktop build sends the magic packet itself (a browser cannot send UDP).
export async function wakePc() {
  if (!settings.pcMac) return { ok: false, message: 'Enter the PC\'s MAC address in Settings first.' };
  if (!window.__TAURI_INTERNALS__) return { ok: false, message: 'Wake-on-LAN needs the desktop app.' };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('wake_on_lan', { mac: settings.pcMac });
    return { ok: true, message: 'Wake packet sent. The PC can take a minute to start.' };
  } catch (e) { return { ok: false, message: String(e) }; }
}

if (serverMode()) { useTelemetrySource('server'); connect(); }
// Coming back from a different network (leaving the house, a VPN switching): reconnect at once instead of waiting out the backoff.
window.addEventListener('online', () => { if (wanted && serverMode() && !ws) { attempts = 0; connect(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && wanted && serverMode() && !ws) { attempts = 0; connect(); } });
