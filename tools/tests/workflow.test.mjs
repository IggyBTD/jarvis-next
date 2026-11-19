// Tests for tier-one agent features: task list and plan mode, context trimming and compaction,
// skills, hooks, sessions helpers, and the runner's gate and hooks. Run: node --test tools/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks, setTasks, getTasks, formatTasks, taskSummary, setPlanMode, isPlanMode, planRefusal, workContext } from '../../src/core/work-state.js';
import { estimateTokens, shouldCompact, trimToolResults, findCut, summaryRequest, applySummary, withReminder } from '../../src/core/context-manager.js';
import { parseSkill, skillPrompt } from '../../src/core/skills.js';
import { matchHooks, buildCommand } from '../../src/core/hooks.js';
import { slimHistory, sessionTitle, toMarkdown } from '../../src/core/sessions.js';
import { createActionRunner } from '../../src/core/action-runner.js';

// --- tasks and plan mode ---
test('tasks accept strings and objects, and reject two doing at once', () => {
  assert.deepEqual(parseTasks(['a', { text: 'b', status: 'in_progress' }]).tasks, [{ text: 'a', status: 'todo' }, { text: 'b', status: 'doing' }]);
  assert.ok(parseTasks([{ text: 'a', status: 'doing' }, { text: 'b', status: 'doing' }]).error);
  assert.ok(parseTasks([{ text: '  ' }]).error);
  assert.ok(parseTasks('nope').error);
  assert.ok(parseTasks([{ text: 'a', status: 'weird' }]).error);
});

test('setting tasks notifies and formats', () => {
  setTasks([{ text: 'one', status: 'done' }, { text: 'two', status: 'doing' }, 'three']);
  assert.equal(getTasks().length, 3);
  assert.equal(formatTasks(), '1. [x] one\n2. [~] two\n3. [ ] three');
  assert.equal(taskSummary(), '1 of 3 done');
  assert.match(workContext(), /<tasks>[\s\S]*two/);
  setTasks([]);
  assert.equal(workContext(), '');
});

test('plan mode refuses changes but not reads, and puts a notice in the context', () => {
  assert.equal(planRefusal('edit_file'), null);
  setPlanMode(true);
  assert.ok(isPlanMode());
  assert.match(planRefusal('edit_file'), /Plan mode is on/);
  assert.match(planRefusal('run_command'), /submit_plan/);
  assert.equal(planRefusal('read_file'), null);
  assert.equal(planRefusal('submit_plan'), null);
  assert.match(workContext(), /<plan-mode>/);
  setPlanMode(false);
  assert.equal(planRefusal('write_file'), null);
});

// --- context ---
const long = (n) => 'x'.repeat(n);
const convo = () => [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: long(5000) },
  { role: 'assistant', content: 'answer one' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: 'answer two' },
  { role: 'user', content: 'third question' },
  { role: 'assistant', content: 'answer three' },
];

test('token estimate grows with content; compaction triggers at the ratio', () => {
  assert.ok(estimateTokens(convo()) > 1400);
  assert.ok(shouldCompact(26000, 32768));
  assert.ok(!shouldCompact(10000, 32768));
  assert.ok(!shouldCompact(null, 32768));
});

test('old tool results are trimmed, recent ones are not', () => {
  const h = convo();
  assert.equal(trimToolResults(h, 4), 1);
  assert.ok(h[2].content.length < 400);
  assert.match(h[2].content, /trimmed/);
  const h2 = convo();
  assert.equal(trimToolResults(h2, 20), 0);
});

test('the cut is at a user message so a tool call stays with its result', () => {
  const h = convo();
  assert.equal(h[findCut(h, 3)].role, 'user');
  assert.equal(findCut(h, 3), 6);
  assert.equal(findCut([{ role: 'user', content: 'only' }], 6), -1);
  // a cut never lands between a call and its result
  for (let keep = 1; keep < h.length; keep++) {
    const cut = findCut(h, keep);
    if (cut > 0) assert.notEqual(h[cut].role, 'tool');
  }
});

test('applying a summary replaces the old part and keeps alternation', () => {
  const h = convo();
  const cut = findCut(h, 3);
  const removed = applySummary(h, cut, 'We read a and answered twice.');
  assert.equal(removed.length, 6);
  assert.equal(h[0].role, 'user');
  assert.match(h[0].content, /Summary of the earlier conversation/);
  assert.equal(h[1].role, 'assistant');
  assert.equal(h[2].content, 'third question');
  assert.match(summaryRequest(removed, 'the file a')[0].content, /file a/);
});

// --- skills ---
test('a skill file is parsed from frontmatter, with the folder name as fallback', () => {
  const s = parseSkill('---\nname: Hand Off\ndescription: "Write the handoff notes"\n---\nDo this.\nThen that.\n', 'ignored');
  assert.deepEqual(s, { name: 'hand-off', description: 'Write the handoff notes', body: 'Do this.\nThen that.' });
  assert.equal(parseSkill('just text', 'my-skill').name, 'my-skill');
  assert.equal(parseSkill('---\ndescription: x\n---\nbody', ''), null); // no name and no folder name
  assert.equal(parseSkill('body', ''), null);
  assert.match(skillPrompt(s, 'for session 5'), /Task: for session 5/);
});

// --- hooks ---
const hooks = [
  { event: 'after', match: 'edit_file|write_file', path: 'src/**/*.js', command: 'node --check {path}' },
  { event: 'before', match: 'run_command', command: 'echo no', block: true },
  { event: 'after', match: '*', command: 'echo all {tool}' },
];

test('hooks match by event, tool and path glob', () => {
  assert.equal(matchHooks(hooks, 'after', 'edit_file', 'src/core/a.js').length, 2);
  assert.equal(matchHooks(hooks, 'after', 'edit_file', 'docs/a.md').length, 1);
  assert.equal(matchHooks(hooks, 'after', 'edit_file', null).length, 1);
  assert.equal(matchHooks(hooks, 'before', 'run_command', 'ls').length, 1);
  assert.equal(matchHooks(hooks, 'before', 'edit_file', 'src/a.js').length, 0);
});

test('hook commands refuse values that could break out of the command', () => {
  assert.equal(buildCommand('node --check {path}', { path: 'src/a.js' }), 'node --check src/a.js');
  assert.equal(buildCommand('node --check {path}', { path: 'a.js; rm -rf /' }), null);
  assert.equal(buildCommand('x {path}', { path: 'a"b' }), null);
  assert.equal(buildCommand('x {path}', { path: '$(whoami)' }), null);
  assert.equal(buildCommand('echo {tool}', { tool: 'edit_file' }), 'echo edit_file');
});

// --- sessions ---
test('history is saved without images; titles and markdown read well', () => {
  const h = [
    { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: 'A diagram.' },
  ];
  const slim = slimHistory(h);
  assert.equal(JSON.stringify(slim).includes('base64'), false);
  assert.equal(slim[0].content[1].text, '[image]');
  assert.equal(sessionTitle(h), 'what is this?');
  assert.equal(sessionTitle([]), 'Untitled');
  const md = toMarkdown('T', h);
  assert.match(md, /\*\*You:\*\* what is this\?/);
  assert.match(md, /\*\*JARVIS:\*\* A diagram\./);
});

// --- the runner's gate and hooks ---
const actions = [
  { name: 'edit_file', tier: 'auto', primary: 'path', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'read_file', tier: 'auto', primary: 'path', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];
const call = (name, args = { path: 'a.js' }) => ({ id: 'c', name, arguments: JSON.stringify(args) });

test('the gate refuses before anything runs', async () => {
  let ran = 0;
  const runner = createActionRunner({
    actions, handlers: { edit_file: async () => { ran++; return 'ok'; }, read_file: async () => 'read' },
    getRules: () => ({ allow: [], ask: [], deny: [] }), gate: (name) => (name === 'edit_file' ? 'plan mode' : null),
  });
  const r = await runner.run(call('edit_file'));
  assert.equal(r.ok, false);
  assert.match(r.content, /Refused: plan mode/);
  assert.equal(ran, 0);
  assert.equal((await runner.run(call('read_file'))).ok, true);
});

test('a before hook can refuse; an after hook adds its output to the result', async () => {
  const seen = [];
  const runner = createActionRunner({
    actions, handlers: { edit_file: async () => 'edited', read_file: async () => 'read' },
    getRules: () => ({ allow: [], ask: [], deny: [] }),
    hooks: {
      before: async (name) => (name === 'read_file' ? 'not today' : null),
      after: async (name) => { seen.push(name); return name === 'edit_file' ? 'syntax ok' : ''; },
    },
  });
  const blocked = await runner.run(call('read_file'));
  assert.equal(blocked.ok, false);
  assert.match(blocked.content, /Refused by a hook: not today/);
  const edited = await runner.run(call('edit_file'));
  assert.equal(edited.ok, true);
  assert.match(edited.content, /edited\n\[hook output\]\nsyntax ok/);
  assert.deepEqual(seen, ['edit_file']);
});

test('withReminder puts per-turn context on a copy of the newest user message only', () => {
  const history = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'tool', content: 'r' }];
  const out = withReminder(history, '<tasks>x</tasks>');
  assert.equal(out[2].content, 'c\n\n<tasks>x</tasks>');
  assert.equal(out[0].content, 'a');
  assert.equal(history[2].content, 'c'); // the stored history is untouched
  const img = withReminder([{ role: 'user', content: [{ type: 'text', text: 'q' }] }], 'r');
  assert.deepEqual(img[0].content[1], { type: 'text', text: 'r' });
  assert.equal(withReminder(history, ''), history);
});
