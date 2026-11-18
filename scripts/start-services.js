// Starts whatever of JARVIS is down on this PC: the server, the PC agent and the starter (the doorbell the Mac rings). It opens no window.
// Run hidden at logon by "JARVIS starter.vbs" in the Startup folder, so the server is already up when the app is opened.
//   node scripts/start-services.js
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../server/core/config.js';
import { reachable } from './wake.js';
import { background, freshen } from './launch-app.js';
import { isMain } from '../shared/util.js';

export async function startServices({ probe = reachable, start = background, refresh = freshen, platform = process.platform } = {}) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const me = Object.keys(cfg.machines.machines).find((m) => cfg.machines.machines[m].os === platform);
  const port = cfg.machines.server.port ?? 7410;
  const tailHost = new URL(cfg.machines.server.url ?? `http://127.0.0.1:${port}`).hostname; // the starter listens on the tailnet address only
  const logs = path.join(ROOT, 'data', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const started = [];
  await refresh({ probe, port }); // a newer build of the UI, and a server older than its code is stopped first
  if (me && !(await probe('127.0.0.1', cfg.machines.machines[me].agentPort))) { start('agent/index.js', ['--machine', me], path.join(logs, 'agent.log')); started.push('agent'); }
  if (!(await probe('127.0.0.1', port))) { start('server/index.js', [], path.join(logs, 'server.log')); started.push('server'); }
  if (!(await probe(tailHost, port + 1)) && !(await probe('127.0.0.1', port + 1))) { start('scripts/pc-starter.js', [], path.join(logs, 'starter.log')); started.push('starter'); }
  return started;
}

if (isMain(import.meta.url)) {
  startServices().then((s) => { if (s.length) fs.appendFileSync(path.join(ROOT, 'data', 'logs', 'launch.log'), `${new Date().toISOString()} started: ${s.join(', ')}\n`); }).catch((e) => {
    fs.appendFileSync(path.join(ROOT, 'data', 'logs', 'launch.log'), `${new Date().toISOString()} start-services failed: ${e.message}\n`);
    process.exit(1);
  });
}
