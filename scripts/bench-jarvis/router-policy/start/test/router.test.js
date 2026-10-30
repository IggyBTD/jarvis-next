const test = require('node:test');
const assert = require('node:assert');
const { route } = require('../src/router');

function setup({ approve = true, output = 'hello', fail = false } = {}) {
  const calls = [];
  const audit = [];
  const d = {
    gate: { ask: async () => approve },
    agent: {
      run: async (c) => {
        calls.push(c);
        if (fail) throw new Error('boom');
        return output;
      },
    },
    audit: { push: (r) => audit.push(r) },
  };
  return { d, calls, audit };
}

test('a read goes through and its output is wrapped as untrusted', async () => {
  const { d, calls } = setup();
  const r = await route({ tool: 'files.read', args: { path: 'notes.txt' } }, { source: 'chat', target: 'pc' }, d);
  assert.equal(r.ok, true);
  assert.match(r.output, /^<untrusted source="files\.read">hello<\/untrusted>$/);
  assert.equal(calls.length, 1);
});

test('an unknown tool is denied and the agent is not called', async () => {
  const { d, calls } = setup();
  const r = await route({ tool: 'nope.run', args: {} }, { source: 'chat' }, d);
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test('a shell command asks the gate, and a no means it does not run', async () => {
  const { d, calls } = setup({ approve: false });
  const r = await route({ tool: 'shell.run', args: { cmd: 'dir' } }, { source: 'chat', target: 'pc' }, d);
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test('the target comes from the context, never from the model arguments', async () => {
  const { d, calls } = setup();
  await route({ tool: 'files.read', args: { path: 'a', target: 'mac' } }, { source: 'chat', target: 'pc' }, d);
  assert.equal(calls[0].target, 'pc');
});

test('scheduled jobs never run a T3 tool, and do not ask', async () => {
  let asked = false;
  const { d, calls } = setup();
  d.gate.ask = async () => {
    asked = true;
    return true;
  };
  const r = await route({ tool: 'mail.send', args: {} }, { source: 'schedule', target: 'pc' }, d);
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
  assert.equal(asked, false);
});

test('paths that leave the workspace are denied', async () => {
  const { d, calls } = setup();
  const r = await route({ tool: 'files.read', args: { path: '../secrets.env' } }, { source: 'chat', target: 'pc' }, d);
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});
