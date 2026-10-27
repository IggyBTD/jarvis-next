// The Claude Code backend: modes become flags that keep the floors, the manager turns the program's stream into events, and a task
// run through it ends with the result as its summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { claudeArgs, bashRule } from '../../shared/claude-args.js';
import { createClaudeManager } from '../../agent/sidecars/claude-manager.js';
import { createAgentTasks } from '../../server/core/agent-tasks.js';

const policy = { allowCommands: ['git status*', 'ls', 'npm test'], destructive: ['rm -rf*', 'git push*', '*| sh*'] };
const after = (a, flag) => a.slice(a.indexOf(flag) + 1);

test('bash rules', () => {
  assert.equal(bashRule('git status*'), 'Bash(git status:*)');
  assert.equal(bashRule('ls'), 'Bash(ls)');
  assert.equal(bashRule('*| sh*'), null);
});

test('modes become flags; nothing ever skips permissions', () => {
  for (const m of ['auto', 'manual', 'accept-edits', 'plan', 'bypass']) {
    const a = claudeArgs(m, policy);
    assert.ok(!a.includes('--dangerously-skip-permissions') && !a.includes('bypassPermissions'), m);
    assert.ok(a.includes('stream-json'));
  }
  assert.equal(after(claudeArgs('plan', policy), '--permission-mode')[0], 'plan');
  assert.ok(after(claudeArgs('plan', policy), '--disallowedTools').includes('Edit'));
  assert.ok(!after(claudeArgs('manual', policy), '--allowedTools').includes('Edit'));
  const edits = claudeArgs('accept-edits', policy);
  assert.ok(after(edits, '--allowedTools').includes('Bash(git status:*)') && !after(edits, '--allowedTools').includes('Bash'));
  for (const m of ['auto', 'bypass']) {
    const a = claudeArgs(m, policy);
    assert.ok(after(a, '--allowedTools').includes('Bash'));
    const denied = after(a, '--disallowedTools');
    for (const must of ['Bash(rm -rf:*)', 'Bash(git push:*)', 'Bash(bash:*)', 'Edit(**/package.json)', 'Edit(**/.git/**)', 'Edit(**/*.sh)']) assert.ok(denied.includes(must), `${m} denies ${must}`);
  }
});

function fakeSpawn(lines) {
  return (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.emit('close', null); };
    child.args = args;
    child.stdin.on('finish', () => setImmediate(() => { for (const l of lines) child.stdout.write(`${JSON.stringify(l)}\n`); child.stdout.end(); setImmediate(() => child.emit('close', 0)); }));
    fakeSpawn.last = child;
    return child;
  };
}
const call = (mgr, method, sub, body) => new Promise((resolve) => {
  const req = Object.assign(new PassThrough(), { method });
  const res = { writeHead(s) { this.s = s; }, end(b) { resolve({ status: this.s, json: JSON.parse(b) }); } };
  mgr.proxy(req, res, sub);
  req.end(body ? JSON.stringify(body) : undefined);
});

test('a run streams text and ends with its result; a bad request is refused', async () => {
  const lines = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }, { type: 'tool_use', name: 'Edit' }] } }, { type: 'result', is_error: false, result: 'Done: fixed it.', permission_denials: [{}], session_id: 's1' }];
  const mgr = createClaudeManager({ workspaceDir: '/w', policy: { opencode: policy }, spawnFn: fakeSpawn(lines), command: 'claude' });
  const got = [];
  mgr.events.on('event', (e) => got.push(e));
  assert.equal((await call(mgr, 'POST', '/run', { runId: 'r1', prompt: '', mode: 'auto' })).status, 400);
  assert.equal((await call(mgr, 'POST', '/run', { runId: 'r1', prompt: 'fix', mode: 'nope' })).status, 400);
  assert.equal((await call(mgr, 'POST', '/run', { runId: 'r1', prompt: 'fix', mode: 'auto', folder: '../x' })).status, 400);
  assert.equal((await call(mgr, 'POST', '/run', { runId: 'r1', prompt: 'fix', mode: 'auto' })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(got.map((e) => e.type), ['claude.text', 'claude.tool', 'claude.done']);
  assert.deepEqual([got[2].ok, got[2].result, got[2].denied], [true, 'Done: fixed it.', 1]);
  assert.equal(fakeSpawn.last.args[0], '-p');
});

test('a task on the Claude backend finishes with the run result', async () => {
  const sent = [];
  const caps = { call: async () => ({ ok: false }), claude: async (m, p, b) => { sent.push([p, b.mode]); return { status: 200, json: { ok: true } }; } };
  const published = [];
  const tasks = createAgentTasks({ router: { capabilities: () => caps }, bus: { publish: (t, p) => published.push([t, p]) }, audit: { append: async () => {} }, conversations: null, dataDir: process.env.TEMP, taskTimeoutMs: 60_000, modes: { get: () => 'plan' }, backend: { get: () => 'claude' } });
  const r = tasks.start({ prompt: 'add a test' }, { target: 'pc' });
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(sent, [['/run', 'plan']]);
  tasks.onClaudeEvent('pc', { type: 'claude.done', runId: r.taskId, ok: true, result: 'All done.', denied: 0 });
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(tasks.get(r.taskId).state, 'done');
  assert.equal(tasks.get(r.taskId).summary, 'All done.');
});
