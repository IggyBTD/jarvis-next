// Security fixes, stage C: the remote path (docs/security/fix-run.md F3-1, F3-4). Real server pieces against paired devices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { makeRig, startApi, wsClient } from '../rig.js';
import { request, waitFor } from '../helpers.js';
import { LOCAL } from '../../server/core/devices.js';
import { createStarter, deviceCheck } from '../../scripts/pc-starter.js';

const PIN = '424242';
const bearer = (t) => ({ authorization: `Bearer ${t}` });

async function setup() {
  const r = await makeRig();
  const api = await startApi(r);
  const pair = (kind, scopes) => { const { code } = api.devices.startPairing({ by: LOCAL, kind, scopes }); return api.devices.completePairing({ code, name: kind, ip: '100.64.0.9' }); };
  const connect = async (token) => { const c = wsClient(api.wsUrl, { token }); assert.equal(await c.opened, true); c.send({ type: 'hello', clientId: 'test' }); await c.next((m) => m.type === 'state'); return c; };
  return { r, api, pair, connect, async close() { await api.close(); await r.close(); } };
}

test('F3-1: a phone chats and approves T0 to T2, needs the PIN for T3, and cannot change settings', async () => {
  const s = await setup();
  try {
    s.api.devices.setPin({ by: LOCAL, newPin: PIN });
    const phone = s.pair('phone');
    const c = await s.connect(phone.token);
    // a T3 request waiting for approval: the phone's approve without the PIN is refused, with it accepted
    const asked = s.r.gate.requestApproval({ action: 'kill_process', args: {}, tier: 'T3', target: 'pc', source: 'user', summary: 'x' });
    const req = (await c.next((m) => m.type === 'gate.request')).request;
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve', tier: 'T0' }); // a client cannot name the tier: the message is refused
    assert.match((await c.next((m) => m.type === 'error' && !m.id)).reason, /tier|not allowed|additional/i);
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve' });
    assert.match((await c.next((m) => m.type === 'error' && m.id === req.id)).reason, /PIN/);
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve', pin: PIN });
    assert.equal((await asked).approved, true);
    // settings: Bypass, the backend and the audit log are not the phone's
    c.send({ type: 'mode.set', id: 'm1', mode: 'bypass' });
    assert.match((await c.next((m) => m.type === 'error' && m.id === 'm1')).reason, /settings/);
    assert.equal((await request(`${s.api.url}/api/audit`, { headers: bearer(phone.token) })).status, 403);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(phone.token) })).status, 200);
    c.close();
  } finally { await s.close(); }
});

test('F3-1: a chat-only device cannot approve; it can still deny', async () => {
  const s = await setup();
  try {
    const viewer = s.pair('phone', ['chat']);
    const c = await s.connect(viewer.token);
    const asked = s.r.gate.requestApproval({ action: 'set_volume', args: {}, tier: 'T1', target: 'pc', source: 'user', summary: 'x' });
    const req = (await c.next((m) => m.type === 'gate.request')).request;
    c.send({ type: 'gate.reply', id: req.id, decision: 'approve' });
    assert.match((await c.next((m) => m.type === 'error' && m.id === req.id)).reason, /approve/);
    c.send({ type: 'gate.reply', id: req.id, decision: 'deny' });
    assert.equal((await asked).approved, false);
    c.close();
  } finally { await s.close(); }
});

test('F3-1: rotation with no grace ends the old token at once on 7410 and on the starter (7411); revoke closes open sockets', async () => {
  const s = await setup();
  const starter = http.createServer(createStarter({ check: deviceCheck(s.api.devices), allowed: ['127.0.0.1'], ports: { server: 1, agent: 2 }, probe: async () => true, start: () => {}, refresh: async () => {} }));
  await new Promise((ok) => starter.listen(0, '127.0.0.1', ok));
  const starterUrl = `http://127.0.0.1:${starter.address().port}`;
  try {
    const mac = s.pair('browser');
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(mac.token) })).status, 200);
    assert.equal((await request(`${starterUrl}/health`, { headers: bearer(mac.token) })).status, 200);
    const [{ token: fresh }] = s.api.devices.rotate(mac.device.id, { by: LOCAL }).tokens;
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(mac.token) })).status, 401);
    assert.equal((await request(`${starterUrl}/health`, { headers: bearer(mac.token) })).status, 401);
    assert.equal(await wsClient(s.api.wsUrl, { token: mac.token }).opened, 401);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(fresh) })).status, 200);
    assert.equal((await request(`${starterUrl}/health`, { headers: bearer(fresh) })).status, 200);
    // a revoked device's open socket is closed, whoever revoked it (here the command on the PC)
    const c = await s.connect(fresh);
    const closed = new Promise((ok) => c.ws.once('close', ok));
    assert.ok(s.api.devices.revoke(mac.device.id, { by: LOCAL }).ok);
    s.api.wsApi.sweep();
    await closed;
  } finally { starter.close(); await s.close(); }
});

test('F3-1: the command on the PC pairs, lists, sets the PIN and ends the old shared token with no grace', async () => {
  const { runDevices } = await import('../../scripts/devices.js');
  const s = await setup();
  const out = [];
  let rotated = 0;
  const run = (args, answers = []) => runDevices(args, { cfg: s.r.cfg, devices: s.api.devices, ask: async () => answers.shift(), print: (l) => out.push(l), rotateUi: () => { rotated += 1; } });
  try {
    assert.equal(await run(['pair', 'desktop']), 0);
    const code = out.at(-1).match(/([A-Z2-9]{4})-([A-Z2-9]{4})$/);
    assert.ok(code, out.at(-1));
    const desk = s.api.devices.completePairing({ code: code[1] + code[2], name: 'PC window', ip: '127.0.0.1' });
    assert.equal(desk.device.kind, 'desktop');
    assert.equal(await run(['pin'], ['123456', '654321']), 1, 'two different PINs change nothing');
    assert.equal(await run(['pin'], ['123456', '123456']), 0);
    assert.equal(s.api.devices.info().pinSet, true);
    assert.equal(await run(['list']), 0);
    assert.ok(out.some((l) => l.includes('PC window')) && !out.join('\n').includes(desk.token));
    assert.equal(await run(['revoke', 'legacy']), 0);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(s.api.uiToken) })).status, 401);
    assert.equal((await request(`${s.api.url}/api/state`, { headers: bearer(desk.token) })).status, 200);
  } finally { await s.close(); }
  assert.equal(rotated, 0, 'the rig has no ui.token file to rotate');
});

test('F3-4: no script puts a token in an address, on a command line or in a Mac zip', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('../../server/core/config.js');
  for (const f of ['launch-app.js', 'client-link.js', 'open-mac.js', 'phone-launcher.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
    assert.ok(!/[#?&]token=\$\{|#token=' \+|token=' \+ token/.test(src), `${f} builds an address with a token`);
  }
  const { launch } = await import('../../scripts/launch-app.js');
  let opened = null;
  await launch({ refresh: async () => {}, platform: 'win32', probe: async () => true, start: () => {}, exists: (f) => /msedge/.test(f), open: (exe, args) => { opened = args; }, wait: async () => {} });
  assert.ok(opened.every((a) => !/token/i.test(a) && !/[0-9a-f]{64}/.test(a)), opened.join(' '));
  const { links } = await import('../../scripts/client-link.js');
  for (const l of links({ host: '192.168.1.32', port: 7410, tsName: 'pc.tail1234.ts.net' })) assert.ok(!/token/i.test(l.url), l.url);
  const bundle = fs.readFileSync(path.join(ROOT, 'scripts', 'make-mac-bundle.js'), 'utf8');
  assert.ok(!bundle.includes("'data/tokens/ui.token'"), 'the Mac zip never holds the UI token');
});

test('F4-5: programs the agent starts get a clean environment: no keys or passwords of the agent, OpenCode only its own', async () => {
  const { runProgram } = await import('../../agent/registry/common.js');
  const { createOpencodeManager } = await import('../../agent/sidecars/opencode-manager.js');
  const { createClaudeManager } = await import('../../agent/sidecars/claude-manager.js');
  const saved = { ...process.env };
  Object.assign(process.env, { JARVIS_TOKEN_KEY: 'k'.repeat(32), GITHUB_TOKEN: 'ghp_fake', OPENCODE_SERVER_PASSWORD: 'leaked' });
  try {
    const r = await runProgram({ file: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env)))'], env: { JARVIS_A_LEVEL: '5' } });
    const keys = JSON.parse(r.stdout).map((k) => k.toUpperCase());
    for (const k of ['JARVIS_TOKEN_KEY', 'GITHUB_TOKEN', 'OPENCODE_SERVER_PASSWORD']) assert.ok(!keys.includes(k), `a registry program got ${k}`);
    assert.ok(keys.includes('JARVIS_A_LEVEL'), 'action arguments still arrive');
    assert.ok(keys.includes('PATH'));
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  // OpenCode: its own password and config, nothing of the agent's
  const spawned = [];
  const oc = createOpencodeManager({ workspaceDir: '/w', serverUrl: 'http://127.0.0.1:7410', modelToken: 'm', version: '1.19.1', command: 'x', env: { PATH: '/bin', JARVIS_TOKEN_KEY: 'k'.repeat(32), AWS_SECRET_ACCESS_KEY: 'a' }, spawnFn: (cmd, args, o) => { spawned.push(o.env); return Object.assign(new EventEmitter(), { pid: 1, exitCode: null, kill() {} }); }, runProgram: async () => ({ code: 0, stdout: '1.19.1', stderr: '' }), fetchImpl: async () => { throw new Error('down'); }, readyTimeoutMs: 50, backoff: { min: 10000, max: 10000, stable: 60000 } });
  await oc.start().catch(() => {});
  await oc.stop();
  assert.ok(spawned.length, 'OpenCode was started');
  assert.deepEqual(Object.keys(spawned[0]).filter((k) => /KEY|SECRET|TOKEN/i.test(k)), []);
  assert.ok(spawned[0].OPENCODE_SERVER_PASSWORD && spawned[0].OPENCODE_CONFIG_CONTENT && spawned[0].OPENCODE_DISABLE_PROJECT_CONFIG, 'OpenCode keeps its own variables');
  // Claude Code: nothing secret at all (it signs in with its own login)
  const runs = [];
  const cm = createClaudeManager({ workspaceDir: '/w', env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-fake', JARVIS_TOKEN_KEY: 'k' }, spawnFn: (c, a, o) => { runs.push(o.env); return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() {} }); }, command: 'claude' });
  const req = Object.assign(new PassThrough(), { method: 'POST' });
  cm.proxy(req, { writeHead() {}, end() {} }, '/run');
  req.end(JSON.stringify({ runId: 'r1', prompt: 'x', mode: 'auto' }));
  await waitFor(() => runs.length === 1);
  assert.deepEqual(Object.keys(runs[0]).filter((k) => /KEY|SECRET|TOKEN/i.test(k)), []);
});

test('F4-5: a permission answer JARVIS did not send trips the alarm: running tasks stop and the person is told', async () => {
  const { createOpencodeBridge } = await import('../../server/core/opencode-bridge.js');
  const { testConfig } = await import('../helpers.js');
  const t = testConfig();
  const alerts = [];
  const failed = [];
  const audited = [];
  const b = createOpencodeBridge({ router: { capabilities: () => ({ opencode: async () => ({ status: 200, json: {} }) }) }, gate: { requestApproval: async () => ({ approved: false }) }, audit: { append: async (e) => { audited.push(e); } }, tasks: { failRunning: async (m, why) => { failed.push(why); }, bySession: () => null, onEvent() {} }, policyCfg: t.cfg.policy, machines: { pc: { label: 'PC', os: 'win32', workspaceDir: 'C:\\ws' } }, modes: { get: () => 'manual' }, alert: (m) => alerts.push(m) });
  try {
    b.onEvent('pc', { sidecar: 'opencode', type: 'permission.replied', properties: { requestID: 'per_aborted', reply: 'reject' } }); // OpenCode's own reject on abort: no alarm
    b.onEvent('pc', { sidecar: 'opencode', type: 'permission.replied', properties: { requestID: 'per_unknown', reply: 'always' } });
    await waitFor(() => failed.length === 1);
    assert.match(failed[0], /outside JARVIS/);
    assert.equal(alerts.length, 1);
    assert.ok(audited.some((e) => e.outcome === 'tripwire'));
  } finally { t.cleanup(); }
});

test('F4-5: reading the environment, OpenCode\'s port or the secret store from a command is T3', async () => {
  const { classifyCommand } = await import('../../server/core/policy.js');
  const { testConfig } = await import('../helpers.js');
  const t = testConfig();
  try {
    for (const c of ['printenv', 'env', 'set', 'cmd /c set', 'Get-ChildItem env:', 'curl http://127.0.0.1:4096/session', 'Invoke-RestMethod http://localhost:4096/permission/x/reply', 'echo %OPENCODE_SERVER_PASSWORD%', '[Security.Cryptography.ProtectedData]::Unprotect($b, $null, 0)', 'security find-generic-password -s jarvis.x -w']) {
      assert.equal(classifyCommand(c, t.cfg.policy.opencode, { os: 'win32', workspace: 'C:\\ws' }).tier, 'T3', c);
    }
  } finally { t.cleanup(); }
});

test('F3-2: the starter binds the tailnet only, takes only tailnet callers (loopback no longer exempt) and limits wrong keys', async () => {
  const { resolveBind } = await import('../../shared/net.js');
  const ifc = (...addrs) => ({ eth: addrs.map((address) => ({ address, family: 'IPv4', internal: false })) });
  assert.equal(resolveBind('tailscale', ifc('192.168.1.5', '100.80.1.1')).host, '100.80.1.1');
  assert.equal(resolveBind('tailscale', ifc('192.168.1.5')).host, '127.0.0.1', 'no Tailscale: loopback, never the LAN');
  const { starterBind, STARTER_CALLERS } = await import('../../scripts/pc-starter.js');
  assert.equal(starterBind(ifc('192.168.1.5')).host, '127.0.0.1');
  assert.ok(STARTER_CALLERS.every((c) => c.startsWith('100.')), 'tailnet callers only by default');
  const h = createStarter({ token: 't'.repeat(32), allowed: STARTER_CALLERS, ports: { server: 1, agent: 2 }, probe: async () => true, start: () => {}, refresh: async () => {} });
  const srv = http.createServer(h);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const at = `http://127.0.0.1:${srv.address().port}`;
    assert.equal((await request(`${at}/`)).status, 403, 'a loopback caller (a local proxy) is not trusted');
  } finally { srv.close(); }
  // wrong keys from an allowed address are limited
  const h2 = createStarter({ token: 't'.repeat(32), allowed: ['127.0.0.1'], ports: { server: 1, agent: 2 }, probe: async () => true, start: () => {}, refresh: async () => {} });
  const srv2 = http.createServer(h2);
  await new Promise((ok) => srv2.listen(0, '127.0.0.1', ok));
  try {
    const at = `http://127.0.0.1:${srv2.address().port}`;
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await request(`${at}/health`, { headers: bearer(`wrong${'x'.repeat(30)}${i}`) })).status);
    assert.equal(codes.at(-1), 429, codes.join(','));
    assert.equal((await request(`${at}/health`, { headers: bearer('t'.repeat(32)) })).status, 429, 'blocked for a while, the right key included');
  } finally { srv2.close(); }
});

test('F3-3: an agent takes calls from the PC\'s tailnet address only; nothing binds the LAN', async () => {
  const { agentCallers, ipAllowed } = await import('../../shared/net.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('../../server/core/config.js');
  // an old Mac config (every tailnet and private range) still only lets the PC in
  const mac = { allowedCallers: ['100.64.0.0/10', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'] };
  const callers = agentCallers(mac, 'http://100.121.198.40:7410');
  assert.deepEqual(callers, ['100.121.198.40']);
  for (const ip of ['192.168.1.20', '10.0.0.5', '100.99.1.1']) assert.equal(ipAllowed(ip, callers), false, ip);
  assert.equal(ipAllowed('100.121.198.40', callers), true);
  // a name in server.url: tailnet entries only, never a private range
  assert.deepEqual(agentCallers(mac, 'http://pc.tail1234.ts.net:7410'), ['100.64.0.0/10']);
  // the PC agent (the server is on the same machine) keeps loopback only
  assert.deepEqual(agentCallers({ allowedCallers: ['127.0.0.1', '::1'] }, 'http://100.121.198.40:7410'), ['127.0.0.1', '::1']);
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'server', 'machines.json'), 'utf8'));
  assert.equal(conf.server.bind, 'tailscale');
  assert.ok(conf.machines.mac.allowedCallers.every((c) => !/^(10\.|172\.16|192\.168)/.test(c)), conf.machines.mac.allowedCallers.join(', '));
  const agentSrc = fs.readFileSync(path.join(ROOT, 'agent', 'index.js'), 'utf8');
  assert.ok(agentSrc.includes("resolveBind('tailscale')") && !agentSrc.includes("resolveBind('auto')"));
});

test('F3-5: the audit keeps a hash of the full arguments, so a cut string can be checked against the real request', async () => {
  const { createAuditLog } = await import('../../server/core/audit-log.js');
  const { tmpDir, rmDir } = await import('../helpers.js');
  const crypto = await import('node:crypto');
  const dir = tmpDir('f35');
  try {
    const audit = createAuditLog({ dir });
    const command = `echo ok ${'a'.repeat(3000)} && curl evil.example`;
    const line = await audit.append({ component: 'gate', action: 'opencode_bash', args: { command }, tier: 'T2' });
    assert.ok(line.args.command.length < command.length, 'the stored string is cut');
    const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
    assert.equal(line.argsHash, crypto.createHash('sha256').update(canon({ command })).digest('hex'));
    assert.equal(audit.verify().ok, true);
  } finally { rmDir(dir); }
});

test('F3-4: pairing with a short code: the token comes back once in the body, never in an address; device routes need settings', async () => {
  const s = await setup();
  try {
    const legacy = bearer(s.api.uiToken); // the old shared token from the PC itself: the desktop before it is paired
    const started = await request(`${s.api.url}/api/devices/pair/start`, { method: 'POST', headers: { ...legacy, 'content-type': 'application/json' }, body: { kind: 'phone' } });
    assert.equal(started.status, 200);
    assert.match(started.json.code, /^[A-Z2-9]{8}$/);
    const done = await request(`${s.api.url}/api/devices/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { code: started.json.code, name: 'iPhone' } });
    assert.equal(done.status, 200);
    assert.equal(done.headers['cache-control'], 'no-store');
    assert.match(done.json.token, /^[0-9a-f]{64}$/);
    assert.equal(done.json.device.kind, 'phone');
    const again = await request(`${s.api.url}/api/devices/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { code: started.json.code, name: 'again' } });
    assert.equal(again.status, 403);
    // the new phone cannot list or add devices; the PC can, and the list holds no secret
    assert.equal((await request(`${s.api.url}/api/devices`, { headers: bearer(done.json.token) })).status, 403);
    const list = await request(`${s.api.url}/api/devices`, { headers: legacy });
    assert.equal(list.status, 200);
    assert.ok(list.json.devices.some((d) => d.name === 'iPhone'));
    assert.ok(!list.text.includes(done.json.token) && !/hash/.test(list.text));
    // revoking through the API closes that device's socket at once
    const c = await s.connect(done.json.token);
    const closed = new Promise((ok) => c.ws.once('close', ok));
    const rev = await request(`${s.api.url}/api/devices/revoke`, { method: 'POST', headers: { ...legacy, 'content-type': 'application/json' }, body: { id: done.json.device.id } });
    assert.equal(rev.status, 200);
    await closed;
    await waitFor(async () => (await request(`${s.api.url}/api/state`, { headers: bearer(done.json.token) })).status === 401);
  } finally { await s.close(); }
});
