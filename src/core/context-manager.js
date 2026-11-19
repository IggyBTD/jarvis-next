// Keeps the conversation inside the model's context window. Pure functions over the history array
// (OpenAI-style messages), so node can test them. chat-ui.js decides when to call them and runs
// the one model call (the summary) that compaction needs.
//
// Two steps, cheapest first: trimToolResults shortens old tool output (file bodies and command
// output are what fills a 32K window), compaction replaces everything but the recent messages by a
// summary written by the model.
const CHARS_PER_TOKEN = 3.5; // rough; the real count comes from the server after each reply
const TRIM_TO = 300;

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n') : '');

const sizeOf = (m) => textOf(m.content).length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);

export const estimateTokens = (messages, extraChars = 0) => Math.ceil((messages.reduce((n, m) => n + sizeOf(m), 0) + extraChars) / CHARS_PER_TOKEN);

export const shouldCompact = (usedTokens, maxTokens, ratio = 0.75) => !!usedTokens && !!maxTokens && usedTokens >= maxTokens * ratio;

// Shortens the content of tool results older than the last `keep` messages. Mutates, returns how many.
export function trimToolResults(history, keep = 8) {
  let n = 0;
  for (let i = 0; i < history.length - keep; i++) {
    const m = history[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > TRIM_TO + 40) {
      m.content = `${m.content.slice(0, TRIM_TO)}\n...[${m.content.length - TRIM_TO} characters trimmed to save context]`;
      n++;
    }
  }
  return n;
}

// Where to cut: everything before `cut` is summarised, everything from it on is kept. The cut is
// always at a user message, so a tool call is never separated from its result. Returns -1 when
// there is nothing worth summarising.
export function findCut(history, keep = 6) {
  for (let i = Math.max(1, history.length - keep); i < history.length; i++) {
    if (history[i].role === 'user' && !history[i].summary) return i;
  }
  return -1;
}

// The text the summariser reads: the old messages, long tool output shortened.
export function transcriptForSummary(old, maxChars = 24000) {
  const lines = old.map((m) => {
    if (m.role === 'user') return `USER: ${textOf(m.content)}`;
    if (m.role === 'tool') return `TOOL RESULT: ${textOf(m.content).slice(0, 400)}`;
    const calls = (m.tool_calls ?? []).map((c) => `${c.function.name}(${String(c.function.arguments).slice(0, 160)})`).join('; ');
    return `ASSISTANT: ${textOf(m.content)}${calls ? ` [called ${calls}]` : ''}`;
  });
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = `[earlier part cut]\n${text.slice(text.length - maxChars)}`;
  return text;
}

export const summaryRequest = (old, focus = '') => [{
  role: 'user',
  content: 'Summarise this conversation so the work can continue from the summary alone. Keep: the goal, decisions made, '
    + 'files read or changed (with paths), commands run and their outcomes, open problems, and what was about to happen next. '
    + `Plain text, under 400 words, no preamble.${focus ? ` Pay particular attention to: ${focus}.` : ''}\n\n<conversation>\n${transcriptForSummary(old)}\n</conversation>`,
}];

// The two messages that stand in for the summarised part (they keep the user/assistant alternation).
export const summaryMessages = (summary) => [
  { role: 'user', content: `[Summary of the earlier conversation]\n${summary.trim()}`, summary: true },
  { role: 'assistant', content: 'Understood. I will continue from that summary.', summary: true },
];

// Replaces history[0..cut) by the summary, in place. Returns the messages that were removed.
export function applySummary(history, cut, summary) {
  return history.splice(0, cut, ...summaryMessages(summary));
}

// Per-turn context (recalled memory, tasks, plan mode) is appended to a copy of the newest user
// message instead of the system prompt: the system prompt and older history then stay identical
// between turns, so LM Studio reuses its cached prefix instead of reading the whole chat again.
export function withReminder(messages, reminder) {
  const i = messages.findLastIndex((m) => m.role === 'user');
  if (!reminder || i < 0) return messages;
  const m = messages[i];
  const content = Array.isArray(m.content) ? [...m.content, { type: 'text', text: reminder }] : `${m.content}\n\n${reminder}`;
  return messages.with(i, { ...m, content });
}
