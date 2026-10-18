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
