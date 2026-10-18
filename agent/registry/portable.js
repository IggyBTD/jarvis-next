// Actions implemented in plain JavaScript, identical on Windows and macOS. Anything that needs an OS program lives in
// win32.js or darwin.js. Every path goes through safePath (config/server/files.json roots); nothing here builds a shell string.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { action, safePath, dirPath, expandHome, spawnTracked } from './common.js';
import { parseLhm } from '../../shared/lhm.js';
import { gitSnapshot, gitChanges } from './git.js';
import { validate } from '../../shared/schema.js';

const GiB = 1024 ** 3;
const round = (n, d = 1) => Number(n.toFixed(d));
const SKIP = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);
const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const typeOf = (d) => (d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'link' : 'file');

function* walk(dir, { depth = 6, limit = 20_000 } = {}) {
  let count = 0;
  const stack = [[dir, 0]];
  while (stack.length) {
    const [cur, d] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.isSymbolicLink()) continue;
      const full = path.join(cur, e.name);
      if (++count > limit) return;
      yield { full, entry: e };
      if (e.isDirectory() && d < depth) stack.push([full, d + 1]);
    }
  }
}

const globRe = (g) => new RegExp(`^${g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

async function lhm(ctx) {
  const url = `${ctx.env.LHM_URL ?? 'http://127.0.0.1:8085'}/data.json`;
  const res = await ctx.fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`LibreHardwareMonitor answered ${res.status}`);
  return parseLhm(await res.json());
}

function wolPacket(mac) {
  const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

export const portable = {
  get_system_info: action({ async run(_a, ctx) {
    const cpus = os.cpus();
    return { os: process.platform, osVersion: ctx.facts?.os_version ?? os.release(), hostname: os.hostname(), user: os.userInfo().username, arch: os.arch(), cpu: cpus[0]?.model?.trim(), cores: cpus.length, memoryTotalGiB: round(os.totalmem() / GiB), memoryFreeGiB: round(os.freemem() / GiB), uptimeSeconds: Math.round(os.uptime()) };
  } }),
  cpu_usage: action({ async run(_a, ctx) {
    const snap = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 });
    const a = snap();
    await ctx.sleep(500);
    const b = snap();
    const total = b.total - a.total;
    return { loadPercent: total > 0 ? round((1 - (b.idle - a.idle) / total) * 100) : 0 };
  } }),
  uptime: action({ async run() { const s = Math.round(os.uptime()); return { seconds: s, human: `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h ${Math.floor(s % 3600 / 60)}m` }; } }),
  network_info: action({ async run() {
    return Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list ?? []).filter((i) => !i.internal).map((i) => ({ name, address: i.address, family: i.family, mac: i.mac })));
  } }),
  public_ip: action({ async run(_a, ctx) {
    const res = await ctx.fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`lookup failed (${res.status})`);
    return { ip: (await res.json()).ip };
  } }),
  wake_on_lan: action({
    describe: (a) => ({ would: `send a Wake-on-LAN broadcast to ${a.mac}` }),
    async run({ mac }) {
      if (!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(mac)) throw new Error('MAC address must look like aa:bb:cc:dd:ee:ff');
      await new Promise((resolve, reject) => {
        const s = dgram.createSocket('udp4');
        s.once('error', (e) => { s.close(); reject(e); });
        s.bind(() => { s.setBroadcast(true); s.send(wolPacket(mac), 9, '255.255.255.255', (e) => { s.close(); e ? reject(e) : resolve(); }); });
      });
      return { sentTo: mac };
    },
  }),
  gpu_usage: action({ async run(_a, ctx) { const m = await lhm(ctx); return { loadPercent: m.GPU_Compute_Load ?? null, vramUsedGiB: m.GPU_VRAM_Usage ?? null, vramTotalGiB: m.GPU_VRAM_Total ?? null, temperatureC: m.GPU_Temperature ?? null }; } }),
  temperatures: action({ async run(_a, ctx) { const m = await lhm(ctx); return { cpuC: m.CPU_Temperature ?? null, gpuC: m.GPU_Temperature ?? null, storageC: m.Storage_Temperature ?? null }; } }),

  // --- files -------------------------------------------------------------------------------------------------------------
  list_dir: action({ async run({ path: p }, ctx) {
    const dir = dirPath(p, ctx);
    const items = fs.readdirSync(dir, { withFileTypes: true }).slice(0, ctx.files.maxListEntries ?? 300).map((e) => {
      const s = stat(path.join(dir, e.name));
      return { name: e.name, type: typeOf(e), size: s?.isFile() ? s.size : null, modified: s?.mtime.toISOString() ?? null };
    });
    return { path: dir, items };
  } }),
  read_file: action({ async run({ path: p }, ctx) {
    const file = safePath(p, ctx);
    const s = stat(file);
    if (!s?.isFile()) throw new Error('not a file');
    const max = ctx.files.maxReadBytes ?? 200_000;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(s.size, max));
      fs.readSync(fd, buf, 0, buf.length, 0);
      if (buf.subarray(0, 4096).includes(0)) throw new Error('binary file');
      return { path: file, size: s.size, truncated: s.size > max, text: buf.toString('utf8') };
    } finally { fs.closeSync(fd); }
  } }),
  search_files: action({ async run({ path: p, pattern }, ctx) {
    const root = dirPath(p, ctx);
    const re = pattern.includes('*') ? globRe(pattern) : null;
    const needle = pattern.toLowerCase();
    const found = [];
    for (const { full, entry } of walk(root)) {
      const hit = re ? re.test(entry.name) : entry.name.toLowerCase().includes(needle);
      if (hit) found.push({ path: full, type: typeOf(entry) });
      if (found.length >= 100) break;
    }
    return { root, matches: found };
  } }),
  file_info: action({ async run({ path: p }, ctx) {
    const file = safePath(p, ctx);
    const s = stat(file);
    if (!s) throw new Error('does not exist');
    return { path: file, type: s.isDirectory() ? 'dir' : 'file', size: s.size, modified: s.mtime.toISOString(), created: s.birthtime.toISOString() };
  } }),
  find_duplicates: action({ async run({ path: p }, ctx) {
    const root = dirPath(p, ctx);
    const bySize = new Map();
    for (const { full, entry } of walk(root, { limit: 5000 })) {
      if (!entry.isFile()) continue;
      const s = stat(full);
      if (!s || s.size === 0 || s.size > 200 * 1024 * 1024) continue;
      bySize.set(s.size, [...(bySize.get(s.size) ?? []), full]);
    }
    const groups = new Map();
    for (const files of bySize.values()) {
      if (files.length < 2) continue;
      for (const f of files) { const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); groups.set(h, [...(groups.get(h) ?? []), f]); }
    }
    return { groups: [...groups.values()].filter((g) => g.length > 1).slice(0, 50) };
  } }),
  copy_file: action({ describe: (a) => ({ would: `copy ${a.from} to ${a.to}` }), async run({ from, to }, ctx) {
    const src = safePath(from, ctx);
    const dst = safePath(to, ctx);
    if (!stat(src)?.isFile()) throw new Error('source is not a file');
    if (fs.existsSync(dst)) throw new Error('destination already exists; nothing was overwritten');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    return { copied: dst };
  } }),
  move_file: action({ describe: (a) => ({ would: `move ${a.from} to ${a.to}` }), async run({ from, to }, ctx) {
    const src = safePath(from, ctx);
    const dst = safePath(to, ctx);
    if (!fs.existsSync(src)) throw new Error('source does not exist');
    if (fs.existsSync(dst)) throw new Error('destination already exists; nothing was overwritten');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.renameSync(src, dst); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(src);
    }
    return { moved: dst };
  } }),
  clean_downloads: action({
    describe: (a) => ({ would: a.apply ? 'move files older than 30 days from Downloads into Downloads/_old' : 'list files older than 30 days in Downloads' }),
    async run({ apply }, ctx) {
      const root = (ctx.files.roots[ctx.os] ?? []).map(expandHome).find((r) => /downloads$/i.test(r));
      if (!root) throw new Error('no Downloads folder in files.json');
      const dir = dirPath(root, ctx);
      const cutoff = Date.now() - 30 * 86_400_000;
      const old = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(dir, e.name)).filter((f) => (stat(f)?.mtimeMs ?? Infinity) < cutoff);
      if (!apply) return { proposal: old.map((f) => path.basename(f)), note: 'nothing moved; call again with apply=true to move these into _old' };
      const dest = path.join(dir, '_old');
      fs.mkdirSync(dest, { recursive: true });
      const moved = [];
      for (const f of old) { const t = path.join(dest, path.basename(f)); if (!fs.existsSync(t)) { fs.renameSync(f, t); moved.push(path.basename(f)); } }
      return { moved };
    },
  }),
  backup_folder: action({ describe: (a) => ({ would: `copy ${a.path} into the backup folder` }), async run({ path: p }, ctx) {
    const src = dirPath(p, ctx);
    const base = safePath(ctx.files.backupDir ?? path.join(ctx.workspaceDir, 'backups'), ctx);
    if (src === base || src.startsWith(base + path.sep)) throw new Error('refusing to back up the backup folder');
    const dst = path.join(base, `${path.basename(src)}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(base, { recursive: true });
    fs.cpSync(src, dst, { recursive: true, errorOnExist: true, filter: (s) => !SKIP.has(path.basename(s)) });
    return { backup: dst };
  } }),
  clear_temp_files: action({
    describe: (a) => ({ would: a.dryRun === false ? 'delete temporary files older than a day' : 'count temporary files older than a day' }),
    async run({ dryRun }, ctx) {
      const dir = fs.realpathSync(ctx.tmpDir ?? os.tmpdir());
      const cutoff = Date.now() - 86_400_000;
      let files = 0;
      let bytes = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const s = stat(full);
        if (!s || s.mtimeMs > cutoff) continue;
        files += 1;
        bytes += s.isFile() ? s.size : 0;
        if (dryRun === false) { try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* in use: skip */ } }
      }
      return { dryRun: dryRun !== false, items: files, megabytes: round(bytes / 1024 / 1024) };
    },
  }),

  // --- workspaces and dev servers ----------------------------------------------------------------------------------------
  list_workspaces: action({ async run(_a, ctx) { return Object.entries(ctx.workspaces).map(([name, w]) => ({ name, apps: w.apps ?? [], urls: (w.urls ?? []).length, folders: (w.folders ?? []).length, devCommands: Object.keys(w.devCommands ?? {}) })); } }),
  open_workspace: action({
    describe: (a, ctx) => ({ would: `open workspace ${a.name}`, workspace: ctx.workspaces[a.name] ?? null }),
    async run({ name }, ctx) {
      if (!Object.hasOwn(ctx.workspaces, name)) throw new Error(`unknown workspace "${name}". Known: ${Object.keys(ctx.workspaces).join(', ')}`);
      const w = ctx.workspaces[name];
      const opened = [];
      const failed = [];
      const step = async (label, act, args) => { const r = await ctx.call(act, args); (r.ok ? opened : failed).push(r.ok ? label : `${label}: ${r.error}`); };
      for (const app of w.apps ?? []) await step(`app ${app}`, 'open_app', { app });
      for (const url of w.urls ?? []) await step(`url ${url}`, 'open_url', { url });
      for (const f of w.folders ?? []) await step(`folder ${f}`, 'open_folder', { path: f });
      return { workspace: name, opened, failed };
    },
  }),
  close_workspace: action({
    describe: (a, ctx) => ({ would: `ask the apps of workspace ${a.name} to quit`, apps: ctx.workspaces[a.name]?.apps ?? [] }),
    async run({ name }, ctx) {
      if (!Object.hasOwn(ctx.workspaces, name)) throw new Error(`unknown workspace "${name}"`);
      const closed = [];
      for (const app of ctx.workspaces[name].apps ?? []) { const r = await ctx.call('close_app', { app }); if (r.ok) closed.push(app); }
      return { workspace: name, closed };
    },
  }),
  start_dev_server: action({ async run({ workspace, command }, ctx) {
    if (!Object.hasOwn(ctx.workspaces, workspace)) throw new Error(`unknown workspace "${workspace}"`);
    const cmds = ctx.workspaces[workspace].devCommands ?? {};
    if (!Object.hasOwn(cmds, command)) throw new Error(`unknown dev command "${command}". Known: ${Object.keys(cmds).join(', ') || 'none'}`);
    const [file, ...args] = cmds[command];
    const folder = ctx.workspaces[workspace].folders?.[0];
    const cwd = folder ? dirPath(folder, ctx) : ctx.workspaceDir;
    const pid = spawnTracked({ file: ctx.os === 'win32' && file === 'npm' ? 'npm.cmd' : file, args, cwd }, ctx.background, `dev:${workspace}:${command}`);
    return { started: `${workspace}/${command}`, pid };
  } }),
  stop_dev_server: action({ async run({ workspace, command }, ctx) {
    const entry = ctx.background.get(`dev:${workspace}:${command}`);
    if (!entry) throw new Error('that dev server was not started by JARVIS');
    entry.child.kill();
    return { stopped: `${workspace}/${command}` };
  } }),
  list_dev_servers: action({ async run(_a, ctx) { return [...ctx.background.entries()].filter(([k]) => k.startsWith('dev:')).map(([k, v]) => ({ name: k.slice(4), pid: v.child.pid, since: new Date(v.startedAt).toISOString() })); } }),

  git_snapshot: action({ run: ({ path: p, name }, ctx) => gitSnapshot(p, name, ctx) }),
  git_changes: action({ run: ({ path: p, name }, ctx) => gitChanges(p, name, ctx) }),

  // --- user scripts ------------------------------------------------------------------------------------------------------
  run_user_script: action({
    describe: (a) => ({ would: `run the pinned user script "${a.name}"` }),
    async run({ name, args }, ctx) {
      const entry = ctx.scripts.scripts.find((s) => s.name === name && s.platform === ctx.os);
      if (!entry) throw new Error(`no script "${name}" for this OS in config/server/scripts.json`);
      if (/[\\/]|\.\./.test(entry.file)) throw new Error('script file must be a plain file name inside scripts/user');
      const file = path.join(ctx.scriptsDir, entry.file);
      const body = fs.readFileSync(file);
      if (crypto.createHash('sha256').update(body).digest('hex') !== entry.sha256) throw new Error('script changed since it was pinned; update the sha256 in scripts.json after reviewing it');
      let params = {};
      if (args) { try { params = JSON.parse(args); } catch { throw new Error('args must be a JSON object'); } }
      const bad = validate(entry.params, params);
      if (bad.length) throw new Error(`bad script arguments: ${bad.join('; ')}`);
      const env = Object.fromEntries(Object.entries(params).map(([k, v]) => [`JARVIS_ARG_${k.replace(/\W/g, '_').toUpperCase()}`, String(v)]));
      const ext = path.extname(entry.file).toLowerCase();
      const spec = { '.ps1': ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file]], '.sh': ['/bin/sh', [file]], '.js': [process.execPath, [file]], '.applescript': ['osascript', [file]] }[ext];
      if (!spec) throw new Error(`unsupported script type ${ext}`);
      const r = await ctx.runProgram({ file: spec[0], args: spec[1], env, timeoutMs: 60_000, cwd: ctx.workspaceDir });
      return { exitCode: r.code, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 1000) };
    },
  }),
};

