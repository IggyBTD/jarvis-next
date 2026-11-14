// Max usable context per model at equal settings: load at growing context, fill ~85% with a prompt, measure speed.
// Usage: node maxctx.cjs <base|ft> ; appends to maxctx-results.jsonl
const fs = require('fs'), path = require('path');
const BASE = 'http://localhost:1234';
const KEYS = { base: 'qwen3.8-27b', ft: 'qwen3.8-27b-turbo-fable-cold-fusion-735-882-heretic-uncensored-neo-coder-max-mtp' };
const LOAD = { base: { flash_attention: true }, ft: { flash_attention: true, speculative_draft_mtp: true, speculative_draft_max_tokens: 2, speculative_draft_min_continue_probability: 0.4 } };
const api = async (p, body) => { const r = await fetch(`${BASE}/api/v1${p}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 300)); return JSON.parse(t); };
const alias = process.argv[2], key = KEYS[alias]; if (process.env.NOMTP) LOAD.ft = { flash_attention: true, speculative_draft_mtp: false }; const LIST = (process.env.CTXS || '16384,49152,65536,98304,131072,196608,262144').split(',').map(Number); const TAG = process.env.NOMTP ? alias + '-nomtp' : alias;
const text = fs.readFileSync(path.join(__dirname, 'tune.cjs'), 'utf8') + fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8');
async function chat(id, prompt) {
  const t0 = Date.now(); let tFirst = null, usage = null; const dec = new TextDecoder(); let buf = '';
  const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 200, stream: true, stream_options: { include_usage: true } }), signal: AbortSignal.timeout(900000) });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  for await (const c of r.body) { buf += dec.decode(c, { stream: true }); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) { if (!l.startsWith('data: ') || l.includes('[DONE]')) continue; const d = JSON.parse(l.slice(6)); if (d.usage) usage = d.usage; const dl = d.choices?.[0]?.delta; if (dl && (dl.content || dl.reasoning_content) && !tFirst) tFirst = Date.now(); } }
  const t1 = Date.now(); return { ttft: (tFirst - t0) / 1000, prompt: usage?.prompt_tokens, tps: (usage?.completion_tokens || 0) / Math.max((t1 - tFirst) / 1000, 0.01) };
}
(async () => {
  let ref = null;
  for (const C of LIST) {
    const row = { model: TAG, ctx: C };
    try {
      for (const m of (await api('/models')).models) for (const i of m.loaded_instances || []) await api('/models/unload', { instance_id: i.id });
      const t0 = Date.now(); await api('/models/load', { model: key, context_length: C, ...LOAD[alias] }); row.loadS = (Date.now() - t0) / 1000;
      const words = Math.floor(C * 0.8 / 1.3); const body = (text.repeat(Math.ceil(words * 6 / text.length) + 1)).slice(0, Math.floor(C * 0.8 * 3.2));
      const r = await chat(key, `/no_think ${body}\n\nIn one sentence, what is this text?`);
      Object.assign(row, { promptTok: r.prompt, ttft: +r.ttft.toFixed(1), tps: +r.tps.toFixed(1) });
      if (!ref) ref = r.tps; row.ok = r.tps >= ref * 0.5;
    } catch (e) { row.ok = false; row.error = String(e.message).slice(0, 200); }
    fs.appendFileSync(path.join(__dirname, 'maxctx-results.jsonl'), JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
    if (!row.ok) break;
  }
})();
