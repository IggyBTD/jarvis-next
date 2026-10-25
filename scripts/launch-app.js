// What the "JARVIS NEXT" shortcut runs: makes sure the JARVIS server and this PC's agent are running (starting them in the
// background if not), then opens the app in its own window (Edge or Chrome in app mode: no tabs, no address bar, own taskbar
// icon, its own profile in data/app-profile). Starting it twice just opens another window.
//   node scripts/launch-app.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, tokenPath, ROOT } from '../server/core/config.js';
import { reachable } from './wake.js';
import { isMain, sleep } from '../shared/util.js';

const BROWSERS = {
  win32: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
};

function background(script, args, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  spawn(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
}

export async function launch({ platform = process.platform, probe = reachable, start = background, open = (exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(), exists = fs.existsSync, wait = sleep } = {}) {
  const cfg = loadConfig({ only: ['machines.json'] });
  const me = Object.keys(cfg.machines.machines).find((m) => cfg.machines.machines[m].os === platform);
  const port = cfg.machines.server.port ?? 7410;
  const logs = path.join(ROOT, 'data', 'logs');
  if (me && !(await probe('127.0.0.1', cfg.machines.machines[me].agentPort))) start('agent/index.js', ['--machine', me], path.join(logs, 'agent.log'));
  if (!(await probe('127.0.0.1', port))) start('server/index.js', [], path.join(logs, 'server.log'));
  for (let i = 0; i < 60 && !(await probe('127.0.0.1', port)); i++) await wait(500);
  if (!(await probe('127.0.0.1', port))) throw new Error(`The JARVIS server did not start. See ${path.join(logs, 'server.log')}`);
  const exe = (BROWSERS[platform] ?? []).find(exists);
  if (!exe) throw new Error('Edge or Chrome is needed to show the app window.');
  // the token goes in the #fragment: it is never sent anywhere, and the page removes it from the address at once
  const token = fs.readFileSync(path.join(path.dirname(tokenPath(cfg, me ?? 'pc')), 'ui.token'), 'utf8').trim();
  open(exe, [`--app=http://127.0.0.1:${port}/#token=${token}`, `--user-data-dir=${path.join(ROOT, 'data', 'app-profile')}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate']);
  return { exe };
}

if (isMain(import.meta.url)) {
  launch().catch((e) => {
    fs.mkdirSync(path.join(ROOT, 'data', 'logs'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'data', 'logs', 'launch.log'), `${new Date().toISOString()} ${e.message}\n`);
    process.exit(1);
  });
}
