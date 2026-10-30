const crypto = require('node:crypto');

const GENESIS = '0'.repeat(64);
const SECRET = /token|secret|password|apikey|api_key|authorization/i;

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = SECRET.test(k) ? '[redacted]' : redact(v[k]);
    return out;
  }
  return v;
}

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function hashOf(prev, entry) {
  return crypto.createHash('sha256').update(prev + canon(entry)).digest('hex');
}

function append(log, entry) {
  const prev = log.length ? log[log.length - 1].hash : GENESIS;
  const stored = redact(entry);
  return [...log, { entry: stored, prev, hash: hashOf(prev, stored) }];
}

function verify(log) {
  let prev = GENESIS;
  for (let index = 0; index < log.length; index++) {
    const r = log[index];
    if (r.prev !== prev || r.hash !== hashOf(prev, r.entry)) return { ok: false, index };
    prev = r.hash;
  }
  return { ok: true };
}

function tail(log, n) {
  return n <= 0 ? [] : log.slice(-n);
}

module.exports = { append, verify, tail, GENESIS };
