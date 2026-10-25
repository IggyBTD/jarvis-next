// Updates this machine's JARVIS helper from the server (no AirDrop): downloads the current bundle with this machine's own token,
// unpacks it over this folder, and keeps what is local: data/ (tokens, logs) and config/server/machines.json (your addresses).
// If package.json changed it runs npm install, then restarts the agent's LaunchAgent on a Mac.
//   node scripts/update.js
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, tokenPath, ROOT } from '../server/core/config.js';
import { readZip } from '../shared/zip.js';
import { isMain } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';

const KEEP = (name) => name.startsWith('data/') || name === 'config/server/machines.json';

export function applyBundle(zipBytes, root) {
  const files = readZip(zipBytes);
  const written = [];
  let packageChanged = false;
  for (const f of files) {
    if (KEEP(f.name) && fs.existsSync(path.join(root, f.name))) continue;
    const dest = path.join(root, f.name);
    if (!path.resolve(dest).startsWith(path.resolve(root) + path.sep)) throw new Error(`refusing to write outside the folder: ${f.name}`);
    const old = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (old && old.equals(f.data)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
    written.push(f.name);
    if (f.name === 'package.json') packageChanged = true;
  }
  return { written, packageChanged, total: files.length };
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const id = Object.keys(cfg.machines.machines).find((m) => cfg.machines.machines[m].os === process.platform);
  const token = fs.readFileSync(tokenPath(cfg, id), 'utf8').trim();
  const base = cfg.machines.server.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/bundle`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`The server answered ${res.status}. Is it running, and is server.url in config/server/machines.json right?`); process.exit(1); }
  const r = applyBundle(Buffer.from(await res.arrayBuffer()), ROOT);
  console.log(r.written.length ? `Updated ${r.written.length} of ${r.total} files:\n  ${r.written.join('\n  ')}` : 'Already up to date.');
  if (r.packageChanged) { console.log('Dependencies changed: running npm install'); await runProgram({ file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['install'], cwd: ROOT, timeoutMs: 300_000 }); }
  if (r.written.length && process.platform === 'darwin') {
    const k = await runProgram({ file: 'launchctl', args: ['kickstart', '-k', `gui/${process.getuid()}/com.jarvis.agent`] });
    console.log(k.code === 0 ? 'Agent restarted.' : 'Restart the agent yourself: launchctl kickstart -k gui/$(id -u)/com.jarvis.agent');
  }
}
