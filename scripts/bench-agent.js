// Agent benchmark: the real OpenCode CLI works on small repos (scripts/bench-agent-tasks.js) against the model in LM Studio.
// A logging proxy sits between them and applies each variant's request settings (reasoning effort, sampling, system line, thinking budget).
//   node scripts/bench-agent.js --variants coder,27b-none [--tasks fix-cart,fix-lru] [--reps 2] [--timeout 480] [--write name]
// Score per run = tests passed (visible + hidden) / total. Hidden tests are written after the agent stops.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { AGENT_TASKS } from './bench-agent-tasks.js';

const UP = 'http://127.0.0.1:1234/v1';
const PORT = 1236;
const OPENCODE = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
const CODER = { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1.05 };
const Q27 = { temperature: 0.3, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0, repeat_penalty: 1 };
const C = (model, load = []) => ({ model, load, body: {}, budgetTokens: 0, addendum: '' });
const BRIEF = 'Think briefly: check key assumptions, then act. Do not enumerate alternatives you will not use.';
export const VARIANTS = {
  coder: { ...C('qwen/qwen3-coder-30b', ['--kv', 'q8_0', '--cpuexp', '0.2917', '--batch', '1024']), body: CODER },
  'coder-fast': { ...C('qwen/qwen3-coder-30b', ['--kv', 'q8_0', '--cpuexp', '0.2', '--batch', '1024']), body: CODER },
  '27b-none-nomtp': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0']), body: { ...Q27, reasoning_effort: 'none' } },
  '27b-none': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0', '--mtp', '2']), body: { ...Q27, reasoning_effort: 'none' } },
  '27b-low': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0']), body: { ...Q27, temperature: 0.6, reasoning_effort: 'low' } },
  '27b-medium': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0']), body: { ...Q27, temperature: 0.6, reasoning_effort: 'medium' } },
  '27b-low-brief': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0']), body: { ...Q27, temperature: 0.6, reasoning_effort: 'low' }, addendum: BRIEF },
  // Thinking left on; LM Studio's own thinking budget (set in the model's default settings at load, bench-speed --budget) ends it after N tokens.
  '27b-b1000': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0', '--mtp', '2', '--budget', '1000']), body: { ...Q27, temperature: 0.6 } },
  '27b-b2000': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0', '--mtp', '2', '--budget', '2000']), body: { ...Q27, temperature: 0.6 } },
  '27b-b4000': { ...C('unsloth/qwen3.8-27b', ['--kv', 'q8_0', '--mtp', '2', '--budget', '4000']), body: { ...Q27, temperature: 0.6 } },
};
for (const k of ['coder', 'coder-fast', '27b-none-nomtp', '27b-none']) VARIANTS[k].load.push('--budget', '0');

for (const [k, v] of Object.entries(VARIANTS)) if (/^27b-(low|medium|budget)/.test(k)) v.load = [...v.load, '--mtp', '2']; // MTP doubles the 27B's speed (docs/bench-speed)
let V = VARIANTS.coder;
const fresh = () => ({ requests: 0, completionTokens: 0, reasoningChars: 0, forced: 0, upstreamMs: 0 });
let stats = fresh();

// Streams one chat request to LM Studio and on to OpenCode. With a thinking budget, a request that has thought for more than
// budgetTokens (about 3.5 characters each) without starting its answer is cut off and sent again with thinking off.
async function relay(body, res) {
  stats.requests++;
  let started = false;
  const start = () => { if (!started) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); started = true; } };
  let attempt = body;
  let budgetChars = V.budgetTokens * 3.5;
  for (;;) {
    const ctl = new AbortController();
    const t0 = Date.now();
    const up = await fetch(`${UP}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(attempt), signal: ctl.signal });
    if (!up.ok) { const text = await up.text(); if (!started) { res.writeHead(up.status, { 'content-type': 'application/json' }); started = true; } res.end(text); return; }
    start();
    const dec = new TextDecoder();
    let buf = '', rChars = 0, sawOutput = false, cut = false, done = false;
    for await (const chunk of up.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = ev.startsWith('data:') ? ev.slice(5).trim() : '';
        if (data === '[DONE]') { done = true; continue; }
        let j; try { j = JSON.parse(data); } catch { res.write(`${ev}\n\n`); continue; }
        const d = j.choices?.[0]?.delta;
        const r = d?.reasoning_content ?? d?.reasoning;
        if (r) rChars += r.length;
        if (d?.content || d?.tool_calls?.length) sawOutput = true;
        if (j.usage) stats.completionTokens += j.usage.completion_tokens ?? 0;
        res.write(`${ev}\n\n`);
        if (budgetChars && !sawOutput && rChars > budgetChars) { cut = true; break; }
      }
      if (cut) { ctl.abort(); break; }
    }
    stats.reasoningChars += rChars; stats.upstreamMs += Date.now() - t0;
    if (cut) { stats.forced++; attempt = { ...body, reasoning_effort: 'none' }; budgetChars = 0; continue; }
    res.write('data: [DONE]\n\n'); res.end(); return;
  }
}

export function startProxy() {
  const server = http.createServer(async (req, res) => {
    try {
      const parts = []; for await (const c of req) parts.push(c);
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
      const body = { ...JSON.parse(Buffer.concat(parts).toString('utf8')), ...V.body, model: V.model };
      if (V.addendum) { const m = body.messages ?? []; const i = m.findIndex((x) => x.role === 'system'); if (i !== -1 && typeof m[i].content === 'string') m[i] = { ...m[i], content: `${m[i].content}\n\n${V.addendum}` }; }
      if (body.stream) { body.stream_options = { ...body.stream_options, include_usage: true }; await relay(body, res); return; }
      stats.requests++;
      const up = await fetch(`${UP}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await up.text();
      try { stats.completionTokens += JSON.parse(text).usage?.completion_tokens ?? 0; } catch { /* ignore */ }
      res.writeHead(up.status, { 'content-type': 'application/json' }); res.end(text);
    } catch (e) { try { res.writeHead(502); res.end(String(e.message)); } catch { /* already closed */ } }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const countTests = (files) => Object.entries(files).filter(([f]) => /\.test\.js$/.test(f)).reduce((n, [, s]) => n + (s.match(/^test\(/gm) ?? []).length, 0);
const write = (dir, files) => { for (const [f, s] of Object.entries(files)) { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); } };
const cleanEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; }; // a test run inside a test run is skipped otherwise
export function gradeDir(dir, task) {
  // Only the task's own tests count: tests the agent added or edited are replaced by the originals (plus the reference's edited tests, e.g. a rename) so extra tests cannot hide a failure.
  const isTest = (f) => /\.test\.js$/.test(f);
  const official = { ...Object.fromEntries(Object.entries(task.files).filter(([f]) => isTest(f))), ...Object.fromEntries(Object.entries(task.solution ?? {}).filter(([f]) => isTest(f))), ...task.hidden };
  for (const d of ['test', 'test-hidden']) { const p = path.join(dir, d); if (fs.existsSync(p)) for (const f of fs.readdirSync(p)) if (isTest(f) && !(`${d}/${f}` in official)) fs.rmSync(path.join(p, f)); }
  write(dir, official);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/*.test.js', 'test-hidden/*.test.js'], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: cleanEnv() });
  const pass = Number((r.stdout.match(/^# pass (\d+)/m) ?? [])[1] ?? 0);
  return { passed: pass, total: countTests(official) };
}

const config = (ctx) => ({
  $schema: 'https://opencode.ai/config.json', model: 'lms/agent',
  provider: { lms: { npm: '@ai-sdk/openai-compatible', name: 'LM Studio bench', options: { baseURL: `http://127.0.0.1:${PORT}/v1`, apiKey: 'x' }, models: { agent: { name: 'agent', limit: { context: ctx, output: 8192 } } } } },
  permission: { bash: { '*': 'deny', 'node *': 'allow', 'npm test*': 'allow', 'ls*': 'allow', 'dir*': 'allow', 'cat *': 'allow', 'type *': 'allow' }, edit: { '*': 'allow' }, webfetch: 'deny', external_directory: 'deny', doom_loop: 'deny' },
  formatter: false, lsp: false, share: 'disabled', autoupdate: false,
});

export async function runTask(task, timeoutSec, ctx, keepDir = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-${task.id}-`));
  write(dir, task.files);
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(config(ctx), null, 2));
  stats = fresh();
  const t0 = Date.now();
  const child = spawn(OPENCODE, ['run', '--pure', '--dir', dir, '--model', 'lms/agent', '--format', 'json', task.prompt], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timedOut = await new Promise((resolve) => {
    const t = setTimeout(() => { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); resolve(true); }, timeoutSec * 1000);
    child.on('exit', () => { clearTimeout(t); resolve(false); });
  });
  const sec = (Date.now() - t0) / 1000;
  const grade = gradeDir(dir, task);
  const toolCalls = new Set([...out.matchAll(/"callID":"([^"]+)"/g)].map((m) => m[1])).size;
  const result = { task: task.id, sec: Number(sec.toFixed(0)), timedOut, ...grade, score: grade.total ? grade.passed / grade.total : 0, toolCalls, ...stats, reasoningTokens: Math.round(stats.reasoningChars / 3.5), log: out.slice(-1500) };
  if (!keepDir) fs.rmSync(dir, { recursive: true, force: true }); else result.dir = dir;
  return result;
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
if (isMain(import.meta.url)) {
  const names = arg('--variants', 'coder,27b-none').split(',');
  const taskIds = arg('--tasks', AGENT_TASKS.map((t) => t.id).join(',')).split(',');
  const reps = Number(arg('--reps', 2));
  const timeoutSec = Number(arg('--timeout', 480));
  const ctx = Number(arg('--ctx', 32768));
  const server = await startProxy();
  const rows = [];
  for (const name of names) {
    V = VARIANTS[name];
    console.log(`\n== ${name}: loading`);
    const ld = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'bench-speed.js'), '--model', V.model, '--ctx', String(ctx), ...V.load, '--load-only'], { encoding: 'utf8', timeout: 400_000 });
    console.log(ld.stdout.trim() || ld.stderr.trim());
    const runs = [];
    for (let r = 1; r <= reps; r++) for (const id of taskIds) {
      const res = await runTask(AGENT_TASKS.find((t) => t.id === id), timeoutSec, ctx);
      runs.push(res);
      console.log(`  ${id} rep ${r}: ${res.passed}/${res.total} tests, ${res.sec} s, ${res.requests} requests, ${res.toolCalls} tool calls, ~${res.reasoningTokens} thinking tokens${res.forced ? `, ${res.forced} cut` : ''}${res.timedOut ? ', TIMED OUT' : ''}`);
    }
    const mean = (k) => runs.reduce((s, x) => s + x[k], 0) / runs.length;
    rows.push({ name, score: 100 * mean('score'), perfect: runs.filter((x) => x.score === 1).length, runs: runs.length, sec: mean('sec'), requests: mean('requests'), toolCalls: mean('toolCalls'), tokens: mean('completionTokens'), reasoning: mean('reasoningTokens'), timeouts: runs.filter((x) => x.timedOut).length, forced: runs.reduce((s, x) => s + x.forced, 0), detail: runs });
  }
  server.close();
  const md = `# Agent benchmark (OpenCode ${spawnSync(OPENCODE, ['--version'], { encoding: 'utf8' }).stdout.trim()}) ${new Date().toISOString().slice(0, 10)}\n\n| Variant | Mean score /100 | Fully passed | Mean seconds per task | Mean requests | Mean tool calls | Mean completion tokens | Mean thinking tokens | Timeouts |\n|---|---|---|---|---|---|---|---|---|\n${rows.map((r) => `| ${r.name} | **${r.score.toFixed(1)}** | ${r.perfect}/${r.runs} | ${r.sec.toFixed(0)} | ${r.requests.toFixed(1)} | ${r.toolCalls.toFixed(1)} | ${r.tokens.toFixed(0)} | ${r.reasoning.toFixed(0)} | ${r.timeouts} |`).join('\n')}\n\nPer run:\n${rows.flatMap((r) => r.detail.map((x) => `- ${r.name}, ${x.task}: ${x.passed}/${x.total} tests, ${x.sec} s${x.timedOut ? ' (timed out)' : ''}`)).join('\n')}\n`;
  console.log(`\n${md}`);
  const w = arg('--write', null);
  if (w) fs.writeFileSync(path.join(ROOT, 'docs', `bench-agent-${w}.md`), md);
}
