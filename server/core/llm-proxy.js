// Authenticated OpenAI-compatible /v1 for OpenCode. Authentication is done by the HTTP layer (machine and model tokens
// only; UI tokens and anonymous callers never get here). The request goes through llm-client and llm-queue at "agent"
// priority; the SSE stream is passed through untouched. A client that leaves frees its slot at once.
import { once } from 'node:events';
import { LlmError } from './llm-client.js';

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('request body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const send = (res, status, obj) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export function createLlmProxy({ llm, queue, audit, modelId }) {
  async function chatCompletions(req, res, principal) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status ?? 400, { error: { message: e.status ? e.message : 'body must be JSON' } }); }
    if (!body || !Array.isArray(body.messages)) return send(res, 400, { error: { message: 'messages is required' } });

    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(new Error('client left')); });
    const started = Date.now();
    let outcome = 'ok';
    try {
      await queue.run('agent', async (signal) => {
        const { res: up, arm, done } = await llm.raw(body, { signal });
        try {
          res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache' });
          for await (const chunk of up.body) {
            arm();
            if (!res.write(chunk)) await once(res, 'drain');
          }
          res.end();
        } finally { done(); }
      }, { signal: ctl.signal });
    } catch (e) {
      outcome = ctl.signal.aborted ? 'client_left' : 'error';
      if (!res.headersSent) send(res, e instanceof LlmError && e.status ? 502 : 502, { error: { message: e instanceof LlmError ? e.message : 'model unavailable' } });
      else res.destroy();
    } finally {
      audit?.append({ component: 'llm-proxy', source: 'agent', target: principal?.machine ?? null, action: 'chat.completions', args: { messages: body.messages.length, tools: body.tools?.length ?? 0 }, decision: 'allow', outcome, durationMs: Date.now() - started }).catch(() => {});
    }
  }

  return {
    async handle(req, res, principal) {
      const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '');
      if (req.method === 'GET' && path === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: modelId, object: 'model', owned_by: 'jarvis' }] });
      if (req.method === 'POST' && path === '/v1/chat/completions') return chatCompletions(req, res, principal);
      return send(res, 404, { error: { message: 'not found' } });
    },
  };
}
