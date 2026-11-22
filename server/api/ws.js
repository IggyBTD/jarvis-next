// The one WebSocket. Upgrade needs a UI token (Authorization header, or the Sec-WebSocket-Protocol pair
// "jarvis.v1, bearer.<token>" for browsers that cannot set headers; never the query string) and an allowed Origin.
// After `hello` the server sends one `state` snapshot (including a chat reply still streaming, so a reconnecting client
// resumes it), then forwards the bus. The server is authoritative; clients hold only a cache.
import { WebSocketServer } from 'ws';
import { parseClientMessage, BROADCAST, MAX_FRAME } from './protocol.js';
import { BusyError } from '../core/orchestrator.js';
import { callerIp } from '../../shared/net.js';

const DEFAULT_CONV = 'main';
const MAX_BUFFER = 8 * 1024 * 1024;

// devices (server/core/devices.js): every message is checked against the sending device's scopes (chat, approve, settings, and the
// T3 and admin step-up), and sockets whose token was revoked or rotated are closed. Without it (test harnesses) nothing is checked.
const NEED = {
  'chat.send': 'chat', 'chat.abort': 'chat', 'agent.task': 'chat', 'agent.abort': 'chat', 'digest.get': 'chat', 'digest.run': 'chat', 'voice.start': 'chat', 'voice.stop': 'chat',
  'voice.barge_in': 'chat', 'action.invoke': 'chat', 'wake.pc': 'chat', 'reminder.dismiss': 'chat', 'target.set': 'target', 'backend.set': 'settings',
};

export function attachWs({ server, cfg, auth, bus, gate, orchestrator, targetState, prompts, router, conversations, telemetry, health, digest, agentTasks, modes, backend, reminders, voice, wake, devices = null, log = () => {} }) {
  const may = (c, what, opts = {}) => (devices ? devices.can(c.principal, what, { ip: c.ip, ...opts }) : { ok: true });
  // The tier of an approval is the gate's own, never the client's. A pin travels only with gate.reply and mode.set.
  const permission = (c, m) => {
    if (m.type === 'hello') return may(c, 'chat');
    if (m.type === 'ping') return { ok: true };
    if (m.type === 'mode.set') return may(c, m.mode === 'bypass' || m.mode === 'accept-edits' ? 'admin' : 'settings', { pin: m.pin }); // both run any command that is not T3 (2026-11-18)
    if (m.type === 'clipboard.copy') return may(c, 'approve', { tier: 'T2' }); // it answers its own T2 read (get_clipboard)
    if (m.type === 'gate.reply') return m.decision === 'deny' ? may(c, 'deny') : may(c, 'approve', { tier: gate.pending().find((p) => p.id === m.id)?.tier, pin: m.pin });
    return Object.hasOwn(NEED, m.type) ? may(c, NEED[m.type]) : { ok: false, reason: 'unknown message' };
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false, handleProtocols: (protocols) => (protocols.has('jarvis.v1') ? 'jarvis.v1' : false) });
  const clients = new Set();
  const streams = new Map(); // convId -> text of the reply being written
  const origins = cfg.machines.server.origins ?? [];
  const machines = cfg.machines.machines;

  const send = (c, obj) => {
    if (c.ws.readyState !== 1) return;
    if (c.ws.bufferedAmount > MAX_BUFFER) { c.ws.close(1013, 'too slow'); return; }
    c.ws.send(JSON.stringify(obj));
  };
  const broadcast = (obj) => { for (const c of clients) send(c, obj); };

  bus.subscribe((m) => {
    if (m.type === 'chat.delta') streams.set(m.convId, (streams.get(m.convId) ?? '') + m.text);
    if (m.type === 'chat.done' || m.type === 'chat.error') streams.delete(m.convId);
    if (BROADCAST.has(m.type)) broadcast(m);
  });
  bus.subscribe((m) => { if (m.type === 'target.changed') prompts.refresh(m.to).catch(() => {}); });

  async function buildState(convId = DEFAULT_CONV) {
    const h = await health();
    const conv = conversations.get(convId);
    return {
      type: 'state', target: targetState.get(), machines: Object.fromEntries(Object.entries(machines).map(([id, m]) => [id, { label: m.label, os: m.os, online: h.machines[id]?.online ?? false }])),
      health: h, pendingApprovals: gate.pending(), telemetry: telemetry?.snapshot() ?? {}, digest: digest?.latestMeta?.() ?? null,
      conversation: { id: convId, title: conv?.title ?? '', messages: conv ? conversations.recent(conv) : [], streaming: streams.has(convId) ? { text: streams.get(convId) } : null },
      running: orchestrator.busyIds?.() ?? [], permissionMode: modes?.get() ?? 'auto', codeBackend: backend?.get() ?? 'local', agentTasks: agentTasks?.list?.() ?? [], reminders: reminders?.missedFor?.() ?? [], voice: voice ? { enabled: true } : { enabled: false },
    };
  }

  // Code page with the Claude backend: the message is the coding task itself (no local model in between). The reply is written into the chat when the run ends.
  // The task goes through the router like any other tool call (policy, audit), never to the task list directly.
  async function codeTurn(c, convId, text) {
    if (!agentTasks) return send(c, { type: 'chat.error', convId, reason: 'The coding agent is not available.' });
    const conv = conversations.ensure(convId);
    const target = targetState.get();
    conversations.append(conv, { role: 'user', content: text, target });
    const out = await router.invoke({ name: 'agent_task', args: { prompt: text } }, { target, source: 'user', convId, direct: true });
    if (!out.ok) send(c, { type: 'chat.error', convId, reason: out.error ?? 'the coding task did not start' });
  }

  const handlers = {
    async hello(c, m) { c.hello = true; send(c, await buildState(/^[\w-]{1,64}$/.test(m?.convId ?? '') ? m.convId : undefined)); await reminders?.deliverMissed?.(); },
    ping(c, m) { send(c, { type: 'pong', id: m.id }); },
    'chat.send'(c, m) {
      const convId = m.convId ?? DEFAULT_CONV;
      if (orchestrator.isBusy(convId)) return send(c, { type: 'chat.error', convId, reason: 'The last message is still being answered.' });
      if (m.code) { const conv = conversations.ensure(convId); if (conv.mode !== 'code') { conv.mode = 'code'; conversations.save(conv); } } // marks the chat as a coding session
      if (m.code && backend?.get() === 'claude') return codeTurn(c, convId, m.text);
      orchestrator.runTurn({ convId, text: m.text, source: 'user', effort: m.effort }).catch((e) => send(c, { type: 'chat.error', convId, reason: e instanceof BusyError ? e.message : 'internal error' }));
    },
    'chat.abort'(c, m) { orchestrator.abort(m.convId); },
    'mode.set'(c, m) { modes.set(m.mode); },
    'backend.set'(c, m) { backend.set(m.backend); },
    'target.set'(c, m) {
      try { targetState.set(m.target, { by: 'ui', clientId: c.id }); send(c, { type: 'target.ack', id: m.id, target: m.target }); } catch (e) { send(c, { type: 'target.rejected', id: m.id, target: targetState.get(), reason: e.message }); }
    },
    async 'gate.reply'(c, m) { const r = await gate.reply(m.id, m.decision, c.principal?.deviceId ? `${c.principal.deviceId}/${c.id}` : c.id); if (!r.ok) send(c, { type: 'error', id: m.id, reason: r.error }); },
    async 'agent.task'(c, m) {
      const out = await router.invoke({ name: 'agent_task', args: { prompt: m.prompt, ...(m.workspace ? { workspace: m.workspace } : {}) } }, { target: targetState.bind().target, source: 'user' });
      send(c, { type: 'agent.task.ack', id: m.id, ok: out.ok, message: out.content });
    },
    'agent.abort'(c, m) { agentTasks?.abort?.(m.taskId); },
    async 'digest.get'(c, m) { send(c, { type: 'digest.data', id: m.id, digest: digest?.get(m.date) ?? null }); },
    async 'digest.run'(c, m) { if (!digest) return send(c, { type: 'error', id: m.id, reason: 'digest is not available' }); digest.run({ manual: true }).catch(() => {}); },
    async 'action.invoke'(c, m) {
      const out = await router.invoke({ name: m.name, args: m.args ?? {} }, { target: targetState.bind().target, source: 'user' });
      send(c, { type: 'action.result', id: m.id, name: m.name, ok: out.ok, target: out.target, content: out.content });
    },
    // One computer's clipboard onto the other's (the app's "Copy PC clipboard to Mac" commands). Both halves go through the router as
    // the person's own press (source 'click': policy, audit; set_clipboard's text is kept out of the log). The text reaches neither
    // this client nor the model.
    async 'clipboard.copy'(c, m) {
      const reply = (ok, message) => send(c, { type: 'clipboard.result', id: m.id, ok, message });
      const name = (id) => machines[id]?.label ?? id;
      const why = (out) => out.error ?? String(out.content ?? '').replace(/^\[[^\]]*\]\s*/, '');
      if (m.from === m.to) return reply(false, 'Pick two different computers.');
      const got = await router.invoke({ name: 'get_clipboard', args: {} }, { target: m.from, source: 'click' });
      if (!got.ok) return reply(false, `Could not read the ${name(m.from)} clipboard: ${why(got)}`);
      const text = typeof got.data?.text === 'string' ? got.data.text : '';
      if (got.data?.truncated) return reply(false, `The ${name(m.from)} clipboard is too long to copy (${got.data.chars ?? 'over 12000'} characters; the limit is 12000).`);
      if (!text) return reply(false, `The ${name(m.from)} clipboard has no text.`);
      const put = await router.invoke({ name: 'set_clipboard', args: { text } }, { target: m.to, source: 'click' });
      reply(put.ok, put.ok ? `Copied ${text.length} characters from the ${name(m.from)} to the ${name(m.to)}.` : `Could not write the ${name(m.to)} clipboard: ${why(put)}`);
    },
    async 'wake.pc'(c, m) { const r = await wake?.(); send(c, { type: 'wake.result', id: m.id, ok: !!r?.ok, message: r?.message ?? 'Wake-on-LAN is not configured' }); },
    'reminder.dismiss'(c, m) { reminders?.dismiss?.(m.reminderId); },
    'voice.start'(c, m) { voice ? voice.start(c, m) : send(c, { type: 'error', id: m.id, reason: 'voice is off' }); },
    'voice.stop'(c) { voice?.stop(c); },
    'voice.barge_in'(c) { voice?.bargeIn(c); },
  };

  server.on('upgrade', (req, socket, head) => {
    const refuse = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
    const url = new URL(req.url, 'http://server');
    if (url.pathname !== '/ws') return refuse(404, 'Not Found');
    // the app served by this very server is same-origin; anything else must be a listed origin
    if (!auth.originAllowed(req.headers.origin, [...origins, `http://${req.headers.host}`, `https://${req.headers.host}`])) return refuse(403, 'Forbidden');
    const proto = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
    const fromProto = proto.find((p) => p.startsWith('bearer.'));
    const header = req.headers.authorization ?? (fromProto ? `Bearer ${fromProto.slice(7)}` : undefined);
    const ip = callerIp(req);
    const verdict = auth.check(header, { roles: ['ui'], ip });
    if (!verdict.ok) return refuse(verdict.status === 429 ? 429 : verdict.status === 403 ? 403 : 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      // the bearer is kept in memory so sweep() can ask the device store whether it still holds (revoked or rotated: closed)
      const c = { ws, id: `ui-${Math.random().toString(36).slice(2, 10)}`, hello: false, principal: verdict.principal, ip, bearer: String(header ?? '').replace(/^Bearer\s+/, '') };
      clients.add(c);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => { clients.delete(c); voice?.forget(c); });
      ws.on('error', () => {});
      ws.on('message', async (data, isBinary) => {
        if (isBinary) { voice?.onBinary(c, data); return; }
        const parsed = parseClientMessage(data.toString('utf8'));
        if (!parsed.ok) return send(c, { type: 'error', reason: parsed.error });
        const m = parsed.msg;
        if (!c.hello && m.type !== 'hello' && m.type !== 'ping') return send(c, { type: 'error', id: m.id, reason: 'send hello first' });
        const allowed = permission(c, m);
        if (!allowed.ok) return send(c, { type: 'error', id: m.id, reason: allowed.reason || 'this device may not do that' });
        try { await handlers[m.type](c, m); } catch (e) { log(`ws handler ${m.type}: ${e.stack ?? e}`); send(c, { type: 'error', id: m.id, reason: 'internal error' }); }
      });
    });
  });

  // A socket whose token no longer holds (the device was revoked, or its token rotated, from here or from the command on the PC) is
  // closed: it would otherwise keep receiving every chat and approval.
  const sweep = () => { if (!devices) return; for (const c of clients) if (!devices.authenticate(c.bearer, { ip: c.ip })) { clients.delete(c); c.ws.close(4401, 'this device is no longer paired'); } };
  const beat = setInterval(() => { sweep(); for (const c of clients) { if (!c.ws.isAlive) { c.ws.terminate(); continue; } c.ws.isAlive = false; c.ws.ping(); } }, 20_000);
  beat.unref?.();
  const healthPush = setInterval(async () => { if (clients.size) broadcast({ type: 'health', ...(await health().catch(() => ({}))) }); }, 5000);
  healthPush.unref?.();

  return {
    clientCount: () => clients.size,
    buildState, broadcast, sweep,
    close() { clearInterval(beat); clearInterval(healthPush); for (const c of clients) c.ws.close(1001, 'server stopping'); wss.close(); },
  };
}
