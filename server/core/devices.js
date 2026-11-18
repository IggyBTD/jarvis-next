// Paired devices (docs/security/pairing-design.md). Each device has its own token; data/devices.json keeps only a hash
// of it. Scopes split chat from approve from settings; a T3 approval and the admin actions also need the desktop on
// loopback or the owner's PIN. Every call reads the file, so a revoke or a rotation applies at once in every process
// (server, starter on 7411, CLI) and to sockets that are already open. Nothing here throws after the factory; every
// odd, unknown, expired, revoked or locked input is a no.
// ponytail: one small JSON file read per call and one lock file for writers. Move to an in-memory copy with a file
// watcher if this ever shows up in a profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJsonAtomic, sha256, safeEqual, stripControl } from '../../shared/util.js';
import { isLoopback } from '../../shared/net.js';

// The CLI on the PC passes this as `by`. A symbol cannot arrive in JSON, so no network message can claim it.
export const LOCAL = Symbol('local');
export const SCOPES = ['chat', 'approve', 'settings'];
export const KINDS = ['desktop', 'browser', 'phone'];
// desktop: the app window on the PC. browser: the Mac (or any other computer) in a browser. phone: the iPhone app.
export const DEFAULT_SCOPES = { desktop: ['chat', 'approve', 'settings'], browser: ['chat', 'approve', 'settings'], phone: ['chat', 'approve'] };
export const LEGACY_SCOPES = ['chat', 'approve'];
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I L O U 0 1

const CODE_LENGTH = 8;
const CODE_TTL_MS = 5 * 60_000;
const CODE_MAX_PENDING = 3;
const CODE_MAX_FAILS = 10;        // wrong codes from anywhere while a code is pending; then that code is dead
const PAIR_SOURCE_MAX = 5;        // wrong codes from one address per window
const PAIR_WINDOW_MS = 10 * 60_000;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 15 * 60_000;  // doubles with every lockout in a row, up to a day
const PIN_LOCK_MAX_MS = 24 * 3_600_000;
const SEEN_EVERY_MS = 60_000;
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,512}$/; // the same shape auth.js accepts as a bearer
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

const yes = { ok: true, reason: '' };
const no = (reason) => ({ ok: false, reason });
const newToken = () => crypto.randomBytes(32).toString('hex');
const codeHash = (code) => sha256(`pair:${code}`);
const view = (d) => ({ id: d.id, name: d.name, kind: d.kind, scopes: [...d.scopes], createdAt: d.createdAt ?? null, lastSeenAt: d.lastSeenAt ?? null, lastIp: d.lastIp ?? null, revokedAt: d.revokedAt ?? null });
const obj = (x) => (x && typeof x === 'object' ? x : {}); // options from a caller: anything that is not an object is no options
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

export function createDevices({ dataDir, now = Date.now, legacyToken = () => null, scryptN = 32768 } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('createDevices needs a dataDir');
  const file = path.join(dataDir, 'devices.json');
  const lock = `${file}.lock`;
  const tries = new Map(); // source address -> times of its wrong pairing codes (this process only)

  // A missing file is a fresh install. A file that cannot be read or parsed is damaged: then nobody gets in, the old token included.
  function load() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { version: 1, devices: [], codes: [], pin: null, legacy: { revokedAt: null, lastSeenAt: null } } : { broken: true }; }
    try {
      const s = JSON.parse(text);
      const ok = s && Array.isArray(s.devices) && Array.isArray(s.codes) && s.legacy && typeof s.legacy === 'object'
        && s.devices.every((d) => d && typeof d.id === 'string' && Array.isArray(d.scopes)) && s.codes.every((c) => c && typeof c.hash === 'string');
      if (ok) return s;
    } catch { /* damaged */ }
    return { broken: true };
  }

  // One writer at a time across processes, so a "last seen" write can never undo a revoke made by the CLI.
  function mutate(fn) {
    let fd = null;
    try {
      for (let i = 0; i < 100 && fd === null; i++) {
        try { fs.mkdirSync(dataDir, { recursive: true }); fd = fs.openSync(lock, 'wx'); } catch {
          try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.rmSync(lock, { force: true }); } catch { /* gone already */ }
          Atomics.wait(sleepCell, 0, 0, 10);
        }
      }
      if (fd === null) return { error: 'the device store is busy' };
      const s = load();
      if (s.broken) return { error: 'the device store is damaged' };
      const before = JSON.stringify(s);
      const out = fn(s);
      if (JSON.stringify(s) !== before) writeJsonAtomic(file, s, 0o600);
      return out;
    } catch { return { error: 'the device store could not be written' }; } finally {
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } try { fs.rmSync(lock, { force: true }); } catch { /* gone */ } }
    }
  }

  const legacy = () => { try { const t = legacyToken(); return typeof t === 'string' && TOKEN_RE.test(t) ? t : null; } catch { return null; } };
  const legacyDevice = (s) => (!s.legacy.revokedAt && legacy() ? { id: 'legacy', name: 'legacy (shared token)', kind: 'legacy', scopes: LEGACY_SCOPES, lastSeenAt: s.legacy.lastSeenAt ?? null, lastIp: s.legacy.lastIp ?? null } : null);
  // The record as it is on disk now, never the principal object a socket has held since it connected.
  function current(s, principal) {
    const id = principal?.deviceId;
    if (s.broken || typeof id !== 'string') return null;
    if (id === 'legacy') return legacyDevice(s);
    const d = s.devices.find((x) => x.id === id);
    return d && !d.revokedAt && typeof d.hash === 'string' ? d : null;
  }
  const principalOf = (d) => ({ role: 'ui', deviceId: d.id, name: d.name, kind: d.kind, scopes: d.scopes.filter((x) => SCOPES.includes(x)) });

  // Driver: auth.js authenticate() calls this first for a bearer (then its machine and model tokens as before); ws.js keeps the
  // result on the client as c.principal; the starter on 7411 calls it on every request in place of its own token compare.
  function authenticate(token, opts) {
    try {
      const { ip } = obj(opts);
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      const s = load();
      if (s.broken) return null;
      const h = sha256(token);
      let found = null;
      for (const d of s.devices) if (!d.revokedAt && typeof d.hash === 'string' && safeEqual(h, d.hash)) found ??= d;
      const old = legacy();
      if (!found && old && safeEqual(token, old)) found = legacyDevice(s);
      if (!found) return null;
      if (now() - (found.lastSeenAt ?? 0) > SEEN_EVERY_MS) {
        const from = typeof ip === 'string' ? ip.slice(0, 64) : null;
        mutate((w) => { const d = found.id === 'legacy' ? w.legacy : w.devices.find((x) => x.id === found.id && !x.revokedAt); if (d) { d.lastSeenAt = now(); d.lastIp = from; } });
      }
      return principalOf(found);
    } catch { return null; }
  }

  // Driver: called by can(); also by a CLI "pin check". Constant time; 5 wrong PINs lock it (15 minutes, doubling up to a day),
  // and while it is locked the right PIN is refused too.
  function checkPin(pin) {
    if (typeof pin !== 'string' || !pin || pin.length > 64) return no('wrong PIN');
    const out = mutate((s) => {
      const P = s.pin;
      if (!P || typeof P.hash !== 'string') return no('no PIN is set');
      if (P.lockedUntil > now()) return { ok: false, reason: 'the PIN is locked', until: P.lockedUntil };
      const want = Buffer.from(P.hash, 'hex');
      const got = pinHash(pin, P.salt, P.N);
      if (got.length === want.length && crypto.timingSafeEqual(got, want)) { P.fails = 0; P.locks = 0; P.lockedUntil = 0; return yes; }
      P.fails = (P.fails ?? 0) + 1;
      if (P.fails >= PIN_MAX_FAILS) { P.fails = 0; P.locks = (P.locks ?? 0) + 1; P.lockedUntil = now() + Math.min(PIN_LOCK_MS * 2 ** (P.locks - 1), PIN_LOCK_MAX_MS); }
      return no('wrong PIN');
    });
    return out?.error ? no(out.error) : out;
  }
  // ponytail: scryptSync blocks the server for about 60 ms per check; the lockout caps how often that can happen.
  const pinHash = (pin, salt, N) => crypto.scryptSync(pin.normalize('NFKC'), Buffer.from(String(salt), 'hex'), 32, { N, r: 8, p: 1, maxmem: 2048 * N });

  const stepUp = (d, pin, ip) => {
    if (d.kind === 'desktop' && isLoopback(ip)) return yes;
    return pin === undefined || pin === null || pin === '' ? no('this needs the desktop app on the PC or the PIN') : checkPin(pin);
  };

  // Driver: every ws.js handler and http.js route asks this before it acts, with c.principal or verdict.principal.
  //   'chat'     scope chat: chat.send, chat.abort, hello and state, conversations, digest, voice, reminders, action.invoke,
  //              agent.task, agent.abort, wake.pc, models list, environment, osint, latex, the starter's /health and /start
  //   'target'   scope chat: target.set (it picks where gated actions run; the gate still asks)
  //   'deny'     any paired device: gate.reply with decision deny
  //   'approve'  scope approve: gate.reply with decision approve. tier comes from gate.pending(), never from the client
  //              message. T0 to T2 pass; T3, or a tier that is missing or unknown, also needs the desktop on loopback or the PIN.
  //   'settings' scope settings: mode.set (not bypass or accept-edits), backend.set, POST /api/model, GET /api/audit, /api/browser/*,
  //              the OpenSky key, GET /api/devices
  //   'admin'    scope settings plus the desktop on loopback or the PIN: mode.set bypass or accept-edits, POST /api/project, start a pairing,
  //              revoke or rotate another device, change the PIN
  //   'device'   act on the device `id`: its own id passes (sign out here, renew my token); any other id is 'admin'
  // ip must be the socket's remote address, and something that is not loopback when the request came through a proxy.
  function can(principal, what, opts) {
    try {
      const { tier, pin, ip, id } = obj(opts);
      const d = current(load(), principal);
      if (!d) return no('unknown or revoked device');
      // Migration: the old shared token used from the PC itself (the desktop app before it is paired) keeps the desktop's rights
      // until the owner revokes it. From anywhere else, or through a proxy ('proxied' is not loopback), it has LEGACY_SCOPES only.
      const localLegacy = d.id === 'legacy' && isLoopback(ip);
      const has = (scope) => d.scopes.includes(scope) || (localLegacy && scope === 'settings');
      const admin = () => (has('settings') ? (localLegacy ? yes : stepUp(d, pin, ip)) : no('this device may not change settings'));
      if (what === 'chat' || what === 'target') return has('chat') ? yes : no('this device may not chat');
      if (what === 'deny') return yes;
      if (what === 'approve') return !has('approve') ? no('this device may not approve') : ['T0', 'T1', 'T2'].includes(tier) || localLegacy ? yes : stepUp(d, pin, ip);
      if (what === 'settings') return has('settings') ? yes : no('this device may not change settings');
      if (what === 'admin') return admin();
      if (what === 'device') return typeof id === 'string' && id === d.id && id !== 'legacy' ? yes : admin();
      return no('unknown permission');
    } catch { return no('internal error'); }
  }
  const allowed = (by, what, opts) => (by === LOCAL ? yes : can(by, what, opts));

  // Driver: POST /api/devices/pair/start in http.js (by: verdict.principal, pin from the body) and the CLI (by: LOCAL).
  // The kind and the scopes are fixed here by the one who authorises, never by the new device. A desktop can only be
  // paired with the CLI. The code is returned once; show it as XXXX-XXXX.
  function startPairing(opts) {
    try {
      const { by, kind = 'phone', scopes, pin, ip } = obj(opts);
      if (!KINDS.includes(kind)) return { error: 'kind must be desktop, browser or phone' };
      if (kind === 'desktop' && by !== LOCAL) return { error: 'the desktop is paired with the command on the PC' };
      const give = scopes === undefined ? DEFAULT_SCOPES[kind] : scopes;
      if (!Array.isArray(give) || !give.length || !give.every((x) => SCOPES.includes(x))) return { error: 'scopes must be some of chat, approve, settings' };
      const may = allowed(by, 'admin', { pin, ip });
      if (!may.ok) return { error: may.reason };
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      const expiresAt = now() + CODE_TTL_MS;
      return mutate((s) => {
        s.codes = s.codes.filter(liveCode);
        if (s.codes.length >= CODE_MAX_PENDING) return { error: 'too many codes are waiting; use one or wait five minutes' };
        s.codes.push({ hash: codeHash(code), kind, scopes: [...new Set(give)], expiresAt, fails: 0 });
        return { code, expiresAt };
      });
    } catch { return { error: 'internal error' }; }
  }
  const liveCode = (c) => c.expiresAt > now() && !(c.fails >= CODE_MAX_FAILS);
  const recent = (src) => (tries.get(src) ?? []).filter((t) => now() - t < PAIR_WINDOW_MS);

  // Driver: POST /api/devices/pair in http.js, the one route that needs no token (the caller allowlist and the Origin check
  // still apply; ip is the socket's remote address). The token is in the JSON body of the answer, once, with no-store.
  function completePairing(opts) {
    try {
      const { code, name, ip } = obj(opts);
      const src = typeof ip === 'string' && ip ? ip.slice(0, 64) : 'unknown';
      if (recent(src).length >= PAIR_SOURCE_MAX) return { error: 'too many wrong codes; wait ten minutes' };
      const given = typeof code === 'string' ? code.toUpperCase().replace(/[\s-]/g, '') : '';
      const token = newToken();
      return mutate((s) => {
        s.codes = s.codes.filter(liveCode);
        const hit = CODE_RE.test(given) ? s.codes.find((c) => safeEqual(c.hash, codeHash(given))) : null;
        if (!hit) {
          if (tries.size > 5000) tries.clear(); // ponytail: a flood forgets the per-address counts; the per-code cap below still holds
          tries.set(src, [...recent(src), now()]);
          for (const c of s.codes) c.fails = (c.fails ?? 0) + 1;
          return { error: 'wrong or expired code' };
        }
        s.codes = s.codes.filter((c) => c !== hit);
        const kind = KINDS.includes(hit.kind) ? hit.kind : 'phone';
        const label = typeof name === 'string' ? stripControl(name).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
        const device = { id: `d-${crypto.randomBytes(6).toString('hex')}`, name: label || kind, kind, scopes: (Array.isArray(hit.scopes) ? hit.scopes : []).filter((x) => SCOPES.includes(x)), hash: sha256(token), createdAt: now(), lastSeenAt: null, lastIp: null, revokedAt: null };
        s.devices.push(device);
        return { token, device: view(device) };
      });
    } catch { return { error: 'internal error' }; }
  }

  // Driver: GET /api/devices (after can 'settings') and the CLI. Never holds a hash, a token or a code.
  function list() {
    try {
      const s = load();
      if (s.broken) return [];
      const old = legacyDevice(s);
      return [...s.devices.map(view), ...(old ? [view(old)] : [])];
    } catch { return []; }
  }

  // Driver: GET /api/devices adds this so the screens know whether to show a PIN field and the "old shared token" warning.
  function info() {
    try {
      const s = load();
      if (s.broken) return { pinSet: false, pinLockedUntil: 0, legacy: false, codesWaiting: 0, damaged: true };
      return { pinSet: !!s.pin, pinLockedUntil: s.pin?.lockedUntil > now() ? s.pin.lockedUntil : 0, legacy: !!legacyDevice(s), codesWaiting: s.codes.filter(liveCode).length, damaged: false };
    } catch { return { pinSet: false, pinLockedUntil: 0, legacy: false, codesWaiting: 0, damaged: true }; }
  }

  // Driver: POST /api/devices/revoke (by: verdict.principal) and the CLI (by: LOCAL). id 'legacy' ends the old shared token.
  // After { ok: true } ws.js closes every socket whose c.principal.deviceId is that id.
  function revoke(id, opts) {
    try {
      const { by, pin, ip } = obj(opts);
      if (typeof id !== 'string') return { error: 'unknown device' };
      const may = allowed(by, 'device', { id, pin, ip });
      if (!may.ok) return { error: may.reason };
      return mutate((s) => {
        if (id === 'legacy') { s.legacy.revokedAt ??= now(); return { ok: true, id }; }
        const d = s.devices.find((x) => x.id === id && !x.revokedAt);
        if (!d) return { error: 'unknown device' };
        d.revokedAt = now();
        d.hash = null;
        return { ok: true, id };
      });
    } catch { return { error: 'internal error' }; }
  }

  // Driver: POST /api/devices/rotate (a device renews its own token: the new one is in the answer body) and the CLI
  // (by: LOCAL, id or 'all'). No grace: the old token is dead when this returns. 'all' does not touch the old shared
  // token; revoke('legacy') does. -> { tokens: [{ id, name, token }] }, each token shown once.
  function rotate(id, opts) {
    try {
      const { by, pin, ip } = obj(opts);
      if (typeof id !== 'string') return { error: 'unknown device' };
      const may = allowed(by, id === 'all' ? 'admin' : 'device', { id, pin, ip });
      if (!may.ok) return { error: may.reason };
      return mutate((s) => {
        const which = s.devices.filter((d) => !d.revokedAt && (id === 'all' || d.id === id));
        if (!which.length && id !== 'all') return { error: 'unknown device' };
        return { tokens: which.map((d) => { const token = newToken(); d.hash = sha256(token); return { id: d.id, name: d.name, token }; }) };
      });
    } catch { return { error: 'internal error' }; }
  }

  // Driver: POST /api/devices/pin (by: verdict.principal; `pin` is the current PIN, not needed from the desktop on
  // loopback) and the CLI (by: LOCAL; this is also how a forgotten PIN is replaced). 6 to 64 characters.
  function setPin(opts) {
    try {
      const { by, pin, newPin, ip } = obj(opts);
      if (typeof newPin !== 'string' || newPin.length < 6 || newPin.length > 64) return { error: 'the PIN needs 6 to 64 characters' };
      const may = allowed(by, 'admin', { pin, ip });
      if (!may.ok) return { error: may.reason };
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = pinHash(newPin, salt, scryptN).toString('hex');
      return mutate((s) => { s.pin = { salt, hash, N: scryptN, fails: 0, locks: 0, lockedUntil: 0 }; return { ok: true }; });
    } catch { return { error: 'internal error' }; }
  }

  return { authenticate, can, startPairing, completePairing, list, info, revoke, rotate, setPin, checkPin };
}
