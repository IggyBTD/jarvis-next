import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCall, describeAgentTool, summarizeResult, summarizeSaved } from '../../shared/steps.js';

test('describeCall: a sentence while it runs and another once done, from the arguments', () => {
  assert.deepEqual(describeCall('google_gmail_search', { account: 'school', query: 'invoice' }), { doing: 'Searching Gmail (school) for "invoice"', did: 'Searched Gmail (school) for "invoice"' });
  assert.equal(describeCall('browser_navigate', { url: 'https://example.com/docs/page?x=1' }).doing, 'Opening example.com/docs/page');
  assert.equal(describeCall('set_volume', { level: 30 }).did, 'Set the volume to 30%');
  assert.equal(describeCall('read_file', { path: ['C:', 'Users', 'me', 'notes', 'todo.md'].join(String.fromCharCode(92)) }).did, 'Read "todo.md"'); // a Windows path
  assert.equal(describeCall('read_file', { path: '/Users/me/notes/todo.md' }).did, 'Read "todo.md"');
  assert.match(describeCall('agent_task', { prompt: 'fix the failing test in the parser' }).doing, /^Handing a task to the coding agent: "fix the failing/);
});

test('describeCall: tools without a sentence get a plain one; bad or missing arguments never throw', () => {
  assert.deepEqual(describeCall('get_system_info', {}), { doing: 'Reading system info', did: 'Read system info' });
  assert.equal(describeCall('list_wifi', null).doing, 'Listing wifi');
  assert.equal(describeCall('frobnicate_widget', { name: 'x' }).doing, 'Using frobnicate widget (x)');
  assert.doesNotThrow(() => describeCall('browser_click', undefined));
  assert.equal(describeCall('open_app', {}).did, 'Opened an app');
  assert.ok(describeCall('remember', { text: 'x'.repeat(500) }).doing.length < 120); // long text is clipped
});

test('describeAgentTool: what the coding agent did, one line', () => {
  assert.equal(describeAgentTool('bash', { command: 'npm test -- --watch=false' }), 'Ran a command: npm test -- --watch=false');
  assert.equal(describeAgentTool('Read', { file_path: 'src/a.js' }), 'Read src/a.js');
  assert.equal(describeAgentTool('edit', { filePath: 'src/b.js' }), 'Edited src/b.js');
  assert.equal(describeAgentTool('grep', { pattern: 'TODO' }), 'Searched the code for "TODO"');
  assert.equal(describeAgentTool('mystery', {}), 'Used mystery');
});

test('summarizeResult: counts for lists, the error text for failures, a short preview, never throws', () => {
  assert.deepEqual(summarizeResult('google_gmail_search', { messages: [1, 2, 3] }).summary, '3 messages');
  assert.equal(summarizeResult('x', { events: [] }).summary, 'No events');
  assert.equal(summarizeResult('x', null, 'the agent is unreachable').summary, 'the agent is unreachable');
  assert.equal(summarizeResult('agent_task', { taskId: 't-1', state: 'running' }).summary, 'Started task t-1');
  assert.equal(summarizeResult('browser_read', { title: 'Docs', text: 'x'.repeat(4210) }).summary, 'Docs: 4,210 characters of text');
  assert.equal(summarizeResult('x', { exitCode: 2 }).summary, 'Exited with code 2');
  assert.ok(summarizeResult('x', { a: 'y'.repeat(2000) }).detail.length <= 500);
  const loop = {}; loop.self = loop; // JSON cannot hold this
  assert.doesNotThrow(() => summarizeResult('x', loop));
});

test('summarizeSaved: a saved tool message gives the same summary after a chat is reopened', () => {
  const ok = '[PC] google_calendar_events finished:\n<untrusted source="x">\n{"events":[{"a":1},{"a":2}]}\n</untrusted>';
  assert.equal(summarizeSaved('google_calendar_events', ok).summary, '2 events');
  const bad = '[PC] open_app failed:\n<untrusted source="y">\nno such app\n</untrusted>';
  assert.equal(summarizeSaved('open_app', bad).summary, 'no such app');
  assert.doesNotThrow(() => summarizeSaved('x', undefined));
});
