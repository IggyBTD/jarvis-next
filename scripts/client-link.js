// Prints the address to open on another computer (the Mac) to use JARVIS in a browser: nothing to install there.
// The token is in the #fragment, which the browser never sends to any server. Treat the link like a password.
//   node scripts/client-link.js [--host pc]     (default host: this PC's Tailscale or LAN address)
import fs from 'node:fs';
import { loadConfig, tokenPath } from '../server/core/config.js';
import { resolveBind } from '../shared/net.js';
import { isMain } from '../shared/util.js';
import path from 'node:path';

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const i = process.argv.indexOf('--host');
  const host = i === -1 ? resolveBind(cfg.machines.server.bind).host : process.argv[i + 1];
  const token = fs.readFileSync(path.join(path.dirname(tokenPath(cfg, 'pc')), 'ui.token'), 'utf8').trim();
  console.log(`Open this on the Mac (any browser):\n\nhttp://${host}:${cfg.machines.server.port}/#token=${token}\n\nBuild the app first on the PC if you have not: npm run build`);
}
