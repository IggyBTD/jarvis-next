// A fake machine agent: bearer-token auth, /health, /info, /actions, /action/:name (recorded, results scripted), an SSE
// /events stream you can push to, and recorded /opencode/* and /browser/* requests. Not the real agent: it exists so the
// server side (router, orchestrator, bridge) can be tested without touching a registry.
import http from 'node:http';

export async function startFakeAgent({ token, machine = 'pc', info = {}, port = 0 } = {}) {
  const calls = [];
  const proxied = [];
  const results = new Map();     // action name -> (args, dryRun) => result object
  const routes = new Map();      // "METHOD /path" -> (req body) => { status, json }
  const sse = new Set();
  let down = false;
  const facts = { os: machine === 'pc' ? 'win32' : 'darwin', os_version: machine === 'pc' ? 'Windows 11' : 'macOS 15.1', hostname: `${machine}-host`, user: 'tester', home: '/home/tester', shell: machine === 'pc' ? 'PowerShell' : 'zsh', path_sep: machine === 'pc' ? '\\' : '/', workspace_dir: '/ws', package_manager: machine === 'pc' ? 'winget' : 'Homebrew', modifier_key: machine === 'pc' ? 'Ctrl' : 'Cmd', locale: 'en-GB', timezone: 'Europe/Madrid', date: '2026-10-18 10:00', ...info };

  const server = http.createServer((req, res) => {
    if (down) return req.socket.destroy();
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (url.pathname === '/health') return json(200, { ok: true, machine });
      if (url.pathname === '/info') return json(200, facts);
      if (url.pathname === '/actions') return json(200, { actions: [], missing: [] });
      const act = url.pathname.match(/^\/action\/(\w+)$/);
      if (act) {
        calls.push({ name: act[1], args: body.args, dryRun: !!body.dryRun });
        const fn = results.get(act[1]);
        return json(200, fn ? fn(body.args, body.dryRun) : { ok: true, data: body.dryRun ? { dryRun: true, would: act[1] } : { done: act[1], machine }, durationMs: 1 });
      }
      if (url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': connected\n\n');
        sse.add(res);
        res.on('close', () => sse.delete(res));
        return undefined;
      }
      const side = url.pathname.match(/^\/(opencode|browser)(\/.*)$/);
      if (side) {
        proxied.push({ side: side[1], method: req.method, path: side[2], body });
        const h = routes.get(`${req.method} ${side[1]}${side[2]}`);
        const out = h ? h(body) : { status: 200, json: {} };
        return json(out.status, out.json);
      }
      return json(404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port, calls, proxied, facts,
    result: (name, fn) => results.set(name, fn),
    route: (key, fn) => routes.set(key, fn),
    emit: (event) => { for (const r of sse) r.write(`data: ${JSON.stringify(event)}\n\n`); },
    sseCount: () => sse.size,
    setDown: (v) => { down = v; },
    close: () => new Promise((r) => { for (const s of sse) s.end(); server.closeAllConnections?.(); server.close(r); }),
  };
}
