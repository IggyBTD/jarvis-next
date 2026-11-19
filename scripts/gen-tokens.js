// Creates any missing token files in data/tokens/ (ui, pc, mac), 256 bits each, mode 600.
//   node scripts/gen-tokens.js            create missing tokens
//   node scripts/gen-tokens.js --rotate ui|pc|mac [--grace-minutes 60]   new token, old one valid for the grace period
// Copy mac.token and ui.token to the Mac by hand. Tokens are never printed.
import { loadConfig, tokenPath } from '../server/core/config.js';
import { generateTokens, rotateToken } from '../server/core/auth.js';
import { isMain } from '../shared/util.js';
import path from 'node:path';

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const i = process.argv.indexOf('--rotate');
  if (i !== -1) {
    const name = process.argv[i + 1];
    if (name !== 'ui' && !cfg.machines.machines[name]) { console.error('Use --rotate ui, pc or mac.'); process.exit(1); }
    const g = process.argv.indexOf('--grace-minutes');
    rotateToken(cfg, name, { graceMs: (g === -1 ? 60 : Number(process.argv[g + 1])) * 60_000 });
    console.log(`Rotated the ${name} token. The old one keeps working for the grace period. Copy the new file to the clients.`);
  } else {
    const made = generateTokens(cfg);
    console.log(made.length ? `Created: ${made.join(', ')}` : 'All tokens already exist.');
  }
  console.log(`Token folder: ${path.dirname(tokenPath(cfg, 'pc'))}`);
}
