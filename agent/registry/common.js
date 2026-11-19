// Shared pieces of the action registry: the only place in the agent that starts programs (argument arrays, never a shell
// string), path confinement for file actions, and the action() helper.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { childEnv } from '../../shared/child-env.js';
import path from 'node:path';

const MAX_BUFFER = 4 * 1024 * 1024;
// What a program the registry starts may see of the agent's environment (shared/child-env.js): what it needs to start, never a key or a
// token; action arguments (JARVIS_A_*) and user-script arguments (JARVIS_ARG_*) are handed over on purpose.
const envFor = (env) => childEnv(process.env, env, { allowSecret: [/^JARVIS_A_/, /^JARVIS_ARG_/] });

/**
 * Starts a program with an argument array. spec: { file, args[], env?, cwd?, stdin?, timeoutMs? }.
 * Resolves { code, stdout, stderr } and never throws for a non-zero exit; rejects only when the program cannot start.
 */
export function runProgram(spec) {
  const { file, args = [], env = {}, cwd, stdin, timeoutMs = 30_000 } = spec;
  if (typeof file !== 'string' || !file || file.includes('\0')) return Promise.reject(new Error('program name must be a non-empty string'));
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' || a.includes('\0'))) return Promise.reject(new Error('arguments must be an array of strings'));
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { env: envFor(env), cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return reject(new Error(`cannot start ${file}: ${err.code}`));
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: err?.killed ? `${stderr ?? ''}\n[timed out after ${timeoutMs} ms]` : stderr ?? '' });
    });
    if (stdin !== undefined) child.stdin.end(stdin); else child.stdin?.end();
  });
}

// A long-running child (dev server, keep-awake, caffeinate) that the agent tracks so it can be stopped later.
export function spawnTracked(spec, registry, key) {
  const { file, args = [], env = {}, cwd } = spec;
  if (registry.has(key)) throw new Error(`${key} is already running`);
  const child = spawn(file, args, { env: envFor(env), cwd, stdio: 'ignore', windowsHide: true, detached: false });
  registry.set(key, { child, startedAt: Date.now(), spec: { file, args } });
  child.on('exit', () => registry.delete(key));
  child.on('error', () => registry.delete(key));
  return child.pid;
}

export function action(def) {
  if (!def || (!def.plan && !def.run)) throw new Error('an action needs plan() or run()');
  return def;
}

export const expandHome = (p) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p);
const sameFs = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p) => (sameFs ? p.toLowerCase() : p);

function realOfDeepestExisting(p) {
  let cur = p;
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

// For the server's permission bridge (system action resolve_paths): the real path of one the coding agent asked for, or null when it
// cannot be known. Relative paths are under the workspace, ~ is this machine's home, a trailing wildcard names its folder. Links,
// junctions and 8.3 short names are resolved through the deepest part that exists; UNC, device and provider paths, variables,
// drive-relative paths, alternate streams and a short name in a part that does not exist yet are null. On Windows trailing dots and
// spaces are dropped from every name first, as Windows itself does.
export function realPathOf(raw, ctx) {
  const s = String(raw ?? '').replace(/[\\/]\*+$/, '');
  if (!s || s.includes('\0') || /[`$]|%[A-Za-z_][\w()]*%/.test(s)) return null;
  const win = ctx.os === 'win32';
  if (win) {
    const p = s.replace(/\//g, '\\');
    if (p.startsWith('\\\\') || /^[^\\:]{2,}:/.test(p) || /^[a-z]:(?!\\)/i.test(p) || p.slice(2).includes(':')) return null;
  }
  let abs = path.resolve(ctx.workspaceDir, expandHome(s));
  if (win) {
    const segs = abs.split('\\');
    if (segs.some((seg, i) => i > 0 && seg && /^[. ]+$/.test(seg))) return null;
    abs = segs.map((seg, i) => (i === 0 ? seg : seg.replace(/[. ]+$/, ''))).join('\\');
  }
  let cur = abs;
  const rest = [];
  for (;;) {
    try { cur = fs.realpathSync.native(cur); break; } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
  if (win && rest.some((seg) => /~\d/.test(seg))) return null; // a short name that does not exist yet could become anything
  return path.join(cur, ...rest);
}

export function rootsFor(ctx) {
  return (ctx.files.roots[ctx.os] ?? []).map((r) => realOfDeepestExisting(path.resolve(expandHome(r))));
}

/**
 * Resolves a user- or model-supplied path and proves it lies inside an allowed root, following symlinks (the deepest existing
 * ancestor is resolved with realpath, so a link pointing out of the roots is refused). Returns the absolute real path.
 */
export function safePath(raw, ctx) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0')) throw new Error('path is empty or invalid');
  if (/^\\\\/.test(raw) || /^[a-z]+:\/\//i.test(raw)) throw new Error('network and device paths are not allowed');
  const abs = path.isAbsolute(expandHome(raw)) ? path.resolve(expandHome(raw)) : path.resolve(ctx.workspaceDir, raw);
  const real = realOfDeepestExisting(abs);
  const ok = rootsFor(ctx).some((root) => norm(real) === norm(root) || norm(real).startsWith(norm(root) + path.sep));
  if (!ok) throw new Error('that path is outside the folders JARVIS may use (config/server/files.json)');
  return real;
}
// F4-4: where an action creates a file. write_file makes data and documents only, by type: nothing a shell or file manager runs on
// open or at start. A copy or move keeps its own type, so a program can be moved as itself but text is never renamed into a script.
// Nothing is written under a shell profile or startup folder, and a name with a stream (a:b) or a hidden name is refused.
const DATA_TYPES = new Set(['', '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.toml', '.tex', '.rtf', '.svg', '.ics']);
const AUTOLOAD_DIRS = new Set(['windowspowershell', 'powershell', 'startup', 'launchagents', 'launchdaemons']);
export function writablePath(raw, ctx, { also = null } = {}) {
  const p = safePath(raw, ctx);
  const name = path.basename(p);
  const ext = path.extname(name).toLowerCase();
  if (name.startsWith('.') || name.includes(':')) throw new Error('JARVIS does not write hidden files or file streams');
  if (!DATA_TYPES.has(ext) && !(also != null && also.toLowerCase() === ext)) throw new Error(`JARVIS does not create ${ext || 'that kind of'} files: scripts and programs could run on their own`);
  if (p.split(/[\\/]/).some((s) => AUTOLOAD_DIRS.has(s.toLowerCase()))) throw new Error('JARVIS does not write into a shell profile or startup folder');
  return p;
}
export function dirPath(raw, ctx) {
  const p = safePath(raw, ctx);
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('not a folder');
  return p;
}

export const ok = (data) => ({ ok: true, data });
export const fail = (error) => ({ ok: false, error });
// Clipboard text for the PC-Mac copy (server/api/ws.js clipboard.copy): whole up to CLIP_MAX, else marked so the server refuses it
// instead of pasting a cut copy. set_clipboard's maxLength in actions.json is the same number.
export const CLIP_MAX = 12_000;
export const clipboardText = (s) => { const t = String(s ?? ''); return t.length > CLIP_MAX ? { text: t.slice(0, CLIP_MAX), truncated: true, chars: t.length } : { text: t }; };
export const clipText = (s, n = 6000) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}\n[truncated ${t.length - n} characters]` : t; };
export const tryJson = (s, fallback = null) => { try { return JSON.parse(s); } catch { return fallback; } };
// ConvertTo-Json gives an object for one item and an array for several; callers want a list.
export const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Alias lookup in apps.json for this OS. Unknown names are refused, which is what makes open_app an allowlist.
export function resolveApp(name, ctx) {
  const key = String(name ?? '').toLowerCase().trim();
  if (!Object.hasOwn(ctx.apps, key)) throw new Error(`unknown app "${name}". Known: ${Object.keys(ctx.apps).join(', ')}`);
  const entry = ctx.apps[key];
  const target = entry[ctx.os];
  if (!target) throw new Error(`"${name}" is not available on this computer`);
  return { alias: key, target, args: entry.args ?? [] };
}
