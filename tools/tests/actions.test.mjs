// Pure-logic tests for model actions: permission rules, tool-call streaming, the action runner
// and the audit chain. Run: node --test tools/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, ruleMatches, ruleFor } from '../../src/core/permissions.js';
import { createToolCallAccumulator, parseArguments, assistantToolMessage, toolResultMessage } from '../../src/core/tool-calls.js';
import { createActionRunner, validateArgs } from '../../src/core/action-runner.js';
import { appendAudit, readAudit, verifyAudit } from '../../src/core/audit.js';

// --- permissions ---
test('a rule matches by name, or by name plus a pattern on the primary argument', () => {
  assert.ok(ruleMatches('switch_model', 'switch_model', 'coding'));
  assert.ok(ruleMatches('switch_model(coding)', 'switch_model', 'coding'));
  assert.ok(!ruleMatches('switch_model(coding)', 'switch_model', 'general'));
  assert.ok(ruleMatches('run_command(git status*)', 'run_command', 'git status --short'));
  assert.ok(!ruleMatches('run_command(git status*)', 'run_command', 'git push'));
  assert.ok(ruleMatches('edit_file(src/**)', 'edit_file', 'src/core/a.js'));
  assert.ok(!ruleMatches('switch_model(coding)', 'switch_model', null));
  assert.ok(!ruleMatches('not a rule!', 'x', 'y'));
});

test('pattern characters are literal except the wildcard', () => {
  assert.ok(!ruleMatches('run_command(a.b)', 'run_command', 'axb'));
  assert.ok(ruleMatches('run_command(a.b)', 'run_command', 'a.b'));
  assert.ok(!ruleMatches('run_command(a|b)', 'run_command', 'a'));
});

test('decision order: blocked, deny, ask, allow, then the tier', () => {
  const rules = { allow: ['x'], ask: ['x(danger*)'], deny: ['x(never)'] };
  assert.equal(decide({ name: 'x', primary: 'never', tier: 'auto', rules }).decision, 'deny');
  assert.equal(decide({ name: 'x', primary: 'danger-zone', tier: 'auto', rules }).decision, 'ask');
  assert.equal(decide({ name: 'x', primary: 'fine', tier: 'ask', rules }).decision, 'allow');
  assert.equal(decide({ name: 'y', tier: 'auto', rules }).decision, 'allow');
  assert.equal(decide({ name: 'y', tier: 'ask', rules }).decision, 'ask');
  assert.equal(decide({ name: 'y', tier: 'blocked', rules: { allow: ['y'] } }).decision, 'deny');
  assert.equal(decide({ name: 'y' }).decision, 'ask');
});

test('ruleFor writes the exact call', () => {
  assert.equal(ruleFor('switch_model', 'coding'), 'switch_model(coding)');
  assert.equal(ruleFor('open_whiteboard', null), 'open_whiteboard');
});

// --- tool calls ---
test('streamed tool call fragments are joined', () => {
  const acc = createToolCallAccumulator();
  acc.push([{ index: 0, id: 'a1', function: { name: 'switch_model', arguments: '' } }]);
  acc.push([{ index: 0, function: { arguments: '{"mode":' } }]);
  acc.push([{ index: 0, function: { arguments: '"coding"}' } }]);
  assert.deepEqual(acc.result(), [{ id: 'a1', name: 'switch_model', arguments: '{"mode":"coding"}' }]);
});

test('two calls, with and without distinct indexes', () => {
  const a = createToolCallAccumulator();
  a.push([{ index: 0, id: 'a', function: { name: 'one', arguments: '{}' } }, { index: 1, id: 'b', function: { name: 'two', arguments: '{}' } }]);
  assert.deepEqual(a.result().map((c) => c.name), ['one', 'two']);

  const b = createToolCallAccumulator(); // a server that repeats index 0 for every call
  b.push([{ index: 0, id: 'a', function: { name: 'one', arguments: '{}' } }]);
  b.push([{ index: 0, id: 'b', function: { name: 'two', arguments: '{}' } }]);
  assert.deepEqual(b.result().map((c) => c.id), ['a', 'b']);
});

test('a call without id or arguments still comes out usable', () => {
  const acc = createToolCallAccumulator();
  acc.push([{ function: { name: 'open_whiteboard' } }]);
  assert.deepEqual(acc.result(), [{ id: 'call_0', name: 'open_whiteboard', arguments: '{}' }]);
  assert.deepEqual(createToolCallAccumulator().result(), []);
});

test('arguments from a small model are parsed defensively', () => {
  assert.deepEqual(parseArguments('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(parseArguments(''), { ok: true, value: {} });
  assert.equal(parseArguments('{"a":').ok, false);
  assert.equal(parseArguments('[1]').ok, false);
  assert.equal(parseArguments('"text"').ok, false);
});

test('history messages for a tool round follow the OpenAI shape', () => {
  const call = { id: 'a1', name: 'x', arguments: '{}' };
  assert.deepEqual(assistantToolMessage('', [call]), { role: 'assistant', content: null, tool_calls: [{ id: 'a1', type: 'function', function: { name: 'x', arguments: '{}' } }] });
  assert.deepEqual(toolResultMessage(call, 'ok'), { role: 'tool', tool_call_id: 'a1', content: 'ok' });
});

// --- runner ---
const ACTIONS = [
  { name: 'switch_model', description: 'd', tier: 'auto', primary: 'mode', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['general', 'coding'] } }, required: ['mode'] } },
  { name: 'open_whiteboard', description: 'd', tier: 'auto', parameters: { type: 'object', properties: {} } },
  { name: 'delete_it', description: 'd', tier: 'ask', primary: 'path', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'nuke', description: 'd', tier: 'blocked', parameters: { type: 'object', properties: {} } },
];

function makeRunner(over = {}) {
  const log = { audit: [], events: [], ran: [], always: [] };
  const runner = createActionRunner({
    actions: ACTIONS,
    handlers: {
      switch_model: async ({ mode }) => { log.ran.push(`switch:${mode}`); return `ok ${mode}`; },
      open_whiteboard: async () => { log.ran.push('wb'); return 'opened'; },
      delete_it: async ({ path }) => { log.ran.push(`delete:${path}`); return 'deleted'; },
      nuke: async () => { log.ran.push('nuke'); return 'boom'; },
    },
    getRules: () => ({}),
    onAlways: (r) => log.always.push(r),
    audit: async (r) => { log.audit.push(r); },
    onEvent: (e) => log.events.push(e),
    ...over,
  });
  return { runner, log };
}

test('tools() lists every action in the OpenAI format', () => {
  const { runner } = makeRunner();
  const tools = runner.tools();
  assert.equal(tools.length, ACTIONS.length);
  assert.equal(tools[0].type, 'function');
  assert.equal(tools[0].function.name, 'switch_model');
});

test('an automatic action runs without asking and is audited', async () => {
  const { runner, log } = makeRunner({ approve: async () => { throw new Error('should not ask'); } });
  const r = await runner.run({ id: '1', name: 'switch_model', arguments: '{"mode":"coding"}' });
  assert.deepEqual(r, { ok: true, content: 'ok coding', decision: 'allow', display: null });
  assert.deepEqual(log.ran, ['switch:coding']);
  assert.equal(log.audit.length, 1);
  assert.equal(log.audit[0].action, 'switch_model');
});

test('bad calls are refused with a message the model can read, and nothing runs', async () => {
  const { runner, log } = makeRunner();
  for (const call of [
    { id: '1', name: 'rm_rf', arguments: '{}' },
    { id: '2', name: 'switch_model', arguments: '{"mode":"turbo"}' },
    { id: '3', name: 'switch_model', arguments: '{}' },
    { id: '4', name: 'switch_model', arguments: '{"mode":"coding","extra":1}' },
    { id: '5', name: 'switch_model', arguments: 'not json' },
  ]) {
    const r = await runner.run(call);
    assert.equal(r.ok, false, call.id);
    assert.ok(r.content.length > 10);
  }
  assert.deepEqual(log.ran, []);
});

test('a blocked action never runs, even with an allow rule', async () => {
  const { runner, log } = makeRunner({ getRules: () => ({ allow: ['nuke'] }), approve: async () => 'once' });
  const r = await runner.run({ id: '1', name: 'nuke', arguments: '{}' });
  assert.equal(r.ok, false);
  assert.deepEqual(log.ran, []);
});

test('an ask action is denied when nobody can approve', async () => {
  const { runner, log } = makeRunner();
  const r = await runner.run({ id: '1', name: 'delete_it', arguments: '{"path":"a.txt"}' });
  assert.equal(r.ok, false);
  assert.equal(r.decision, 'deny');
  assert.deepEqual(log.ran, []);
});

test('approval: once runs it, always also stores the rule, deny stops it', async () => {
  const call = { id: '1', name: 'delete_it', arguments: '{"path":"a.txt"}' };

  let { runner, log } = makeRunner({ approve: async () => 'once' });
  assert.equal((await runner.run(call)).ok, true);
  assert.deepEqual(log.always, []);

  ({ runner, log } = makeRunner({ approve: async () => 'always' }));
  assert.equal((await runner.run(call)).ok, true);
  assert.deepEqual(log.always, ['delete_it(a.txt)']);

  ({ runner, log } = makeRunner({ approve: async () => 'deny' }));
  assert.equal((await runner.run(call)).ok, false);
  assert.deepEqual(log.ran, []);
});

test('an always-allow rule lets an ask action run without a prompt; a deny rule beats it', async () => {
  const call = { id: '1', name: 'delete_it', arguments: '{"path":"tmp/x"}' };
  let { runner, log } = makeRunner({ getRules: () => ({ allow: ['delete_it(tmp/*)'] }), approve: async () => { throw new Error('no prompt expected'); } });
  assert.equal((await runner.run(call)).ok, true);
  assert.deepEqual(log.ran, ['delete:tmp/x']);

  ({ runner, log } = makeRunner({ getRules: () => ({ allow: ['delete_it'], deny: ['delete_it(tmp/*)'] }) }));
  assert.equal((await runner.run(call)).ok, false);
});

test('a failing handler reports the failure and does not throw', async () => {
  const { runner } = makeRunner();
  const failing = createActionRunner({
    actions: ACTIONS, getRules: () => ({}),
    handlers: { open_whiteboard: async () => { throw new Error('no window'); } },
  });
  const r = await failing.run({ id: '1', name: 'open_whiteboard', arguments: '' });
  assert.equal(r.ok, false);
  assert.match(r.content, /no window/);
  assert.ok(runner);
});

test('a broken audit sink does not stop the action', async () => {
  const { runner } = makeRunner({ audit: async () => { throw new Error('disk full'); } });
  assert.equal((await runner.run({ id: '1', name: 'open_whiteboard', arguments: '{}' })).ok, true);
});

test('validateArgs', () => {
  const schema = ACTIONS[0].parameters;
  assert.equal(validateArgs(schema, { mode: 'coding' }), null);
  assert.match(validateArgs(schema, {}), /missing/);
  assert.match(validateArgs(schema, { mode: 'x' }), /one of/);
  assert.match(validateArgs(schema, { mode: 5 }), /string/);
});

// --- audit chain ---
test('the audit log is hash-chained and notices tampering', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  await appendAudit({ action: 'a', args: {}, decision: 'allow', ok: true, result: 'one' });
  await appendAudit({ action: 'b', args: { x: 1 }, decision: 'deny', ok: false, result: 'two' });
  await appendAudit({ action: 'c', args: {}, decision: 'allow', ok: true, result: 'three' });
  const list = readAudit();
  assert.equal(list.length, 3);
  assert.equal(list[1].prev, list[0].hash);
  assert.deepEqual(await verifyAudit(list), { ok: true, at: -1 });

  const forged = structuredClone(list);
  forged[1].decision = 'allow';
  assert.deepEqual(await verifyAudit(forged), { ok: false, at: 1 });
  assert.equal((await verifyAudit([list[0], list[2]])).ok, false); // a removed entry
  assert.ok(mem['jarvis.audit']);
});
