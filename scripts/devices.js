// Paired devices, from the PC itself (docs/security/pairing-design.md). It runs as the owner on the PC, so it needs no token or PIN.
//   node scripts/devices.js pair <desktop|browser|phone>   prints a short code to type in that app (5 minutes, once)
//   node scripts/devices.js list                            the devices, the old shared token while it works, whether a PIN is set
//   node scripts/devices.js revoke <id|legacy>              ends a device at once; legacy also replaces ui.token with no grace
//   node scripts/devices.js pin                             asks for a new PIN (typed, never on the command line)
// Moving from the old shared token: pair the desktop, set a PIN, pair the phone and the Mac, then revoke legacy.
import readline from 'node:readline';
import { loadConfig } from '../server/core/config.js';
import { createDevices, LOCAL } from '../server/core/devices.js';
import { currentUiToken, rotateToken } from '../server/core/auth.js';
import { isMain } from '../shared/util.js';

const when = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : 'never');

export async function runDevices(argv, { cfg, devices, ask, print = (l) => console.log(l), rotateUi = (c) => rotateToken(c, 'ui', { graceMs: 0 }) }) {
  const [cmd, arg] = argv;
  if (cmd === 'pair') {
    const r = devices.startPairing({ by: LOCAL, kind: arg ?? 'phone' });
    if (r.error) { print(`Not started: ${r.error}`); return 1; }
    print(`Type this code in the ${arg ?? 'phone'} app within 5 minutes: ${r.code.slice(0, 4)}-${r.code.slice(4)}`);
    return 0;
  }
  if (cmd === 'list') {
    const info = devices.info();
    for (const d of devices.list()) print(`${d.id}  ${d.name}  ${d.kind}  [${d.scopes.join(', ')}]  last seen ${when(d.lastSeenAt)}${d.lastIp ? ` from ${d.lastIp}` : ''}${d.revokedAt ? '  REVOKED' : ''}`);
    print(`PIN: ${info.pinSet ? 'set' : 'not set'}${info.pinLockedUntil ? `, locked until ${when(info.pinLockedUntil)}` : ''}. Old shared token: ${info.legacy ? 'still works' : 'ended'}.${info.damaged ? ' The device store is damaged: nobody can sign in.' : ''}`);
    return 0;
  }
  if (cmd === 'revoke') {
    if (!arg) { print('Which device? Give its id (see list) or legacy.'); return 1; }
    const r = devices.revoke(arg, { by: LOCAL });
    if (r.error) { print(`Not revoked: ${r.error}`); return 1; }
    if (arg === 'legacy' && currentUiToken(cfg)) rotateUi(cfg); // the shared file changes too, and its old copy gets no grace
    print(`Revoked ${arg}. Its open connections close within 20 seconds.`);
    return 0;
  }
  if (cmd === 'pin') {
    const pin = await ask('New PIN (6 to 64 characters): ');
    if (pin !== await ask('Again: ')) { print('The two PINs differ; nothing changed.'); return 1; }
    const r = devices.setPin({ by: LOCAL, newPin: pin });
    print(r.error ? `Not set: ${r.error}` : 'PIN set.');
    return r.error ? 1 : 0;
  }
  print('Usage: node scripts/devices.js pair <desktop|browser|phone> | list | revoke <id|legacy> | pin');
  return 1;
}

// A prompt that does not echo what is typed.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(question); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const devices = createDevices({ dataDir: cfg.dataDir, legacyToken: () => currentUiToken(cfg) });
  process.exitCode = await runDevices(process.argv.slice(2), { cfg, devices, ask: askHidden });
}
