// A model's name the way a person would say it: "unsloth/qwen3.8-27b", "Qwen3.8 27B UD" and "qwen/qwen3-coder-30b-a3b-instruct-q4_k_m.gguf"
// become "Qwen 3.8 27B", "Qwen 3.8 27B" and "Qwen 3 Coder 30B". Quantisation and packaging tags are dropped.
const DROP = /^(q\d.*|iq\d.*|ud|gguf|instruct|it|chat|fp\d+|bf16|f16|mtp|a\d+b|\d+bit|ggml|imatrix)$/i;
const ACRONYM = { gpt: 'GPT', vl: 'VL', ai: 'AI', moe: 'MoE', oss: 'OSS' };

export function prettyModelName(id) {
  const last = String(id ?? '').replace(/^huihui[-_ ]ai[-_ ]/i, '').split('/').pop().replace(/\.gguf$/i, '').replace(/[-_ ]i?q\d(?:_[a-z0-9]+)*/gi, ''); // "-q4_k_m", "_Q3_K_XL" and the like are one tag
  const words = [];
  for (const raw of last.split(/[-_\s]+/).filter(Boolean)) {
    if (DROP.test(raw)) continue;
    const size = raw.match(/^(\d+(?:\.\d+)?)b$/i);
    if (size) { words.push(`${size[1]}B`); continue; }
    const split = raw.match(/^([a-z]+)(\d[\d.]*)$/i); // "qwen3.8" is a name and a version
    if (split) { words.push(cap(split[1]), split[2]); continue; }
    words.push(cap(raw));
  }
  return words.join(' ') || String(id ?? '');
}
const cap = (w) => ACRONYM[w.toLowerCase()] ?? (w[0]?.toUpperCase() ?? '') + w.slice(1).toLowerCase();
