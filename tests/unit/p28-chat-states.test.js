import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatStates } from '../../src/core/chat-states.js';

test('chat states: running from the model or a coding task, waiting when an approval is asked for the task, unseen after finishing elsewhere', () => {
  const agentTasks = [
    { taskId: 't1', convId: 'c-code', state: 'running' },
    { taskId: 't2', convId: 'c-done', state: 'done' },
    { taskId: 't3', convId: null, state: 'running' }, // a task started from outside any chat
    { taskId: 't4', convId: 'c-queued', state: 'queued' },
  ];
  const s = chatStates({ running: ['c-chat'], agentTasks, pending: [{ id: 'g1', taskId: 't1' }, { id: 'g2', taskId: 'unknown' }, { id: 'g3' }], unseen: ['c-old', 'c-chat'] });
  assert.deepEqual([...s].sort(), [['c-chat', 'running'], ['c-code', 'waiting'], ['c-old', 'unseen'], ['c-queued', 'running']]);
  assert.equal(s.has('c-done'), false); // finished task: nothing to show
  assert.equal(chatStates({}).size, 0);
});

test('chat states: a running chat outranks an unseen mark, and an approval outranks running', () => {
  const s = chatStates({ running: ['a'], unseen: ['a'], agentTasks: [{ taskId: 't', convId: 'a', state: 'running' }], pending: [{ taskId: 't' }] });
  assert.equal(s.get('a'), 'waiting');
  assert.equal(chatStates({ running: ['a'], unseen: ['a'] }).get('a'), 'running');
});
