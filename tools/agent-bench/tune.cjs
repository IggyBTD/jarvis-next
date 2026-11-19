// Speed + canary probe for one LM Studio load config. Usage: node tune.cjs <modelKey> '<json config>' [label]
// Appends a line to tune-results.jsonl. Speculative decoding is lossless in theory; the canary guards the rest.
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const BASE = 'http://localhost:1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => { const r = await fetch(`${BASE}/api/v1${p}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return JSON.parse(t); };
const vram = () => { try { return Number(execSync('powershell -NoProfile -File ' + path.join(__dirname, 'vram.ps1'), { encoding: 'utf8' }).trim()); } catch { return null; } };
async function load(key, cfg) {
  for (const m of (await api('/models')).models) for (const i of m.loaded_instances || []) await api('/models/unload', { instance_id: i.id });
  const t0 = Date.now(); const res = await api('/models/load', { model: key, echo_load_config: true, ...cfg });
  return { id: res.instance_id || key, loadS: (Date.now() - t0) / 1000, applied: res.load_config };
}
async function chat(id, prompt, maxTokens) {
  const t0 = Date.now(); let tFirst = null, text = '', usage = null;
  const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } }), signal: AbortSignal.timeout(600000) });
  let buf = ''; const dec = new TextDecoder();
  for await (const c of r.body) { buf += dec.decode(c, { stream: true }); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) { if (!l.startsWith('data: ') || l.includes('[DONE]')) continue; const d = JSON.parse(l.slice(6)); if (d.usage) usage = d.usage; const dl = d.choices?.[0]?.delta; if (dl && (dl.content || dl.reasoning_content)) { if (!tFirst) tFirst = Date.now(); text += dl.content || ''; } } }
  const t1 = Date.now(); const out = usage?.completion_tokens || 0;
  return { ttft: (tFirst - t0) / 1000, genTps: out / Math.max((t1 - tFirst) / 1000, 0.01), prompt: usage?.prompt_tokens, out, text };
}
const filler = fs.readFileSync(path.join(__dirname, 'tune.cjs'), 'utf8');
const CANARY = [
  ['function rle(s) returning run-length encoding like "aaabcc" -> "a3b1c2"', 'rle', [['aaabcc', 'a3b1c2'], ['', ''], ['z', 'z1']]],
  ['function isBalanced(s) true if brackets ()[]{} are balanced', 'isBalanced', [['([]{})', true], ['(]', false], ['', true], ['((', false]]],
  ['function lis(arr) length of longest strictly increasing subsequence', 'lis', [[[10, 9, 2, 5, 3, 7, 101, 18], 4], [[], 0], [[7, 7, 7], 1]]],
];
async function canary(id) {
  let pass = 0;
  for (const [desc, fn, cases] of CANARY) {
    const r = await chat(id, `/no_think Write a JavaScript ${desc}. Reply with only one code block, no commentary.`, 2500);
    const m = r.text.match(/```(?:js|javascript)?\n([\s\S]*?)```/); if (!m) continue;
    try { const f = new Function(m[1] + `; return ${fn};`)(); if (cases.every(([a, e]) => JSON.stringify(f(a)) === JSON.stringify(e))) pass++; } catch {}
  }
  return pass + '/' + CANARY.length;
}
(async () => {
  const [key, cfgJson, label] = process.argv.slice(2); const cfg = JSON.parse(cfgJson || '{}');
  const L = await load(key, cfg); const v = vram();
  await chat(L.id, 'hi', 8); // warm
  const runs = []; for (let i = 0; i < 3; i++) runs.push(await chat(L.id, `/no_think ${filler.slice(0, 6000)}\n\nWrite a detailed JavaScript implementation of an LRU cache class with get, set, delete, size, and unit tests.`, 400));
  const avg = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  const row = { label, key: key.slice(0, 20), cfg, loadS: L.loadS, vramGB: v && +v.toFixed(2), promptTok: runs[0].prompt, ttft: +avg('ttft').toFixed(2), genTps: +avg('genTps').toFixed(2), canary: process.env.NOCANARY ? null : await canary(L.id) };
  fs.appendFileSync(path.join(__dirname, 'tune-results.jsonl'), JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
})().catch((e) => { console.error(e.message); process.exit(1); });
