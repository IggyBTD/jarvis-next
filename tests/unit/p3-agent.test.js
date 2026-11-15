import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { testConfig, tmpDir, rmDir, request, waitFor } from '../helpers.js';
import { createRegistry } from '../../agent/registry/mod.js';
import { createAgent } from '../../agent/index.js';
import { generateTokens, loadTokens } from '../../server/core/auth.js';
import { runProgram } from '../../agent/registry/common.js';
import { gitRun, dangerousKeys } from '../../agent/registry/git.js';
import { ipAllowed, resolveBind } from '../../shared/net.js';
import { parseLhm } from '../../shared/lhm.js';
import { sha256 } from '../../shared/util.js';

// A config whose file roots are a temp folder and in which every action is switched on.
function rig({ edit = () => {}, platform = 'win32', mock = null } = {}) {
  const root = tmpDir('roots');
  const calls = [];
  const t = testConfig((f) => {
    f['files.json'].roots = { win32: [root], darwin: [root] };
    f['machines.json'].machines.pc.workspaceDir = path.join(root, 'ws');
    f['machines.json'].machines.mac.workspaceDir = path.join(root, 'ws');
    for (const a of f['actions.json'].actions) a.enabled = true;
    edit(f);
  });
  const run = mock ?? (async (spec) => { calls.push(spec); return { code: 0, stdout: '', stderr: '' }; });
  const wrapped = async (spec) => { if (!mock) return run(spec); calls.push(spec); return run(spec); };
  const registry = createRegistry({ cfg: t.cfg, machineId: platform === 'win32' ? 'pc' : 'mac', os: platform, runProgram: wrapped, sleep: async () => {}, scriptsDir: path.join(root, 'scripts') });
  registry.ensureWorkspace();
  return { ...t, root, registry, calls, cleanup() { t.cleanup(); rmDir(root); } };
}

const SAMPLE = (root) => ({ app: 'notes', url: 'https://example.com', path: root, from: path.join(root, 'a.txt'), to: path.join(root, 'b.txt'), name: 'dev', workspace: 'dev', command: 'jarvis', level: 40, minutes: 5, count: 5, pid: 4242, port: 3000, host: 'example.com', mac: 'aa:bb:cc:dd:ee:ff', enabled: true, plan: 'balanced', priority: 'high', device: 'speakers', pattern: '*.txt', query: 'hello', text: 'hi', title: 'T', launch: 'steam', dryRun: true, apply: false, args: '{}', content: 'text', append: false, overwrite: false, paths: [path.join(root, 'a.txt')] });
const sampleArgs = (c, root) => Object.fromEntries(Object.keys(c.params.properties).map((k) => [k, c.params.properties[k].enum ? c.params.properties[k].enum[0] : SAMPLE(root)[k]]));

test('contract: every implementation is in actions.json; gaps per OS are exactly the documented ones', () => {
  for (const [platform, expectedMissing] of [
    ['win32', ['set_audio_output', 'night_light', 'transfer_file']],
    ['darwin', ['set_audio_output', 'set_brightness_is_present', 'transfer_file'].filter((n) => n !== 'set_brightness_is_present')],
  ]) {
    const r = rig({ platform });
    try {
      assert.deepEqual(r.registry.missing().sort(), expectedMissing.sort(), `unimplemented on ${platform}`);
      const names = new Set(r.cfg.actions.actions.map((a) => a.name));
      for (const a of r.registry.list()) assert.ok(names.has(a.name));
    } finally { r.cleanup(); }
  }
});

test('every available action on both OSes plans to a program with an argument array and never to a shell', async () => {
  for (const platform of ['win32', 'darwin']) {
    const r = rig({ platform });
    try {
      fs.writeFileSync(path.join(r.root, 'a.txt'), 'a');
      for (const a of r.registry.list()) {
        const c = r.cfg.actions.actions.find((x) => x.name === a.name);
        const out = await r.registry.execute(a.name, { args: sampleArgs(c, r.root), dryRun: true });
        if (!out.ok && /no AppleScript/.test(out.error)) continue; // needs an entry in scripts.json
        assert.equal(out.ok, true, `${platform} ${a.name}: ${out.error}`);
        for (const w of out.data.would ?? []) {
          if (typeof w !== 'object') continue;
          assert.ok(typeof w.program === 'string' && Array.isArray(w.args), `${a.name} plan shape`);
          assert.ok(!/^(cmd|sh|bash|zsh)(\.exe)?$/i.test(w.program), `${a.name} must not use a shell`);
        }
      }
    } finally { r.cleanup(); }
  }
});

test('MVP flow on win32 with a command-runner mock: volume, apps, lock, game mode', async () => {
  const seen = [];
  const r = rig({ mock: async (spec) => {
    seen.push(spec);
    if (spec.args.join(' ').includes('JarvisAudio')) return { code: 0, stdout: '{"volumePercent":30,"muted":false}\r\n', stderr: '' };
    return { code: 0, stdout: 'ok', stderr: '' };
  } });
  try {
    const v = await r.registry.execute('set_volume', { args: { level: 30 } });
    assert.deepEqual(v.data, { volumePercent: 30, muted: false });
    assert.equal(seen[0].env.JARVIS_A_level, '30');
    assert.ok(!seen[0].args.join(' ').includes('30;')); // the number travels in the environment, not in the script text
    assert.equal((await r.registry.execute('set_volume', { args: { level: 101 } })).ok, false);
    assert.match((await r.registry.execute('set_volume', { args: { level: 'loud' } })).error, /bad arguments/);

    const open = await r.registry.execute('open_app', { args: { app: 'spotify' } });
    assert.deepEqual(open.data, { started: 'spotify' });
    assert.equal(seen.at(-1).env.JARVIS_A_target, 'spotify');
    const unknown = await r.registry.execute('open_app', { args: { app: 'calc.exe & del *' } });
    assert.match(unknown.error, /unknown app/);

    assert.equal((await r.registry.execute('lock_screen')).ok, true);
    assert.deepEqual(seen.at(-1), { timeoutMs: 30000, file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] });

    seen.length = 0;
    const g = await r.registry.execute('game_mode_on', { args: { launch: 'steam' } });
    assert.equal(g.ok, true);
    assert.deepEqual(g.data.plan, 'high_performance');
    assert.deepEqual(g.data.closed.sort(), ['discord', 'spotify']);
    assert.ok(seen.some((s) => s.file === 'powercfg.exe' && s.args.includes('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')));
    assert.equal((await r.registry.execute('game_mode_off')).data.plan, 'balanced');
  } finally { r.cleanup(); }
});

test('a failing program becomes a readable error; a missing program does too', async () => {
  const r = rig({ mock: async (spec) => (spec.file === 'powercfg.exe' ? { code: 1, stdout: '', stderr: 'Access is denied.' } : { code: 0, stdout: '', stderr: '' }) });
  try {
    const out = await r.registry.execute('set_power_plan', { args: { plan: 'balanced' } });
    assert.deepEqual([out.ok, out.error], [false, 'Access is denied.']);
  } finally { r.cleanup(); }
  await assert.rejects(runProgram({ file: 'definitely-not-a-program-xyz', args: [] }), /cannot start/);
  await assert.rejects(runProgram({ file: 'node', args: [1] }), /array of strings/);
  const echo = await runProgram({ file: process.execPath, args: ['-e', 'process.stdout.write("a b")'] });
  assert.deepEqual([echo.code, echo.stdout], [0, 'a b']);
});

test('darwin: osascript values travel as argv, volume and memory parsing', async () => {
  const seen = [];
  const r = rig({ platform: 'darwin', mock: async (spec) => {
    seen.push(spec);
    if (spec.file === 'vm_stat') return { code: 0, stdout: 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:   1000.\nPages inactive:   500.\nPages speculative:   100.\n', stderr: '' };
    if (spec.file === 'sysctl') return { code: 0, stdout: '17179869184\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  } });
  try {
    const m = await r.registry.execute('memory_usage');
    assert.equal(m.data.totalGiB, 16);
    assert.ok(m.data.usedGiB > 15.9);
    await r.registry.execute('focus_app', { args: { app: 'notes' } });
    const f = seen.at(-1);
    assert.equal(f.file, 'osascript');
    assert.equal(f.args.at(-1), 'Notes');
    assert.ok(!f.args[1].includes('Notes'));
    assert.equal((await r.registry.execute('night_light', { args: { enabled: true } })).error, 'unsupported');
    await r.registry.execute('set_volume', { args: { level: 20.4 } }).then((o) => assert.equal(o.ok, false));
    assert.ok((await r.registry.execute('run_shortcut', { args: { name: 'x' } })).error);
  } finally { r.cleanup(); }
});

test('disabled and unsupported actions are refused; the OS list hides what cannot run', async () => {
  const r = rig({ edit: (f) => { f['actions.json'].actions.find((a) => a.name === 'shutdown').enabled = false; } });
  try {
    assert.match((await r.registry.execute('shutdown')).error, /disabled/);
    assert.equal((await r.registry.execute('set_brightness', { args: { level: 5 } })).error, 'unsupported'); // darwin only
    assert.equal((await r.registry.execute('no_such_action')).error, 'unknown action "no_such_action"');
    assert.ok(!r.registry.list().some((a) => a.name === 'set_brightness'));
    assert.ok(r.registry.list().some((a) => a.name === 'tile_windows'));
    assert.ok(!r.registry.list().some((a) => a.name === 'set_timer')); // server-side tool
  } finally { r.cleanup(); }
});

test('files: confined to the roots; traversal, absolute, UNC and symlink escapes are refused', async () => {
  const r = rig();
  const outside = tmpDir('outside');
  try {
    fs.writeFileSync(path.join(r.root, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    const ex = (n, a) => r.registry.execute(n, { args: a });
    assert.equal((await ex('read_file', { path: path.join(r.root, 'a.txt') })).data.text, 'hello');
    assert.equal((await ex('read_file', { path: 'a.txt' })).ok, false); // relative resolves against the workspace folder, which has no a.txt
    for (const bad of [path.join(outside, 'secret.txt'), path.join(r.root, '..', path.basename(outside), 'secret.txt'), '\\\\server\\share\\x', 'file:///etc/passwd', '']) {
      const out = await ex('read_file', { path: bad });
      assert.equal(out.ok, false, bad);
    }
    try {
      fs.symlinkSync(outside, path.join(r.root, 'link'), 'junction');
      assert.equal((await ex('read_file', { path: path.join(r.root, 'link', 'secret.txt') })).ok, false);
      assert.equal((await ex('list_dir', { path: path.join(r.root, 'link') })).ok, false);
    } catch (e) { if (!/EPERM|EACCES/.test(e.code)) throw e; }

    assert.equal((await ex('list_dir', { path: r.root })).data.items.some((i) => i.name === 'a.txt'), true);
    assert.equal((await ex('search_files', { path: r.root, pattern: '*.txt' })).data.matches.length >= 1, true);
    assert.equal((await ex('file_info', { path: path.join(r.root, 'a.txt') })).data.size, 5);
    fs.writeFileSync(path.join(r.root, 'bin.dat'), Buffer.from([1, 0, 2]));
    assert.match((await ex('read_file', { path: path.join(r.root, 'bin.dat') })).error, /binary/);

    const c = await ex('copy_file', { from: path.join(r.root, 'a.txt'), to: path.join(r.root, 'sub', 'a2.txt') });
    assert.equal(c.ok, true);
    assert.match((await ex('copy_file', { from: path.join(r.root, 'a.txt'), to: path.join(r.root, 'sub', 'a2.txt') })).error, /already exists/);
    assert.equal((await ex('move_file', { from: path.join(r.root, 'sub', 'a2.txt'), to: path.join(r.root, 'a3.txt') })).ok, true);
    assert.equal((await ex('move_file', { from: path.join(r.root, 'a3.txt'), to: path.join(outside, 'x.txt') })).ok, false);
    fs.writeFileSync(path.join(r.root, 'dup.txt'), 'hello');
    assert.equal((await ex('find_duplicates', { path: r.root })).data.groups.length, 1);
    assert.equal((await r.registry.execute('read_file', { args: { path: path.join(r.root, 'a.txt'), extra: 1 } })).ok, false);
  } finally { r.cleanup(); rmDir(outside); }
});

test('argument injection is refused: option-like hosts, container names, URL schemes, dev commands', async () => {
  const r = rig();
  try {
    const ex = (n, a) => r.registry.execute(n, { args: a });
    assert.match((await ex('ping', { host: '-f 8.8.8.8' })).error, /not a host/);
    assert.match((await ex('ping', { host: 'a;b' })).error, /not a host/);
    assert.match((await ex('docker_start', { name: '--privileged' })).error, /bad container/);
    assert.match((await ex('open_url', { url: 'javascript:alert(1)' })).error, /http and https/);
    assert.match((await ex('open_url', { url: 'file:///c:/windows/system32/cmd.exe' })).error, /http and https/);
    assert.match((await ex('start_dev_server', { workspace: 'dev', command: 'rm -rf /' })).error, /unknown dev command/);
    assert.match((await ex('kill_process', { pid: 4 })).error, /refusing/);
    assert.match((await ex('wake_on_lan', { mac: 'zz' })).error, /MAC address/);
  } finally { r.cleanup(); }
});

test('clear_temp_files defaults to a dry run (on a scratch folder, never the real temp folder)', async () => {
  const r = rig();
  const scratch = tmpDir('scratch-tmp');
  try {
    r.registry.ctx.tmpDir = scratch;
    const f = path.join(scratch, 'old.tmp');
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, new Date(Date.now() - 3 * 86_400_000), new Date(Date.now() - 3 * 86_400_000));
    const fresh = path.join(scratch, 'fresh.tmp');
    fs.writeFileSync(fresh, 'x');
    const dry = await r.registry.execute('clear_temp_files', { args: {} });
    assert.deepEqual([dry.data.dryRun, dry.data.items], [true, 1]);
    assert.ok(fs.existsSync(f));
    await r.registry.execute('clear_temp_files', { args: { dryRun: false } });
    assert.ok(!fs.existsSync(f));
    assert.ok(fs.existsSync(fresh));
  } finally { r.cleanup(); rmDir(scratch); }
});

test('user scripts: pinned hash, parameter schema, environment delivery', async () => {
  const body = 'echo hi';
  const r = rig({ edit: (f) => { f['scripts.json'].scripts = [{ name: 'hello', file: 'hello.ps1', sha256: sha256(body), tier: 'T1', platform: 'win32', params: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'], additionalProperties: false } }]; } });
  try {
    fs.mkdirSync(path.join(r.root, 'scripts'));
    fs.writeFileSync(path.join(r.root, 'scripts', 'hello.ps1'), body);
    const ok = await r.registry.execute('run_user_script', { args: { name: 'hello', args: '{"who":"Iggy"}' } });
    assert.equal(ok.ok, true);
    assert.equal(r.calls.at(-1).env.JARVIS_ARG_WHO, 'Iggy');
    assert.match((await r.registry.execute('run_user_script', { args: { name: 'hello', args: '{"bad":1}' } })).error, /bad script arguments/);
    assert.match((await r.registry.execute('run_user_script', { args: { name: 'nope' } })).error, /no script/);
    fs.writeFileSync(path.join(r.root, 'scripts', 'hello.ps1'), 'echo changed');
    assert.match((await r.registry.execute('run_user_script', { args: { name: 'hello', args: '{"who":"x"}' } })).error, /changed since it was pinned/);
  } finally { r.cleanup(); }
});

test('git: refuses repositories whose config can start programs; works on a clean one', async () => {
  const r = rig({ mock: null });
  const real = { ...r.registry.ctx, runProgram };
  try {
    const repo = path.join(r.root, 'repo');
    fs.mkdirSync(repo);
    const g = (...a) => runProgram({ file: 'git', args: ['-C', repo, ...a] });
    if ((await g('init')).code !== 0) return; // no git on this machine
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    const st = await gitRun('status', repo, real);
    assert.match(st.output, /f\.txt/);
    fs.appendFileSync(path.join(repo, '.git', 'config'), '[core]\n\tfsmonitor = touch /tmp/pwned\n');
    await assert.rejects(gitRun('status', repo, real), /can start programs/);
    fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n\tbare = false\n[diff "x"]\n\ttextconv = evil\n');
    await assert.rejects(gitRun('diff', repo, real), /can start programs/);
    fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n\tbare = false\n[alias]\n\tst = !evil\n');
    await assert.rejects(gitRun('status', repo, real), /can start programs/);
    const nested = path.join(r.root, 'gitfile');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, '.git'), 'gitdir: ../elsewhere');
    await assert.rejects(gitRun('status', nested, real), /\.git folder is required/);
    assert.deepEqual(dangerousKeys(['core.bare', 'core.fsmonitor', 'filter.lfs.clean', 'user.name']), ['core.fsmonitor', 'filter.lfs.clean']);
  } finally { r.cleanup(); }
});

test('helpers: CIDR allowlist, auto bind, LibreHardwareMonitor mapping', () => {
  assert.equal(ipAllowed('100.101.2.3', ['100.64.0.0/10']), true);
  assert.equal(ipAllowed('100.128.0.1', ['100.64.0.0/10']), false);
  assert.equal(ipAllowed('::ffff:127.0.0.1', ['127.0.0.1']), true);
  assert.equal(ipAllowed('8.8.8.8', ['192.168.0.0/16', '::1']), false);
  const ifc = (a) => ({ eth: [{ family: 'IPv4', address: a, internal: false }] });
  assert.equal(resolveBind('auto', ifc('100.80.1.1')).host, '100.80.1.1');
  assert.equal(resolveBind('auto', ifc('192.168.1.5')).host, '192.168.1.5');
  assert.equal(resolveBind('auto', ifc('8.8.4.4')).host, '127.0.0.1');
  assert.equal(resolveBind('127.0.0.1', {}).reason, 'configured');
  const sensor = (Text, Value, SensorId, RawValue) => ({ Text, Value, SensorId, RawValue, Children: [] });
  const m = parseLhm({ Text: 'Sensor', Children: [sensor('CPU Total', '25.0 %', '/amdcpu/0/load/0'), sensor('Memory Used', '12.0 GB', '/ram/data/0'), sensor('Memory Available', '20.0 GB', '/ram/data/1'), sensor('GPU Memory Used', '2048.0 MB', '/gpu-amd/5/smalldata/0'), sensor('GPU Core', '65.0 °C', '/gpu-amd/5/temperature/0'), sensor('Upload Speed', '1 KB/s', '/nic/e/throughput/7', '1024 B/s'), sensor('Download Speed', '2 KB/s', '/nic/e/throughput/8', '2048 B/s')] });
  assert.deepEqual([m.CPU_Load, m.Memory_Total, m.GPU_VRAM_Usage, m.GPU_Temperature, m.Network_Speed_Bps], [25, 32, 2, 65, 3072]);
});

test('agent HTTP: auth, caller allowlist, origin, other machine token, shell route, actions, events', async () => {
  const r = rig({ platform: 'win32', mock: async () => ({ code: 0, stdout: '{"volumePercent":10,"muted":false}', stderr: '' }) });
  generateTokens(r.cfg);
  const tokens = loadTokens(r.cfg);
  const events = new EventEmitter();
  const opencodeSeen = [];
  const agent = createAgent({ cfg: r.cfg, machineId: 'pc', registry: r.registry, tokens, sidecars: { opencode: { events, status: () => ({ running: true }), proxy: (req, res, sub) => { opencodeSeen.push(sub); res.end('proxied'); } } } });
  const addr = await agent.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}`;
  const auth = { authorization: `Bearer ${tokens.machines.pc[0]}` };
  try {
    assert.equal((await request(`${url}/health`)).status, 401);
    assert.equal((await request(`${url}/health`, { headers: { authorization: 'Bearer wrongwrongwrongwrong' } })).status, 401);
    assert.equal((await request(`${url}/health`, { headers: { authorization: `Bearer ${tokens.ui[0]}` } })).status, 403);
    assert.equal((await request(`${url}/health`, { headers: { authorization: `Bearer ${tokens.machines.mac[0]}` } })).status, 403);
    assert.equal((await request(`${url}/health`, { headers: { ...auth, origin: 'http://evil.example' } })).status, 403);
    const health = await request(`${url}/health`, { headers: auth });
    assert.equal(health.json.machine, 'pc');
    assert.equal(health.json.sidecars.opencode.running, true);
    assert.equal((await request(`${url}/info`, { headers: auth })).json.workspace_dir, r.registry.ctx.workspaceDir);
    assert.ok((await request(`${url}/actions`, { headers: auth })).json.actions.length > 80);

    const act = await request(`${url}/action/set_volume`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: { args: { level: 10 } } });
    assert.equal(act.json.ok, true);
    const dry = await request(`${url}/action/set_volume`, { method: 'POST', headers: auth, body: { args: { level: 10 }, dryRun: true } });
    assert.equal(dry.json.data.dryRun, true);
    assert.equal((await request(`${url}/action/Set-Volume`, { method: 'POST', headers: auth, body: '{}' })).status, 404);
    assert.equal((await request(`${url}/action/set_volume`, { method: 'POST', headers: auth, body: 'not json' })).status, 400);
    assert.equal((await request(`${url}/nothing`, { headers: auth })).status, 404);

    for (const bad of ['/opencode/session/abc/shell', '/opencode/session/abc/shell/', '/opencode/x/../session/abc/shell', '/opencode/session/abc%2Fshell']) {
      const res = await request(`${url}${bad}`, { method: 'POST', headers: auth, body: '{}' });
      assert.ok([403, 404].includes(res.status), bad);
    }
    assert.deepEqual(opencodeSeen, []);
    assert.equal((await request(`${url}/opencode/session`, { headers: auth })).text, 'proxied');
    assert.equal((await request(`${url}/browser/x`, { headers: auth })).status, 503);

    // SSE: sidecar events reach /events
    const got = [];
    const sse = http.get(`${url}/events`, { headers: auth }, (res) => res.on('data', (c) => got.push(String(c))));
    await waitFor(() => got.join('').includes('connected'));
    events.emit('event', { type: 'permission.asked', id: 'p1' });
    await waitFor(() => got.join('').includes('permission.asked'));
    sse.destroy();
  } finally { await agent.close(); r.cleanup(); }

  // a caller that is not on the allowlist is refused even with a valid token
  const r2 = rig({ edit: (f) => { f['machines.json'].machines.pc.allowedCallers = ['10.9.9.9']; } });
  generateTokens(r2.cfg);
  const t2 = loadTokens(r2.cfg);
  const a2 = createAgent({ cfg: r2.cfg, machineId: 'pc', registry: r2.registry, tokens: t2 });
  const ad = await a2.listen(0, '127.0.0.1');
  try { assert.equal((await request(`http://127.0.0.1:${ad.port}/health`, { headers: { authorization: `Bearer ${t2.machines.pc[0]}` } })).status, 403); } finally { await a2.close(); r2.cleanup(); }
});

test('write_file: saves text inside the roots; never overwrites unless asked; append adds; a folder, an outside path and a non-text value are refused', async () => {
  const r = rig();
  const outside = tmpDir('outside-w');
  try {
    const ex = (a) => r.registry.execute('write_file', { args: a });
    const file = path.join(r.root, 'essay.md');
    const made = await ex({ path: file, content: '# Title\n' });
    assert.equal(made.ok, true);
    assert.equal(made.data.characters, 8);
    assert.equal(fs.readFileSync(file, 'utf8'), '# Title\n');
    const again = await ex({ path: file, content: 'x' });
    assert.equal(again.ok, false); // never overwrites by default
    assert.match(again.error, /already exists/);
    assert.equal(fs.readFileSync(file, 'utf8'), '# Title\n');
    assert.equal((await ex({ path: file, content: 'More text.\n', append: true })).ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), '# Title\nMore text.\n');
    assert.equal((await ex({ path: file, content: 'new', overwrite: true })).ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.equal((await ex({ path: 'notes/relative.md', content: 'in the workspace' })).ok, true); // a relative path goes in the workspace folder
    assert.equal(fs.readFileSync(path.join(r.root, 'ws', 'notes', 'relative.md'), 'utf8'), 'in the workspace');
    assert.equal((await ex({ path: r.root, content: 'x', overwrite: true })).ok, false); // a folder
    assert.equal((await ex({ path: path.join(outside, 'x.md'), content: 'x' })).ok, false); // outside the roots
    assert.equal(fs.existsSync(path.join(outside, 'x.md')), false);
    assert.equal((await ex({ path: file, content: 42 })).ok, false); // not text
  } finally { rmDir(outside); r.cleanup(); }
});
