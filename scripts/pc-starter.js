// The PC's doorbell: a tiny always-on listener (started at logon) that starts the JARVIS server and the PC agent when the Mac
// asks, so opening JARVIS on the Mac works even if the server was stopped. Same ui.token as the server; same callers as the Mac.
//   node scripts/pc-starter.js        listens on port 7411 (server port + 1)
//   GET /health -> { server, agent }      POST /start -> starts what is down, returns what it is starting
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, tokenPath, ROOT } from '../server/core/config.js';
import { ipAllowed, isLoopback } from '../shared/net.js';
import { reachable } from './wake.js';
import { background, freshen } from './launch-app.js';
import { isMain } from '../shared/util.js';

export function createStarter({ token, allowed, ports, probe = reachable, start = background, refresh = freshen, logs = path.join(ROOT, 'data', 'logs') }) {
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const state = async () => ({ server: await probe('127.0.0.1', ports.server), agent: await probe('127.0.0.1', ports.agent) });
  let starting = false;
  return async (req, res) => {
    const out = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const ip = req.socket.remoteAddress;
    if (!isLoopback(ip) && !ipAllowed(ip, allowed)) return out(403, { error: 'forbidden' });
    const given = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!given || !same(given, token)) return out(401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/health') return out(200, await state());
    if (req.method !== 'POST' || req.url !== '/start') return out(404, { error: 'not found' });
    const s = await state();
    if (!s.agent) start('agent/index.js', ['--machine', 'pc'], path.join(logs, 'agent.log'));
    out(202, { starting: [!s.agent && 'agent', !s.server && 'server'].filter(Boolean) });
    if (!s.server && !starting) { // rebuild the UI first if src/ changed, so the Mac sees the current app
      starting = true;
      try { await refresh(); } catch { /* open the previous build */ }
      start('server/index.js', [], path.join(logs, 'server.log'));
      starting = false;
    }
  };
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const m = cfg.machines;
  const token = fs.readFileSync(path.join(path.dirname(tokenPath(cfg, 'pc')), 'ui.token'), 'utf8').trim();
  const port = (m.server.port ?? 7410) + 1;
  const handler = createStarter({ token, allowed: m.machines.mac.allowedCallers, ports: { server: m.server.port ?? 7410, agent: m.machines.pc.agentPort } });
  http.createServer(handler).listen(port, '0.0.0.0', () => console.log(`JARVIS starter on port ${port}`));
}
