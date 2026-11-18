// Starts the sidecars this machine hosts: OpenCode (coding agent) and the guarded browser. Neither is required for the agent
// to run: a missing or refused sidecar is reported in /health and the agent carries on.
import { loadTokens, modelTokenFor } from '../../server/core/auth.js';
import { createOpencodeManager } from './opencode-manager.js';
import { createBrowserManager } from './browser-manager.js';
import { createClaudeManager } from './claude-manager.js';
import { getInfo } from '../info.js';
import os from 'node:os';
import { systemFolders, within } from '../../shared/command-scope.js';

export async function startSidecars({ cfg, machineId, registry, log = () => {}, env = process.env, overrides = {} }) {
  const machine = cfg.machines.machines[machineId];
  const token = loadTokens(cfg).machines[machineId]?.[0];
  const sidecars = {};
  const stops = [];
  if (!token) return { sidecars, stopSidecars: async () => {} };

  if (env.JARVIS_OPENCODE !== '0') {
    const facts = await getInfo({ machine: { ...machine, workspaceDir: registry.ctx.workspaceDir } }).catch(() => null);
    const oc = createOpencodeManager({
      workspaceDir: registry.ctx.workspaceDir, serverUrl: cfg.machines.server.url ?? `http://127.0.0.1:${cfg.machines.server.port}`,
      modelToken: modelTokenFor(token), contextLength: cfg.models?.contextLength, version: cfg.policy.opencode.version, facts, log,
      allowOtherVersion: env.JARVIS_ALLOW_OPENCODE_VERSION === '1', env, ...overrides.opencode,
    });
    sidecars.opencode = oc;
    stops.push(() => oc.stop());
    oc.start().then((ok) => log(ok ? `OpenCode ready (${oc.status().version})` : `OpenCode not started: ${oc.status().error}`)).catch((e) => log(`OpenCode failed: ${e.message}`));
  }

  if (env.JARVIS_CLAUDE !== '0') sidecars.claude = createClaudeManager({ workspaceDir: registry.ctx.workspaceDir, policy: cfg.policy, protect: [cfg.root, cfg.dataDir, ...claudeSystem(registry.ctx.workspaceDir)].filter(Boolean), env, log, ...overrides.claude });

  if (env.JARVIS_BROWSER !== '0') {
    const br = createBrowserManager({ cfg, machineId, workspaceDir: registry.ctx.workspaceDir, dataDir: cfg.dataDir, log, env, ...overrides.browser });
    sidecars.browser = br;
    stops.push(() => br.stop());
    br.start().then((ok) => log(ok ? 'browser sidecar ready' : `browser sidecar not started: ${br.status().error}`)).catch((e) => log(`browser sidecar failed: ${e.message}`));
  }
  return { sidecars, stopSidecars: async () => { await Promise.all(stops.map((s) => s().catch(() => {}))); } };
}

// The system's folders that Claude Code may not read or edit in any mode (the bridge protects the same ones for OpenCode), except one
// that holds the workspace: that folder was chosen to work in.
function claudeSystem(workspace) {
  const plat = process.platform === 'win32' ? 'win32' : 'darwin';
  return systemFolders(plat, os.homedir()).filter((s) => !(workspace && within(workspace, s, plat, { loose: true })));
}
