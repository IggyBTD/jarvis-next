// Append-only, hash-chained audit log: data/audit/YYYY-MM-DD.jsonl (UTC day) plus head.json, an anchor that records the
// last hash. Each line: ts, id, component, target, source, action, args (redacted, bounded), tier, decision, outcome,
// durationMs, prevHash, hash. hash = sha256(prevHash + canonical JSON of the line without its hash).
// Reads are logged by the caller like any other action. Files are never deleted here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJsonAtomic, readJson } from '../../shared/util.js';

const GENESIS = '0'.repeat(64);
const SENSITIVE_WORDS = new Set(['password', 'passwd', 'passphrase', 'pwd', 'secret', 'token', 'authorization', 'cookie', 'cookies', 'credential', 'credentials', 'bearer', 'otp', 'body', 'snippet']);
const keyIsSensitive = (key) => {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => SENSITIVE_WORDS.has(w))) return true;
  return words.includes('key') && words.some((w) => ['api', 'private', 'access', 'secret', 'ssh'].includes(w));
};
const VALUE_PATTERNS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/\b[0-9a-f]{64}\b/gi, '[redacted-hex]'],
  [/\bya29\.[\w.-]+/g, '[redacted-google-token]'],
  [/\b1\/\/[\w-]{20,}/g, '[redacted-google-token]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted-key]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];
const redactString = (s) => VALUE_PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), s);

// Redacts by what a key means (camelCase and snake_case are split), redacts token-shaped and email-shaped values, and bounds
// the result: depth 6, 40 keys per object, 500 characters per string, 4 KB overall.
export function redact(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') { const s = redactString(value); return s.length > 500 ? `${s.slice(0, 500)}...[${s.length} chars]` : s; }
  if (depth >= 6) return '[too deep]';
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = Object.create(null);
    for (const k of Object.keys(value).slice(0, 40)) out[k] = keyIsSensitive(k) ? '[redacted]' : redact(value[k], depth + 1);
    return out;
  }
  return String(value);
}
export function boundedArgs(args) {
  const r = redact(args ?? {});
  const text = JSON.stringify(r);
  return text.length <= 4096 ? JSON.parse(text) : { _truncated: true, preview: text.slice(0, 1000) };
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
const hashOf = (prev, entry) => crypto.createHash('sha256').update(`${prev}\n${canonical(entry)}`).digest('hex');

export function createAuditLog({ dir, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const anchorFile = path.join(dir, 'head.json');
  let head = null; // { hash, count }
  let chain = Promise.resolve();
  const notes = [];

  const files = () => fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  const readLines = (file) => fs.readFileSync(path.join(dir, file), 'utf8').split('\n');

  // Finds the last good hash. A torn last line (crash mid-write) is cut off; that is the only repair done on the log itself.
  function init() {
    if (head) return;
    let hash = GENESIS;
    let count = 0;
    const list = files();
    for (const f of list) count += readLines(f).filter(Boolean).length;
    for (let i = list.length - 1; i >= 0; i--) {
      const lines = readLines(list[i]);
      const lastNonEmpty = lines.map((l, n) => [l, n]).filter(([l]) => l).pop();
      if (!lastNonEmpty) continue;
      try {
        hash = JSON.parse(lastNonEmpty[0]).hash;
      } catch {
        const kept = lines.slice(0, lastNonEmpty[1]).filter(Boolean);
        fs.writeFileSync(path.join(dir, list[i]), kept.length ? `${kept.join('\n')}\n` : '');
        notes.push(`cut a torn last line from ${list[i]}`);
        count -= 1;
        hash = kept.length ? JSON.parse(kept.at(-1)).hash : GENESIS;
        if (!kept.length) continue;
      }
      break;
    }
    head = { hash, count };
    // anchor one entry off (crash between the append and the anchor write) is repaired; anything else stays visible to verify()
    const a = readJson(anchorFile);
    if (a && a.hash !== hash) {
      const prevOfLast = (() => { for (let i = list.length - 1; i >= 0; i--) { const l = readLines(list[i]).filter(Boolean); if (l.length) return JSON.parse(l.at(-1)).prevHash; } return null; })();
      if (a.hash === prevOfLast) { notes.push('anchor was one entry behind: repaired'); writeJsonAtomic(anchorFile, { hash, count, file: list.at(-1) }); }
    }
  }

  function write(entry) {
    init();
    const d = now();
    const day = d.toISOString().slice(0, 10);
    const line = {
      ts: d.toISOString(), id: entry.id ?? crypto.randomUUID(), component: entry.component ?? 'server', target: entry.target ?? null,
      source: entry.source ?? null, action: entry.action ?? null, args: boundedArgs(entry.args), tier: entry.tier ?? null,
      decision: entry.decision ?? null, outcome: entry.outcome ?? null, durationMs: entry.durationMs ?? null,
      ...(entry.reason ? { reason: redactString(String(entry.reason)).slice(0, 300) } : {}),
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
      prevHash: head.hash,
    };
    line.hash = hashOf(line.prevHash, Object.fromEntries(Object.entries(line).filter(([k]) => k !== 'hash')));
    fs.appendFileSync(path.join(dir, `${day}.jsonl`), `${JSON.stringify(line)}\n`);
    head = { hash: line.hash, count: head.count + 1 };
    try { writeJsonAtomic(anchorFile, { hash: head.hash, count: head.count, file: `${day}.jsonl` }); } catch { /* the log line is what matters; verify() reports a stale anchor */ }
    return line;
  }

  return {
    // Serialised so concurrent callers never interleave; a failure rejects only that caller.
    append(entry) {
      const run = chain.then(() => write(entry));
      chain = run.catch(() => {});
      return run;
    },
    notes: () => [...notes],
    verify() {
      const errors = [];
      let prev = GENESIS;
      let entries = 0;
      for (const f of files()) {
        readLines(f).forEach((raw, i) => {
          if (!raw) return;
          let e;
          try { e = JSON.parse(raw); } catch { errors.push(`${f}:${i + 1} is not valid JSON`); return; }
          const { hash, ...rest } = e;
          if (e.prevHash !== prev) errors.push(`${f}:${i + 1} breaks the chain (prevHash does not match the previous entry)`);
          if (hash !== hashOf(e.prevHash, rest)) errors.push(`${f}:${i + 1} was edited (hash does not match its content)`);
          prev = hash ?? prev;
          entries += 1;
        });
      }
      const a = readJson(anchorFile);
      if (a && a.hash !== prev) errors.push('the head anchor does not match the last entry (entries were removed or the anchor is stale)');
      if (!a && entries) errors.push('head anchor is missing');
      return { ok: errors.length === 0, entries, errors };
    },
    tail(n = 50) {
      const out = [];
      for (const f of files().reverse()) {
        for (const l of readLines(f).filter(Boolean).reverse()) { try { out.push(JSON.parse(l)); } catch { /* skip torn */ } if (out.length >= n) return out.reverse(); }
      }
      return out.reverse();
    },
  };
}
