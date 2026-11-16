// The phone's link to the JARVIS server: a small WebSocket client. It keeps a copy of what the server said and sends what you do; it has no
// authority (the server picks the computer, runs the tools and asks for approval). Same protocol as the desktop client (src/core/server-link.js),
// without the desktop's telemetry and window parts.
//
// iOS suspends a page's sockets when the app goes to the background, so the link reconnects the moment the app is visible again, and a reply
// that was still being written comes back in the first `state` message (`conversation.streaming`).
import { DEFAULT_EFFORT, EFFORTS } from '../../shared/effort.js';

const KEY = 'jarvis.phone';
const CONV_KEY = 'jarvis.phone.conv';
const EFFORT_KEY = 'jarvis.phone.effort';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: lasts until the app closes */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* nothing to remove */ } },
};

let token = (() => { try { return JSON.parse(store.get(KEY) ?? '{}').token ?? ''; } catch { return ''; } })();
// The token travels in the address after "#" (never sent to a server). It stays there on purpose: "Add to Home Screen" saves this address, and
// iOS gives a home-screen app its own storage, so the address is how the token gets in.
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) { token = fromHash; store.set(KEY, JSON.stringify({ token })); }
export const hasToken = () => !!token;
export function forget() { store.del(KEY); store.del(CONV_KEY); token = ''; history.replaceState(null, '', location.pathname); location.reload(); }

const newId = () => `p-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
let convId = store.get(CONV_KEY) || newId();
export const getConvId = () => convId;
export const getEffort = () => { const e = store.get(EFFORT_KEY); return EFFORTS.includes(e) ? e : DEFAULT_EFFORT; };
export const setEffort = (e) => { if (EFFORTS.includes(e)) store.set(EFFORT_KEY, e); emit({ type: 'effort' }); };

// 'connecting' | 'online' | 'offline' | 'refused' (the server said no: wrong token) | 'off' (no token)
export const state = {
  status: token ? 'connecting' : 'off', target: 'pc', machines: {}, health: null, pending: [], running: new Set(), agentTasks: [],
  conv: { id: convId, title: '', messages: [], streaming: null }, attempts: 0, lastError: '',
};

const listeners = new Set();
export const onLink = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
function emit(event) { for (const cb of [...listeners]) { try { cb(event, state); } catch (e) { console.warn('[jarvis] listener failed:', e); } } }
function setStatus(status, lastError = '') {
  if (state.status === status && state.lastError === lastError) return;
  state.status = status;
  state.lastError = lastError;
  emit({ type: 'status' });
}

const origin = () => location.origin;
const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
export async function api(path, init = {}) {
  const res = await fetch(`${origin()}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let ws = null;
let timer = 0;
let attempts = 0;
let wanted = false;

export function connect() {
  if (!token) { setStatus('off'); return; }
  wanted = true;
  clearTimeout(timer);
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  setStatus(attempts ? 'offline' : 'connecting');
  let socket;
  try { socket = new WebSocket(wsUrl(), ['jarvis.v1', `bearer.${token}`]); } catch { setStatus('refused', 'The address is not valid.'); return; }
  ws = socket;
  let opened = 0;
  const stall = setTimeout(() => { if (!opened) try { socket.close(); } catch { /* closed */ } }, 5000); // a silent address is given up on after 5 s
  socket.onopen = () => {
    opened = Date.now();
    attempts = 0;
    state.attempts = 0;
    socket.send(JSON.stringify({ type: 'hello', convId, clientId: `phone-${Math.random().toString(36).slice(2, 8)}`, version: '1' }));
  };
  socket.onmessage = (ev) => { if (typeof ev.data === 'string') { try { handle(JSON.parse(ev.data)); } catch (e) { console.warn('[jarvis] bad message', e); } } };
  socket.onerror = () => {};
  socket.onclose = () => {
    clearTimeout(stall);
    if (ws !== socket) return;
    ws = null;
    attempts += 1;
    state.attempts = attempts;
    state.conv.streaming = null;
    // A browser hides the HTTP status of a refused upgrade, so repeated instant failures are shown as a probable wrong token.
    setStatus(attempts >= 3 && !opened ? 'refused' : 'offline', attempts >= 3 && !opened ? 'Cannot connect. Check that the PC is on and that Tailscale is connected on this phone.' : '');
    if (wanted) timer = setTimeout(connect, Math.min(15_000, 400 * 2 ** Math.min(attempts, 6)) * (0.6 + Math.random() * 0.4));
  };
}
const send = (obj) => { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; };
export const isOnline = () => state.status === 'online';
export function retry() { attempts = 0; clearTimeout(timer); try { ws?.close(); } catch { /* closed */ } ws = null; connect(); }
const reqId = () => Math.random().toString(36).slice(2, 10);

function handle(m) {
  switch (m.type) {
    case 'state':
      Object.assign(state, { target: m.target, machines: m.machines, health: m.health, pending: m.pendingApprovals ?? [], agentTasks: m.agentTasks ?? [] });
      state.conv = { ...m.conversation, id: m.conversation?.id ?? convId };
      state.running = new Set(m.running ?? []);
      setStatus('online');
      emit({ type: 'state' });
      if (m.conversation?.streaming && m.conversation.id === convId) emit({ type: 'resume', text: m.conversation.streaming.text });
      return;
    case 'target.changed': state.target = m.to; emit({ type: 'target' }); return;
    case 'target.rejected': state.target = m.target; emit({ type: 'target', rejected: true, reason: m.reason }); return;
    case 'health': state.health = m; for (const [id, v] of Object.entries(m.machines ?? {})) if (state.machines[id]) state.machines[id].online = v.online; emit({ type: 'health' }); return;
    case 'chat.state': if (m.running) state.running.add(m.convId); else state.running.delete(m.convId); emit({ type: 'running', convId: m.convId }); return;
    case 'gate.request': case 'gate.queued': state.pending = [...state.pending.filter((p) => p.id !== m.request.id), m.request]; emit({ type: 'gate', request: m.request }); return;
    case 'gate.resolved': state.pending = state.pending.filter((p) => p.id !== m.id); emit({ type: 'gate.resolved', id: m.id, decision: m.decision }); return;
    case 'agent.status': state.agentTasks = [...state.agentTasks.filter((t) => t.taskId !== m.taskId), m]; emit({ type: 'agent.status', task: m }); return;
    case 'agent.step': emit(m); return;
    case 'chat.title': if (m.convId === convId) { state.conv.title = m.title; emit({ type: 'title', title: m.title }); } return;
    case 'chat.delta': case 'chat.done': case 'chat.error': case 'tool.call': case 'tool.result': case 'chat.note':
      if (m.convId === convId) emit(m); else emit({ type: 'elsewhere', convId: m.convId, kind: m.type });
      return;
    case 'error': emit({ type: 'server-error', reason: m.reason }); return;
    default: emit(m);
  }
}

// ---- what you do ------------------------------------------------------------------------------------------------------------------
export function sendChat(text) {
  if (!isOnline()) return { ok: false, reason: state.status === 'connecting' ? 'Still connecting.' : 'Not connected to the PC. Nothing was sent.' };
  send({ type: 'chat.send', convId, text, effort: getEffort() });
  return { ok: true };
}
export const abort = () => send({ type: 'chat.abort', convId });
export const replyGate = (id, decision) => send({ type: 'gate.reply', id, decision });
// Undo for a note the model saved (the server announces it to every client): the person's own call, through the router like any other.
export const forgetNote = (noteId) => send({ type: 'action.invoke', id: newId(), name: 'forget', args: { note: noteId } });
export function setTarget(target) {
  if (!isOnline() || target === state.target) return;
  state.target = target; // optimistic: the server confirms (target.changed) or answers with the real one (target.rejected)
  emit({ type: 'target', optimistic: true });
  send({ type: 'target.set', id: reqId(), target });
}
export function newChat() {
  convId = newId();
  store.set(CONV_KEY, convId);
  state.conv = { id: convId, title: '', messages: [], streaming: null };
  emit({ type: 'conversation' });
}
// Opens a saved chat: the server's next snapshot (a `hello` with this id) carries its recent messages and any reply still being written.
export function openChat(id) {
  convId = id;
  store.set(CONV_KEY, id);
  state.conv = { id, title: '', messages: [], streaming: null };
  send({ type: 'hello', convId: id, clientId: `phone-${Math.random().toString(36).slice(2, 8)}`, version: '1' });
  emit({ type: 'conversation' });
}
export const listChats = async () => (await api('/conversations')).conversations ?? [];
export const deleteChat = (id) => api(`/conversations/${id}`, { method: 'DELETE' });

// iOS suspends sockets in the background: come back to a live link.
document.addEventListener('visibilitychange', () => { if (!document.hidden && wanted && !ws) { attempts = 0; connect(); } });
window.addEventListener('online', () => { if (wanted && !ws) { attempts = 0; connect(); } });
window.addEventListener('pageshow', (e) => { if (e.persisted && wanted && !ws) { attempts = 0; connect(); } }); // restored from the back-forward cache
