const crypto = require('node:crypto');

const GENESIS = '0'.repeat(64);

function hashOf(prev, entry) {
  return crypto.createHash('sha256').update(prev + JSON.stringify(entry)).digest('hex');
}

function append(log, entry) {
  const prev = log.length ? log[log.length - 1].hash : GENESIS;
  const record = { entry, prev, hash: hashOf(prev, entry) };
  return [...log, record];
}

function verify(log) {
  let prev = GENESIS;
  for (const r of log) {
    if (r.prev !== prev || r.hash !== hashOf(prev, r.entry)) return false;
    prev = r.hash;
  }
  return true;
}

module.exports = { append, verify, GENESIS };
