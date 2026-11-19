// Saving and resuming conversations. The files are written by Rust (sessions.rs, data/sessions);
// this module holds the pure helpers (ids, slimming, titles, markdown export) and the one client.
// Same pattern as memory-client.js: the only place that calls the session commands.
export const newSessionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n') : '');
export { textOf };

// Images are not saved (they would make every file huge); they come back as the text "[image]".
export function slimHistory(history) {
  return history.map((m) => (Array.isArray(m.content)
    ? { ...m, content: m.content.map((p) => (p.type === 'text' ? p : { type: 'text', text: '[image]' })) }
    : { ...m }));
}

export function sessionTitle(history) {
  const first = history.find((m) => m.role === 'user' && !m.summary);
  const line = textOf(first?.content).split(/\n/)[0].trim();
  return line.length <= 60 ? line || 'Untitled' : `${line.slice(0, 57).replace(/\s+\S*$/, '')}...`;
}

export function toMarkdown(name, history) {
  const out = [`# ${name}`, ''];
  for (const m of history) {
    if (m.role === 'user') out.push(`**You:** ${textOf(m.content)}`, '');
    else if (m.role === 'assistant' && textOf(m.content)) out.push(`**JARVIS:** ${textOf(m.content)}`, '');
    else if (m.role === 'assistant' && m.tool_calls) out.push(`_JARVIS used: ${m.tool_calls.map((c) => c.function.name).join(', ')}_`, '');
    else if (m.role === 'tool') out.push('```', textOf(m.content).slice(0, 1500), '```', '');
  }
  return out.join('\n');
}

async function call(command, args) {
  if (!window.__TAURI_INTERNALS__) throw new Error('Saved sessions need the desktop app (no Tauri backend here).');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

export const saveSession = (meta, history) => call('session_save', { id: meta.id, meta: JSON.stringify(meta), history: JSON.stringify(slimHistory(history)) });
export const listSessions = () => call('session_list');
export const loadSession = async (id) => JSON.parse(await call('session_load', { id }));
export const deleteSession = (id) => call('session_delete', { id });
export const searchSessions = (query) => call('session_search', { query });
export const exportSession = (id, text) => call('session_export', { id, text });
