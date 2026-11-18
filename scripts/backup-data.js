// Backs up the runtime state in data/ (audit log, conversations, digests, reminders, tasks, state; NEVER the tokens) into
// data/backups/<timestamp>/, verifies the copied audit chain, and keeps the newest N (default 7, the newest is always kept).
//   node scripts/backup-data.js [--keep 7]        node scripts/restore-data.js <backup folder name>   (restore lives in this file too)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, dataPath } from '../server/core/config.js';
import { createAuditLog, auditKeyFor } from '../server/core/audit-log.js';
import { isMain } from '../shared/util.js';

export const KNOWN = ['audit', 'conversations', 'digests', 'telemetry', 'reminders.json', 'agent-tasks.json', 'state.json', 'scheduler-state.json', 'pending-approvals.json'];

export function backup(dataDir, { keep = 7, now = () => new Date() } = {}) {
  const root = path.join(dataDir, 'backups');
  const name = now().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(root, name);
  fs.mkdirSync(dest, { recursive: true });
  for (const k of KNOWN) { const src = path.join(dataDir, k); if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, k), { recursive: true }); }
  const v = fs.existsSync(path.join(dest, 'audit')) ? createAuditLog({ dir: path.join(dest, 'audit'), key: auditKeyFor(dataDir).key }).verify() : { ok: true, entries: 0 };
  if (!v.ok) throw new Error(`the copied audit log does not verify: ${v.errors[0]}`);
  const all = fs.readdirSync(root).sort();
  for (const old of all.slice(0, Math.max(0, all.length - Math.max(1, keep)))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return { name, auditEntries: v.entries };
}

// Restores only the known names from a backup folder, over the current data. The current files are first moved aside under data/restore-previous/.
export function restore(dataDir, name) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('bad backup name');
  const src = path.join(dataDir, 'backups', name);
  if (!fs.existsSync(src)) throw new Error('no such backup');
  const aside = path.join(dataDir, 'restore-previous', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const k of KNOWN) {
    const from = path.join(src, k);
    if (!fs.existsSync(from)) continue;
    const cur = path.join(dataDir, k);
    if (fs.existsSync(cur)) { fs.mkdirSync(aside, { recursive: true }); fs.renameSync(cur, path.join(aside, k)); }
    fs.cpSync(from, cur, { recursive: true });
  }
  return { restored: KNOWN.filter((k) => fs.existsSync(path.join(src, k))), previousKeptIn: aside };
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const keepArg = process.argv.indexOf('--keep');
  if (process.argv[2] && !process.argv[2].startsWith('--')) console.log(restore(cfg.dataDir, process.argv[2]));
  else console.log(backup(dataPath(cfg), { keep: keepArg === -1 ? 7 : Number(process.argv[keepArg + 1]) }));
}
