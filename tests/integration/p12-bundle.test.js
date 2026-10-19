import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { buildMacBundle } from '../../scripts/make-mac-bundle.js';
import { runProgram } from '../../agent/registry/common.js';
import { loadConfig } from '../../server/core/config.js';
import { generateTokens, loadTokens } from '../../server/core/auth.js';
import { tmpDir, rmDir, request, waitFor } from '../helpers.js';

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('the Mac bundle is small, leaves out the app, models, tests and tokens, and its agent starts from the unpacked folder alone', async () => {
  const out = tmpDir('bundle');
  const dest = tmpDir('unpacked');
  const data = tmpDir('bdata');
  let child;
  try {
    const b = await buildMacBundle({ outDir: out });
    assert.ok(b.bytes < 2 * 1024 * 1024, `${b.bytes} bytes`);
    for (const must of ['agent/index.js', 'agent/registry/darwin.js', 'agent/sidecars/opencode-manager.js', 'server/core/auth.js', 'server/core/config.js', 'shared/util.js', 'sidecars/browser-guard/server.js', 'config/server/actions.json', 'scripts/install.js', 'scripts/doctor.js', 'package.json']) assert.ok(b.files.includes(must), must);
    for (const f of b.files) assert.ok(!/^(src|src-tauri|models|node_modules|tests|data|dist|docs\/ui-shots)\//.test(f) && !/\.token$/.test(f), `must not ship ${f}`);
    assert.ok(!b.files.some((f) => /^server\/(api|voice|digest|telemetry|osint)\//.test(f) && f !== 'server/digest/google.js'), 'the server proper stays on the PC');
    const pkg = JSON.parse(fs.readFileSync(path.join(b.stage, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies), ['playwright']);

    const un = process.platform === 'win32' ? { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:Z -DestinationPath $env:D -Force'], env: { Z: b.zip, D: dest } } : { file: 'unzip', args: ['-q', b.zip, '-d', dest] };
    assert.equal((await runProgram({ ...un, timeoutMs: 60000 })).code, 0);
    const port = await freePort();
    const mpath = path.join(dest, 'config', 'server', 'machines.json');
    const m = JSON.parse(fs.readFileSync(mpath, 'utf8'));
    m.machines.pc.agentPort = port;
    fs.writeFileSync(mpath, JSON.stringify(m));
    const cfg = loadConfig({ configDir: path.join(dest, 'config', 'server'), dataDir: data });
    generateTokens(cfg);
    const token = loadTokens(cfg).machines.pc[0];
    child = spawn(process.execPath, [path.join(dest, 'agent', 'index.js'), '--machine', 'pc'], { cwd: dest, env: { ...process.env, JARVIS_ROOT: dest, JARVIS_DATA_DIR: data, JARVIS_OPENCODE: '0', JARVIS_BROWSER: '0' }, stdio: 'ignore' });
    const health = await waitFor(async () => { try { const r = await request(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` } }); return r.status === 200 ? r.json : null; } catch { return null; } }, { timeout: 15000, step: 200 });
    assert.equal(health.machine, 'pc');
  } finally { child?.kill(); await new Promise((r) => setTimeout(r, 200)); rmDir(out); rmDir(dest); rmDir(data); }
});
