// Small helpers shared by server, agent and sidecars: entry guard, process guards, atomic JSON files,
// untrusted-content wrapping, a few text helpers. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// True when this module is the program being run. The naive `import.meta.url === file://argv1` check fails on
// Windows and on paths with spaces, so compare real paths.
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(path.resolve(process.argv[1])); } catch { return false; }
}

// A crash in one timer or socket must be logged, not take the process down silently.
export function installProcessGuards(log = console.error) {
  process.on('uncaughtException', (e) => log(`uncaughtException: ${e?.stack ?? e}`));
  process.on('unhandledRejection', (e) => log(`unhandledRejection: ${e?.stack ?? e}`));
}

export const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// Write tmp then rename, so a crash never leaves half a file. A failed write throws; callers in timers must catch.
export function writeFileAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}
export const writeJsonAtomic = (file, obj, mode) => writeFileAtomic(file, `${JSON.stringify(obj, null, 2)}\n`, mode);
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Anything that came from a web page, an email, a file or a tool is data. It goes into model context inside a marked
// block, and the closing marker cannot be forged from inside the block.
export function wrapUntrusted(source, text, { max = 8000 } = {}) {
  let body = String(text ?? '');
  const cut = body.length > max;
  if (cut) body = `${body.slice(0, max)}\n[truncated, ${text.length - max} more characters]`;
  body = body.replace(/<\/?untrusted[^>]*>/gi, '[tag removed]');
  const label = String(source).replace(/[^\w .:/-]/g, '').slice(0, 80);
  return `<untrusted source="${label}">\n${body}\n</untrusted>`;
}

export const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}...[${t.length - n} more]` : t; };

// Strips control characters except \n and \t; model-visible and log-visible text should not carry terminal escapes.
// eslint-disable-next-line no-control-regex
export const stripControl = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

export const nowIso = () => new Date().toISOString();
export const newId = (prefix = '') => `${prefix}${crypto.randomUUID()}`;
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Constant-time string comparison that does not leak length either (both sides are hashed first).
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Own-property lookup for maps that use model- or network-supplied keys.
export const own = (obj, key) => (obj && Object.hasOwn(obj, key) ? obj[key] : undefined);
