// The one WebSocket. Upgrade needs a UI token (Authorization header, or the Sec-WebSocket-Protocol pair
// "jarvis.v1, bearer.<token>" for browsers that cannot set headers; never the query string) and an allowed Origin.
// After `hello` the server sends one `state` snapshot (including a chat reply still streaming, so a reconnecting client
// resumes it), then forwards the bus. The server is authoritative; clients hold only a cache.
import { WebSocketServer } from 'ws';
import { parseClientMessage, BROADCAST, MAX_FRAME } from './protocol.js';
import { BusyError } from '../core/orchestrator.js';

const DEFAULT_CONV = 'main';
const MAX_BUFFER = 8 * 1024 * 1024;

export function attachWs({ server, cfg, auth, bus, gate, orchestrator, targetState, prompts, router, conversations, telemetry, health, digest, agentTasks, reminders, voice, wake, log = () => {} }) {
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
      agentTasks: agentTasks?.list?.() ?? [], reminders: reminders?.missedFor?.() ?? [], voice: voice ? { enabled: true } : { enabled: false },
    };
  }

  const handlers = {
    async hello(c) { c.hello = true; send(c, await buildState()); await reminders?.deliverMissed?.(); },
    ping(c, m) { send(c, { type: 'pong', id: m.id }); },
    'chat.send'(c, m) {
      const convId = m.convId ?? DEFAULT_CONV;
      if (orchestrator.isBusy(convId)) return send(c, { type: 'chat.error', convId, reason: 'The last message is still being answered.' });
      orchestrator.runTurn({ convId, text: m.text, source: 'user' }).catch((e) => send(c, { type: 'chat.error', convId, reason: e instanceof BusyError ? e.message : 'internal error' }));
    },
    'chat.abort'(c, m) { orchestrator.abort(m.convId); },
    'target.set'(c, m) {
      try { targetState.set(m.target, { by: 'ui', clientId: c.id }); send(c, { type: 'target.ack', id: m.id, target: m.target }); } catch (e) { send(c, { type: 'target.rejected', id: m.id, target: targetState.get(), reason: e.message }); }
    },
    async 'gate.reply'(c, m) { const r = await gate.reply(m.id, m.decision, c.id); if (!r.ok) send(c, { type: 'error', id: m.id, reason: r.error }); },
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
    if (!auth.originAllowed(req.headers.origin, origins)) return refuse(403, 'Forbidden');
    const proto = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim());
    const fromProto = proto.find((p) => p.startsWith('bearer.'));
    const header = req.headers.authorization ?? (fromProto ? `Bearer ${fromProto.slice(7)}` : undefined);
    const verdict = auth.check(header, { roles: ['ui'], ip: req.socket.remoteAddress });
    if (!verdict.ok) return refuse(verdict.status === 429 ? 429 : verdict.status === 403 ? 403 : 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c = { ws, id: `ui-${Math.random().toString(36).slice(2, 10)}`, hello: false };
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
        try { await handlers[m.type](c, m); } catch (e) { log(`ws handler ${m.type}: ${e.stack ?? e}`); send(c, { type: 'error', id: m.id, reason: 'internal error' }); }
      });
    });
  });

  const beat = setInterval(() => { for (const c of clients) { if (!c.ws.isAlive) { c.ws.terminate(); continue; } c.ws.isAlive = false; c.ws.ping(); } }, 20_000);
  beat.unref?.();
  const healthPush = setInterval(async () => { if (clients.size) broadcast({ type: 'health', ...(await health().catch(() => ({}))) }); }, 5000);
  healthPush.unref?.();

  return {
    clientCount: () => clients.size,
    buildState, broadcast,
    close() { clearInterval(beat); clearInterval(healthPush); for (const c of clients) c.ws.close(1001, 'server stopping'); wss.close(); },
  };
}
