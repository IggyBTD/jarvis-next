// A fake OpenAI-compatible model server: streaming, tool calls, [DONE], finish_reason, reasoning deltas, and the failure
// modes the real clients must survive. Script the next replies with fake.script(...); every request body is recorded.
//   reply: { content, reasoning, think (inline <think> text), toolCalls: [{name, arguments}], inlineToolCall: {name, arguments},
//            chunk (characters per SSE event, default 4), delayMs, omitDone, omitFinish, splitLines (cut events in the middle),
//            status (HTTP error), hang, crashAfter (close the socket after n events), u2028, usage }
import http from 'node:http';

export async function startFakeModel({ port = 0 } = {}) {
  const requests = [];
  const queue = [];
  let defaultReply = (body) => ({ content: `echo: ${body.messages.at(-1)?.content ?? ''}` });
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'local', object: 'model' }, { id: 'unsloth/qwen3.8-27b', object: 'model' }] }));
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ body, headers: req.headers });
      const reply = queue.shift() ?? defaultReply(body);
      if (reply.status) { res.writeHead(reply.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: reply.message ?? 'fake failure' } })); }
      if (reply.hang) { res.writeHead(200, { 'content-type': 'text/event-stream' }); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = [];
      const delta = (d, finish = null) => events.push(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`);
      events.push(': keep-alive\n\n');
      delta({ role: 'assistant' });
      const slice = (text) => { const n = reply.chunk ?? 4; const out = []; for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n)); return out; };
      if (reply.reasoning) slice(reply.reasoning).forEach((t) => delta({ reasoning_content: t }));
      const text = `${reply.think ? `<think>${reply.think}</think>` : ''}${reply.content ?? ''}${reply.u2028 ? 'a b' : ''}${reply.inlineToolCall ? `<tool_call>${JSON.stringify(reply.inlineToolCall)}</tool_call>` : ''}`;
      slice(text).forEach((t) => delta({ content: t }));
      (reply.toolCalls ?? []).forEach((tc, i) => {
        const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {});
        delta({ tool_calls: [{ index: i, id: `call_${i}`, type: 'function', function: { name: tc.name, arguments: '' } }] });
        slice(args).forEach((t) => delta({ tool_calls: [{ index: i, function: { arguments: t } }] }));
      });
      if (!reply.omitFinish) delta({}, reply.toolCalls?.length ? 'tool_calls' : reply.length ? 'length' : 'stop');
      events.push(`data: ${JSON.stringify({ choices: [], usage: reply.usage ?? { prompt_tokens: 10, completion_tokens: Math.max(2, Math.ceil(text.length / 4)), total_tokens: 20 } })}\n\n`);
      if (!reply.omitDone) events.push('data: [DONE]\n\n');
      const wire = reply.splitLines ? events.join('').match(/[\s\S]{1,7}/g) : events;
      for (let i = 0; i < wire.length; i++) {
        if (res.destroyed) return;
        if (reply.crashAfter !== undefined && i >= reply.crashAfter) return res.destroy();
        res.write(wire[i]);
        if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      }
      res.end();
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    port: server.address().port,
    requests,
    script: (...replies) => queue.push(...replies),
    setDefault: (fn) => { defaultReply = fn; },
    close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(r); }),
  };
}
