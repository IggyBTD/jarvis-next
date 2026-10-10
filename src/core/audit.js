// Audit log of every action the model asked for: what, with which arguments, what was decided,
// what came of it. Entries are hash-chained (each carries the hash of the one before), so a changed
// or removed entry shows up in verifyAudit(). The last MAX_KEPT entries are kept in localStorage; in
// the desktop app every entry is also appended to data/agent/audit.jsonl (the complete record).
const KEY = 'jarvis.audit';
const MAX_KEPT = 500;

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const storage = {
  read() {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  },
  write(entries) {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* private window or blocked storage */ }
  },
};

let entries = null;
let sink = null;
// Where each finished entry is also written, as one JSON line (the app sets a file on the Rust side).
export function setAuditSink(fn) {
  sink = fn;
}
let chain = Promise.resolve(); // appends are serialised so the hashes stay in order

export const bodyOf = ({ t, action, args, decision, ok, result }) => JSON.stringify({ t, action, args, decision, ok, result });

export function appendAudit(record) {
  const run = chain.then(async () => {
    entries ??= storage.read();
    const prev = entries.at(-1)?.hash ?? '';
    const entry = { t: new Date().toISOString(), ...record };
    entry.prev = prev;
    entry.hash = await sha256(prev + bodyOf(entry));
    entries.push(entry);
    if (entries.length > MAX_KEPT) entries = entries.slice(-MAX_KEPT);
    storage.write(entries);
    try { await sink?.(JSON.stringify(entry)); } catch (e) { console.warn('[jarvis] audit file write failed:', e); }
    return entry;
  });
  chain = run.catch(() => {});
  return run;
}

export const readAudit = () => (entries ??= storage.read()).slice();

// Checks the chain over the entries we hold (the first one's `prev` is trusted: older ones were trimmed).
export async function verifyAudit(list = readAudit()) {
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i].prev !== list[i - 1].hash) return { ok: false, at: i };
    if (list[i].hash !== await sha256(list[i].prev + bodyOf(list[i]))) return { ok: false, at: i };
  }
  return { ok: true, at: -1 };
}
