// Starts the PC from here (the Mac, a phone's terminal, anywhere) and waits until JARVIS answers.
//   node scripts/wake.js            wake the PC and wait up to 3 minutes for the server
//   node scripts/wake.js --check    (on the PC) read-only: is a network adapter allowed to wake it?
// Setup, once, in data/wake.json:  { "mac": "AC:36:1B:E9:A4:91", "relay": "http://<relay's Tailscale address>:7430" }
// With "relay" the request goes to the home device running scripts/wake-relay.js (needed when you are away from home).
// Without it a broadcast is sent from this machine, which only works on the PC's own network. The relay's token is
// data/tokens/wake.token. A PC that is asleep (not off, and ideally on a network cable) is what this can wake.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadConfig, ROOT } from '../server/core/config.js';
import { sendWol, MAC_RE } from '../shared/wol.js';
import { isMain, sleep, readJson } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';

export const reachable = (host, port, timeoutMs = 2500) => new Promise((ok) => {
  const s = net.connect({ host, port, timeout: timeoutMs });
  s.once('connect', () => { s.destroy(); ok(true); });
  s.once('timeout', () => { s.destroy(); ok(false); });
  s.once('error', () => ok(false));
});

export async function wake({ conf, server, log = console.log, send = sendWol, fetchImpl = fetch, probe = reachable, waitMs = 180_000, stepMs = 5000, token = '' }) {
  if (await probe(server.host, server.port)) { log('The PC already answers. Nothing to do.'); return { ok: true, already: true }; }
  if (conf.relay) {
    log(`Asking the wake relay at ${conf.relay}...`);
    const res = await fetchImpl(`${conf.relay.replace(/\/+$/, '')}/wake`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, reason: `The relay said ${res.status}${res.status === 401 ? ' (wrong or missing wake token)' : ''}.` };
  } else {
    log('No relay set: sending the packet from this machine (works only on the PC\'s own network).');
    await send(conf.mac);
  }
  log('Packet sent. Waiting for the PC and JARVIS to come up...');
  for (let waited = 0; waited < waitMs; waited += stepMs) {
    await sleep(stepMs);
    if (await probe(server.host, server.port)) { log('JARVIS is up.'); return { ok: true }; }
  }
  return { ok: false, reason: 'No answer after the packet. The PC may not allow wake-up (run "node scripts/wake.js --check" on it), may be fully off, or the server does not start at logon (node scripts/install.js --os win32 --apply).' };
}

async function check() {
  if (process.platform !== 'win32') { console.log('--check reads Windows settings; run it on the PC.'); return; }
  const r = await runProgram({ file: 'powercfg', args: ['/devicequery', 'wake_armed'], timeoutMs: 10_000 });
  const list = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nic = list.filter((l) => /ethernet|network|wi-?fi|wireless|realtek|intel|killer|mediatek|qualcomm|broadcom/i.test(l));
  console.log(nic.length ? `Allowed to wake this PC:\n  ${nic.join('\n  ')}` : 'No network adapter is allowed to wake this PC. In Device Manager > the adapter > Power Management, tick "Allow this device to wake the computer" and "Only allow a magic packet", and enable Wake on LAN in the BIOS/UEFI.');
  console.log('A cable (Ethernet) is far more reliable than Wi-Fi for this. A PC that is fully shut down usually cannot be woken; sleep is fine.');
}

if (isMain(import.meta.url)) {
  if (process.argv.includes('--check')) { await check(); process.exit(0); }
  const conf = readJson(path.join(ROOT, 'data', 'wake.json'));
  if (!conf || !MAC_RE.test(conf.mac ?? '')) { console.error('Create data/wake.json with {"mac": "aa:bb:cc:dd:ee:ff", "relay": "http://<relay address>:7430"} (relay is needed away from home).'); process.exit(1); }
  const cfg = loadConfig({ only: ['machines.json'] });
  const u = new URL(cfg.machines.server.url);
  const tokenFile = path.join(ROOT, 'data', 'tokens', 'wake.token');
  const token = conf.relay && fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
  if (conf.relay && !token) { console.error('Copy the relay\'s wake.token to data/tokens/wake.token on this machine first.'); process.exit(1); }
  const r = await wake({ conf, server: { host: u.hostname, port: Number(u.port || 80) }, token });
  if (r.ok) console.log('Open JARVIS now: your saved link, or node scripts/client-link.js on the PC.'); else console.error(r.reason);
  process.exit(r.ok ? 0 : 1);
}
