// Finds out which request field really lowers the 27B's thinking on this LM Studio.
// Usage: node scripts/probe-thinking.js [--model qwen3.8-27b] [--timeout 180]
// The model must already be loaded. Sends the same prompt seven ways and prints tokens, reasoning size and time.
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const model = arg('--model', 'qwen3.8-27b');
const timeoutMs = Number(arg('--timeout', 180)) * 1000;
const PROMPT = 'Write isEven(n) in JavaScript, code only.';

const variants = [
  ['baseline', {}, PROMPT],
  ['kwargs enable_thinking=false (JARVIS today)', { chat_template_kwargs: { enable_thinking: false } }, PROMPT],
  ['kwargs reasoning_effort=low', { chat_template_kwargs: { reasoning_effort: 'low' } }, PROMPT],
  ['kwargs reasoning_effort=medium', { chat_template_kwargs: { reasoning_effort: 'medium' } }, PROMPT],
  ['top-level reasoning_effort=low', { reasoning_effort: 'low' }, PROMPT],
  ['top-level reasoning_effort=none', { reasoning_effort: 'none' }, PROMPT],
  ['/no_think in the message', {}, `${PROMPT} /no_think`],
];

async function run([label, extra, text]) {
  const t0 = Date.now();
  try {
    const res = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: text }], max_tokens: 8000, stream: false, ...extra }),
    });
    const j = await res.json();
    if (!res.ok) return { label, error: JSON.stringify(j).slice(0, 160) };
    const m = j.choices[0].message;
    const content = m.content ?? '';
    const reasoningChars = (m.reasoning_content ?? m.reasoning ?? '').length + (content.match(/<think>([\s\S]*?)(<\/think>|$)/)?.[1].length ?? 0);
    return { label, tokens: j.usage?.completion_tokens, reasoningTokens: j.usage?.completion_tokens_details?.reasoning_tokens, reasoningChars, finish: j.choices[0].finish_reason, sec: ((Date.now() - t0) / 1000).toFixed(1), answer: content.replace(/<think>[\s\S]*?<\/think>/, '').trim().slice(0, 50).replace(/\n/g, ' ') };
  } catch (e) { return { label, error: /timeout|abort/i.test(`${e.name} ${e.message}`) ? `timed out after ${timeoutMs / 1000} s` : e.message, sec: ((Date.now() - t0) / 1000).toFixed(1) }; }
}

for (const v of variants) console.log(JSON.stringify(await run(v)));
