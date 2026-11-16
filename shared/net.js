// Address helpers: caller allowlists (exact address or IPv4 CIDR) and the "auto" bind rule (Tailscale interface, else LAN IPv4, else loopback).
import os from 'node:os';

const norm = (ip) => String(ip ?? '').replace(/^::ffff:/i, '');
const v4 = (ip) => { const p = ip.split('.').map(Number); return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? (((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]) : null; };

export function ipAllowed(ip, list) {
  const a = norm(ip);
  return list.some((entry) => {
    if (!entry.includes('/')) return norm(entry) === a;
    const [net, bits] = entry.split('/');
    const x = v4(a);
    const n = v4(net);
    const b = Number(bits);
    if (x === null || n === null || !(b >= 0 && b <= 32)) return false;
    const mask = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
    return ((x & mask) >>> 0) === ((n & mask) >>> 0);
  });
}
export const isLoopback = (ip) => ['127.0.0.1', '::1'].includes(norm(ip)) || norm(ip).startsWith('127.');
// The caller's address for permission checks: the socket's own, or 'proxied' when a proxy stands in between (tailscale serve or any
// local proxy makes every caller look like loopback, so loopback then proves nothing).
export const callerIp = (req) => {
  const h = req?.headers ?? {};
  return h['x-forwarded-for'] || h.forwarded || h['x-real-ip'] || Object.keys(h).some((k) => k.startsWith('tailscale-')) ? 'proxied' : req?.socket?.remoteAddress ?? 'unknown';
};

// 'tailscale': the Tailscale interface, else loopback; never the LAN (on a foreign Wi-Fi the LAN is anyone's). 'auto' also tries the LAN.
export function resolveBind(bind, interfaces = os.networkInterfaces()) {
  if (bind !== 'auto' && bind !== 'tailscale') return { host: bind, reason: 'configured' };
  const all = Object.values(interfaces).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  const ts = all.find((i) => ipAllowed(i.address, ['100.64.0.0/10']));
  if (ts) return { host: ts.address, reason: 'Tailscale interface' };
  if (bind === 'tailscale') return { host: '127.0.0.1', reason: 'no Tailscale interface found; loopback only (never the LAN)' };
  const lan = all.find((i) => ipAllowed(i.address, ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12']));
  if (lan) return { host: lan.address, reason: 'LAN address' };
  return { host: '127.0.0.1', reason: 'no Tailscale or LAN interface found; loopback only' };
}
