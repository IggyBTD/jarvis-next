// Runs the same app four times side by side, one icon set each (tools/versions/versions.json).
//   node scripts/versions.mjs start [key]   (a Vite server and a Tauri window per version, tiled 2 x 2; with a key, only that one)
//   node scripts/versions.mjs stop
// Your normal `npm run tauri dev` (port 5174) is left alone.
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const only = process.argv[3];
const versions = JSON.parse(readFileSync('tools/versions/versions.json', 'utf8')).filter((v) => !only || v.key === only);
const PIDS = 'tools/versions/.pids.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = (cmd, env = {}) => { const c = spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...env } }); c.unref(); return c; };

if (process.argv[2] === 'stop') {
  const pids = existsSync(PIDS) ? JSON.parse(readFileSync(PIDS, 'utf8')) : [];
  for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ } }
  for (const v of versions) {
    try { execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${v.port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`, { stdio: 'ignore' }); } catch { /* none */ }
  }
  if (existsSync(PIDS)) unlinkSync(PIDS);
  console.log('stopped');
} else {
  const pids = [];
  for (const v of versions) {
    pids.push(launch(`npx vite --port ${v.port} --strictPort`, { VITE_ICON_SET: v.set }).pid);
    await sleep(2500);
    pids.push(launch(`npx tauri dev --config tools/versions/${v.key}.json`).pid);
    console.log(`${v.key}: ${v.set} on :${v.port}`);
    await sleep(only ? 0 : 7000); // the first one builds, the rest only wait for the build lock
  }
  const old = existsSync(PIDS) ? JSON.parse(readFileSync(PIDS, 'utf8')) : [];
  writeFileSync(PIDS, JSON.stringify([...old, ...pids]));
}
