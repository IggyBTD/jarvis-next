// The server side wired to a REAL agent, a REAL OpenCode manager (with a stubbed child process) and an in-process fake
// OpenCode, so the permission bridge and agent tasks run through every real layer in between.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { testConfig, tmpDir, rmDir } from './helpers.js';
import { createFakeOpencode } from './mocks/fake-opencode.js';
import { createRegistry } from '../agent/registry/mod.js';
import { createAgent } from '../agent/index.js';
import { createOpencodeManager } from '../agent/sidecars/opencode-manager.js';
import { generateTokens, loadTokens } from '../server/core/auth.js';
import { createAuditLog } from '../server/core/audit-log.js';
import { createPolicy } from '../server/core/policy.js';
import { createGate } from '../server/core/gate.js';
import { createBus } from '../server/core/event-bus.js';
import { createToolRouter } from '../server/core/tool-router.js';
import { createConversations } from '../server/core/conversations.js';
import { createAgentTasks, registerAgentTaskTool } from '../server/core/agent-tasks.js';
import { createOpencodeBridge } from '../server/core/opencode-bridge.js';

export function stubSpawn() {
  const made = [];
  const fn = () => {
    const c = new EventEmitter();
    c.pid = 4000 + made.length;
    c.exitCode = null;
    c.kill = () => { if (c.exitCode === null) { c.exitCode = 0; c.emit('exit', 0, null); } };
    made.push(c);
    return c;
  };
  fn.made = made;
  return fn;
}

export async function makeAgentStack({ edit = () => {}, taskTimeoutMs, variant = 'new', clients = 1 } = {}) {
  const root = tmpDir('stack');
  const fake = await createFakeOpencode({ variant });
  const t = testConfig((f) => {
    f['files.json'].roots = { win32: [root], darwin: [root] };
    f['machines.json'].machines.pc.workspaceDir = path.join(root, 'ws');
    if (taskTimeoutMs) f['policy.json'].opencode.taskTimeoutMs = taskTimeoutMs;
    edit(f);
  });
  const { cfg } = t;
  generateTokens(cfg);
  const tokens = loadTokens(cfg);
  const registry = createRegistry({ cfg, machineId: 'pc' });
  const wsDir = registry.ensureWorkspace();
  const spawnFn = stubSpawn();
  const manager = createOpencodeManager({ workspaceDir: wsDir, serverUrl: 'http://127.0.0.1:7410', modelToken: 'm'.repeat(64), version: '1.19.1', command: process.execPath, spawnFn, port: fake.port, runProgram: async () => ({ code: 0, stdout: '1.19.1', stderr: '' }), backoff: { min: 20, max: 40, stable: 60000 }, env: {} });
  const agent = createAgent({ cfg, machineId: 'pc', registry, sidecars: { opencode: manager }, tokens });
  const addr = await agent.listen(0, '127.0.0.1');
  cfg.machines.machines.pc.agentPort = addr.port;
  const bus = createBus();
  const events = [];
  bus.subscribe((m) => events.push(m));
  const audit = createAuditLog({ dir: path.join(t.dataDir, 'audit') });
  const gate = createGate({ audit, bus, clientCount: () => clients, dataDir: t.dataDir, timeoutMs: 5000 });
  const router = createToolRouter({ cfg, policy: createPolicy(cfg.policy), gate, audit, tokens: () => loadTokens(cfg).machines.pc[0] });
  const conversations = createConversations({ dir: path.join(t.dataDir, 'conversations') });
  const tasks = createAgentTasks({ router, bus, audit, conversations, dataDir: t.dataDir, taskTimeoutMs: cfg.policy.opencode.taskTimeoutMs });
  registerAgentTaskTool(router, tasks);
  const machines = { pc: cfg.machines.machines.pc };
  const bridge = createOpencodeBridge({ router, gate, audit, tasks, policyCfg: cfg.policy, machines });
  await manager.start();
  bridge.start();
  const waitIdle = async () => { for (let i = 0; i < 100 && !manager.status().running; i++) await new Promise((r) => setTimeout(r, 20)); };
  await waitIdle();
  return {
    cfg, fake, manager, agent, router, gate, audit, bus, events, tasks, bridge, conversations, spawnFn, root, wsDir, tokens,
    approveAll(decision = 'approve') {
      const seen = new Set();
      const timer = setInterval(() => { for (const e of events.filter((x) => x.type === 'gate.request')) if (!seen.has(e.request.id)) { seen.add(e.request.id); gate.reply(e.request.id, decision, 't'); } }, 5);
      return () => clearInterval(timer);
    },
    async close() { bridge.stop(); gate.denyAll(); await manager.stop(); await agent.close(); await fake.close(); t.cleanup(); rmDir(root); },
  };
}
export { fs };
