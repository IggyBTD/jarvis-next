import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startFakeAgent } from '../mocks/fake-agent.js';
import { startFakeModel } from '../mocks/fake-model.js';
import { testConfig, tmpDir, rmDir } from '../helpers.js';
import { plan, taskXml, launchAgentPlist } from '../../scripts/install.js';
import { backup, restore } from '../../scripts/backup-data.js';
import { runDoctor, table } from '../../scripts/doctor.js';
import { generateTokens, loadTokens } from '../../server/core/auth.js';
import { createAuditLog } from '../../server/core/audit-log.js';

test('install plans: logon tasks and launch agents, firewall commands printed and never run', () => {
  const t = testConfig();
  try {
    const win = plan('win32', { cfg: t.cfg, root: 'C:\\Jarvis & Co', node: 'C:\\node.exe' });
    const tasks = win.filter((s) => s.write);
    assert.equal(tasks.length, 2);
    assert.match(tasks[0].write.content, /<LogonTrigger>/);
    assert.match(tasks[0].write.content, /Jarvis &amp; Co/); // paths are escaped, not injected
    assert.match(tasks[1].write.content, /--machine pc/);
    const fw = win.find((s) => /Firewall/.test(s.title));
    assert.equal(fw.run, undefined);
    assert.match(fw.print[0], /New-NetFirewallRule .* -LocalPort 7410 -RemoteAddress 100\.64\.0\.0\/10/);
    assert.ok(win.filter((s) => s.run).every((s) => s.run[0] === 'schtasks.exe'));
    const mac = plan('darwin', { cfg: t.cfg, root: '/Users/me/jarvis', node: '/usr/local/bin/node', home: '/Users/me' });
    const agent = mac.find((s) => s.write);
    assert.match(agent.write.content, /<key>KeepAlive<\/key><true\/>/);
    assert.match(agent.write.content, /<string>--machine<\/string><string>mac<\/string>/);
    assert.deepEqual(agent.run, ['launchctl', ['load', '-w', '/Users/me/Library/LaunchAgents/com.jarvis.agent.plist']]);
    assert.ok(taskXml({ name: 'x', node: 'n', script: 's', cwd: 'c' }).includes('RestartOnFailure'));
    assert.ok(launchAgentPlist({ label: 'l', node: 'n', script: 's', cwd: 'c', logDir: 'd' }).includes('RunAtLoad'));
    assert.match(launchAgentPlist({ label: 'l', node: 'n', script: 's', cwd: 'c', logDir: 'd' }), /<key>PATH<\/key><string>\/opt\/homebrew\/bin/); // a LaunchAgent has no shell PATH: Homebrew tools (opencode) would not be found
  } finally { t.cleanup(); }
});

test('backup: copies state, never tokens, verifies the audit chain, keeps the newest; restore only knows its names', async () => {
  const dir = tmpDir('bk');
  try {
    fs.mkdirSync(path.join(dir, 'tokens'));
    fs.writeFileSync(path.join(dir, 'tokens', 'ui.token'), 'secret');
    fs.writeFileSync(path.join(dir, 'state.json'), '{"activeTarget":"mac"}');
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
    await createAuditLog({ dir: path.join(dir, 'audit') }).append({ action: 'a', args: {} });
    let n = 0;
    const b1 = backup(dir, { keep: 2, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)) });
    assert.equal(b1.auditEntries, 1);
    const copy = path.join(dir, 'backups', b1.name);
    assert.ok(fs.existsSync(path.join(copy, 'state.json')));
    assert.ok(!fs.existsSync(path.join(copy, 'tokens')) && !fs.existsSync(path.join(copy, 'unrelated.txt')));
    backup(dir, { keep: 2, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)) });
    const b3 = backup(dir, { keep: 0, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)) }); // "keep 0" still keeps the newest
    assert.deepEqual(fs.readdirSync(path.join(dir, 'backups')), [b3.name]);

    fs.writeFileSync(path.join(dir, 'state.json'), '{"activeTarget":"pc"}');
    fs.writeFileSync(path.join(dir, 'backups', b3.name, 'evil.txt'), 'x');
    const r = restore(dir, b3.name);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), { activeTarget: 'mac' });
    assert.ok(!r.restored.includes('evil.txt') && !fs.existsSync(path.join(dir, 'evil.txt')));
    assert.ok(fs.existsSync(r.previousKeptIn));
    assert.throws(() => restore(dir, '../x'), /bad backup name/);

    // a tampered audit copy is refused, not silently backed up
    const file = path.join(dir, 'audit', fs.readdirSync(path.join(dir, 'audit')).find((f) => f.endsWith('.jsonl')));
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"a"', '"b"'));
    assert.throws(() => backup(dir, { now: () => new Date(Date.UTC(2026, 0, 2)) }), /does not verify/);
  } finally { rmDir(dir); }
});

test('doctor: a healthy setup passes, a missing model and a down agent fail with a reason', async () => {
  const model = await startFakeModel();
  const t = testConfig((f) => { f['models.json'].baseUrl = model.url; f['machines.json'].machines.mac.host = '127.0.0.1'; f['digest.json'].enabled = false; });
  generateTokens(t.cfg);
  const tokens = loadTokens(t.cfg);
  const pc = await startFakeAgent({ token: tokens.machines.pc[0], machine: 'pc' });
  const mac = await startFakeAgent({ token: tokens.machines.mac[0], machine: 'mac' });
  t.cfg.machines.machines.pc.agentPort = pc.port;
  t.cfg.machines.machines.mac.agentPort = mac.port;
  try {
    const rows = await runDoctor({ cfg: t.cfg });
    const get = (n) => rows.find((r) => r.name === n);
    assert.equal(get('Agent pc reachable').ok, true);
    assert.equal(get('Model server').ok, true);
    assert.equal(get('Token for mac').ok, true);
    assert.equal(get('Audit log chain').ok, true);
    assert.equal(get('Google sign-in').ok, true);
    mac.setDown(true);
    await model.close();
    const bad = await runDoctor({ cfg: t.cfg });
    assert.equal(bad.find((r) => r.name === 'Agent mac reachable').ok, false);
    assert.equal(bad.find((r) => r.name === 'Model server').ok, false);
    assert.match(table(bad), /FAIL  Model server .*not reachable/);
  } finally { await pc.close(); await mac.close(); await new Promise((r) => setTimeout(r, 100)); t.cleanup(); }
});
