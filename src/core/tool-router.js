// Splits a streamed reply into chat text and artifacts.
//
// Artifact convention (see config/system-prompt.md):
//   <jarvis-artifact id="kebab-id" type="html|svg|mermaid|chart|markdown|code" title="..." lang="py">
//   ...content...
//   </jarvis-artifact>
//
// parseReply() is pure and safe to call on every streamed chunk: it copes with
// a tag that is still being written (partial opening tag, missing close tag).
//
// Board convention: a second, attribute-only tag arranges the whiteboard panels once the reply
// is finished. Panels are artifacts, named by id; the layout is a name, never coordinates.
//   <jarvis-board layout="split|rows|main-side|grid|cascade" panels="id-one,id-two" focus="panels" />
// focus="panels" gives the panels the wide side and the conversation the narrow one.

const OPEN = '<jarvis-artifact';
const CLOSE = '</jarvis-artifact>';
const BOARD = '<jarvis-board';
const BOARD_CLOSE = '</jarvis-board>';
export const ARTIFACT_TYPES = ['html', 'svg', 'mermaid', 'chart', 'markdown', 'code', 'table'];
export const BOARD_LAYOUTS = ['split', 'rows', 'main-side', 'grid', 'cascade'];

// Length of the longest suffix of `text` that is a proper prefix of `tag`, so a
// half-streamed "<jarvis-art" is held back instead of flashing in the chat text.
function partialSuffix(text, tag) {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

function parseAttrs(source) {
  const attrs = {};
  for (const m of source.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = m[2] ?? m[3];
  return attrs;
}

// Models often fence the content inside the tag; drop the fence.
function unfence(content) {
  let c = content.replace(/^\s*\n/, '');
  const open = c.match(/^```[\w+-]*[ \t]*\n/);
  if (open) {
    c = c.slice(open[0].length);
    c = c.replace(/\n?```\s*$/, '');
  }
  return c.replace(/\s+$/, '');
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Returns [{ kind: 'text', text }
//         | { kind: 'artifact', id, type, title, lang, content, complete, opening }
//         | { kind: 'board', layout, panels, focus }]   (layout is '' when absent or unknown)
export function parseReply(text) {
  const parts = [];
  const pushText = (t) => { if (t.trim()) parts.push({ kind: 'text', text: t }); };
  let pos = 0;
  let count = 0;

  while (pos < text.length) {
    const a = text.indexOf(OPEN, pos);
    const b = text.indexOf(BOARD, pos);
    const isBoard = b !== -1 && (a === -1 || b < a);
    const start = isBoard ? b : a;
    if (start === -1) {
      const rest = text.slice(pos);
      pushText(rest.slice(0, rest.length - Math.max(partialSuffix(rest, OPEN), partialSuffix(rest, BOARD))));
      break;
    }
    pushText(text.slice(pos, start));

    if (isBoard) {
      const end = text.indexOf('>', start);
      if (end === -1) break; // tag still streaming: show nothing yet
      const attrs = parseAttrs(text.slice(start + BOARD.length, end));
      parts.push({
        kind: 'board',
        layout: BOARD_LAYOUTS.includes(attrs.layout) ? attrs.layout : '',
        panels: (attrs.panels || '').split(',').map((s) => s.trim()).filter(Boolean),
        focus: attrs.focus === 'panels' ? 'panels' : 'session',
      });
      pos = end + 1;
      const tail = text.slice(pos).match(/^\s*<\/jarvis-board>/); // optional explicit close
      if (tail) pos += tail[0].length;
      continue;
    }

    const tagEnd = text.indexOf('>', start);
    if (tagEnd === -1) {
      // Opening tag still streaming: show a placeholder card, nothing else.
      parts.push({ kind: 'artifact', id: '', type: 'code', title: '', lang: '', content: '', complete: false, opening: true });
      break;
    }

    const attrs = parseAttrs(text.slice(start + OPEN.length, tagEnd));
    const bodyStart = tagEnd + 1;
    const closeAt = text.indexOf(CLOSE, bodyStart);
    const complete = closeAt !== -1;
    let body = complete ? text.slice(bodyStart, closeAt) : text.slice(bodyStart);
    if (!complete) body = body.slice(0, body.length - partialSuffix(body, CLOSE));

    count += 1;
    const title = attrs.title || 'Untitled';
    parts.push({
      kind: 'artifact',
      id: attrs.id || slug(title) || `artifact-${count}`,
      type: ARTIFACT_TYPES.includes(attrs.type) ? attrs.type : 'code',
      title,
      lang: attrs.lang || '',
      content: unfence(body),
      complete,
      opening: false,
    });
    pos = complete ? closeAt + CLOSE.length : text.length;
  }
  return parts;
}
