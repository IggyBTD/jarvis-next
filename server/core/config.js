// Loads and validates config/server/*.json plus the prompt files. Refuses to start (throws ConfigError) with a readable
// message that names the file and the field. Paths: JARVIS_ROOT, JARVIS_CONFIG_DIR and JARVIS_DATA_DIR override the defaults.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../shared/schema.js';
import { SCHEMAS, REQUIRED_FILES } from './config-schemas.js';

export class ConfigError extends Error {
  constructor(problems) {
    super(`Configuration is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export const ROOT = process.env.JARVIS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const expandHome = (p) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p);

export function loadConfig({ configDir = process.env.JARVIS_CONFIG_DIR ?? path.join(ROOT, 'config', 'server'), dataDir = process.env.JARVIS_DATA_DIR ?? path.join(ROOT, 'data'), only = null } = {}) {
  const problems = [];
  const cfg = { configDir, dataDir, root: ROOT };
  for (const file of only ?? REQUIRED_FILES) {
    const full = path.join(configDir, file);
    let json;
    try { json = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) {
      problems.push(`${file}: ${e.code === 'ENOENT' ? 'file is missing' : `cannot be read as JSON (${e.message})`}`);
      continue;
    }
    for (const msg of validate(SCHEMAS[file], json)) problems.push(`${file} ${msg}`);
    cfg[file.replace(/\.json$/, '')] = json;
  }
  if (problems.length) throw new ConfigError(problems);

  // cross-file checks that a schema cannot express
  if (cfg.machines) {
    const ports = new Set([cfg.machines.server.port]);
    for (const [id, m] of Object.entries(cfg.machines.machines)) {
      if (ports.has(m.agentPort) && m.host === cfg.machines.machines.pc?.host && id !== 'pc') problems.push(`machines.json: ${id}.agentPort ${m.agentPort} is already used`);
      ports.add(m.agentPort);
    }
    if (!cfg.machines.machines.pc || !cfg.machines.machines.mac) problems.push('machines.json: both "pc" and "mac" must be defined');
  }
  if (cfg.actions) {
    const seen = new Set();
    for (const a of cfg.actions.actions) {
      if (seen.has(a.name)) problems.push(`actions.json: duplicate action "${a.name}"`);
      seen.add(a.name);
    }
  }
  if (cfg.policy && cfg.actions) {
    const names = new Set(cfg.actions.actions.map((a) => a.name));
    for (const n of Object.keys(cfg.policy.actions ?? {})) if (!names.has(n) && !/^(agent_task|browser_|list_action_categories|run_user_script)/.test(n)) problems.push(`policy.json: actions.${n} is not a known action`);
  }
  if (problems.length) throw new ConfigError(problems);

  cfg.prompts = {};
  const promptDir = path.join(configDir, 'prompts');
  for (const f of ['base.md', 'target-pc.md', 'target-mac.md', 'switch-notice.md']) {
    try { cfg.prompts[f.replace(/\.md$/, '')] = fs.readFileSync(path.join(promptDir, f), 'utf8'); } catch { if (!only) problems.push(`prompts/${f}: file is missing`); }
  }
  if (problems.length) throw new ConfigError(problems);
  return cfg;
}

export const dataPath = (cfg, ...parts) => path.join(cfg.dataDir, ...parts);
export const machineIds = (cfg) => Object.keys(cfg.machines.machines);
// "data/..." in a config file means the data directory, wherever it is; anything else is a real path.
export const resolveData = (cfg, p) => (/^data[\\/]/.test(p) ? path.join(cfg.dataDir, p.slice(5)) : path.resolve(expandHome(p)));
export const tokenPath = (cfg, id) => resolveData(cfg, cfg.machines.machines[id].tokenFile);
