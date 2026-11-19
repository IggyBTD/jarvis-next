// Prints the address(es) to open on another computer (the Mac) or the iPhone, and a short code to pair that device. Nothing secret is in
// an address: the device asks for the code on its first run and gets its own token in return (docs/security/pairing-design.md). Every
// address is the PC's Tailscale name (F3-6): Tailscale authenticates the machine behind the name, while a raw address gives the token
// to whatever answers there. With "tailscale serve" the same page is also reachable over HTTPS, which browsers require for the
// microphone on anything but localhost.
//   node scripts/client-link.js [phone|browser]
import { loadConfig } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';
import { createDevices, LOCAL } from '../server/core/devices.js';
import { currentUiToken } from '../server/core/auth.js';

export async function tailscaleName(run = runProgram) {
  // the installer adds Tailscale to PATH only for new sessions, so the default Windows location is tried too
  const r = (await run({ file: 'tailscale', args: ['status', '--json'], timeoutMs: 5000 }).catch(() => null)) ?? (process.platform === 'win32' ? await run({ file: 'C:\\Program Files\\Tailscale\\tailscale.exe', args: ['status', '--json'], timeoutMs: 5000 }).catch(() => null) : null);
  if (!r || r.code !== 0) return null;
  try { const j = JSON.parse(r.stdout); return j.BackendState === 'Running' && j.Self?.DNSName ? j.Self.DNSName.replace(/\.$/, '') : null; } catch { return null; }
}

export function links({ port, tsName }) {
  if (!tsName) return [];
  return [
    // the iPhone app (docs/mobile.md): through the starter on port + 1, so the home-screen icon also starts the server when it is off
    { label: 'iPhone: open this in Safari, type the code, then Share > Add to Home Screen', url: `http://${tsName}:${port + 1}/` },
    { label: 'Over Tailscale (HTTPS, microphone works). First run on the PC: tailscale serve --bg ' + port, url: `https://${tsName}/` },
    { label: 'Over Tailscale (plain HTTP, no microphone)', url: `http://${tsName}:${port}/` },
  ];
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const kind = ['phone', 'browser'].includes(process.argv[2]) ? process.argv[2] : 'browser';
  const tsName = await tailscaleName();
  for (const l of links({ port: cfg.machines.server.port, tsName })) console.log(`${l.label}:\n${l.url}\n`);
  if (!tsName) console.log('Tailscale is not running on this PC, so there is no address to give: other devices reach JARVIS only over Tailscale (docs/remote.md).');
  // the phone needs two: the home-screen launcher (port + 1) and the app it opens keep separate storage, so each is paired once
  const devices = createDevices({ dataDir: cfg.dataDir, legacyToken: () => currentUiToken(cfg) });
  for (const what of kind === 'phone' ? ['the home-screen page', 'the app'] : ['this browser']) {
    const r = devices.startPairing({ by: LOCAL, kind });
    console.log(r.error ? `No pairing code: ${r.error}` : `Pairing code for ${what} (5 minutes, once): ${r.code.slice(0, 4)}-${r.code.slice(4)}`);
  }
  console.log('Build the app first on the PC if you have not: npm run build');
}
