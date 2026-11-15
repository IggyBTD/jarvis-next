// Conversations persist in data/conversations/<id>.json (atomic writes). Messages are in OpenAI chat format plus a few
// bookkeeping fields (target, ts, partial). fit() keeps a conversation inside the context budget without ever splitting a
// tool call from its result.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic, readJson, newId } from '../../shared/util.js';
import { stateOf, cleanState } from './taint.js';

export const estimateTokens = (m) => Math.ceil((typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length) / 3.5) + (m.tool_calls ? Math.ceil(JSON.stringify(m.tool_calls).length / 3.5) : 0) + 8;
const ID_RE = /^[\w-]{1,64}$/;

export function createConversations({ dir, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const file = (id) => path.join(dir, `${id}.json`);

  function get(id) {
    if (!ID_RE.test(id)) throw new Error('bad conversation id');
    if (cache.has(id)) return cache.get(id);
    const c = readJson(file(id));
    if (!c) return null;
    c.unlocked = new Set(c.unlocked ?? []);
    c.taint = stateOf(c); // a chat saved before the tainted-chat rule gets its state from its history (taint.js)
    cache.set(id, c);
    return c;
  }
  function save(c) {
    c.updatedAt = now().toISOString();
    writeJsonAtomic(file(c.id), { ...c, unlocked: [...c.unlocked] });
  }
  function create(id = newId('c-')) {
    if (!ID_RE.test(id)) throw new Error('bad conversation id');
    const c = { id, title: '', createdAt: now().toISOString(), updatedAt: now().toISOString(), lastTarget: null, messages: [], unlocked: new Set(), taint: cleanState() };
    cache.set(id, c);
    save(c);
    return c;
  }
  return {
    get, create,
    ensure: (id) => (id && get(id)) || create(id && ID_RE.test(id) ? id : undefined),
    append(c, msg) { c.messages.push({ ts: now().toISOString(), ...msg }); save(c); return msg; },
    save,
    list: () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f))).filter(Boolean).map(({ id, title, updatedAt, lastTarget, pinned, project, messages }) => ({ id, title, updatedAt, lastTarget, pinned: !!pinned, messages: messages.filter((m) => m.role === 'user').length, project: project ?? null })).filter((c) => c.messages > 0).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    // rename or pin from the sidebar; a name given by hand stops the automatic one
    patch(id, { title, pinned, project }) {
      const c = get(id);
      if (!c) return null;
      if (typeof title === 'string' && title.trim()) { c.title = title.trim().slice(0, 80); c.manual = true; }
      if (typeof pinned === 'boolean') c.pinned = pinned;
      if (project === null) delete c.project; // a folder (a project of the app) the chat is filed in
      else if (typeof project === 'string' && /^[\w-]{1,40}$/.test(project)) c.project = project;
      save(c);
      return c;
    },
    remove(id) {
      if (!ID_RE.test(id)) throw new Error('bad conversation id');
      cache.delete(id);
      fs.rmSync(file(id), { force: true });
    },
    // the whole spoken conversation, for opening a saved chat
    transcript: (c) => c.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content).map((m) => ({ role: m.role, content: m.content, target: m.target ?? null, ts: m.ts })),
    // A snapshot for a newly connected client: the last few messages without internals.
    recent(c, n = 30) { return c.messages.slice(-n).filter((m) => m.role !== 'tool' && m.content).map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '', target: m.target ?? null, ts: m.ts })); },
  };
}

// API-shaped messages for the model, newest kept, inside `budget` tokens. Old tool results are shortened first, then the
// oldest whole exchanges are dropped; the list never starts with a tool message or an assistant message that has tool calls
// whose results were cut.
export function fit(messages, budget) {
  const api = messages.map(({ ts, target, partial, ...m }) => ({ ...m }));
  const total = (list) => list.reduce((n, m) => n + estimateTokens(m), 0);
  if (total(api) <= budget) return api;
  const lastUser = api.findLastIndex((m) => m.role === 'user');
  for (let i = 0; i < api.length && total(api) > budget; i++) {
    if (api[i].role === 'tool' && i < lastUser && api[i].content.length > 200) api[i] = { ...api[i], content: '[older tool result removed to save space]' };
  }
  let start = 0;
  while (total(api.slice(start)) > budget && start < lastUser) start += 1;
  while (start < api.length && (api[start].role === 'tool' || (api[start].role === 'assistant' && api[start].tool_calls && api[start + 1]?.role !== 'tool'))) start += 1;
  return api.slice(Math.min(start, Math.max(lastUser, 0)));
}
