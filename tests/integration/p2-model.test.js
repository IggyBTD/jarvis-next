import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFakeModel } from '../mocks/fake-model.js';
import { createLlmClient, LlmError, StreamSplitter, SseParser } from '../../server/core/llm-client.js';
import { createQueue, PreemptedError } from '../../server/core/llm-queue.js';
import { createLlmProxy } from '../../server/core/llm-proxy.js';
import { loadConfig } from '../../server/core/config.js';
import { waitFor, request } from '../helpers.js';

const base = loadConfig({ only: ['models.json'] }).models;
const noSleep = () => Promise.resolve();
async function rig(over = {}) {
  const fake = await startFakeModel();
  const config = { ...base, baseUrl: fake.url, ...over };
  return { fake, config, llm: createLlmClient({ config, sleepFn: noSleep }), close: () => fake.close() };
}
const user = (content) => [{ role: 'user', content }];

test('chat: streams content, reports usage and stats, ends on [DONE]', async () => {
  const r = await rig();
  try {
    r.fake.script({ content: 'Hello there, world.' });
    const deltas = [];
    const out = await r.llm.chat({ messages: user('hi'), onDelta: (d) => deltas.push(d) });
    assert.equal(out.content, 'Hello there, world.');
    assert.equal(deltas.map((d) => d.content ?? '').join(''), 'Hello there, world.');
    assert.equal(out.finishReason, 'stop');
    assert.equal(out.truncated, false);
    assert.ok(out.stats.ttftMs >= 0);
    assert.equal(out.usage.prompt_tokens, 10);
    assert.equal(r.fake.requests[0].body.model, 'local');
    assert.equal(r.fake.requests[0].body.stream, true);
  } finally { await r.close(); }
});

test('chat: reasoning_content stays out of content; inline <think> is folded; both across tiny chunks', async () => {
  const r = await rig();
  try {
    r.fake.script({ reasoning: 'let me think', content: 'The answer.', chunk: 2 });
    const a = await r.llm.chat({ messages: user('q') });
    assert.equal(a.content, 'The answer.');
    assert.equal(a.reasoning, 'let me think');
    r.fake.script({ think: 'hidden plan', content: 'Visible only.', chunk: 1 });
    const seen = [];
    const b = await r.llm.chat({ messages: user('q'), onDelta: (d) => seen.push(d) });
    assert.equal(b.content, 'Visible only.');
    assert.equal(b.reasoning, 'hidden plan');
    assert.ok(!seen.some((d) => /think|hidden/.test(d.content ?? '')));
    assert.ok(!seen.some((d) => /<|>/.test(d.content ?? '')));
  } finally { await r.close(); }
});

test('chat: missing [DONE], missing finish_reason, split lines and U+2028 do not hang or corrupt', async () => {
  const r = await rig();
  try {
    r.fake.script({ content: 'no done marker', omitDone: true });
    const a = await r.llm.chat({ messages: user('q') });
    assert.equal(a.content, 'no done marker');
    assert.equal(a.truncated, false); // finish_reason arrived
    r.fake.script({ content: 'cut off', omitDone: true, omitFinish: true });
    const b = await r.llm.chat({ messages: user('q') });
    assert.equal(b.content, 'cut off');
    assert.equal(b.truncated, true);
    r.fake.script({ content: 'split across tcp writes', splitLines: true });
    assert.equal((await r.llm.chat({ messages: user('q') })).content, 'split across tcp writes');
    r.fake.script({ content: 'x', u2028: true });
    assert.equal((await r.llm.chat({ messages: user('q') })).content, 'xa b');
    r.fake.script({ content: 'long', length: true });
    assert.equal((await r.llm.chat({ messages: user('q') })).truncated, true);
  } finally { await r.close(); }
});

test('chat: tool calls are accumulated; inline tool calls count only when tools were offered', async () => {
  const r = await rig();
  try {
    const tools = [{ type: 'function', function: { name: 'set_volume', parameters: { type: 'object' } } }];
    r.fake.script({ toolCalls: [{ name: 'set_volume', arguments: { level: 30 } }], chunk: 3 });
    const a = await r.llm.chat({ messages: user('q'), tools });
    assert.deepEqual(a.toolCalls.map((c) => [c.name, c.args]), [['set_volume', { level: 30 }]]);
    assert.equal(a.finishReason, 'tool_calls');
    assert.equal(r.fake.requests[0].body.tool_choice, 'auto');

    r.fake.script({ content: 'Sure. ', inlineToolCall: { name: 'set_volume', arguments: { level: 5 } } });
    const b = await r.llm.chat({ messages: user('q'), tools });
    assert.equal(b.content, 'Sure.');
    assert.deepEqual(b.toolCalls[0].args, { level: 5 });

    r.fake.script({ content: 'Sure. ', inlineToolCall: { name: 'set_volume', arguments: { level: 5 } } });
    const c = await r.llm.chat({ messages: user('q') });
    assert.equal(c.toolCalls.length, 0);
    assert.match(c.content, /<tool_call>/);

    r.fake.script({ toolCalls: [{ name: 'set_volume', arguments: '{"level": ' }] });
    const d = await r.llm.chat({ messages: user('q'), tools });
    assert.equal(d.toolCalls[0].args, null);
    assert.match(d.toolCalls[0].error, /not a JSON object/);
  } finally { await r.close(); }
});

test('chat: retries before the first byte, not after; hard errors are readable', async () => {
  const r = await rig();
  try {
    r.fake.script({ status: 503 }, { status: 503 }, { content: 'finally' });
    assert.equal((await r.llm.chat({ messages: user('q') })).content, 'finally');
    assert.equal(r.fake.requests.length, 3);
    r.fake.script({ status: 503 }, { status: 503 }, { status: 503 });
    await assert.rejects(r.llm.chat({ messages: user('q') }), (e) => e instanceof LlmError && e.status === 503);
    r.fake.script({ status: 400, message: 'bad template' });
    await assert.rejects(r.llm.chat({ messages: user('q') }), /bad template/);
    r.fake.script({ content: 'abcdefgh', crashAfter: 4, delayMs: 15 });
    const cut = await r.llm.chat({ messages: user('q') }).catch((e) => e);
    assert.ok(cut instanceof LlmError || cut.truncated); // an abrupt close is an error or a truncated reply, never a hang
  } finally { await r.close(); }
});

test('chat: abort mid-stream rejects and closes the connection; inactivity times out', async () => {
  const r = await rig({ requestTimeoutMs: 1000 });
  try {
    r.fake.script({ content: 'x'.repeat(400), chunk: 1, delayMs: 5 });
    const ctl = new AbortController();
    const p = r.llm.chat({ messages: user('q'), signal: ctl.signal, onDelta: () => {} });
    setTimeout(() => ctl.abort(), 40);
    await assert.rejects(p, (e) => e.name === 'AbortError');
    r.fake.script({ hang: true });
    const t0 = Date.now();
    await assert.rejects(createLlmClient({ config: { ...r.config, requestTimeoutMs: 150 }, sleepFn: noSleep }).chat({ messages: user('q') }), /no data from the model/);
    assert.ok(Date.now() - t0 < 2000);
    await assert.rejects(r.llm.chat({ messages: user('q'), signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
  } finally { await r.close(); }
});

test('thinking policy: per-use switch by method; history never carries thinking text', async () => {
  const r = await rig();
  try {
    await r.llm.chat({ messages: user('q'), use: 'chat' });
    await r.llm.chat({ messages: user('q'), use: 'agent' });
    assert.equal(r.fake.requests[0].body.chat_template_kwargs.enable_thinking, false);
    assert.equal(r.fake.requests[1].body.chat_template_kwargs.enable_thinking, true);
    const nt = createLlmClient({ config: { ...r.config, thinkingMethod: 'no_think' }, sleepFn: noSleep });
    await nt.chat({ messages: user('hello'), use: 'digest' });
    assert.equal(r.fake.requests[2].body.messages.at(-1).content, 'hello /no_think');
    assert.equal(r.fake.requests[2].body.chat_template_kwargs, undefined);
    await r.llm.chat({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '<think>secret plan</think>done', reasoning: 'x' }, { role: 'user', content: 'b' }] });
    const sent = r.fake.requests[3].body.messages;
    assert.equal(sent[1].content, 'done');
    assert.equal(sent[1].reasoning, undefined);
  } finally { await r.close(); }
});

test('health: reachable, unreachable, tokens per second after a request', async () => {
  const r = await rig();
  try {
    await r.llm.chat({ messages: user('hello there my friend, answer please') });
    const h = await r.llm.health();
    assert.equal(h.reachable, true);
    assert.equal(h.modelPresent, true);
    assert.ok(typeof h.tokensPerSec === 'number' || h.tokensPerSec === null);
    await r.close();
    assert.equal((await r.llm.health()).reachable, false);
  } finally { await r.close(); }
});

test('splitter and sse parser unit behaviour', () => {
  const s = new StreamSplitter({ toolCalls: true });
  const out = [...s.push('a<thi'), ...s.push('nk>b</th'), ...s.push('ink>c<tool_call>{"name":"x"}</tool_'), ...s.push('call>d'), ...s.flush()];
  assert.deepEqual(out.map((p) => `${p.kind}:${p.text}`), ['content:a', 'reasoning:b', 'content:c', 'toolcall:{"name":"x"}', 'content:d']);
  const lone = new StreamSplitter();
  assert.deepEqual([...lone.push('1 < 2 and <th'), ...lone.flush()].map((p) => p.text).join(''), '1 < 2 and <th');
  const sse = new SseParser();
  assert.deepEqual([...sse.push('data: {"a"'), ...sse.push(':1}\r\n\r\n: ping\n\ndata: [DONE]\n\n')], ['{"a":1}', '[DONE]']);
});

test('queue: priority, aging, concurrency, abort while waiting, slot release, preemption', async () => {
  let t = 0;
  const q = createQueue({ concurrency: 1, agingMs: 1000, now: () => t });
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = q.run('digest', async () => { order.push('first'); await gate; });
  await waitFor(() => q.active() === 1);
  const jobs = [q.run('digest', async () => { order.push('digest'); }), q.run('agent', async () => { order.push('agent'); }), q.run('interactive', async () => { order.push('interactive'); })];
  assert.equal(q.depth(), 3);
  release();
  await Promise.all([first, ...jobs]);
  assert.deepEqual(order, ['first', 'interactive', 'agent', 'digest']);

  // aging: an old digest job beats a fresh interactive one
  const q2 = createQueue({ concurrency: 1, agingMs: 1000, now: () => t });
  let rel2;
  const hold = q2.run('interactive', () => new Promise((r) => { rel2 = r; }));
  await waitFor(() => q2.active() === 1);
  const seen = [];
  const old = q2.run('digest', async () => { seen.push('old digest'); });
  t += 5000;
  const fresh = q2.run('interactive', async () => { seen.push('fresh interactive'); });
  rel2();
  await Promise.all([hold, old, fresh]);
  assert.deepEqual(seen, ['old digest', 'fresh interactive']);

  // abort while waiting leaves the queue clean; an error in a job still frees the slot
  const q3 = createQueue({ concurrency: 1 });
  let rel3;
  const h3 = q3.run('agent', () => new Promise((r) => { rel3 = r; }));
  await waitFor(() => q3.active() === 1);
  const ctl = new AbortController();
  const waiting = q3.run('agent', async () => 'never', { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(waiting);
  assert.equal(q3.depth(), 0);
  rel3();
  await h3;
  await assert.rejects(q3.run('agent', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await q3.run('agent', async () => 'ok'), 'ok');

  // preemption (only when enabled)
  const q4 = createQueue({ concurrency: 1, preempt: true });
  const victim = q4.run('digest', (signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))));
  await waitFor(() => q4.active() === 1);
  const win = q4.run('interactive', async () => 'went first');
  await assert.rejects(victim, PreemptedError);
  assert.equal(await win, 'went first');
});

test('proxy: passes the stream through untouched, forces the alias and thinking policy, frees the slot when the client leaves', async () => {
  const r = await rig();
  const queue = createQueue({ concurrency: 1 });
  const proxy = createLlmProxy({ llm: r.llm, queue, modelId: 'local', audit: null });
  const srv = http.createServer((req, res) => proxy.handle(req, res, { role: 'model', machine: 'mac' }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    r.fake.script({ content: 'streamed through' });
    const res = await request(`${url}/v1/chat/completions`, { method: 'POST', body: { model: 'gpt-4', messages: user('hi'), stream: true, chat_template_kwargs: { enable_thinking: false }, max_tokens: 99999999 } });
    assert.equal(res.status, 200);
    assert.match(res.text, /streamed through|stre|ream/);
    assert.match(res.text, /\[DONE\]/);
    const sent = r.fake.requests[0].body;
    assert.equal(sent.model, 'local');
    assert.equal(sent.chat_template_kwargs.enable_thinking, true); // agent use
    assert.ok(sent.max_tokens <= base.contextLength / 2);
    assert.equal((await request(`${url}/v1/models`)).json.data[0].id, 'local');
    assert.equal((await request(`${url}/v1/other`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await request(`${url}/v1/chat/completions`, { method: 'POST', body: '{"x":1}' })).status, 400);

    // a client that leaves frees its slot: the next request runs
    r.fake.script({ content: 'y'.repeat(2000), chunk: 1, delayMs: 5 }, { content: 'second' });
    let leaver;
    const gotFirst = new Promise((ok) => {
      leaver = http.request(`${url}/v1/chat/completions`, { method: 'POST' }, (rs) => { rs.once('data', () => { leaver.destroy(); ok(); }); });
    });
    leaver.on('error', () => {});
    leaver.end(JSON.stringify({ messages: user('hi'), stream: true }));
    await gotFirst;
    const second = await request(`${url}/v1/chat/completions`, { method: 'POST', body: { messages: user('hi'), stream: true } });
    assert.match(second.text, /second|seco/);
    assert.equal(queue.active(), 0);

    // upstream down: 502 with a message, nothing hangs
    r.fake.script({ status: 400, message: 'nope' });
    const bad = await request(`${url}/v1/chat/completions`, { method: 'POST', body: { messages: user('hi') } });
    assert.equal(bad.status, 502);
  } finally { srv.close(); await r.close(); }
});

test('system messages are only ever first: later ones become user notes so strict chat templates accept them', async () => {
  const r = await rig();
  try {
    await r.llm.chat({ messages: [{ role: 'system', content: 'base' }, { role: 'system', content: 'more' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'system', content: 'Target changed from PC to Mac.' }, { role: 'user', content: 'next' }] });
    const sent = r.fake.requests[0].body.messages;
    assert.deepEqual(sent.map((m) => m.role), ['system', 'user', 'assistant', 'user', 'user']);
    assert.equal(sent[0].content, 'base\n\nmore');
    assert.match(sent[3].content, /^\[note from JARVIS\] Target changed/);
  } finally { await r.close(); }
});
