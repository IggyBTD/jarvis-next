// The chat loop: one user message -> model -> tool calls through the router -> model ... -> answer.
// Limits per turn (models.json): 8 model calls and 12 tool calls by default. The target is bound when the turn starts and
// stays for the whole turn. The user can abort at any time; the conversation never keeps a tool call without a result.
import { fit, estimateTokens } from './conversations.js';
import { effortNote, DEFAULT_EFFORT } from '../../shared/effort.js';

export class BusyError extends Error { constructor() { super('This conversation is still answering the last message.'); this.name = 'BusyError'; } }

export function createOrchestrator({ llm, queue, router, prompts, conversations, targetState, bus, models, now = () => new Date() }) {
  const maxIterations = models.maxIterations ?? 8;
  const maxToolCalls = models.maxToolCalls ?? 12;
  const turnToolChars = () => models.turnToolChars ?? 24_000;
  const active = new Map(); // convId -> AbortController

  const budgetFor = (system, tools) => models.contextLength - (models.maxOutputTokens ?? 4096) - estimateTokens({ content: system }) - Math.ceil(JSON.stringify(tools).length / 3.5) - 512;

  async function runTurn({ convId, text, source = 'user', voiceMode = false, effort = DEFAULT_EFFORT }) {
    const conv = conversations.ensure(convId);
    if (active.has(conv.id)) throw new BusyError();
    const ctl = new AbortController();
    active.set(conv.id, ctl);
    bus.publish('chat.state', { convId: conv.id, running: true }); // the chat list shows which chats are working
    const { target } = targetState.bind();
    const emit = (type, payload = {}) => bus.publish(type, { convId: conv.id, target, ...payload });
    let streamed = '';
    try {
      if (conv.lastTarget && conv.lastTarget !== target) {
        conversations.append(conv, { role: 'system', content: prompts.switchNotice({ from: conv.lastTarget, to: target, now: now() }), target });
      }
      conv.lastTarget = target;
      conversations.append(conv, { role: 'user', content: text, target });
      if (!conv.title) { conv.title = text.replace(/\s+/g, ' ').slice(0, 60); conversations.save(conv); emit('chat.title', { title: conv.title }); }

      const built = await prompts.build(target, { now: now() });
      const system = voiceMode ? `${built}\n\nThis reply will be spoken aloud: lead with the answer, use short plain sentences, no tables, lists, headings or symbols, and never read code or long numbers.` : built;
      let calls = 0;
      let turnChars = 0;
      let malformed = 0;
      const turn = { requests: 0, completionTokens: 0, genSeconds: 0, promptTokens: null, ttftMs: null, startedAt: Date.now() }; // what this reply cost the model, shown under it
      let finalText = '';
      let truncated = false;
      let wrapUp = false;

      for (let iteration = 1; ; iteration++) {
        if (iteration > maxIterations) { finalText = `I stopped after ${maxIterations} steps without finishing. Tell me how to continue.`; break; }
        const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        const recent = conv.messages.filter((m) => m.role === 'tool').slice(-8).map((m) => m.name);
        const sel = wrapUp ? { tools: [] } : router.toolDefs(target, { text: `${lastUser}\n${conv.messages.filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join('\n')}`, recent, unlocked: conv.unlocked });
        const history = fit(conv.messages, budgetFor(system, sel.tools));
        const lastUserAt = history.findLastIndex((m) => m.role === 'user' && typeof m.content === 'string');
        if (lastUserAt !== -1) history[lastUserAt] = { ...history[lastUserAt], content: `${history[lastUserAt].content}\n\n${prompts.timeNote(now())}${effortNote(effort) ? `
${effortNote(effort)}` : ''}` }; // request only, never stored
        const messages = [{ role: 'system', content: system }, ...history];
        streamed = '';
        const res = await queue.run('interactive', (signal) => llm.chat({
          messages, tools: sel.tools.length ? sel.tools : null, use: sel.tools.length ? 'tools' : 'chat', signal,
          onDelta: (d) => { if (d.content) { streamed += d.content; emit('chat.delta', { text: d.content }); } },
        }), { signal: ctl.signal });

        turn.requests += 1;
        turn.completionTokens += res.stats.completionTokens ?? 0;
        if (res.stats.tokensPerSec) turn.genSeconds += (res.stats.completionTokens ?? 0) / res.stats.tokensPerSec;
        turn.promptTokens = res.stats.promptTokens ?? turn.promptTokens;
        turn.ttftMs ??= res.stats.ttftMs;
        if (!res.toolCalls.length) { finalText = res.content; truncated = res.truncated; break; }

        conversations.append(conv, {
          role: 'assistant', content: res.content, target,
          tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
        });
        for (const c of res.toolCalls) {
          let content;
          if (calls >= maxToolCalls) content = 'Skipped: the limit of tool calls for this message was reached.';
          else if (c.args === null) { malformed += 1; content = `Your arguments for ${c.name} were not a valid JSON object. Send a JSON object that matches the tool's parameters.`; }
          else {
            calls += 1;
            emit('tool.call', { name: c.name, args: c.args });
            const r = await router.invoke(c, { target, source, convId: conv.id, signal: ctl.signal, conversation: conv });
            emit('tool.result', { name: c.name, ok: r.ok, queued: !!r.queued, denied: !!r.denied });
            content = r.content;
            // All tool output of one message together stays under a budget, so a long loop cannot grow the prompt without limit.
            if (turnChars + content.length > turnToolChars()) content = `[${c.name}] The result was left out: this message already brought in ${turnChars} characters of tool output. Use fewer items or a narrower query, or answer from what you have.`;
            turnChars += content.length;
          }
          conversations.append(conv, { role: 'tool', tool_call_id: c.id, name: c.name, content, target });
        }
        if (malformed > 2) { emit('chat.error', { reason: 'The model kept sending malformed tool calls. Try rephrasing.' }); return { ok: false, error: 'malformed' }; }
        if (calls >= maxToolCalls) wrapUp = true;
        streamed = '';
      }

      if (truncated) finalText += '\n\n[The reply was cut off by the output limit.]';
      conversations.append(conv, { role: 'assistant', content: finalText, target });
      emit('chat.done', { text: finalText, stats: { requests: turn.requests, tools: calls, completionTokens: turn.completionTokens, promptTokens: turn.promptTokens, ttftMs: turn.ttftMs, tokensPerSec: turn.genSeconds ? Number((turn.completionTokens / turn.genSeconds).toFixed(1)) : null, totalMs: Date.now() - turn.startedAt } });
      return { ok: true, text: finalText, target };
    } catch (e) {
      const aborted = ctl.signal.aborted || e.name === 'AbortError';
      // never leave a tool call without its result
      const last = conv.messages.filter((m) => m.role === 'assistant' && m.tool_calls).at(-1);
      if (last) for (const tc of last.tool_calls) if (!conv.messages.some((m) => m.tool_call_id === tc.id)) conversations.append(conv, { role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: 'Cancelled before it ran.', target });
      if (streamed) conversations.append(conv, { role: 'assistant', content: streamed, target, partial: true });
      emit('chat.error', { reason: aborted ? 'aborted' : e.message });
      return { ok: false, error: aborted ? 'aborted' : e.message };
    } finally { active.delete(conv.id); bus.publish('chat.state', { convId: conv.id, running: false }); }
  }

  return {
    runTurn,
    abort(convId) { active.get(convId)?.abort(Object.assign(new Error('aborted'), { name: 'AbortError' })); return active.has(convId); },
    isBusy: (convId) => active.has(convId),
    busyIds: () => [...active.keys()],
    abortAll() { for (const c of active.values()) c.abort(Object.assign(new Error('aborted'), { name: 'AbortError' })); },
  };
}
