// Helpers for OpenAI-style tool calling over a streamed reply. Pure, so node can test them.

// Collects the "tool_calls" fragments of streamed deltas into whole calls. Servers differ: some
// number every call from 0 and send the id once, some repeat index 0 for each new call. A fragment
// with a different id than the call at its index starts a new call.
export function createToolCallAccumulator() {
  const calls = [];
  return {
    push(fragments) {
      for (const f of fragments ?? []) {
        let slot = f.index ?? 0;
        if (f.id && calls[slot]?.id && calls[slot].id !== f.id) slot = calls.length;
        const call = (calls[slot] ??= { id: '', name: '', arguments: '' });
        if (f.id) call.id = f.id;
        if (f.function?.name) call.name += f.function.name;
        if (f.function?.arguments) call.arguments += f.function.arguments;
      }
    },
    result() {
      return calls
        .filter((c) => c && c.name)
        .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || '{}' }));
    },
  };
}

// Arguments arrive as a JSON string written by a small model: parse defensively.
export function parseArguments(raw) {
  if (raw && typeof raw === 'object') return { ok: true, value: raw };
  const text = String(raw ?? '').trim() || '{}';
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'arguments must be a JSON object' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: `arguments are not valid JSON (${e.message})` };
  }
}

// The two messages that record a round of tool calls in the conversation history.
export function assistantToolMessage(content, calls) {
  return {
    role: 'assistant',
    content: content || null,
    tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
  };
}

export const toolResultMessage = (call, content) => ({ role: 'tool', tool_call_id: call.id, content: String(content) });
