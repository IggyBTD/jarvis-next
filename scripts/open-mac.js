// Opens JARVIS on the Mac. If the PC's server is not answering, rings the PC's starter (scripts/pc-starter.js); if that is not
// reachable and data/wake.json exists, wakes the PC. Then opens the interface in its own window (Chrome or Edge app mode, else
// the default browser). Needs data/tokens/ui.token (copied by hand) and the PC address in config/server/machines.json.
//   node scripts/open-mac.js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, tokenPath, ROOT } from '../server/core/config.js';
import { reachable, wake } from './wake.js';
import { isMain, sleep, readJson } from '../shared/util.js';
import { applyBundle } from './update.js';

// Pulls the current Mac helper (this launcher, the agent, config except machines.json) from the PC. Never blocks opening: any failure is ignored.
export async function selfUpdate({ base, token, root = ROOT, fetchImpl = fetch, apply = applyBundle }) {
  try {
    const res = await fetchImpl(`${base}/api/bundle`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return apply(Buffer.from(await res.arrayBuffer()), root);
  } catch { return null; }
}

export async function bringUp({ server, token, probe = reachable, fetchImpl = fetch, wakeConf = null, wakeToken = '', wakeFn = wake, wait = sleep, log = console.log, waitMs = 120_000 }) {
  if (await probe(server.host, server.port)) return { ok: true };
  log('The JARVIS server is not answering. Asking the PC to start it...');
  const ring = () => fetchImpl(`http://${server.host}:${server.port + 1}/start`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
  if (!(await ring()) && wakeConf) {
    const w = await wakeFn({ conf: wakeConf, server, log, token: wakeToken, probe });
    return w.ok ? { ok: true } : { ok: false, reason: w.reason };
  }
  const t0 = Date.now(); let rang = false;
  while (Date.now() - t0 < waitMs) {
    if (await probe(server.host, server.port)) return { ok: true };
    await wait(2000);
    if (!rang && Date.now() - t0 > 10_000) { rang = true; await ring(); } // the first ring can land while the starter itself is still booting
  }
  return { ok: false, reason: 'The PC did not start JARVIS. Is the PC on and signed in, and is Tailscale connected on both? (The PC runs scripts/pc-starter.js at logon: node scripts/install.js --os win32 --apply.)' };
}

if (isMain(import.meta.url)) {
  const logFile = path.join(ROOT, 'data', 'logs', 'open-mac.log');
  const fail = (msg) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    console.error(msg);
    spawn('osascript', ['-e', `display dialog ${JSON.stringify(`JARVIS: ${msg}`)} buttons {"OK"} with icon caution`], { stdio: 'ignore' }).unref();
    process.exit(1);
  };
  const cfg = loadConfig({ only: ['machines.json'] });
  const url = new URL(cfg.machines.server.url);
  const server = { host: url.hostname, port: Number(url.port || 80) };
  const tokenFile = path.join(path.dirname(tokenPath(cfg, 'mac')), 'ui.token');
  if (!fs.existsSync(tokenFile)) fail(`Missing ${tokenFile}. Copy ui.token from the PC (data/tokens) by hand.`);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const wakeFile = path.join(ROOT, 'data', 'tokens', 'wake.token');
  const r = await bringUp({ server, token, wakeConf: readJson(path.join(ROOT, 'data', 'wake.json')), wakeToken: fs.existsSync(wakeFile) ? fs.readFileSync(wakeFile, 'utf8').trim() : '' });
  if (!r.ok) fail(r.reason);
  const up = await selfUpdate({ base: url.origin, token });
  if (up?.written.length) fs.appendFileSync(logFile, `${new Date().toISOString()} updated: ${up.written.join(', ')}
`); // ponytail: the new code runs from the next launch; a changed package.json needs node scripts/update.js once
  const target = `${url.origin}/#token=${token}`; // the #fragment is never sent anywhere
  if (process.env.JARVIS_NO_WINDOW) { console.log(`Would open ${url.origin}/ (JARVIS_NO_WINDOW is set)`); process.exit(0); } // for testing on another OS
  spawn('open', ['-a', 'Safari', target], { detached: true, stdio: 'ignore' }).unref(); // Safari has no app mode: File > Add to Dock gives a window of its own
}
