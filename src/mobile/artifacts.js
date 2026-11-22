// Artifacts on the phone: a card where JARVIS made one inside a reply, a full-height viewer (the same sandboxed frame the desktop uses),
// and the list for the Artifacts tab, found by reading the artifact tags out of your recent chats on the server.
import { parseReply } from '../core/tool-router.js';
import { upsertArtifact, getArtifact, listArtifacts } from '../core/artifacts.js';
import { buildSrcdoc } from '../core/artifact-renderer.js';
import { icon } from '../icons/index.js';
import { listChats, getChat } from './link.js';
import { openSheet } from './sheets.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const KIND = { html: 'Page', svg: 'Image', mermaid: 'Diagram', chart: 'Chart', markdown: 'Document', code: 'Code', table: 'Table' };
export const kindOf = (a) => KIND[a.type === 'code' && a.lang ? 'code' : a.type] ?? 'Artifact';
const origin = new Map(); // artifact id -> { chat, at } for the list
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// the card shown in the conversation where a reply made an artifact
export function cardHtml(p) {
  if (p.opening || !p.id) return `<div class="m-art-card working"><span class="m-art-ic">${icon('artifacts', { size: 20 })}</span><span class="m-art-text"><span class="m-art-title">Making an artifact...</span></span></div>`;
  return `<button type="button" class="m-art-card" data-art="${escapeHtml(p.id)}"><span class="m-art-ic">${icon('artifacts', { size: 20 })}</span><span class="m-art-text"><span class="m-art-title">${escapeHtml(p.title)}</span><span class="m-art-sub">${p.complete ? `${KIND[p.type] ?? 'Artifact'} · tap to open` : 'Writing...'}</span></span></button>`;
}
export const register = (p, chat) => { if (p.id && p.content && p.complete) { upsertArtifact({ ...p }); if (!origin.has(p.id)) origin.set(p.id, { chat: chat ?? '', at: Date.now() }); } };

export async function openArtifact(id) {
  const a = getArtifact(id);
  if (!a) return;
  const v = a.versions[a.versions.length - 1];
  const wrap = el('div', 'm-art-view');
  const frame = el('iframe', 'm-art-frame');
  frame.setAttribute('sandbox', 'allow-scripts'); // deliberately no allow-same-origin, as on the desktop
  frame.title = a.title;
  wrap.append(frame);
  const share = el('button', 'm-secondary', 'Copy source'); share.type = 'button';
  share.addEventListener('click', async () => { try { await navigator.clipboard.writeText(v.content); share.textContent = 'Copied'; } catch { share.textContent = 'Copy failed'; } setTimeout(() => { share.textContent = 'Copy source'; }, 1600); });
  openSheet({ title: a.title, content: wrap, footer: share, label: a.title });
  let doc = null;
  try { doc = await buildSrcdoc(a.type, v.content); } catch (e) { doc = `<body style="font:14px monospace;padding:16px">The preview failed: ${escapeHtml(e.message)}</body>`; }
  if (doc) frame.srcdoc = doc;
  else { const pre = el('pre', 'm-art-src', v.content); frame.replaceWith(pre); }
}

// Reads the artifact tags out of the newest chats (once each per change) so the tab lists what exists, not only this session's.
const seen = new Map(); // chat id -> updatedAt already read
export async function scan(limit = 12) {
  let chats = [];
  try { chats = (await listChats()).slice(0, limit); } catch { return list(); }
  await Promise.all(chats.map(async (c) => {
    if (seen.get(c.id) === c.updatedAt) return;
    seen.set(c.id, c.updatedAt);
    try {
      const { messages } = await getChat(c.id);
      for (const m of messages) {
        if (m.role !== 'assistant' || typeof m.content !== 'string' || !m.content.includes('<jarvis-artifact')) continue;
        for (const p of parseReply(m.content)) if (p.kind === 'artifact') { upsertArtifact(p); if (p.complete && p.id) origin.set(p.id, { chat: c.title || 'New chat', at: Date.parse(c.updatedAt) }); }
      }
    } catch { /* a chat that cannot be read is skipped */ }
  }));
  return list();
}
export const list = () => listArtifacts().filter((a) => a.versions.some((v) => !v.partial)).map((a) => ({ a, from: origin.get(a.id) })).sort((x, y) => (y.from?.at ?? 0) - (x.from?.at ?? 0));
