// Fake LM Studio: native model API plus a scripted /v1/chat/completions.
import http from 'node:http';
const loaded = new Set();
const requests = [];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const models = () => ({ models: ['qwen/qwen3-14b', 'qwen/qwen3.8-27b'].map((key) => ({ key, type: 'llm', loaded_instances: loaded.has(key) ? [{ id: key }] : [] })) });
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})); });
const sse = (res, deltas) => { res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' }); for (const d of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`); res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`); res.end('data: [DONE]\n\n'); };
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const json = (o) => { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/v1/models') return json(models());
  if (req.url === '/api/v1/models/unload') { const b = await body(req); loaded.delete(b.instance_id); return json({}); }
  if (req.url === '/api/v1/models/load') { const b = await body(req); loaded.add(b.model); return json({}); }
  if (req.url === '/__requests') return json(requests);
  if (req.url === '/v1/chat/completions') {
    const b = await body(req);
    requests.push({ model: b.model, tools: (b.tools || []).map((t) => t.function.name), last: b.messages.at(-1), count: b.messages.length });
    const msgs = b.messages;
    const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
    const done = msgs.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
    const text = String(msgs[lastUser].content);
    const call = (name, args, i) => sse(res, [{ tool_calls: [{ index: 0, id: `t${lastUser}_${i}`, function: { name, arguments: JSON.stringify(args) } }] }]);
    const SCRIPTS = {
      edit: [['read_file', { path: 'src/main.js' }], ['edit_file', { path: 'src/main.js', old_text: 'const b = 2;', new_text: 'const b = 3;\nconst c = 4;' }]],
      run: [['run_command', { command: 'git status' }], ['run_command', { command: 'npm test' }], ['run_command', { command: 'rm -rf /' }], ['list_dir', {}]],
      always: [['run_command', { command: 'cargo test --lib' }]],
      loop: Array.from({ length: 30 }, (_, i) => ['list_dir', { path: '.' }]),
      newfile: [['write_file', { path: 'notes/todo.md', content: '# Todo\n- one\n' }], ['search_files', { pattern: 'const' }], ['close_panel', { id: 'nope' }]],
    };
    const key = Object.keys(SCRIPTS).find((k) => new RegExp(`\\b${k}\\b`).test(text));
    if (key) {
      const step = SCRIPTS[key][done];
      if (step) return call(step[0], step[1], done);
      return sse(res, [{ content: `Finished ${key} after ${done} calls.` }]);
    }
    if (/coding model/.test(text) && done === 0) return sse(res, [{ tool_calls: [{ index: 0, id: 'c1', function: { name: 'switch_model', arguments: '{"mode":"coding"}' } }] }]);
    if (done > 0) return sse(res, [{ content: 'Done.' }]);
    return sse(res, [{ content: 'plain answer' }]);
  }
  res.writeHead(404, cors); res.end();
}).listen(1234, () => console.log('mock lms up'));
