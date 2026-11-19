// The only module that talks to the model backend (an OpenAI-compatible server on localhost: LM Studio or llama-server).
// Streaming chat with abort, retry before the first byte, an inactivity timeout, reasoning kept apart from content,
// <think> blocks folded out of visible text, inline <tool_call> blocks recognised only when tools were offered,
// tool-call deltas accumulated, and a health check. Nothing else in the repo may use the backend address (see
// scripts/check-chokepoint.js); llm-proxy reaches the model through raw() and prepareProxyBody() below.
import { sleep } from '../../shared/util.js';

export class LlmError extends Error {
  constructor(message, { status = null, retryable = false } = {}) { super(message); this.name = 'LlmError'; this.status = status; this.retryable = retryable; }
}

// Splits streamed text into content, reasoning (<think>) and inline tool calls (<tool_call>), holding back any
// partial tag at the end of a chunk so it never flashes in the visible text.
export class StreamSplitter {
  constructor({ toolCalls = false } = {}) { this.buf = ''; this.mode = 'content'; this.tools = toolCalls; this.dropped = 0; }
  static #hold(text, tags) {
    let n = 0;
    for (const tag of tags) for (let k = Math.min(tag.length - 1, text.length); k > n; k--) if (tag.startsWith(text.slice(-k))) { n = k; break; }
    return n;
  }
  push(text) {
    this.buf += text;
    const out = [];
    for (;;) {
      if (this.mode === 'content') {
        const opens = [['<think>', 'reasoning'], ...(this.tools ? [['<tool_call>', 'toolcall']] : [])];
        let best = null;
        for (const [tag, mode] of opens) { const i = this.buf.indexOf(tag); if (i !== -1 && (!best || i < best.i)) best = { i, tag, mode }; }
        if (best) {
          if (best.i) out.push({ kind: 'content', text: this.buf.slice(0, best.i) });
          this.buf = this.buf.slice(best.i + best.tag.length);
          this.mode = best.mode;
          continue;
        }
        const keep = StreamSplitter.#hold(this.buf, opens.map(([t]) => t));
        const emit = this.buf.slice(0, this.buf.length - keep);
        if (emit) out.push({ kind: 'content', text: emit });
        this.buf = this.buf.slice(this.buf.length - keep);
        return out;
      }
      const close = this.mode === 'reasoning' ? '</think>' : '</tool_call>';
      const i = this.buf.indexOf(close);
      if (i !== -1) {
        if (i || this.mode === 'toolcall') out.push({ kind: this.mode, text: this.buf.slice(0, i) });
        this.buf = this.buf.slice(i + close.length);
        this.mode = 'content';
        continue;
      }
      if (this.mode === 'reasoning') {
        const keep = StreamSplitter.#hold(this.buf, [close]);
        const emit = this.buf.slice(0, this.buf.length - keep);
        if (emit) out.push({ kind: 'reasoning', text: emit });
        this.buf = this.buf.slice(this.buf.length - keep);
      }
      return out; // an open tool_call keeps buffering until its close tag arrives
    }
  }
  flush() {
    const out = [];
    if (this.mode === 'content' && this.buf) out.push({ kind: 'content', text: this.buf });
    else if (this.mode === 'reasoning' && this.buf) out.push({ kind: 'reasoning', text: this.buf });
    else if (this.mode === 'toolcall') this.dropped += 1;
    this.buf = '';
    this.mode = 'content';
    return out;
  }
}

// Incremental server-sent-events reader: partial lines, CRLF, comments and keep-alives are handled.
// Splits on \n only, so U+2028 inside a JSON string is never taken for a line break.
export class SseParser {
  constructor() { this.tail = ''; }
  push(chunk) {
    this.tail += chunk;
    const lines = this.tail.split('\n');
    this.tail = lines.pop();
    const events = [];
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) events.push(line.slice(5).replace(/^ /, ''));
    }
    return events;
  }
  end() { const t = this.tail.trim(); this.tail = ''; return t.startsWith('data:') ? [t.slice(5).trim()] : []; }
}

const parseJson = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
const stripThink = (t) => String(t ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');

export function createLlmClient({ config, fetchImpl = fetch, sleepFn = sleep, now = () => performance.now() }) {
  const base = config.baseUrl.replace(/\/$/, '');
  let last = null;
  // Once this backend has answered with structured tool calls, it is never read for <tool_call> text again: from then on such text in
  // a reply can only be something the model copied (a quoted mail, a page), not a call it meant to make.
  let structured = false;
  const flags = (use) => ({ thinking: config.thinking?.[use] ?? false });

  // Thinking switch, by the method in models.json (see docs/decisions.md D-07).
  function applyThinking(body, use) {
    const { thinking } = flags(use);
    if (config.thinkingMethod === 'chat_template_kwargs') body.chat_template_kwargs = { ...(body.chat_template_kwargs ?? {}), enable_thinking: thinking };
    else if (config.thinkingMethod === 'request_field') body.reasoning_effort = typeof thinking === 'string' ? thinking : thinking ? 'medium' : 'none'; // true = medium, or an effort name from models.json
    else if (config.thinkingMethod === 'no_think' && !thinking) {
      const msgs = body.messages ?? [];
      const i = msgs.findLastIndex((m) => m.role === 'user' && typeof m.content === 'string');
      if (i !== -1 && !msgs[i].content.endsWith('/no_think')) msgs[i] = { ...msgs[i], content: `${msgs[i].content} /no_think` };
    }
    return body;
  }

  // History sent back to the model: only API fields; thinking text is dropped unless configured otherwise.
  // Many chat templates (Qwen3.x, gpt-oss) refuse a system message anywhere but first ("System message must be at the beginning").
  // Leading system messages are merged into one; a later one (a target-switch notice, an agent task note) is sent as a user message.
  function placeSystem(messages) {
    const lead = [];
    let i = 0;
    while (i < messages.length && messages[i].role === 'system') lead.push(messages[i++].content);
    const rest = messages.slice(i).map((m) => (m.role === 'system' ? { ...m, role: 'user', content: `[note from JARVIS] ${m.content}` } : m));
    return lead.length ? [{ role: 'system', content: lead.join('\n\n') }, ...rest] : rest;
  }

  const cleanMessages = (messages) => placeSystem(messages).map((m) => {
    const out = { role: m.role, content: m.role === 'assistant' && !config.keepThinkInHistory && typeof m.content === 'string' ? stripThink(m.content) : m.content };
    for (const k of ['name', 'tool_call_id', 'tool_calls']) if (m[k] !== undefined) out[k] = m[k];
    return out;
  });

  async function post(body, { signal, timeoutMs = config.requestTimeoutMs } = {}) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort(signal.reason);
    if (signal?.aborted) ctl.abort(signal.reason); else signal?.addEventListener('abort', onAbort, { once: true });
    let idle;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new LlmError(`no data from the model for ${Math.round(timeoutMs / 1000)} s`, { retryable: false })), timeoutMs); idle.unref?.(); };
    arm();
    const done = () => { clearTimeout(idle); signal?.removeEventListener('abort', onAbort); };
    try {
      const res = await fetchImpl(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      return { res, ctl, arm, done };
    } catch (e) {
      done();
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (ctl.signal.aborted && ctl.signal.reason instanceof LlmError) throw ctl.signal.reason;
      throw new LlmError(`cannot reach the model at ${base}: ${e.cause?.code ?? e.message}`, { retryable: true });
    }
  }

  // Connects with up to two retries (before any byte has arrived) on connection errors, 429, 502, 503 and 504.
  async function open(body, opts) {
    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await post(body, opts); } catch (e) {
        if (e instanceof LlmError && e.retryable && attempt < 2 && !opts.signal?.aborted) { await sleepFn(300 * 2 ** attempt, opts.signal); continue; }
        throw e;
      }
      if (r.res.ok) return r;
      const text = await r.res.text().catch(() => '');
      r.done();
      const retryable = [429, 502, 503, 504].includes(r.res.status);
      if (retryable && attempt < 2 && !opts.signal?.aborted) { await sleepFn(300 * 2 ** attempt, opts.signal); continue; }
      throw new LlmError(`model server answered ${r.res.status}: ${text.slice(0, 300)}`, { status: r.res.status, retryable });
    }
  }

  /**
   * Streams one chat completion.
   * @param {{messages: object[], tools?: object[], signal?: AbortSignal, use?: 'chat'|'tools'|'digest'|'agent', maxTokens?: number,
   *          onDelta?: (d: {content?: string, reasoning?: string}) => void}} o
   * @returns {Promise<{content: string, reasoning: string, toolCalls: {id: string, name: string, arguments: string, args: object|null, error?: string}[],
   *   finishReason: string|null, truncated: boolean, usage: object|null, stats: object}>}
   */
  async function chat({ messages, tools = null, signal, use = 'chat', maxTokens = config.maxOutputTokens, onDelta }) {
    const body = applyThinking({
      model: config.modelId, messages: cleanMessages(messages), stream: true, stream_options: { include_usage: true },
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      ...config.sampling, // temperature, top_p, top_k, min_p, presence_penalty, repeat_penalty from models.json; absent = LM Studio's preset
    }, use);
    const t0 = now();
    const { res, ctl, arm, done } = await open(body, { signal });
    const splitter = new StreamSplitter({ toolCalls: !!tools?.length && !structured });
    // An inline call whose text is already in a tool result or an untrusted block of this request is an echo of that content, not a call.
    const flat = (s) => String(s ?? '').replace(/[\s\\]/g, '');
    let quoted = null;
    const echoes = (text) => { quoted ??= flat(messages.filter((m) => m.role === 'tool' || (typeof m.content === 'string' && m.content.includes('<untrusted'))).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')); const t = flat(text); return !!t && quoted.includes(t); };
    let echoed = 0;
    const sse = new SseParser();
    const acc = new Map();
    const inline = [];
    let content = '';
    let reasoning = '';
    let finishReason = null;
    let usage = null;
    let tFirst = null;
    let sawDone = false;
    let bad = 0;

    const emit = (parts) => {
      for (const p of parts) {
        if (p.kind === 'content') { content += p.text; onDelta?.({ content: p.text }); }
        else if (p.kind === 'reasoning') { reasoning += p.text; onDelta?.({ reasoning: p.text }); }
        else {
          const j = parseJson(p.text.trim());
          if (echoes(p.text)) echoed += 1;
          else if (j && typeof j.name === 'string') inline.push({ id: `call_inline_${inline.length}`, name: j.name, arguments: JSON.stringify(j.arguments ?? j.parameters ?? {}) });
          else bad += 1;
        }
      }
    };
    const handle = (data) => {
      if (data === '[DONE]') { sawDone = true; return; }
      const j = parseJson(data);
      if (!j) { bad += 1; return; }
      if (j.error) throw new LlmError(`model error: ${j.error.message ?? JSON.stringify(j.error).slice(0, 200)}`);
      if (j.usage) usage = j.usage;
      const choice = j.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const d = choice.delta ?? {};
      if (d.reasoning_content || d.reasoning) { tFirst ??= now(); const t = d.reasoning_content ?? d.reasoning; reasoning += t; onDelta?.({ reasoning: t }); }
      if (typeof d.content === 'string' && d.content) { tFirst ??= now(); emit(splitter.push(d.content)); }
      for (const tc of d.tool_calls ?? []) {
        tFirst ??= now();
        const i = tc.index ?? 0;
        const cur = acc.get(i) ?? { id: '', name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        acc.set(i, cur);
      }
    };

    try {
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        arm();
        for (const ev of sse.push(decoder.decode(chunk, { stream: true }))) handle(ev);
      }
      for (const ev of sse.end()) handle(ev);
    } catch (e) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (ctl.signal.aborted && ctl.signal.reason instanceof LlmError) throw ctl.signal.reason;
      throw e instanceof LlmError ? e : new LlmError(`stream failed: ${e.message}`);
    } finally { done(); }
    emit(splitter.flush());
    if (acc.size) structured = true;

    const toolCalls = [...acc.values(), ...inline].filter((c) => c.name).map((c, i) => {
      const args = c.arguments.trim() === '' ? {} : parseJson(c.arguments);
      const ok = args && typeof args === 'object' && !Array.isArray(args);
      return { id: c.id || `call_${i}`, name: c.name, arguments: c.arguments, args: ok ? args : null, ...(ok ? {} : { error: 'arguments are not a JSON object' }) };
    });
    // The server closed the stream. Without [DONE] or a finish_reason this is a cut-off reply, reported as truncated, never as a hang.
    const truncated = finishReason === 'length' || (!sawDone && finishReason === null);
    const end = now();
    const completionTokens = usage?.completion_tokens ?? Math.ceil((content.length + reasoning.length) / 4);
    const genSeconds = tFirst === null ? 0 : Math.max((end - tFirst) / 1000, 0.001);
    const stats = { ttftMs: tFirst === null ? null : Math.round(tFirst - t0), tokensPerSec: genSeconds && completionTokens > 1 ? Number((completionTokens / genSeconds).toFixed(2)) : null, completionTokens, promptTokens: usage?.prompt_tokens ?? null, malformedChunks: bad, droppedToolCalls: splitter.dropped + echoed };
    if (stats.tokensPerSec) last = { ...stats, at: Date.now() };
    return { content: content.trim(), reasoning, toolCalls, finishReason, truncated, usage, stats };
  }

  async function health() {
    try {
      const res = await fetchImpl(`${base}/models`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { reachable: false, error: `HTTP ${res.status}`, tokensPerSec: last?.tokensPerSec ?? null };
      // LM Studio lists "qwen3.8-27b" for the key "unsloth/qwen3.8-27b", so the match below also accepts the part after the slash.
      const ids = ((await res.json()).data ?? []).map((m) => m.id);
      const mine = await listModels().then((r) => r.models.find((m) => m.key === config.modelId)).catch(() => null); // size on disk and loaded context
      return { reachable: true, sizeBytes: mine?.sizeBytes ?? null, loadedContext: mine?.loadedContext ?? null, modelId: config.modelId, settings: { thinking: config.thinking?.chat ?? false, temperature: config.sampling?.temperature ?? null, mtp: !!config.mtp?.enabled }, loaded: ids, modelPresent: ids.some((id) => id === config.modelId || config.modelId.endsWith(`/${id}`)), tokensPerSec: last?.tokensPerSec ?? null, lastRequestAt: last?.at ?? null };
    } catch (e) { return { reachable: false, error: e.cause?.code ?? e.message, tokensPerSec: last?.tokensPerSec ?? null }; }
  }

  // For llm-proxy (OpenCode): same alias, same thinking policy, bounded output, raw streamed Response back.
  function prepareProxyBody(input) {
    const body = { ...input, ...config.sampling, model: config.modelId };
    delete body.chat_template_kwargs; delete body.reasoning_effort;
    const cap = Math.floor(config.contextLength / 2);
    if (!Number.isFinite(body.max_tokens) || body.max_tokens > cap) body.max_tokens = cap;
    return applyThinking(body, 'agent');
  }
  async function raw(body, { signal } = {}) {
    const { res, arm, done } = await open(prepareProxyBody(body), { signal });
    return { res, arm, done }; // the caller calls arm() on every chunk (inactivity timeout) and done() at the end
  }

  // ---- the model list and the model choice (the app's model menu) ----
  const root = base.replace(/\/v1$/, '');
  const native = async (p, body, signal = AbortSignal.timeout(120_000)) => {
    const res = await fetchImpl(`${root}/api/v1${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal } : { signal });
    if (!res.ok) throw new LlmError(`LM Studio ${p} answered ${res.status}`, { status: res.status });
    return res.json();
  };
  async function listModels() {
    const j = await native('/models', null, AbortSignal.timeout(5000));
    const models = (j.models ?? []).filter((m) => m.type === 'llm').map((m) => ({ key: m.key, name: m.display_name ?? m.key, loaded: (m.loaded_instances?.length ?? 0) > 0, loadedContext: m.loaded_instances?.[0]?.config?.context_length ?? null, sizeBytes: m.size_bytes ?? null, instanceIds: (m.loaded_instances ?? []).map((i) => i.id) }));
    return { active: models.find((m) => sameModel(m.key, config.modelId))?.key ?? config.modelId, models };
  }
  // A model without a profile gets the safe request side: thinking off by the template switch, LM Studio's own sampling.
  // LM Studio lists a model as "qwen3.8-27b" where the config says "unsloth/qwen3.8-27b": the same model, with or without the publisher
  const sameModel = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  const profileFor = (key) => config.profiles?.[key] ?? Object.entries(config.profiles ?? {}).find(([k]) => sameModel(k, key))?.[1] ?? { thinkingMethod: 'chat_template_kwargs', thinking: { chat: false, tools: false, digest: false, agent: false } };
  function applyProfile(key) {
    const p = profileFor(key);
    config.modelId = key;
    config.thinkingMethod = p.thinkingMethod ?? config.thinkingMethod;
    config.thinking = { ...config.thinking, ...p.thinking };
    config.sampling = p.sampling;
    if (p.contextLength) config.contextLength = p.contextLength;
  }
  async function selectModel(key) {
    const { models } = await listModels();
    if (!models.some((m) => m.key === key)) throw new LlmError('that model is not installed in LM Studio', { status: 404 });
    for (const m of models) if (m.key !== key) for (const id of m.instanceIds) await native('/models/unload', { instance_id: id });
    if (!models.find((m) => m.key === key).loaded) await native('/models/load', { model: key, context_length: profileFor(key).contextLength ?? config.contextLength });
    applyProfile(key);
    return listModels();
  }

  return { chat, health, raw, listModels, selectModel, applyProfile, lastStats: () => last, get modelId() { return config.modelId; }, get contextLength() { return config.contextLength; } };
}
