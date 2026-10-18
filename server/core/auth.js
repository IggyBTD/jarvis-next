// Tokens and request authentication. Three roles: ui (the HUD client), machine (an agent, and the LLM proxy), model (a
// token derived from a machine token that opens only /v1, so OpenCode never holds the token that reaches an agent).
// Comparison is constant time. A failures-only rate limiter blocks sources that keep guessing; a valid token is never blocked.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeEqual, writeFileAtomic, readJson, writeJsonAtomic } from '../../shared/util.js';
import { tokenPath, machineIds } from './config.js';

export const newToken = () => crypto.randomBytes(32).toString('hex');
export const modelTokenFor = (machineToken) => crypto.createHmac('sha256', machineToken).update('jarvis-model-v1').digest('hex');

const uiTokenPath = (cfg) => path.join(cfg.dataDir, 'tokens', 'ui.token');
const readToken = (file) => { try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; } };
const readPrev = (file, now) => { const p = readJson(`${file}.prev`); return p && p.until > now() ? p.token : null; };
const writeToken = (file, token) => { writeFileAtomic(file, `${token}\n`, 0o600); };

// Creates every missing token file. Returns the names that were created.
export function generateTokens(cfg) {
  const made = [];
  for (const file of [uiTokenPath(cfg), ...machineIds(cfg).map((id) => tokenPath(cfg, id))]) {
    if (!readToken(file)) { writeToken(file, newToken()); made.push(path.basename(file, '.token')); }
  }
  return made;
}

// New token now; the old one keeps working for graceMs so clients can be updated without an outage.
export function rotateToken(cfg, name, { graceMs = 3_600_000, now = Date.now } = {}) {
  const file = name === 'ui' ? uiTokenPath(cfg) : tokenPath(cfg, name);
  const old = readToken(file);
  if (old) writeJsonAtomic(`${file}.prev`, { token: old, until: now() + graceMs }, 0o600);
  const fresh = newToken();
  writeToken(file, fresh);
  return fresh;
}

export function loadTokens(cfg, now = Date.now) {
  const tokens = { ui: [], machines: {} };
  const ui = readToken(uiTokenPath(cfg));
  if (ui) tokens.ui.push(ui);
  const uiPrev = readPrev(uiTokenPath(cfg), now);
  if (uiPrev) tokens.ui.push(uiPrev);
  for (const id of machineIds(cfg)) {
    const f = tokenPath(cfg, id);
    const t = [readToken(f), readPrev(f, now)].filter(Boolean);
    if (t.length) tokens.machines[id] = t;
  }
  return tokens;
}

// failuresOnly limiter: only bad credentials count; a source over the limit gets 429 until its window passes.
export function createLimiter({ max = 10, windowMs = 60_000, now = Date.now, maxSources = 5000 } = {}) {
  const fails = new Map();
  const recent = (ip) => { const t = (fails.get(ip) ?? []).filter((x) => now() - x < windowMs); if (t.length) fails.set(ip, t); else fails.delete(ip); return t; };
  return {
    fail(ip) {
      if (fails.size >= maxSources && !fails.has(ip)) fails.delete(fails.keys().next().value);
      fails.set(ip, [...recent(ip), now()]);
    },
    blocked: (ip) => recent(ip).length >= max,
  };
}

export function createAuth({ tokens, limiter = createLimiter(), reload = null }) {
  let current = tokens;
  const parseBearer = (header) => { const m = String(header ?? '').match(/^Bearer\s+([A-Za-z0-9._~+/=-]{16,512})$/); return m ? m[1] : null; };

  // Walks every candidate (no early exit between roles) and returns the first match.
  function authenticate(header) {
    const given = parseBearer(header);
    if (!given) return null;
    let found = null;
    const hit = (principal) => { found ??= principal; };
    for (const t of current.ui) if (safeEqual(given, t)) hit({ role: 'ui' });
    for (const [id, list] of Object.entries(current.machines)) {
      for (const t of list) {
        if (safeEqual(given, t)) hit({ role: 'machine', machine: id });
        if (safeEqual(given, modelTokenFor(t))) hit({ role: 'model', machine: id });
      }
    }
    return found;
  }

  // { ok, status, principal }. roles: which roles may use this route.
  function check(header, { roles, ip = 'unknown' }) {
    const principal = authenticate(header);
    if (principal) return roles.includes(principal.role) ? { ok: true, status: 200, principal } : { ok: false, status: 403, principal };
    if (limiter.blocked(ip)) return { ok: false, status: 429, principal: null };
    limiter.fail(ip);
    return { ok: false, status: 401, principal: null };
  }

  return {
    authenticate, check,
    reload() { if (reload) current = reload(); },
    // a browser page must come from a listed origin; clients that send no Origin (native) are fine, the token still applies
    originAllowed: (origin, allowed) => !origin || allowed.includes(origin),
  };
}
