// Measures the model through llm-client (the same path the server uses): time to first token and tokens per second at a
// few prompt sizes. Run it on the PC with the model loaded. Real numbers are a human step (HUMAN_TODO.md section 2).
//   node scripts/bench-model.js [--label "rocm mtp-off"] [--runs 3] [--write] [--check-thinking]
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../server/core/config.js';
import { createLlmClient } from '../server/core/llm-client.js';
import { isMain } from '../shared/util.js';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i === -1 ? fallback : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1] ?? true); };

export async function bench({ llm, runs = 3, log = console.log }) {
  const filler = (n) => 'The quick brown fox jumps over the lazy dog. '.repeat(n);
  const cases = [['short prompt', 'Count from one to thirty in words, comma separated.'], ['2k-token prompt', `${filler(180)}\nSummarise the text above in two sentences.`], ['8k-token prompt', `${filler(720)}\nSummarise the text above in two sentences.`]];
  const rows = [];
  for (const [name, prompt] of cases) {
    const t = [];
    const s = [];
    for (let i = 0; i < runs; i++) {
      const r = await llm.chat({ messages: [{ role: 'user', content: prompt }], use: 'chat', maxTokens: 200 });
      if (r.stats.ttftMs != null) t.push(r.stats.ttftMs);
      if (r.stats.tokensPerSec) s.push(r.stats.tokensPerSec);
    }
    const avg = (a) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)) : null);
    rows.push({ name, ttftMs: avg(t), tokensPerSec: avg(s) });
    log(`${name}: first token ${avg(t)} ms, ${avg(s)} tok/s`);
  }
  return rows;
}

// Does the thinking switch actually suppress thinking on this backend? Prints the verdict and the setting to change.
export async function checkThinking({ llm, log = console.log }) {
  const off = await llm.chat({ messages: [{ role: 'user', content: 'What is 17 times 23? Answer with the number only.' }], use: 'chat', maxTokens: 400 });
  const leaked = off.reasoning.length > 0 || /<think>/.test(off.content);
  log(leaked ? 'Thinking is still on with the current thinkingMethod. Try "no_think" in config/server/models.json.' : 'Thinking is off for chat requests. Good.');
  return !leaked;
}

if (isMain(import.meta.url)) {
  if (arg('--help')) { console.log('node scripts/bench-model.js [--label text] [--runs n] [--write] [--check-thinking]'); process.exit(0); }
  const cfg = loadConfig({ only: ['models.json'] });
  const llm = createLlmClient({ config: cfg.models });
  const health = await llm.health();
  if (!health.reachable) { console.error(`Model server not reachable: ${health.error}. Load the model on the PC first.`); process.exit(1); }
  if (arg('--check-thinking')) process.exit((await checkThinking({ llm })) ? 0 : 2);
  const rows = await bench({ llm, runs: Number(arg('--runs', 3)) });
  if (arg('--write')) {
    const file = path.join(ROOT, 'docs', 'benchmarks.md');
    const line = `\n### ${new Date().toISOString().slice(0, 10)} ${arg('--label', 'unlabelled')}\n\n| Case | First token (ms) | Tokens per second |\n|---|---|---|\n${rows.map((r) => `| ${r.name} | ${r.ttftMs} | ${r.tokensPerSec} |`).join('\n')}\n`;
    fs.appendFileSync(file, line);
    console.log(`Appended to ${path.relative(process.cwd(), file)}`);
  }
}
