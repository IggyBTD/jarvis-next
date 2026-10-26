// Tunes the 27B's request settings on the hard suite: reasoning effort, brevity line, sampling, output cap.
//   node scripts/bench-tune.js [--only none,low,low+brief] [--reps 3] [--task-timeout 300] [--model qwen3.8-27b] [--write]
// Load settings (context, KV cache, MTP) are LM Studio's; this only varies what each request sends.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../server/core/config.js';
import { benchModel } from './bench-coding.js';
import { HARD_TASKS } from './bench-hard-tasks.js';

const BALANCED = { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1 };
const INSTRUCT = { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 };
const BRIEF = 'Think briefly: check key assumptions, then answer. Do not enumerate alternatives you will not use.';
const SYNTAX = 'Before you reply, check the file is valid JavaScript that runs as written: define every function with a normal declaration before assigning module.exports, and make sure every promise settles.';
const v = (name, effort, o = {}) => ({ name, effort, sampling: BALANCED, addendum: '', maxTokens: 32000, ...o });
const VARIANTS = [
  v('none', 'none'), v('low', 'low'), v('medium', 'medium'),
  v('low+brief', 'low', { addendum: BRIEF }), v('medium+brief', 'medium', { addendum: BRIEF }),
  v('on', 'on', { sampling: { ...BALANCED } }), // thinking left on: the request says nothing, LM Studio's thinking budget (bench-speed --budget) decides
  v('none+brief', 'none', { addendum: BRIEF }),
  v('none+syntax', 'none', { addendum: SYNTAX, sampling: { ...BALANCED, temperature: 0.3 } }),
  v('none+temp0.3', 'none', { sampling: { ...BALANCED, temperature: 0.3 } }),
  v('low+instruct', 'low', { sampling: INSTRUCT }),
  v('low+cap4k', 'low', { maxTokens: 4000 }), v('low+cap8k', 'low', { maxTokens: 8000 }), v('medium+cap8k', 'medium', { maxTokens: 8000 }),
];

const VENDOR = { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1.05 };
const CHECK = 'Before writing the code, make sure it satisfies every requirement and edge case in the task. Reply with the complete file in one block.';
const c = (name, o = {}) => ({ name, effort: null, sampling: VENDOR, addendum: '', maxTokens: 32000, ...o });
const CODER_VARIANTS = [
  c('c-base'), c('c-temp0.3', { sampling: { ...VENDOR, temperature: 0.3 } }), c('c-temp0.5', { sampling: { ...VENDOR, temperature: 0.5 } }),
  c('c-rep1.0', { sampling: { ...VENDOR, repeat_penalty: 1 } }), c('c-check', { addendum: CHECK }),
  c('c-temp0.3+check', { sampling: { ...VENDOR, temperature: 0.3 }, addendum: CHECK }),
];

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const key = arg('--model', 'unsloth/qwen3.8-27b');
const reps = Number(arg('--reps', 2));
const taskTimeoutMs = Number(arg('--task-timeout', 120)) * 1000;
const only = arg('--only', null)?.split(',');
const isCoder = /coder/i.test(key);
const pool = isCoder ? CODER_VARIANTS : VARIANTS;
const picked = only ? pool.filter((x) => only.includes(x.name)) : pool;
const cfg = loadConfig({ only: ['models.json'] });
const base = cfg.models.baseUrl.replace(/\/v1\/?$/, '');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

const rows = [];
for (const x of picked) {
  const profile = x.effort === 'on' ? { thinkingMethod: 'no_think', thinking: { chat: true, tools: true, digest: true, agent: true }, sampling: x.sampling } : x.effort ? { thinkingMethod: 'request_field', thinking: { chat: x.effort, tools: x.effort, digest: x.effort, agent: x.effort }, sampling: x.sampling } : { sampling: x.sampling };
  const totals = []; const secs = []; const toks = []; const fails = [];
  for (let r = 1; r <= reps; r++) {
    console.log(`\n${x.name} rep ${r}/${reps}`);
    const res = await benchModel({ base, key, modelCfg: cfg.models, maxTokens: x.maxTokens, taskTimeoutMs, log: () => {}, tasks: HARD_TASKS, codeWeight: 16, toolWeight: 20, profile, addendum: x.addendum });
    const code = res.tasks.filter((t) => t.sec !== undefined);
    totals.push(res.total); secs.push(...code.map((t) => t.sec)); toks.push(...code.map((t) => t.tokens ?? 0));
    fails.push(...res.tasks.filter((t) => t.failed?.length).map((t) => `${t.name}: ${t.failed.join(', ')}`));
    console.log(`  total ${res.total}  median ${median(code.map((t) => t.sec)).toFixed(0)} s/task  ${res.tokensPerSec} tok/s`);
    if (res.total < 40) { console.log('  timing out on most tasks; skipping the remaining repeats'); break; }
  }
  rows.push({ name: x.name, mean: mean(totals), min: Math.min(...totals), max: Math.max(...totals), sec: median(secs), tokens: mean(toks), runs: totals, fails });
}

const adj = (r) => r.mean * Math.min(1, 60 / Math.max(r.sec, 1));
const md = `# ${isCoder ? 'Coder' : '27B'} tuning ${new Date().toISOString().slice(0, 10)} (${reps} reps, hard suite, ${key})\n\n| Variant | Mean /100 | Min | Max | Median s per code task | Mean tokens per task | Time-adjusted |\n|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r.name} | **${r.mean.toFixed(1)}** | ${r.min} | ${r.max} | ${r.sec.toFixed(0)} | ${r.tokens.toFixed(0)} | ${adj(r).toFixed(1)} |`).join('\n')}\n\nRuns: ${rows.map((r) => `${r.name} [${r.runs.join(', ')}]`).join('; ')}\n\nFailures:\n${rows.flatMap((r) => r.fails.map((f) => `- ${r.name}, ${f}`)).join('\n') || 'none'}\n`;
console.log(`\n${md}`);
if (process.argv.includes('--write')) fs.writeFileSync(path.join(ROOT, 'docs', `tune-${isCoder ? 'coder' : '27b'}-${new Date().toISOString().slice(0, 10)}${only ? `-${only.join('_').replace(/\W/g, '')}` : ''}.md`), md);
