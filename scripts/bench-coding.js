// Compares coding models on the same small, automatically graded tasks (about 3 to 5 minutes per model).
//   node scripts/bench-coding.js [--models "qwen3.8-27b,qwen/qwen3-coder-30b"] [--max-tokens 900] [--write]
// For each model: unload everything, load that model through LM Studio's native API (so two models never compete for VRAM), run
// three code tasks (the answer's code is run against hidden test cases in a child process with a time limit) and one tool-call task
// (valid calls, right names, right arguments). Score out of 100: 25 per task. Speed is reported next to it, not mixed into it.
// At the end the models that were loaded before are loaded again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, ROOT } from '../server/core/config.js';
import { createLlmClient } from '../server/core/llm-client.js';
import { isMain } from '../shared/util.js';

const SYSTEM = 'You are an expert JavaScript programmer. Reply with ONLY the complete code in a single ```js block, CommonJS (module.exports = ...), no explanation, no tests, no comments longer than one line.';

export const CODE_TASKS = [
  {
    name: 'parseDuration',
    prompt: 'Write parseDuration(str) that converts a duration string to milliseconds. Units: d, h, m, s, ms (case-insensitive), possibly several in a row and possibly separated by spaces, e.g. "1h30m", "1h 30m", "2d", "500ms", "1.5h". Return null for anything invalid: empty string, a number without a unit ("90"), unknown units ("5x"), stray text ("abc", "1h foo"). Export it as module.exports = { parseDuration }.',
    cases: [
      ['1h30m', (m) => m.parseDuration('1h30m') === 5400000], ['1h 30m', (m) => m.parseDuration('1h 30m') === 5400000], ['2d', (m) => m.parseDuration('2d') === 172800000],
      ['500ms', (m) => m.parseDuration('500ms') === 500], ['1.5h', (m) => m.parseDuration('1.5h') === 5400000], ['case', (m) => m.parseDuration('1H') === 3600000],
      ['1m30s500ms', (m) => m.parseDuration('1m30s500ms') === 90500], ['empty', (m) => m.parseDuration('') === null], ['no unit', (m) => m.parseDuration('90') === null],
      ['bad unit', (m) => m.parseDuration('5x') === null], ['stray', (m) => m.parseDuration('1h foo') === null], ['text', (m) => m.parseDuration('abc') === null],
    ],
  },
  {
    name: 'fix mergeIntervals',
    prompt: 'This function should merge overlapping or touching intervals ([1,3] and [3,5] touch, so they merge). It has bugs. Return the corrected full function, exported as module.exports = { mergeIntervals }. It must not modify its input.\n\n```js\nfunction mergeIntervals(list) {\n  list.sort();\n  const out = [list[0]];\n  for (let i = 1; i < list.length; i++) {\n    const last = out[out.length - 1];\n    if (list[i][0] < last[1]) last[1] = list[i][1];\n    else out.push(list[i]);\n  }\n  return out;\n}\n```',
    cases: [
      ['overlap', (m) => JSON.stringify(m.mergeIntervals([[1, 3], [2, 6], [8, 10]])) === '[[1,6],[8,10]]'], ['touching', (m) => JSON.stringify(m.mergeIntervals([[1, 3], [3, 5]])) === '[[1,5]]'],
      ['numeric sort', (m) => JSON.stringify(m.mergeIntervals([[10, 12], [2, 3], [1, 2]])) === '[[1,3],[10,12]]'], ['contained', (m) => JSON.stringify(m.mergeIntervals([[1, 10], [2, 3]])) === '[[1,10]]'],
      ['empty', (m) => JSON.stringify(m.mergeIntervals([])) === '[]'], ['single', (m) => JSON.stringify(m.mergeIntervals([[4, 5]])) === '[[4,5]]'],
      ['no mutation', (m) => { const a = [[5, 6], [1, 2]]; m.mergeIntervals(a); return JSON.stringify(a) === '[[5,6],[1,2]]'; }],
      ['no shared arrays', (m) => { const a = [[1, 3], [2, 4]]; const r = m.mergeIntervals(a); r[0][1] = 99; return a[0][1] === 3; }],
    ],
  },
  {
    name: 'LRUCache',
    prompt: 'Write a class LRUCache with a constructor(capacity), get(key) (returns undefined if missing and marks the key most recently used), put(key, value) (inserts or updates and marks most recent; when over capacity evicts the least recently used), and a size getter. Capacity 0 stores nothing. Export it as module.exports = { LRUCache }.',
    cases: [
      ['basic', (m) => { const c = new m.LRUCache(2); c.put('a', 1); c.put('b', 2); return c.get('a') === 1 && c.get('b') === 2 && c.size === 2; }],
      ['evicts oldest', (m) => { const c = new m.LRUCache(2); c.put('a', 1); c.put('b', 2); c.put('c', 3); return c.get('a') === undefined && c.get('c') === 3; }],
      ['get refreshes', (m) => { const c = new m.LRUCache(2); c.put('a', 1); c.put('b', 2); c.get('a'); c.put('c', 3); return c.get('b') === undefined && c.get('a') === 1; }],
      ['put refreshes', (m) => { const c = new m.LRUCache(2); c.put('a', 1); c.put('b', 2); c.put('a', 9); c.put('c', 3); return c.get('a') === 9 && c.get('b') === undefined; }],
      ['size stays bounded', (m) => { const c = new m.LRUCache(3); for (let i = 0; i < 10; i++) c.put(i, i); return c.size === 3; }],
      ['capacity zero', (m) => { const c = new m.LRUCache(0); c.put('a', 1); return c.get('a') === undefined && c.size === 0; }],
      ['falsy values', (m) => { const c = new m.LRUCache(2); c.put('z', 0); return c.get('z') === 0; }],
    ],
  },
];

const TOOLS = [
  { type: 'function', function: { name: 'set_volume', description: 'Set the system volume.', parameters: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['level'], additionalProperties: false } } },
  { type: 'function', function: { name: 'open_app', description: 'Open an application by its alias.', parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'], additionalProperties: false } } },
  { type: 'function', function: { name: 'lock_screen', description: 'Lock the screen.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
];

// Runs the answer's code against the cases in a child process (10 s limit). Returns { passed, total, error? }.
export function gradeCode(code, cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  try {
    fs.writeFileSync(path.join(dir, 'solution.cjs'), code);
    const harness = `const m = require('./solution.cjs'); const cases = ${JSON.stringify(cases.map((c) => [c[0], c[1].toString()]))}; let passed = 0; const failed = [];
for (const [name, src] of cases) { try { if ((0, eval)('(' + src + ')')(m)) passed++; else failed.push(name); } catch (e) { failed.push(name + ': ' + e.message); } }
console.log(JSON.stringify({ passed, total: cases.length, failed }));`;
    fs.writeFileSync(path.join(dir, 'run.cjs'), harness);
    const r = spawnSync(process.execPath, ['run.cjs'], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
    if (r.error || r.status !== 0) return { passed: 0, total: cases.length, error: (r.stderr || r.error?.message || 'did not run').split('\n').find((l) => /Error/.test(l)) ?? 'did not run', failed: ['all'] };
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
export const extractCode = (text) => { const m = text.match(/```(?:js|javascript|cjs)?\s*\n([\s\S]*?)```/); return (m ? m[1] : text).trim(); };

export function gradeTools(calls) {
  const vol = calls.find((c) => c.name === 'set_volume');
  const app = calls.find((c) => c.name === 'open_app');
  const parts = [
    ['set_volume called', !!vol], ['level is the integer 15', vol?.args?.level === 15], ['open_app called', !!app], ['app is spotify', /^spotify$/i.test(app?.args?.app ?? '')],
  ];
  const clean = calls.every((c) => c.args && !c.error) && !calls.some((c) => c.name === 'lock_screen');
  parts.push(['no malformed or unwanted calls', clean && calls.length > 0]);
  return { passed: parts.filter((p) => p[1]).length, total: parts.length, failed: parts.filter((p) => !p[1]).map((p) => p[0]) };
}

async function native(base, p, body) {
  const res = await fetch(`${base}/api/v1${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(`LM Studio ${p} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => null);
}
const loadedNow = async (base) => (await native(base, '/models')).models.filter((m) => m.type === 'llm').flatMap((m) => m.loaded_instances.map((i) => ({ key: m.key, id: i.id })));
async function useOnly(base, key, log) {
  for (const i of await loadedNow(base)) { if (i.key !== key) { log(`  unloading ${i.key}`); await native(base, '/models/unload', { instance_id: i.id }); } }
  if (!(await loadedNow(base)).some((i) => i.key === key)) { log(`  loading ${key} (this can take a minute)`); await native(base, '/models/load', { model: key }); }
}

export async function benchModel({ base, key, modelCfg, maxTokens, log }) {
  const t0 = Date.now();
  await useOnly(base, key, log);
  const loadSec = (Date.now() - t0) / 1000;
  const llm = createLlmClient({ config: { ...modelCfg, baseUrl: `${base}/v1`, modelId: key, requestTimeoutMs: 180_000 } });
  const tasks = [];
  const speeds = [];
  for (const t of CODE_TASKS) {
    log(`  ${t.name}...`);
    try {
      const r = await llm.chat({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: t.prompt }], use: 'chat', maxTokens });
      if (r.stats.tokensPerSec) speeds.push(r.stats.tokensPerSec);
      const g = r.truncated && !/```[\s\S]*```/.test(r.content) ? { passed: 0, total: t.cases.length, failed: ['answer cut off before the code ended'] } : gradeCode(extractCode(r.content), t.cases);
      tasks.push({ name: t.name, ...g, score: Math.round((g.passed / g.total) * 25), tokens: r.stats.completionTokens, sec: r.stats.ttftMs != null ? Number(((Date.now() - t0) / 1000).toFixed(0)) : null });
    } catch (e) { tasks.push({ name: t.name, passed: 0, total: t.cases.length, score: 0, failed: [`error: ${e.message}`] }); }
  }
  log('  tool calls...');
  try {
    const r = await llm.chat({ messages: [{ role: 'system', content: 'You control a computer with the tools provided. Use them; do not explain.' }, { role: 'user', content: 'Turn the volume down to 15 percent and open spotify.' }], tools: TOOLS, use: 'tools', maxTokens: 400 });
    if (r.stats.tokensPerSec) speeds.push(r.stats.tokensPerSec);
    const g = gradeTools(r.toolCalls);
    tasks.push({ name: 'tool calls', ...g, score: Math.round((g.passed / g.total) * 25) });
  } catch (e) { tasks.push({ name: 'tool calls', passed: 0, total: 5, score: 0, failed: [`error: ${e.message}`] }); }
  const avg = speeds.length ? Number((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1)) : null;
  return { key, total: tasks.reduce((s, t) => s + t.score, 0), tokensPerSec: avg, loadSec: Number(loadSec.toFixed(0)), minutes: Number(((Date.now() - t0) / 60000).toFixed(1)), tasks };
}

export const report = (results) => {
  const names = results[0].tasks.map((t) => t.name);
  const head = `| Model | Total /100 | ${names.join(' | ')} | Tokens/s |\n|---|---|${names.map(() => '---').join('|')}|---|`;
  const rows = results.map((r) => `| ${r.key} | **${r.total}** | ${r.tasks.map((t) => `${t.passed}/${t.total}`).join(' | ')} | ${r.tokensPerSec ?? 'n/a'} |`);
  const fails = results.flatMap((r) => r.tasks.filter((t) => t.failed?.length).map((t) => `- ${r.key}, ${t.name}: failed ${t.failed.join(', ')}`));
  const best = [...results].sort((a, b) => b.total - a.total);
  const verdict = best.length > 1 && best[0].total - best[1].total >= 8 ? `${best[0].key} is clearly better (${best[0].total} vs ${best[1].total}).` : best.length > 1 && best[0].total === best[1].total ? 'A tie on quality: take the faster one.' : `Close: ${best[0].key} ahead by ${best[0].total - (best[1]?.total ?? 0)} points; the speed difference may decide it.`;
  return `${head}\n${rows.join('\n')}\n\n${fails.length ? `Failures:\n${fails.join('\n')}\n\n` : 'No failures.\n\n'}Verdict: ${verdict}\n`;
};

if (isMain(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
  const cfg = loadConfig({ only: ['models.json'] });
  const base = cfg.models.baseUrl.replace(/\/v1\/?$/, '');
  const keys = arg('--models', 'qwen3.8-27b,qwen/qwen3-coder-30b').split(',').map((s) => s.trim());
  const maxTokens = Number(arg('--max-tokens', 900));
  const before = await loadedNow(base);
  const results = [];
  try {
    for (const key of keys) { console.log(`\n${key}`); results.push(await benchModel({ base, key, modelCfg: cfg.models, maxTokens, log: console.log })); }
  } finally {
    const want = before.map((i) => i.key);
    for (const k of want) { try { await useOnly(base, k, () => {}); } catch { /* best effort */ } }
  }
  const md = `# Coding benchmark ${new Date().toISOString().slice(0, 10)}\n\n${report(results)}`;
  console.log(`\n${md}`);
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(ROOT, 'docs', `bench-coding-${new Date().toISOString().slice(0, 10)}.md`), md);
}
