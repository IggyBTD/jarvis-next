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

export function renderMarkdown(text) {
  const html = marked.parse(normaliseMath(text));
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
