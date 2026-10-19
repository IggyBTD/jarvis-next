// Checks that everything JARVIS needs is in place and prints a pass/fail table. Exit code 1 if anything fails.
//   node scripts/doctor.js            (on the PC: all checks; on the Mac: pass --agent-only)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadConfig, tokenPath, resolveData, dataPath, ConfigError } from '../server/core/config.js';
import { loadTokens } from '../server/core/auth.js';
import { createAuditLog } from '../server/core/audit-log.js';
import { createLlmClient } from '../server/core/llm-client.js';
import { loadToken } from '../server/digest/google.js';
import { isMain } from '../shared/util.js';

const portFree = (port, host = '127.0.0.1') => new Promise((ok) => { const s = net.createServer(); s.once('error', () => ok(false)); s.listen(port, host, () => s.close(() => ok(true))); });

export async function runDoctor({ cfg = loadConfig(), fetchImpl = fetch, agentOnly = false } = {}) {
  const rows = [];
  const add = (name, ok, detail = '') => rows.push({ name, ok, detail });
  add('Node 22 or newer', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node);
  add('Configuration files valid', true, 'config/server');
  const tokens = loadTokens(cfg);
  for (const id of Object.keys(cfg.machines.machines)) {
    const f = tokenPath(cfg, id);
    let mode = '';
    try { mode = process.platform === 'win32' ? 'n/a' : (fs.statSync(f).mode & 0o077) === 0 ? 'private' : 'readable by others'; } catch { /* missing */ }
    add(`Token for ${id}`, !!tokens.machines[id], tokens.machines[id] ? (mode && mode !== 'n/a' ? mode : 'present') : 'missing: npm run gen-tokens');
  }
  add('UI token', tokens.ui.length > 0, tokens.ui.length ? 'present' : 'missing: npm run gen-tokens');
  for (const [id, m] of Object.entries(cfg.machines.machines)) {
    if (agentOnly && m.os !== process.platform) continue;
    try {
      const res = await fetchImpl(`http://${m.host}:${m.agentPort}/health`, { headers: { authorization: `Bearer ${tokens.machines[id]?.[0]}` }, signal: AbortSignal.timeout(3000) });
      const j = res.ok ? await res.json() : null;
      add(`Agent ${id} reachable`, !!j, j ? `${j.os}, up ${j.uptimeSeconds}s` : `HTTP ${res.status}`);
      if (j?.sidecars?.opencode) {
        const o = j.sidecars.opencode;
        add(`OpenCode on ${id}`, !!o.running && (!cfg.policy.opencode.version || o.version === cfg.policy.opencode.version), o.running ? `version ${o.version}` : (o.error ?? 'not running'));
      }
      if (j?.sidecars?.browser) add(`Browser service on ${id}`, !!j.sidecars.browser.running, j.sidecars.browser.running ? 'running' : (j.sidecars.browser.error ?? 'not running'));
    } catch (e) { add(`Agent ${id} reachable`, false, `${e.cause?.code ?? e.message}`); }
  }
  if (!agentOnly) {
    const h = await createLlmClient({ config: cfg.models, fetchImpl }).health();
    add('Model server', h.reachable && h.modelPresent, h.reachable ? (h.modelPresent ? `alias ${cfg.models.modelId} loaded` : `reachable, but alias "${cfg.models.modelId}" is not loaded`) : `not reachable (${h.error})`);
    add(`Server port ${cfg.machines.server.port}`, true, (await portFree(cfg.machines.server.port)) ? 'free (server is not running)' : 'in use (server running?)');
    let google = 'not set up (digest will show a banner)';
    let googleOk = false;
    try { const t = loadToken(resolveData(cfg, cfg.digest.google.tokenFile)); googleOk = !!t?.refresh_token; if (googleOk) google = 'refresh token saved'; } catch (e) { google = `token unreadable: ${e.message}`; }
    add('Google sign-in', googleOk || !cfg.digest.enabled, google);
    const v = createAuditLog({ dir: dataPath(cfg, 'audit') }).verify();
    add('Audit log chain', v.ok, `${v.entries} entries${v.ok ? '' : `: ${v.errors[0]}`}`);
  }
  try { const s = fs.statfsSync(cfg.dataDir.length && fs.existsSync(cfg.dataDir) ? cfg.dataDir : path.dirname(cfg.dataDir)); const gb = (s.bavail * s.bsize) / 1024 ** 3; add('Disk space for data', gb > 2, `${gb.toFixed(1)} GB free`); } catch { add('Disk space for data', true, 'unknown'); }
  return rows;
}

export const table = (rows) => rows.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(28)} ${r.detail}`).join('\n');

if (isMain(import.meta.url)) {
  try {
    const rows = await runDoctor({ agentOnly: process.argv.includes('--agent-only') });
    console.log(table(rows));
    process.exit(rows.every((r) => r.ok) ? 0 : 1);
  } catch (e) { console.error(e instanceof ConfigError ? e.message : e); process.exit(1); }
}
