import http from 'node:http';
const loaded = new Set(['qwen/qwen3-14b']);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d ? JSON.parse(d) : {})); });
const RICH = `## Results

Here is the comparison you asked for. The **27B** model is slower but more accurate on long edits, and $E = mc^2$ still holds.

| Model | Speed | Score |
|---|---|---|
| qwen3-14b | 48 t/s | 71 |
| qwen3.8-27b | 22 t/s | 83 |

1. Load the model.
2. Run the suite.

\`\`\`python
def ttft(samples):
    return sum(samples) / len(samples)  # mean
\`\`\`

> Measured on the RX 9070 with 32K context.

<jarvis-artifact id="speed-chart" type="chart" title="Speed by model">
{"type":"bar","data":{"labels":["14B","27B"],"datasets":[{"label":"t/s","data":[48,22]}]},"options":{}}
</jarvis-artifact>
I put the numbers in a chart.`;
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const json = (o) => { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/v1/models') return json({ models: ['qwen/qwen3-14b', 'qwen/qwen3.8-27b'].map((key) => ({ key, type: 'llm', quantization: { name: 'Q4_K_M' }, max_context_length: 32768, loaded_instances: loaded.has(key) ? [{ id: key, config: { context_length: 32768 } }] : [] })) });
  if (req.url === '/api/v1/models/load') { const b = await body(req); loaded.clear(); loaded.add(b.model); return json({}); }
  if (req.url === '/api/v1/models/unload') { const b = await body(req); loaded.delete(b.instance_id); return json({}); }
  if (req.url === '/v1/chat/completions') {
    const b = await body(req);
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    const send = (d) => res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
    const end = () => { res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5400, completion_tokens: 320 } })}\n\n`); res.end('data: [DONE]\n\n'); };
    const lastUser = b.messages.map((m) => m.role).lastIndexOf('user');
    const text = JSON.stringify(b.messages[lastUser].content);
    const done = b.messages.slice(lastUser + 1).filter((m) => m.role === 'tool').length;
    if (/agent job/.test(text)) {
      const calls = [['read_file', { path: 'src/main.js' }], ['edit_file', { path: 'src/main.js', old_text: 'const b = 2;', new_text: 'const b = 3;' }], ['run_command', { command: 'npm test -- --watch=false > out.txt' }]];
      if (done < calls.length) { send({ tool_calls: [{ index: 0, id: 'c' + done, function: { name: calls[done][0], arguments: JSON.stringify(calls[done][1]) } }] }); return end(); }
      send({ content: 'Changed `b` to 3 and the tests pass.' }); return end();
    }
    if (/demo/.test(text)) { send({ reasoning_content: 'The user wants a comparison. I will build a table and a chart.' }); for (const part of RICH.match(/[\s\S]{1,80}/g)) send({ content: part }); return end(); }
    send({ content: 'Sure.' }); return end();
  }
  res.writeHead(404, cors); res.end();
}).listen(1234, () => console.log('mock 1234'));
