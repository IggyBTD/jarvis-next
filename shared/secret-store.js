// Where JARVIS keeps secrets at rest (docs/security/secrets-design.md). One interface, three backends:
//   win32   'dpapi'     DPAPI CurrentUser through PowerShell; the protected blob is a 0600 file <dir>/<name>.dpapi
//   darwin  'keychain'  a generic password in the login Keychain, written and read through /usr/bin/security
//   other   'file'      a plain 0600 file <dir>/<name>.secret, reported as unprotected (also what fallbackOnly gives)
// The value never appears on a command line, in script text or in a child's environment: it goes in on stdin and comes back on
// stdout. None of the backends stops a program that runs as the same OS user; they stop a file read, a copied folder and a backup.
// Every function is total and fails closed: a store that cannot be read answers null, never a guess. Values are never logged
// and never put into an error text. Programs are started only through the runProgram the caller hands in.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic } from './util.js';

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// ponytail: 1024 bytes is enough for tokens and keys and keeps the Keychain command line short; raise it after a test on a real Mac.
const MAX_BYTES = 1024;
export const validName = (name) => typeof name === 'string' && NAME.test(name) && !name.includes('..');
const validValue = (v) => typeof v === 'string' && v.length > 0 && !v.includes('\0') && Buffer.byteLength(v, 'utf8') <= MAX_BYTES;
const B64 = /^[A-Za-z0-9+/]+=*$/;
const HEX = /^(?:[0-9a-f]{2})+$/;

// Fixed text. stdin: line 1 the secret's name (bound into the blob as DPAPI entropy, so one blob cannot stand in for another),
// line 2 base64. Protect: base64 of the value in, base64 blob out. Unprotect: the reverse. Base64 keeps every byte ASCII.
const PS_HEAD = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$l=[Console]::In.ReadToEnd() -split \"`n\";$e=[Text.Encoding]::UTF8.GetBytes('jarvis-secret-v1:'+$l[0].Trim());$b=[Convert]::FromBase64String($l[1].Trim());";
const PS = {
  protect: `${PS_HEAD}[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$e,'CurrentUser'))`,
  unprotect: `${PS_HEAD}[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$e,'CurrentUser'))`,
};
const ACCOUNT = 'jarvis';
const NOT_FOUND = 44; // security's exit code for "the item is not in the keychain"

export function createSecretStore({ dir, platform = process.platform, runProgram, fallbackOnly = false } = {}) {
  const kind = fallbackOnly ? 'file' : platform === 'win32' ? 'dpapi' : platform === 'darwin' ? 'keychain' : 'file';
  const fileOf = (name) => path.join(String(dir), `${name}.${kind === 'dpapi' ? 'dpapi' : 'secret'}`);
  const run = async (file, args, stdin) => {
    try { const r = await runProgram({ file, args, stdin, timeoutMs: 20_000 }); return { code: r?.code ?? -1, out: String(r?.stdout ?? '').trim() }; } catch { return { code: -1, out: '' }; }
  };
  const ps = (script, stdin) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], stdin);
  const service = (name) => `jarvis.${name}`;
  const read = (name) => { try { return fs.readFileSync(fileOf(name), 'utf8'); } catch { return null; } };
  const write = (name, text) => { fs.mkdirSync(String(dir), { recursive: true, mode: 0o700 }); writeFileAtomic(fileOf(name), text, 0o600); };

  const backends = {
    file: {
      get: async (name) => read(name) || null,
      set: async (name, value) => { write(name, value); return true; },
      has: async (name) => fs.existsSync(fileOf(name)),
      remove: async (name) => { fs.rmSync(fileOf(name), { force: true }); return true; },
    },
    dpapi: {
      async get(name) {
        const blob = read(name)?.trim();
        if (!blob || !B64.test(blob)) return null;
        const r = await ps(PS.unprotect, `${name}\n${blob}`);
        return r.code === 0 && B64.test(r.out) ? Buffer.from(r.out, 'base64').toString('utf8') || null : null;
      },
      async set(name, value) {
        const r = await ps(PS.protect, `${name}\n${Buffer.from(value, 'utf8').toString('base64')}`);
        if (r.code !== 0 || !B64.test(r.out)) return false;
        write(name, `${r.out}\n`);
        return true;
      },
      has: async (name) => fs.existsSync(fileOf(name)),
      remove: async (name) => { fs.rmSync(fileOf(name), { force: true }); return true; },
    },
    // The value is stored as hex text: no quoting to get wrong, and what comes back is unambiguous. `security -i` reads its
    // commands from stdin, which keeps the value off every command line; it reports nothing useful, so set() reads the item back.
    keychain: {
      async get(name) {
        const r = await run('security', ['find-generic-password', '-a', ACCOUNT, '-s', service(name), '-w']);
        return r.code === 0 && HEX.test(r.out) ? Buffer.from(r.out, 'hex').toString('utf8') || null : null;
      },
      async set(name, value) {
        await run('security', ['-i'], `add-generic-password -U -a ${ACCOUNT} -s ${service(name)} -w ${Buffer.from(value, 'utf8').toString('hex')}\n`);
        return (await this.get(name)) === value;
      },
      async has(name) {
        const r = await run('security', ['find-generic-password', '-a', ACCOUNT, '-s', service(name)]);
        return r.code === 0 ? true : r.code === NOT_FOUND ? false : null;
      },
      async remove(name) {
        const r = await run('security', ['delete-generic-password', '-a', ACCOUNT, '-s', service(name)]);
        return r.code === 0 || r.code === NOT_FOUND;
      },
    },
  };
  const b = backends[kind];
  const usable = typeof dir === 'string' && dir !== '' && (kind === 'file' || typeof runProgram === 'function');

  return {
    kind,
    protected: kind !== 'file',
    /** The value, or null when it is missing, damaged or the store cannot be read. */
    async get(name) {
      if (!usable || !validName(name)) return null;
      try { const v = await b.get(name); return typeof v === 'string' && v ? v : null; } catch { return null; }
    },
    /** { ok: true } or { error }. The error text never holds the value. */
    async set(name, value) {
      if (!usable) return { error: 'the secret store is not set up' };
      if (!validName(name)) return { error: 'bad secret name' };
      if (!validValue(value)) return { error: `a secret must be a non-empty string of at most ${MAX_BYTES} bytes` };
      try { return (await b.set(name, value)) ? { ok: true } : { error: `the ${kind} store did not take the secret` }; } catch { return { error: `the ${kind} store could not be written` }; }
    },
    /** true, false, or null when it cannot be known (then nothing may be created over it). */
    async has(name) {
      if (!usable || !validName(name)) return null;
      try { return await b.has(name); } catch { return null; }
    },
    /** { ok: true } (also when there was nothing to remove) or { error }. */
    async remove(name) {
      if (!usable) return { error: 'the secret store is not set up' };
      if (!validName(name)) return { error: 'bad secret name' };
      try { return (await b.remove(name)) ? { ok: true } : { error: `the ${kind} store could not remove the secret` }; } catch { return { error: `the ${kind} store could not remove the secret` }; }
    },
  };
}

/**
 * Copies a plain secret file (a token file: one value, surrounding whitespace dropped) into the store and proves it reads back.
 * A value already in the store wins and is left alone. The old file is never touched: the caller removes it once the new path works.
 * -> { ok: true, migrated: boolean } | { error }
 */
export async function migrateFile(store, name, file) {
  try {
    if ((await store.get(name)) !== null) return { ok: true, migrated: false };
    let value;
    try { value = fs.readFileSync(file, 'utf8').trim(); } catch { return { error: 'there is no file to migrate' }; }
    const r = await store.set(name, value);
    if (!r.ok) return { error: r.error ?? 'the store refused the value' };
    if ((await store.get(name)) !== value) return { error: 'the stored value does not read back' };
    return { ok: true, migrated: true };
  } catch { return { error: 'migration failed' }; }
}

/**
 * A secret that used to live in an environment variable: the store first, then the variable's value (written to the store on
 * that first use), then, only with create and only when the store says for certain that nothing is there, a new random one.
 * -> { value: string | null, source: 'store' | 'env' | 'new' | null, stored: boolean }
 */
export async function secretOrEnv(store, name, envValue, { create = false, minLength = 16 } = {}) {
  try {
    const kept = await store.get(name);
    if (kept !== null) return { value: kept, source: 'store', stored: true };
    if (typeof envValue === 'string' && envValue.length >= minLength) return { value: envValue, source: 'env', stored: !!(await store.set(name, envValue)).ok };
    if (create && (await store.has(name)) === false) {
      const fresh = crypto.randomBytes(32).toString('hex');
      if ((await store.set(name, fresh)).ok && (await store.get(name)) === fresh) return { value: fresh, source: 'new', stored: true };
    }
  } catch { /* fall through: nothing usable */ }
  return { value: null, source: null, stored: false };
}
