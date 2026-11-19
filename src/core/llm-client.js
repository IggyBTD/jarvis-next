// Single entry point for LM Studio. No other file should call the API directly.
import config from '../../config/models.json';
import systemPrompt from '../../config/system-prompt.md?raw';
import { createToolCallAccumulator } from './tool-calls.js';
import { withReminder } from './context-manager.js';

const BASE = config.endpoint;                          // OpenAI-compatible: .../v1
const NATIVE = BASE.replace(/\/v1\/?$/, '/api/v1');    // LM Studio native: models, load, unload
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- events --------------------------------------------------------------
// { type: 'phase', phase: 'unloading' | 'loading' | 'idle', model }
// { type: 'stats', model, stats }
const listeners = new Set();
export function onEvent(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = (e) => listeners.forEach((cb) => cb(e));

// --- mode / presets ------------------------------------------------------
let mode = config.default;

export function setMode(name) {
  if (!config.models[name]) throw new Error(`Unknown mode: ${name}`);
  mode = name;
}

export function getMode() {
  return mode;
}

export const listModes = () => Object.keys(config.models);

export function getPreset() {
  return { name: mode, ...config.models[mode] };
}

// --- thinking ------------------------------------------------------------
// Off by default: Qwen overthinks. On, the reasoning is capped at config.think_budget tokens; past
// that the reply is restarted with thinking off and the notes so far (see chat()).
const THINK_KEY = 'jarvis.think';
let think = false;
try { think = localStorage.getItem(THINK_KEY) === '1'; } catch { /* storage blocked */ }
export const getThink = () => think;
export function setThink(on) {
  think = !!on;
  try { localStorage.setItem(THINK_KEY, think ? '1' : '0'); } catch { /* storage blocked */ }
  emit({ type: 'think', on: think });
}

// --- native API ----------------------------------------------------------
async function native(path, body) {
  const res = await fetch(`${NATIVE}${path}`, body
    ? { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }
    : undefined);
  if (!res.ok) throw new Error(`LM Studio ${path} ${res.status}: ${await res.text()}`);
  return res.json().catch(() => null);
}

// Every call refreshes `seen`. LM Studio takes about 200 ms to answer this, and the model panel asks
// every 3 seconds anyway, so a message can reuse a recent answer (see swapTo) instead of waiting.
let seen = null; // { at, models }
const SEEN_FRESH_MS = 5000;
export async function listModels() {
  const models = (await native('/models')).models;
  seen = { at: Date.now(), models };
  return models;
}

const loadedInstances = (models) => models
  .filter((m) => m.type === 'llm')
  .flatMap((m) => m.loaded_instances.map((i) => ({ key: m.key, id: i.id })));

async function waitFor(predicate, what, timeoutMs = 120000) {
  const start = Date.now();
  for (;;) {
    const models = await listModels();
    if (predicate(models)) return models;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(400);
  }
}

// Make `key` the only loaded chat model. Order matters: every other instance is
// unloaded and confirmed gone BEFORE the new model loads, so the two never
// compete for VRAM. If an unload fails we throw and never start the load.
let usedSeen = false; // the last swapTo answered from `seen` without asking LM Studio
async function swapTo(key) {
  // Fast path: a list from the last few seconds shows exactly this model loaded and nothing else,
  // so there is nothing to swap. Anything else (another model loaded, none loaded, a stale list)
  // takes the full check below, so the one-model-at-a-time rule is never skipped.
  usedSeen = false;
  if (seen && Date.now() - seen.at < SEEN_FRESH_MS) {
    const now = loadedInstances(seen.models);
    if (now.length) { usedSeen = true; return now[0].id; }
  }
  const loaded = loadedInstances(await listModels());
  if (loaded.length) return loaded[0].id; // whatever is loaded is used; nothing is unloaded or swapped automatically
  const keep = null;
  const drop = [];

  for (const inst of drop) {
    emit({ type: 'phase', phase: 'unloading', model: inst.key });
    await native('/models/unload', { instance_id: inst.id });
  }
  if (drop.length) {
    const gone = new Set(drop.map((d) => d.id));
    await waitFor((ms) => !loadedInstances(ms).some((i) => gone.has(i.id)), 'unload to finish');
  }

  if (!keep) {
    emit({ type: 'phase', phase: 'loading', model: key });
    await native('/models/load', { model: key, ...Object.values(config.models).find((m) => m.model === key)?.load }); // context_length etc. from models.json
  }
  const models = await waitFor((ms) => loadedInstances(ms).some((i) => i.key === key), 'load to finish');
  emit({ type: 'phase', phase: 'idle', model: key });
  return loadedInstances(models).find((i) => i.key === key).id;
}

// Frees one loaded model from memory (the next message loads it again).
export function unloadModel(instanceId, key) {
  const run = swapQueue.then(async () => {
    emit({ type: 'phase', phase: 'unloading', model: key });
    try {
      await native('/models/unload', { instance_id: instanceId });
      await waitFor((ms) => !loadedInstances(ms).some((i) => i.id === instanceId), 'unload to finish');
    } finally { seen = null; emit({ type: 'phase', phase: 'idle', model: key }); }
  });
  swapQueue = run.catch(() => {});
  return run;
}

// Swaps never overlap. The target is read when the swap actually runs, so rapid
// mode changes collapse to the latest one and skip intermediate loads.
let swapQueue = Promise.resolve();
export function syncModel() {
  const run = swapQueue.then(() => swapTo(getPreset().model));
  swapQueue = run.catch(() => {});
  run.catch(() => emit({ type: 'phase', phase: 'idle', model: null }));
  return run;
}

// Unloads every chat model (game mode frees the GPU). Queued with the swaps; the next message loads
// its model again.
export function unloadAll() {
  const run = swapQueue.then(async () => {
    const loaded = loadedInstances(await listModels());
    for (const inst of loaded) await native('/models/unload', { instance_id: inst.id });
    seen = null;
    return loaded.length;
  });
  swapQueue = run.catch(() => {});
  return run;
}

// --- chat ----------------------------------------------------------------
// Hides <think> blocks (closed or still open) that some Qwen3 builds inline.
// The model may start its reply with <jarvis-title>a name for this chat</jarvis-title>. The app uses it and never shows it:
// complete tags are cut out, and so is a tag still being written (including a bare "<jar" at the very end).
const TITLE_TAG = '<jarvis-title>';
function withoutTitle(text) {
  let t = text.replace(/<jarvis-title>[\s\S]*?<\/jarvis-title>\s*/g, '').replace(/<jarvis-title>[\s\S]*$/, '');
  for (let n = Math.min(TITLE_TAG.length - 1, t.length); n > 0; n -= 1) if (TITLE_TAG.startsWith(t.slice(-n))) { t = t.slice(0, -n); break; }
  return t;
}
export const titleIn = (text) => /<jarvis-title>([\s\S]*?)<\/jarvis-title>/.exec(text)?.[1].trim().replace(/^[\s"'`*#]+|[\s"'`*.]+$/g, '') || '';
const visibleText = (text) => withoutTitle(text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '')).trim();

// Streams a reply. onDelta({ content, reasoning, thinking }) fires on every chunk:
// content is the visible reply so far, reasoning the model's thinking so far.
// Resolves { reply, toolCalls, preset, stats }. With `tools` (OpenAI function definitions) the model
// may answer with tool calls instead of, or after, text: toolCalls is [{ id, name, arguments }].
// think: let the model reason first (default: the composer toggle). Internal calls pass false.
export async function chat(messages, { signal, onDelta, context = '', reminder = '', tools = null, think: thinkOn = think, priorReasoning = '' } = {}) {
  const preset = getPreset();
  // Qwen's soft switch rides on the newest user message; chat_template_kwargs is for servers that read it.
  const turnReminder = [reminder, thinkOn ? '/think' : '/no_think'].filter(Boolean).join('\n\n');
  const budgetChars = (config.think_budget ?? 1200) * 3.5;
  const own = new AbortController(); // cuts a reasoning stream that runs past the budget
  if (signal?.aborted) own.abort(signal.reason);
  signal?.addEventListener('abort', () => own.abort(signal.reason), { once: true });
  const body = (instanceId) => JSON.stringify({
    model: instanceId,
    messages: [{ role: 'system', content: context ? `${systemPrompt}

${context}` : systemPrompt }, ...withReminder(messages, turnReminder).map(({ summary, shown, ...m }) => m)], // "summary" and "shown" are our own bookkeeping, not part of the API
    stream: true,
    stream_options: { include_usage: true },
    chat_template_kwargs: { enable_thinking: thinkOn },
    ...config.sampling?.[thinkOn ? 'think' : 'fast'],
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
  });
  const post = (instanceId) => fetch(`${BASE}/chat/completions`, { method: 'POST', headers: JSON_HEADERS, body: body(instanceId), signal: own.signal });

  let res = await post(await syncModel());
  if (!res.ok && usedSeen) {
    // The model was unloaded since the list we trusted: ask LM Studio for real this time.
    seen = null;
    res = await post(await syncModel());
  }
  if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await res.text()}`);

  const t0 = performance.now();
  let tFirst = null;
  let content = '';
  let reasoning = '';
  let usage = null;
  const toolCalls = createToolCallAccumulator();
  let buffer = '';
  const decoder = new TextDecoder();

  let overBudget = false;
  try {
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const data = JSON.parse(line.slice(6));
      if (data.usage) usage = data.usage;
      const delta = data.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.tool_calls) toolCalls.push(delta.tool_calls);
      const hasToken = delta.content || delta.reasoning_content;
      if (hasToken && tFirst === null) tFirst = performance.now();
      if (delta.content) content += delta.content;
      if (delta.reasoning_content) reasoning += delta.reasoning_content;
      if (hasToken) {
        const visible = visibleText(content);
        onDelta?.({ content: visible, reasoning: priorReasoning + reasoning, thinking: !visible });
        if (!visible && reasoning.length + content.length > budgetChars) { overBudget = true; own.abort(); } // content: builds that inline <think>
      }
    }
  }
  } catch (e) {
    if (!overBudget) throw e;
  }
  if (overBudget) {
    // Thought too long: answer now from the notes, without thinking again.
    const thought = reasoning || content.replace(/<\/?think>/g, '');
    const notes = `<thinking-notes>\nYour reasoning so far (cut off because it ran too long):\n${thought}\n</thinking-notes>\nStop reasoning and answer now from these notes.`;
    return chat(messages, { signal, onDelta, context, tools, reminder: [reminder, notes].filter(Boolean).join('\n\n'), think: false, priorReasoning: `${priorReasoning}${thought}\n\n[Thinking cut off at the budget.]\n\n` });
  }

  const tEnd = performance.now();
  const ttft = tFirst === null ? null : (tFirst - t0) / 1000;
  const genSeconds = tFirst === null ? 0 : (tEnd - tFirst) / 1000;
  const promptTokens = usage?.prompt_tokens ?? null;
  const completionTokens = usage?.completion_tokens ?? null;
  const stats = {
    promptTokens,
    completionTokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    ttft,
    tps: completionTokens > 1 && genSeconds > 0 ? completionTokens / genSeconds : null,
    promptTps: promptTokens && ttft ? promptTokens / ttft : null,
  };
  emit({ type: 'stats', model: preset.model, stats });
  const title = titleIn(content.replace(/<think>[\s\S]*?<\/think>/g, ''));
  if (title) emit({ type: 'title', title });
  return { reply: visibleText(content), toolCalls: toolCalls.result(), preset, stats };
}
