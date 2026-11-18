// Append-only, hash-chained audit log: data/audit/YYYY-MM-DD.jsonl (UTC day) plus head.json, an anchor that records the
// last hash. Each line: ts, id, component, target, source, action, args (redacted, bounded), argsHash (of the whole args), tier,
// decision, outcome, durationMs, v, prevHash, hash. With the audit key (auditKeyFor) hash = HMAC-SHA256(key, prevHash + canonical
// JSON of the line without its hash) and v = 2; without it (older lines, tests) a plain sha256.
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

// The audit key (data/tokens/audit.key, 0600, made by the server on first use) and the mark file next to it. With the key every
// line is an HMAC, so recomputing the chain without it is caught; the mark (outside data/audit) and the tagged head record how long
// the log is, so cut or deleted entries are caught; anchors kept on the other machine catch a rewrite of all of them. The key is
// readable by the same OS user: this holds against tools that edit files, not against code running as that user with the key
// (running OpenCode as its own user is that step, HUMAN_TODO.md section 12).
export function auditKeyFor(dataDir, { create = false } = {}) {
  const file = path.join(dataDir, 'tokens', 'audit.key');
  let key = null;
  try { key = fs.readFileSync(file, 'utf8').trim() || null; } catch { /* none yet */ }
  if (!key && create) {
    key = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${key}\n`, { mode: 0o600, flag: 'wx' });
  }
  return { key, markFile: path.join(dataDir, 'tokens', 'audit.mark') };
}

export function createAuditLog({ dir, key = null, markFile = null, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const anchorFile = path.join(dir, 'head.json');
  const sign = (prev, entry) => crypto.createHmac('sha256', key).update(`${prev}\n${canonical(entry)}`).digest('hex');
  const tagOf = (hash, count) => (key ? crypto.createHmac('sha256', key).update(`head:${hash}:${count}`).digest('hex') : undefined);
  let head = null; // { hash, count }
  let chain = Promise.resolve();
  const notes = [];

  const files = () => fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  const readLines = (file) => fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
  const writeHead = (file) => {
    const h = { hash: head.hash, count: head.count, file, ...(key ? { tag: tagOf(head.hash, head.count) } : {}) };
    try { writeJsonAtomic(anchorFile, h); } catch { /* the log line is what matters; verify() reports a stale anchor */ }
    if (markFile && key) {
      try { fs.mkdirSync(path.dirname(markFile), { recursive: true }); writeJsonAtomic(markFile, { hash: h.hash, count: h.count, tag: h.tag }, 0o600); } catch { /* verify() reports it */ }
    }
  };

  // Finds the last good hash. A torn last line (crash mid-write) is cut off, and the cut is written into the log as an entry of its
  // own, so it stays visible; that is the only repair done on the log itself.
  function init() {
    if (head) return;
    let hash = GENESIS;
    let count = 0;
    let cut = null;
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
        cut = { file: list[i], characters: lastNonEmpty[0].length };
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
      if (a.hash === prevOfLast) { notes.push('anchor was one entry behind: repaired'); writeHead(list.at(-1)); }
    }
    if (cut) writeLine({ component: 'audit', action: 'repair', args: cut, outcome: 'cut a torn last line (a write was interrupted)' });
  }

  function writeLine(entry) {
    const d = now();
    const day = d.toISOString().slice(0, 10);
    const line = {
      ts: d.toISOString(), id: entry.id ?? crypto.randomUUID(), component: entry.component ?? 'server', target: entry.target ?? null,
      source: entry.source ?? null, action: entry.action ?? null, args: boundedArgs(entry.args),
      // the stored args are redacted and cut (500 characters a string); this hash of the whole request lets a cut command be checked
      argsHash: crypto.createHash('sha256').update(canonical(entry.args ?? {})).digest('hex'),
      tier: entry.tier ?? null,
      decision: entry.decision ?? null, outcome: entry.outcome ?? null, durationMs: entry.durationMs ?? null,
      ...(entry.reason ? { reason: redactString(String(entry.reason)).slice(0, 300) } : {}),
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
      ...(key ? { v: 2 } : {}),
      prevHash: head.hash,
    };
    const unsigned = Object.fromEntries(Object.entries(line).filter(([k]) => k !== 'hash'));
    line.hash = key ? sign(line.prevHash, unsigned) : hashOf(line.prevHash, unsigned);
    fs.appendFileSync(path.join(dir, `${day}.jsonl`), `${JSON.stringify(line)}\n`);
    head = { hash: line.hash, count: head.count + 1 };
    writeHead(`${day}.jsonl`);
    return line;
  }
  const write = (entry) => { init(); return writeLine(entry); };

  // Every entry in order as { e, where } ("file:line"), and the places of lines that are not JSON.
  function entries() {
    const out = [];
    const bad = [];
    for (const f of files()) readLines(f).forEach((raw, i) => { if (!raw) return; try { out.push({ e: JSON.parse(raw), where: `${f}:${i + 1}` }); } catch { bad.push(`${f}:${i + 1}`); } });
    return { out, bad };
  }

  return {
    // Serialised so concurrent callers never interleave; a failure rejects only that caller.
    append(entry) {
      const run = chain.then(() => write(entry));
      chain = run.catch(() => {});
      return run;
    },
    notes: () => [...notes],
    head() { init(); return { ...head }; },
    verify() {
      const errors = [];
      let prev = GENESIS;
      let signedSeen = false;
      const { out, bad } = entries();
      for (const where of bad) errors.push(`${where} is not valid JSON`);
      for (const { e, where } of out) {
        const { hash, ...rest } = e;
        if (e.prevHash !== prev) errors.push(`${where} breaks the chain (prevHash does not match the previous entry)`);
        if (e.v === 2) {
          signedSeen = true;
          if (!key) errors.push(`${where} is signed with the audit key, which this check was not given`);
          else if (hash !== sign(e.prevHash, rest)) errors.push(`${where} was edited or forged (its signature does not match)`);
        } else {
          if (signedSeen) errors.push(`${where} is unsigned after signed entries`);
          if (hash !== hashOf(e.prevHash, rest)) errors.push(`${where} was edited (hash does not match its content)`);
        }
        prev = hash ?? prev;
      }
      const count = out.length;
      const a = readJson(anchorFile);
      if (a && a.hash !== prev) errors.push('the head anchor does not match the last entry (entries were removed or the anchor is stale)');
      if (a && Number.isInteger(a.count) && a.count !== count) errors.push(`the head anchor counts ${a.count} entries but ${count} are there (entries are missing or were added)`);
      if (!a && count) errors.push('head anchor is missing');
      if (key && a && a.tag !== tagOf(a.hash, a.count)) errors.push('the head anchor was written without the audit key (edited by hand)');
      if (key && markFile) {
        const m = readJson(markFile);
        if (m && m.tag !== tagOf(m.hash, m.count)) errors.push('the audit mark was written without the audit key');
        else if (m && m.count > count) errors.push(`entries are missing: the log had ${m.count} and now has ${count}`);
        else if (m && m.count > 0 && out[m.count - 1]?.e.hash !== m.hash) errors.push('the entry the audit mark points at was changed');
        else if (!m && signedSeen) errors.push('the audit mark is missing');
      }
      return { ok: errors.length === 0, entries: count, errors };
    },
    // Anchors kept on the other machine ({ count, hash } of this log when they were sent): each must still be in the log, unchanged.
    checkAnchors(anchors) {
      const { out } = entries();
      const errors = [];
      for (const x of Array.isArray(anchors) ? anchors : []) {
        const n = Number(x?.count);
        if (!Number.isInteger(n) || n < 1) continue;
        if (n > out.length) errors.push(`an anchor on the other machine has ${n} entries but the log has ${out.length} (entries are missing)`);
        else if (out[n - 1].e.hash !== x.hash) errors.push(`entry ${n} differs from the anchor on the other machine (the log was rewritten)`);
      }
      return errors;
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
