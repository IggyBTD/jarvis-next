// Prints the address(es) to open on another computer (the Mac) to use JARVIS in a browser: nothing to install there.
// At home it is the PC's address; away from home it is the Tailscale name. With "tailscale serve" the same page is also reachable
// over HTTPS, which browsers require for the microphone on anything but localhost. The token is in the #fragment, which the browser
// never sends to any server. Treat each link like a password.
//   node scripts/client-link.js [--host pc]
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, tokenPath } from '../server/core/config.js';
import { resolveBind } from '../shared/net.js';
import { isMain } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';

export async function tailscaleName(run = runProgram) {
  const r = await run({ file: 'tailscale', args: ['status', '--json'], timeoutMs: 5000 }).catch(() => null);
  if (!r || r.code !== 0) return null;
  try { const j = JSON.parse(r.stdout); return j.BackendState === 'Running' && j.Self?.DNSName ? j.Self.DNSName.replace(/\.$/, '') : null; } catch { return null; }
}

export function links({ host, port, token, tsName }) {
  const out = [{ label: 'At home (same network)', url: `http://${host}:${port}/#token=${token}` }];
  if (tsName) {
    out.push({ label: 'Anywhere, over Tailscale (HTTPS, microphone works). First run on the PC: tailscale serve --bg ' + port, url: `https://${tsName}/#token=${token}` });
    out.push({ label: 'Anywhere, over Tailscale (plain HTTP, no microphone)', url: `http://${tsName}:${port}/#token=${token}` });
  }
  return out;
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const i = process.argv.indexOf('--host');
  const host = i === -1 ? resolveBind(cfg.machines.server.bind).host : process.argv[i + 1];
  const token = fs.readFileSync(path.join(path.dirname(tokenPath(cfg, 'pc')), 'ui.token'), 'utf8').trim();
  const tsName = await tailscaleName();
  for (const l of links({ host, port: cfg.machines.server.port, token, tsName })) console.log(`${l.label}:\n${l.url}\n`);
  if (!tsName) console.log('Tailscale is not running on this PC, so there is no link for use away from home yet (see docs/remote.md).');
  console.log('Build the app first on the PC if you have not: npm run build');
}
