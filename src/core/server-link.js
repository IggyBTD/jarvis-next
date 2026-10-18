// The client side of the JARVIS server (spec section 4.12). A thin WebSocket client: it holds a cache of what the server
// said and sends the user's actions. It has no authority: the server decides the target, runs the tools and asks for approval.
// Settings (server address, UI token) live in localStorage; the desktop build can move the token to the OS keychain later.
// Reconnects with exponential backoff and jitter, never blocks the interface, and shows a plain "offline" state.
import { ingestTelemetry, useTelemetrySource } from './telemetry-view.js';

const KEY = 'jarvis.server';
const CONV_KEY = 'jarvis.server.conv';
const DEFAULTS = { enabled: false, url: 'ws://pc:7410', token: '', pcMac: '' };

const read = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; } };
let settings = read();
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
};

const listeners = new Set();
export const onLink = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
function emit(event) { for (const cb of [...listeners]) { try { cb(event, state); } catch (e) { console.warn('[jarvis] server-link listener failed:', e); } } }

export const serverMode = () => settings.enabled && !!settings.token && !!settings.url;
export const isOnline = () => state.status === 'online';

let ws = null;
let timer = 0;
let attempts = 0;
let wanted = false;

function wsUrl() {
  const u = settings.url.trim().replace(/^http/i, 'ws').replace(/\/+$/, '');
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
  const openedAt = { t: 0 };
  socket.onopen = () => {
    openedAt.t = Date.now();
    attempts = 0;
    state.attempts = 0;
    socket.send(JSON.stringify({ type: 'hello', clientId: `app-${Math.random().toString(36).slice(2, 8)}`, version: '1' }));
  };
  socket.onmessage = (ev) => { if (typeof ev.data === 'string') handle(JSON.parse(ev.data)); };
  socket.onerror = () => {};
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    attempts += 1;
    state.attempts = attempts;
    state.streaming = null;
    // Browsers hide the HTTP status of a refused upgrade, so repeated instant failures are shown as a probable wrong token or address.
    setStatus(attempts >= 3 && !openedAt.t ? 'refused' : 'offline', attempts >= 3 && !openedAt.t ? 'Cannot connect. Check the server address and the token, and that the server is running.' : '');
    if (wanted && serverMode()) timer = setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempts, 7)) * (0.5 + Math.random() * 0.5));
  };
}
export function disconnect() { wanted = false; clearTimeout(timer); const s = ws; ws = null; try { s?.close(); } catch { /* closed */ } setStatus(serverMode() ? 'offline' : 'off'); }
function reconnect() { disconnect(); attempts = 0; if (serverMode()) { useTelemetrySource('server'); connect(); } else useTelemetrySource('local'); }

const send = (obj) => { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; };
const reqId = () => Math.random().toString(36).slice(2, 10);

function handle(m) {
  switch (m.type) {
    case 'state':
      Object.assign(state, { target: m.target, machines: m.machines, health: m.health, pending: m.pendingApprovals ?? [], telemetry: m.telemetry ?? {}, digest: m.digest, agentTasks: m.agentTasks ?? [], reminders: m.reminders ?? [], voice: m.voice ?? { enabled: false } });
      state.conversation = { ...m.conversation, id: m.conversation?.id ?? convId };
      setStatus('online');
      for (const [machine, t] of Object.entries(state.telemetry)) if (machine === 'pc' && t && !t.offline) ingestTelemetry(t.metrics);
      emit({ type: 'state' });
      // the server's default conversation is "main"; this window talks in its own
      if (m.conversation?.streaming && m.conversation.id === convId) emit({ type: 'resume', text: m.conversation.streaming.text });
      return;
    case 'target.changed': state.target = m.to; emit({ type: 'target', from: m.from, to: m.to }); return;
    case 'target.rejected': state.target = m.target; emit({ type: 'target', rejected: true, reason: m.reason }); return;
    case 'health': state.health = m; for (const [id, v] of Object.entries(m.machines ?? {})) if (state.machines[id]) state.machines[id].online = v.online; emit({ type: 'health' }); return;
    case 'telemetry':
      state.telemetry[m.machine] = { ts: m.ts, metrics: m.metrics, offline: !!m.offline };
      if (m.machine === 'pc' && !m.offline) ingestTelemetry(m.metrics);
      emit({ type: 'telemetry', machine: m.machine });
      return;
    case 'gate.request': state.pending = [...state.pending.filter((p) => p.id !== m.request.id), m.request]; emit({ type: 'gate.request', request: m.request }); return;
    case 'gate.queued': state.pending = [...state.pending.filter((p) => p.id !== m.request.id), m.request]; emit({ type: 'gate.queued', request: m.request }); return;
    case 'gate.resolved': state.pending = state.pending.filter((p) => p.id !== m.id); emit({ type: 'gate.resolved', id: m.id, decision: m.decision }); return;
    case 'agent.status': state.agentTasks = [...state.agentTasks.filter((t) => t.taskId !== m.taskId), m]; emit({ type: 'agent.status', task: m }); return;
    case 'digest.ready': state.digest = { date: m.date, ...(state.digest ?? {}) }; emit({ type: 'digest.ready', date: m.date }); return;
    case 'chat.title': if (m.convId === convId) { state.conversation.title = m.title; emit({ type: 'title', title: m.title }); } return;
    case 'chat.delta': case 'chat.done': case 'chat.error': case 'tool.call': case 'tool.result':
      if (m.convId === convId) emit(m);
      return;
    case 'error': emit({ type: 'server-error', reason: m.reason }); return;
    default: emit(m);
  }
}

// ---- actions ---------------------------------------------------------------------------------------------------------
export function sendChat(text) {
  if (!isOnline()) return { ok: false, reason: state.status === 'connecting' ? 'Still connecting to the JARVIS server.' : 'The JARVIS server is not reachable. Nothing was sent, and nothing was run on this computer instead.' };
  send({ type: 'chat.send', convId, text });
  return { ok: true };
}
export const abortChat = () => send({ type: 'chat.abort', convId });
export function setTarget(target) {
  if (!isOnline() || target === state.target) return;
  const previous = state.target;
  state.target = target; // optimistic; the server confirms or sends target.rejected with the real one
  emit({ type: 'target', optimistic: true, from: previous, to: target });
  send({ type: 'target.set', id: reqId(), target });
}
export const replyGate = (id, decision) => send({ type: 'gate.reply', id, decision });
export const runAction = (name, args = {}) => send({ type: 'action.invoke', id: reqId(), name, args });
export const requestDigest = () => send({ type: 'digest.run' });
export const sendAgentTask = (prompt) => send({ type: 'agent.task', id: reqId(), prompt });
export const abortAgentTask = (taskId) => send({ type: 'agent.abort', taskId });
export const dismissReminder = (reminderId) => send({ type: 'reminder.dismiss', reminderId });

export async function fetchAudit(n = 15) {
  const base = settings.url.trim().replace(/^ws/i, 'http').replace(/\/ws$/, '').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/audit?n=${n}`, { headers: { authorization: `Bearer ${settings.token}` } });
    if (!res.ok) return [];
    state.audit = (await res.json()).entries ?? [];
    emit({ type: 'audit' });
    return state.audit;
  } catch { return []; }
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && wanted && serverMode() && !ws) { attempts = 0; connect(); } });
