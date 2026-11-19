// The wake relay: a tiny always-on helper for a device at home (a Raspberry Pi, a NAS, an old laptop, anything with Node)
// that sits on the same network as the PC and on your Tailscale network. A sleeping PC cannot answer, and a packet from far
// away cannot reach its network's broadcast address, so the Mac asks this device (over Tailscale) to send the Wake-on-LAN packet.
// It can wake exactly one MAC, the one it was started with, and only for a caller that has the wake token.
//   node scripts/wake-relay.js --mac AC:36:1B:E9:A4:91 --host <this device's Tailscale address> [--port 7430] [--broadcast 192.168.1.255]
// The first start creates data/tokens/wake.token (printed path only, never the content). Copy that file to the Mac's
// data/tokens/ by hand, like the other tokens.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAC_RE, sendWol } from '../shared/wol.js';
import { isMain, writeFileAtomic } from '../shared/util.js';

export function createRelay({ token, mac, send = sendWol, extra = [], now = Date.now, minGapMs = 5000 }) {
  let last = 0;
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return async (req, res) => {
    const out = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const given = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!given || !same(given, token)) return out(401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/health') return out(200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/wake') return out(404, { error: 'not found' });
    if (now() - last < minGapMs) return out(429, { error: 'asked a moment ago, wait a few seconds' });
    last = now();
    try { await send(mac, { extra }); return out(200, { sent: true }); } catch (e) { return out(502, { error: `could not send: ${e.message}` }); }
  };
}

if (isMain(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const mac = arg('mac');
  if (!mac || !MAC_RE.test(mac)) { console.error('Give the PC\'s MAC address: --mac aa:bb:cc:dd:ee:ff'); process.exit(1); }
  const host = arg('host', '127.0.0.1');
  const port = Number(arg('port', 7430));
  const file = path.resolve('data', 'tokens', 'wake.token');
  if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileAtomic(file, crypto.randomBytes(24).toString('hex'), 0o600); console.log(`Created ${file}. Copy it to the Mac's data/tokens/ folder by hand; do not paste it anywhere.`); }
  const token = fs.readFileSync(file, 'utf8').trim();
  const extra = arg('broadcast') ? [arg('broadcast')] : [];
  http.createServer(createRelay({ token, mac, extra })).listen(port, host, () => console.log(`Wake relay for ${mac} on http://${host}:${port}`));
}
