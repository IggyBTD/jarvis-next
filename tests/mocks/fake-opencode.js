// A fake OpenCode server: HTTP basic auth, /doc, /global/health, SSE /event, sessions, prompts, abort, permissions in the
// two reply-path variants seen across versions, the /session/:id/shell route (recorded, so tests can prove it is never
// called), and the stale-id quirk (a reply to an unknown permission id "succeeds" and does nothing).
import http from 'node:http';

const DOC_NEW = { openapi: '3.1.0', info: { version: '1.19.1' }, paths: { '/doc': { get: {} }, '/global/health': { get: {} }, '/event': { get: {} }, '/session': { get: {}, post: {} }, '/session/{sessionID}': { get: {} }, '/session/{sessionID}/message': { post: {} }, '/session/{sessionID}/prompt_async': { post: {} }, '/session/{sessionID}/abort': { post: {} }, '/session/{sessionID}/shell': { post: {} }, '/permission': { get: {} }, '/permission/{requestID}/reply': { post: {} } } };
const DOC_OLD = { openapi: '3.1.0', info: { version: '1.14.0' }, paths: { ...DOC_NEW.paths, '/permission/{requestID}/reply': undefined, '/session/{sessionID}/prompt_async': undefined, '/session/{sessionID}/permissions/{permissionID}': { post: {} } } };

export async function createFakeOpencode({ port = 0, password = null, variant = 'new', version = '1.19.1' } = {}) {
  const sessions = new Map();
  const pending = new Map();
  const stream = new Set();
  const rec = { prompts: [], aborts: [], replies: [], staleReplies: [], shellCalls: [], requests: [], authFailures: 0 };
  let seq = 0;
  let sessionIdle = null;

  const emit = (event) => { for (const r of stream) r.write(`data: ${JSON.stringify(event)}\n\n`); };
  const server = http.createServer((req, res) => {
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (password && req.headers.authorization !== `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`) { rec.authFailures += 1; res.writeHead(401, { 'www-authenticate': 'Basic' }); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      rec.requests.push({ method: req.method, path: url.pathname, body });
      const p = url.pathname;
      if (p === '/doc') return json(200, variant === 'new' ? { ...DOC_NEW, info: { version } } : { ...DOC_OLD, info: { version } });
      if (p === '/global/health') return json(200, { healthy: true, version });
      if (p === '/event') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ type: 'server.connected', properties: {} })}\n\n`);
        stream.add(res);
        res.on('close', () => stream.delete(res));
        return undefined;
      }
      if (req.method === 'POST' && p === '/session') { const id = `ses_${++seq}`; sessions.set(id, { id, title: body.title ?? '' }); return json(200, { id, title: body.title ?? '' }); }
      let m;
      if ((m = p.match(/^\/session\/([\w-]+)$/)) && req.method === 'GET') return sessions.has(m[1]) ? json(200, sessions.get(m[1])) : json(404, { error: 'no such session' });
      if ((m = p.match(/^\/session\/([\w-]+)\/prompt_async$/)) && req.method === 'POST') { rec.prompts.push({ session: m[1], body }); res.writeHead(204); return res.end(); }
      if ((m = p.match(/^\/session\/([\w-]+)\/message$/)) && req.method === 'POST') {
        rec.prompts.push({ session: m[1], body });
        sessionIdle = () => json(200, { info: { id: 'msg_1' }, parts: [] });
        return undefined; // held open until finish()
      }
      if ((m = p.match(/^\/session\/([\w-]+)\/abort$/)) && req.method === 'POST') { rec.aborts.push(m[1]); return json(200, true); }
      if ((m = p.match(/^\/session\/([\w-]+)\/shell$/))) { rec.shellCalls.push({ session: m[1], body }); return json(200, { ran: true }); }
      if (p === '/permission' && req.method === 'GET') return json(200, [...pending.values()]);
      const reply = p.match(/^\/permission\/([\w-]+)\/reply$/) ?? p.match(/^\/session\/([\w-]+)\/permissions\/([\w-]+)$/);
      if (reply && req.method === 'POST') {
        const id = reply[2] ?? reply[1];
        const answer = body.reply ?? body.response;
        rec.replies.push({ id, answer, variant: reply[2] ? 'old' : 'new' });
        if (!pending.has(id)) { rec.staleReplies.push(id); return json(200, true); } // the quirk: success without effect
        pending.delete(id);
        emit({ type: 'permission.replied', properties: { requestID: id, reply: answer } });
        return json(200, true);
      }
      return json(404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port, rec, sessions, pending,
    emit,
    ask({ sessionID = 'ses_1', permission = 'bash', command = 'ls', patterns, metadata } = {}) {
      const id = `per_${++seq}`;
      const props = { id, sessionID, permission, patterns: patterns ?? [command], metadata: metadata ?? (permission === 'bash' ? { command } : {}) };
      pending.set(id, props);
      emit({ type: 'permission.asked', properties: props });
      return id;
    },
    finish(sessionID, text = 'All done.') {
      emit({ type: 'message.part.updated', properties: { part: { type: 'text', sessionID, text } } });
      emit({ type: 'session.idle', properties: { sessionID } });
      sessionIdle?.();
    },
    fail(sessionID, message = 'boom') { emit({ type: 'session.error', properties: { sessionID, error: { message } } }); },
    // pending permissions do not survive a restart, and open streams drop
    restart() { pending.clear(); for (const r of stream) r.end(); },
    close: () => new Promise((r) => { for (const s of stream) s.end(); server.closeAllConnections?.(); server.close(r); }),
  };
}
