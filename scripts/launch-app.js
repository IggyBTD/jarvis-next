// What the "JARVIS NEXT" shortcut runs: makes sure the JARVIS server and this PC's agent are running (starting them in the
// background if not), then opens the app in its own window (Edge or Chrome in app mode: no tabs, no address bar, own taskbar
// icon, its own profile in data/app-profile). Starting it twice just opens another window.
//   node scripts/launch-app.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadConfig, tokenPath, ROOT } from '../server/core/config.js';
import { reachable } from './wake.js';
import { isMain, sleep } from '../shared/util.js';

const BROWSERS = {
  win32: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
};

// Chrome and Edge name an installed web app from its manifest id (here the start URL): sha256, first 16 bytes, each hex digit as a letter a to p.
export const appId = (startUrl) => [...createHash('sha256').update(startUrl).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// Newest file change under these paths (files and folders, skipping node_modules and dist).
const newest = (paths) => {
  let t = 0;
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (!st.isDirectory()) { t = Math.max(t, st.mtimeMs); return; }
    for (const n of fs.readdirSync(p)) if (n !== 'node_modules' && n !== 'dist') walk(path.join(p, n));
  };
  paths.forEach((p) => walk(path.join(ROOT, p)));
  return t;
};
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

// Makes the window show the code as it is now, whichever way the app is opened: rebuilds dist/ when src/ changed, and stops a
// server that started before the last change to server/, shared/ or config/ (the launcher then starts a fresh one).
// ponytail: the agent (agent/) is not restarted; add it here if agent changes need to show up on launch too.
export async function freshen({ probe = reachable, port = 7410 } = {}) {
  if (newest(['src', 'index.html', 'vite.config.js', 'package.json']) > mtime(path.join(ROOT, 'dist', 'index.html'))) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
    if (r.status !== 0) fs.appendFileSync(path.join(ROOT, 'data', 'logs', 'launch.log'), `${new Date().toISOString()} build failed, opening the previous build
`);
  }
  const pidFile = path.join(ROOT, 'data', 'server.pid');
  if (mtime(pidFile) && newest(['server', 'shared', 'config']) > mtime(pidFile)) {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch { /* already gone */ }
    for (let i = 0; i < 20 && (await probe('127.0.0.1', port)); i++) await sleep(250);
  }
}

export function background(script, args, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  spawn(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
}

// install: open the profile in a normal window at the address, so the browser's "Install" button is there (one time, then the app has no browser title bar).
export async function launch({ install = false, platform = process.platform, probe = reachable, start = background, open = (exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(), exists = fs.existsSync, wait = sleep, refresh = freshen } = {}) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const me = Object.keys(cfg.machines.machines).find((m) => cfg.machines.machines[m].os === platform);
  const port = cfg.machines.server.port ?? 7410;
  const logs = path.join(ROOT, 'data', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  await refresh({ probe, port });
  if (me && !(await probe('127.0.0.1', cfg.machines.machines[me].agentPort))) start('agent/index.js', ['--machine', me], path.join(logs, 'agent.log'));
  if (!(await probe('127.0.0.1', port))) start('server/index.js', [], path.join(logs, 'server.log'));
  for (let i = 0; i < 60 && !(await probe('127.0.0.1', port)); i++) await wait(500);
  if (!(await probe('127.0.0.1', port))) throw new Error(`The JARVIS server did not start. See ${path.join(logs, 'server.log')}`);
  const exe = (BROWSERS[platform] ?? []).find(exists);
  if (!exe) throw new Error('Edge or Chrome is needed to show the app window.');
  // the token goes in the #fragment: it is never sent anywhere, and the page removes it from the address at once
  const token = fs.readFileSync(path.join(path.dirname(tokenPath(cfg, me ?? 'pc')), 'ui.token'), 'utf8').trim();
  const profile = path.join(ROOT, 'data', 'app-profile');
  const id = appId(`http://127.0.0.1:${port}/`);
  // Once installed (in this profile), start the installed app: it has no browser title bar. The page keeps the token it saved on the first run.
  const installed = fs.existsSync(path.join(profile, 'Default', 'Web Applications', 'Manifest Resources', id));
  const target = install ? [`http://127.0.0.1:${port}/#token=${token}`] : installed ? [`--app-id=${id}`] : [`--app=http://127.0.0.1:${port}/#token=${token}`];
  open(exe, [...target, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate']);
  return { exe, installed };
}

if (isMain(import.meta.url)) {
  launch({ install: process.argv.includes('--install') }).catch((e) => {
    fs.mkdirSync(path.join(ROOT, 'data', 'logs'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'data', 'logs', 'launch.log'), `${new Date().toISOString()} ${e.message}\n`);
    process.exit(1);
  });
}
