// Which request settings shorten the 27B's thinking? Streams one hard prompt per variant and records how much it thinks before it starts answering.
//   node scripts/probe-think-limit.js [--cap 80] [--only name,name]
// A variant that has not started answering after --cap seconds is cut off and reported as "still thinking".
import { HARD_TASKS } from './bench-hard-tasks.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const cap = Number(arg('--cap', 80)) * 1000;
const only = arg('--only', null)?.split(',');
const model = 'unsloth/qwen3.8-27b';
const prompt = HARD_TASKS.find((t) => t.name.startsWith('topoSort')).prompt;
const SYS = 'You are an expert JavaScript programmer. Reply with ONLY the complete code in a single ```js block, CommonJS, no explanation.';
const BRIEF = ' Think briefly: check key assumptions, then answer. Do not enumerate alternatives you will not use.';
const base = { temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0 };
const V = [
  ['default', {}],
  ['effort low', { reasoning_effort: 'low' }],
  ['effort medium', { reasoning_effort: 'medium' }],
  ['reasoning_budget 800', { reasoning_budget: 800 }],
  ['thinking_budget 800', { thinking_budget: 800 }],
  ['kwargs thinking_budget 800', { chat_template_kwargs: { thinking_budget: 800 } }],
  ['max_reasoning_tokens 800', { max_reasoning_tokens: 800 }],
  ['reasoning object', { reasoning: { max_tokens: 800 } }],
  ['low + brief line', { reasoning_effort: 'low' }, BRIEF],
  ['medium + brief line', { reasoning_effort: 'medium' }, BRIEF],
  ['default + brief line', {}, BRIEF],
];

for (const [name, extra, addendum = ''] of V) {
  if (only && !only.includes(name)) continue;
  const ctl = new AbortController();
  const t0 = Date.now();
  const timer = setTimeout(() => ctl.abort(), cap);
  let rChars = 0, cChars = 0, firstAnswerSec = null, tokens = null, err = null;
  try {
    const res = await fetch('http://127.0.0.1:1234/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ model, messages: [{ role: 'system', content: SYS + addendum }, { role: 'user', content: prompt }], max_tokens: 12000, stream: true, stream_options: { include_usage: true }, ...base, ...extra }) });
    if (!res.ok) err = `HTTP ${res.status} ${(await res.text()).slice(0, 120)}`;
    else {
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const ev = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!ev.startsWith('data:') || ev.includes('[DONE]')) continue;
          let j; try { j = JSON.parse(ev.slice(5)); } catch { continue; }
          const d = j.choices?.[0]?.delta;
          rChars += (d?.reasoning_content ?? d?.reasoning ?? '').length;
          if (d?.content) { cChars += d.content.length; firstAnswerSec ??= (Date.now() - t0) / 1000; }
          if (j.usage) tokens = j.usage.completion_tokens;
        }
      }
    }
  } catch (e) { if (e.name !== 'AbortError') err = e.message; }
  clearTimeout(timer);
  const sec = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ variant: name, thinkingTokens: Math.round(rChars / 3.5), answerStartedAtSec: firstAnswerSec?.toFixed(1) ?? `still thinking at ${sec.toFixed(0)} s`, totalSec: sec.toFixed(0), answerChars: cChars, completionTokens: tokens, ...(err ? { err } : {}) }));
}
