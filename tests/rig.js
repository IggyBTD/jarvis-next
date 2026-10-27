// Builds the whole server-side stack against fakes: config copy, two fake agents, fake model, audit, gate, policy, router,
// target state, conversations, queue, prompts, orchestrator. Tests tweak config through `edit`.
import path from 'node:path';
import { testConfig } from './helpers.js';
import { startFakeAgent } from './mocks/fake-agent.js';
import { startFakeModel } from './mocks/fake-model.js';
import { createAuditLog } from '../server/core/audit-log.js';
import { createPolicy } from '../server/core/policy.js';
import { createGate } from '../server/core/gate.js';
import { createBus } from '../server/core/event-bus.js';
import { createToolRouter } from '../server/core/tool-router.js';
import { createTargetState } from '../server/core/target-state.js';
import { createConversations } from '../server/core/conversations.js';
import { createPromptBuilder } from '../server/core/prompt-builder.js';
import { createLlmClient } from '../server/core/llm-client.js';
import { createQueue } from '../server/core/llm-queue.js';
import { createOrchestrator } from '../server/core/orchestrator.js';

export async function makeRig({ edit = () => {}, clients = 1, enableAll = false } = {}) {
  const pcToken = 'p'.repeat(64);
  const macToken = 'm'.repeat(64);
  const pc = await startFakeAgent({ token: pcToken, machine: 'pc' });
  const mac = await startFakeAgent({ token: macToken, machine: 'mac' });
  const model = await startFakeModel();
  const t = testConfig((f) => {
    f['machines.json'].machines.pc.agentPort = pc.port;
    f['machines.json'].machines.mac.agentPort = mac.port;
    f['machines.json'].machines.mac.host = '127.0.0.1';
    f['models.json'].baseUrl = model.url;
    if (enableAll) for (const a of f['actions.json'].actions) a.enabled = true;
    edit(f);
  });
  const { cfg } = t;
  const bus = createBus();
  const events = [];
  bus.subscribe((m) => events.push(m));
  const state = { clients };
  const audit = createAuditLog({ dir: path.join(t.dataDir, 'audit') });
  const gate = createGate({ audit, bus, clientCount: () => state.clients, dataDir: t.dataDir, timeoutMs: cfg.policy.approvalTimeoutMs, expiryMs: cfg.policy.pendingExpiryMs });
  const policy = createPolicy(cfg.policy);
  const router = createToolRouter({ cfg, policy, gate, audit, tokens: (id) => ({ pc: pcToken, mac: macToken })[id] });
  const target = createTargetState({ dataDir: t.dataDir, machines: Object.keys(cfg.machines.machines), bus });
  const conversations = createConversations({ dir: path.join(t.dataDir, 'conversations') });
  const prompts = createPromptBuilder({ prompts: cfg.prompts, machines: cfg.machines.machines, timezone: cfg.schedules.timezone, getInfo: (id) => router.info(id) });
  const llm = createLlmClient({ config: cfg.models, sleepFn: async () => {} });
  const queue = createQueue({ concurrency: 1 });
  const orchestrator = createOrchestrator({ llm, queue, router, prompts, conversations, targetState: target, bus, models: cfg.models });
  const approveNext = (decision = 'approve') => {
    const seen = new Set(events.filter((e) => e.type === 'gate.request').map((e) => e.request.id));
    const timer = setInterval(() => {
      for (const e of events.filter((x) => x.type === 'gate.request')) if (!seen.has(e.request.id)) { seen.add(e.request.id); gate.reply(e.request.id, decision, 'test'); }
    }, 5);
    return () => clearInterval(timer);
  };
  return {
    cfg, pc, mac, model, bus, events, audit, gate, policy, router, target, conversations, prompts, llm, queue, orchestrator, state, approveNext, tokens: { pc: pcToken, mac: macToken },
    async close() { gate.denyAll(); await Promise.all([pc.close(), mac.close(), model.close()]); t.cleanup(); },
  };
}

export const lastAudit = (r, n = 20) => r.audit.tail(n);
export const settle = () => new Promise((res) => setTimeout(res, 30));

// HTTP + WebSocket on a random port, wired to the rig. Returns { url, wsUrl, uiToken, close }.
import http from 'node:http';
import { createAuth } from '../server/core/auth.js';
import { createLlmProxy } from '../server/core/llm-proxy.js';
import { createHttpHandler, createHealth } from '../server/api/http.js';
import { attachWs } from '../server/api/ws.js';
import { createPermissionMode } from '../server/core/permission-mode.js';
import { createTelemetry } from '../server/telemetry/index.js';

export async function startApi(r, extra = {}) {
  const uiToken = 'u'.repeat(64);
  const auth = createAuth({ tokens: { ui: [uiToken], machines: { pc: [r.tokens.pc], mac: [r.tokens.mac] } } });
  const health = createHealth({ llm: r.llm, queue: r.queue, router: r.router, machines: r.cfg.machines.machines, ttlMs: 50 });
  const llmProxy = createLlmProxy({ llm: r.llm, queue: r.queue, modelId: 'local', audit: r.audit });
  const server = http.createServer();
  const telemetry = extra.telemetry ?? createTelemetry({ bus: r.bus, dataDir: r.cfg.dataDir, providers: {} });
  const wsApi = attachWs({ server, cfg: r.cfg, auth, bus: r.bus, gate: r.gate, orchestrator: r.orchestrator, targetState: r.target, prompts: r.prompts, router: r.router, conversations: r.conversations, telemetry, health, modes: createPermissionMode({ dataDir: r.cfg.dataDir, bus: r.bus }), ...extra });
  let build = wsApi.buildState;
  const handler = createHttpHandler({ cfg: r.cfg, auth, llmProxy, models: { list: () => r.llm.listModels(), select: (k) => r.llm.selectModel(k) }, environment: async () => ({ machine: 'pc', label: 'PC', hostname: 'pc-host', os: 'Windows 11', user: 'tester', folder: '/ws', branch: 'main', dirty: 2, repo: true, remote: { on: true, url: 'http://100.1.2.3:7410', devices: 1 } }), health, audit: r.audit, conversations: r.conversations, digest: extra.digest, osint: extra.osint, buildState: () => build() });
  server.on('request', handler);
  await new Promise((ok) => server.listen(extra.port ?? 0, '127.0.0.1', ok));
  const port = server.address().port;
  r.state.clients = 0;
  const origCount = wsApi.clientCount;
  Object.defineProperty(r.state, 'clients', { get: () => origCount(), set: () => {}, configurable: true });
  return { url: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws`, uiToken, auth, wsApi, close: async () => { wsApi.close(); server.closeAllConnections?.(); await new Promise((ok) => server.close(ok)); } };
}

// A small WebSocket test client: collects messages, waits for one that matches.
import WebSocket from 'ws';
export function wsClient(url, { token, origin, protocols, headers = {} } = {}) {
  const opts = { headers: { ...(token && !protocols ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(origin ? { origin } : {}) };
  const ws = new WebSocket(url, protocols, opts);
  const messages = [];
  const waiters = [];
  ws.on('message', (d, bin) => {
    if (bin) { messages.push({ binary: d }); return; }
    const m = JSON.parse(d.toString());
    m.at = Date.now();
    messages.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); }
  });
  const opened = new Promise((ok, no) => { ws.once('open', () => ok(true)); ws.once('unexpected-response', (_q, res) => ok(res.statusCode)); ws.once('error', (e) => no(e)); });
  return {
    ws, messages, opened,
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    next: (pred, timeout = 3000) => new Promise((ok, no) => {
      const hit = messages.find(pred);
      if (hit) return ok(hit);
      const w = { pred, ok };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i !== -1) { waiters.splice(i, 1); no(new Error(`timeout waiting for message (have: ${messages.map((m) => m.type).join(',')})`)); } }, timeout);
    }),
    close: () => new Promise((ok) => { if (ws.readyState === 3) return ok(); ws.once('close', ok); ws.close(); }),
  };
}
export async function openClient(api, opts = {}) {
  const c = wsClient(api.wsUrl, { token: api.uiToken, ...opts });
  const st = await c.opened;
  if (st !== true) throw new Error(`upgrade refused: ${st}`);
  c.send({ type: 'hello', clientId: opts.clientId ?? 'test' });
  await c.next((m) => m.type === 'state');
  return c;
}
