// Loads a model with given load settings and measures speed and memory. Settings that `lms load` has no flag for (KV cache type,
// MoE expert layers on CPU, batch size) are written into LM Studio's remembered per-model config, which a load reads.
//   node scripts/bench-speed.js --model qwen/qwen3-coder-30b --ctx 32768 [--kv q8_0|q4_0] [--cpuexp 0.29] [--batch 512] [--mtp 3] [--tag name]
// Originals are in docs/lmstudio-settings-backup-2026-10-25/; run with --restore to put them back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../server/core/config.js';

const CFG = path.join(os.homedir(), '.lmstudio', '.internal', 'user-concrete-model-default-config');
const FILES = { 'qwen/qwen3-coder-30b': 'qwen/qwen3-coder-30b.json', 'qwen3.8-27b': 'unsloth/Qwen3.8-27B-GGUF/Qwen3.8-27B-UD-Q3_K_XL.gguf.json', 'prism-ml/bonsai-27b': 'prism-ml/bonsai-27b.json' };
const BACKUP = path.join(ROOT, 'docs', 'lmstudio-settings-backup-2026-10-25');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const model = arg('--model', 'qwen/qwen3-coder-30b');
const file = path.join(CFG, FILES[model]);

if (process.argv.includes('--restore')) {
  fs.copyFileSync(path.join(BACKUP, path.basename(file)), file);
  console.log('restored', path.basename(file));
  process.exit(0);
}

const setField = (cfg, key, value) => { const f = cfg.load.fields.find((x) => x.key === key); if (f) f.value = value; else cfg.load.fields.push({ key, value }); };
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const kv = arg('--kv', null);
if (kv) for (const k of ['kCacheQuantizationType', 'vCacheQuantizationType']) setField(cfg, `llm.load.llama.${k}`, { checked: kv !== 'f16', value: kv });
if (arg('--cpuexp', null)) setField(cfg, 'llm.load.numCpuExpertLayersRatio', Number(arg('--cpuexp')));
if (arg('--batch', null)) setField(cfg, 'llm.load.llama.evalBatchSize', Number(arg('--batch')));
if (arg('--budget', null) !== null) { // thinking budget in tokens (0 = none): LM Studio applies it to API requests too, ending the thinking and starting the answer
  const b = Number(arg('--budget'));
  cfg.operation ??= { fields: [] };
  const f = cfg.operation.fields.find((x) => x.key === 'llm.prediction.reasoning.budgetTokens');
  const v = { checked: b > 0, value: b || 1024 };
  if (f) f.value = v; else cfg.operation.fields.push({ key: 'llm.prediction.reasoning.budgetTokens', value: v });
}
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));

const ctx = Number(arg('--ctx', 32768));
const mtp = Number(arg('--mtp', 0));
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 300_000 });
run('lms', ['unload', '--all']);
const t0 = Date.now();
const load = run('lms', ['load', model, '--context-length', String(ctx), '--gpu', 'max', '-y', ...(mtp ? ['--speculative-draft-mtp', '--speculative-draft-max-tokens', String(mtp)] : ['--no-speculative-draft-mtp'])]);
const loadSec = (Date.now() - t0) / 1000;
if (load.status !== 0) { console.log(JSON.stringify({ tag: arg('--tag', ''), error: (load.stderr || load.stdout).split('\n').slice(-4).join(' ').trim() })); process.exit(1); }
await new Promise((r) => setTimeout(r, 3000));
if (process.argv.includes('--load-only')) { console.log(`loaded ${model} ctx ${ctx} in ${loadSec.toFixed(0)} s`); process.exit(0); }

const gpu = () => { const r = run('powershell', ['-NoProfile', '-Command', "(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage','\\GPU Adapter Memory(*)\\Shared Usage').CounterSamples | Where-Object { $_.CookedValue -gt 1GB } | ForEach-Object { $_.Path.Split('\\')[-1] + '=' + [math]::Round($_.CookedValue/1GB,1) }"]); return r.stdout.trim().replace(/\r?\n/g, ' '); };
const memAfterLoad = `${gpu()} ramFreeGB=${(os.freemem() / 2 ** 30).toFixed(1)}`;

const think = model.includes('27b') ? { reasoning_effort: 'none' } : {};
const post = async (messages, max) => { const t = Date.now(); const r = await fetch('http://127.0.0.1:1234/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, max_tokens: max, temperature: 0.3, stream: false, ...think }) }); const j = await r.json(); return { j, sec: (Date.now() - t) / 1000 }; };
const gens = [];
for (const q of ['Write a JavaScript function that debounces another function, with a short explanation.', 'Write a Python class for a bounded queue with put, get and a size property. Add short comments.', 'Explain in detail how a binary heap works and write insert and extractMin in JavaScript.']) {
  const { j, sec } = await post([{ role: 'user', content: q }], 400);
  gens.push(j.usage.completion_tokens / sec);
}
const lines = []; const words = ['harbor', 'copper', 'meadow', 'signal', 'lantern', 'quartz', 'timber', 'ripple', 'summit', 'canyon'];
for (let i = 0; i < 600; i++) lines.push(`Log ${i + Date.now() % 997}: the ${words[i % 10]} unit number ${(i * 7919) % 10007} reported status ${words[(i * 3) % 10]} at shift ${i % 24}.`);
const p = await post([{ role: 'user', content: `${lines.join('\n')}\n\nHow many log lines are there? Answer with one number.` }], 20);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(JSON.stringify({ tag: arg('--tag', ''), model, ctx, kv: kv ?? 'unchanged', cpuexp: arg('--cpuexp', 'unchanged'), batch: arg('--batch', 'unchanged'), mtp, loadSec: Number(loadSec.toFixed(0)), genTokPerSec: Number(median(gens).toFixed(1)), genAll: gens.map((g) => Number(g.toFixed(1))), promptTokens: p.j.usage.prompt_tokens, promptTokPerSec: Math.round(p.j.usage.prompt_tokens / p.sec), memAfterLoad, memAfterPrompt: `${gpu()} ramFreeGB=${(os.freemem() / 2 ** 30).toFixed(1)}` }));
