// What the "Start JARVIS Old" shortcut runs. It does what run_JARVIS.bat did (go to the old JARVIS project and run
// `npm run tauri dev`, which starts Vite on :5173 and the desktop window) but with no console window, one copy at a time,
// and a log in data/logs/jarvis-old.log. The old project is not touched.
//   node scripts/launch-old.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { reachable } from './wake.js';

const OLD = process.env.JARVIS_OLD_DIR || path.join(process.env.USERPROFILE || '', 'Projects', 'JARVIS');
const VITE_PORT = 5173; // the old project's dev server (tauri.conf.json devUrl)

export async function launchOld({ dir = OLD, probe = reachable, run = spawn } = {}) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) throw new Error(`The old JARVIS project is not at ${dir}. Set JARVIS_OLD_DIR to its folder.`);
  if (await probe('127.0.0.1', VITE_PORT)) return { already: true }; // its window is already open (or starting)
  const logs = path.join(ROOT, 'data', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const out = fs.openSync(path.join(logs, 'jarvis-old.log'), 'a');
  const cmd = process.env.ComSpec || 'cmd.exe';
  run(cmd, ['/d', '/c', 'npm', 'run', 'tauri', 'dev'], { cwd: dir, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  return { already: false };
}

if (isMain(import.meta.url)) {
  launchOld().catch((e) => {
    fs.mkdirSync(path.join(ROOT, 'data', 'logs'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'data', 'logs', 'launch.log'), `${new Date().toISOString()} ${e.message}\n`);
    process.exit(1);
  });
}
