// Turns a streamed chat reply into text that is worth speaking, a sentence at a time.
// Pure functions, no DOM: tested in tools/tests/speech-text.test.mjs.
//
// The reply is markdown with JARVIS markers (artifacts, board tags) and arrives in growing
// prefixes. Anything a listener cannot use (code, tables, formulas, urls, the markers) is
// dropped; anything still being written (an open code fence, half a tag) is held back so it is
// never spoken half finished.

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'no', 'fig']);

// Complete markers and blocks first, then whatever is left open at the end of the text.
function stripBlocks(text, final) {
  let t = text
    .replace(/<jarvis-artifact\b[\s\S]*?<\/jarvis-artifact\s*>/g, ' ')
    .replace(/<jarvis-board\b[^>]*\/?>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ');
  // Open at the end: hold it back while streaming, drop it when the reply is final.
  const open = t.search(/<jarvis-artifact\b|<jarvis-board\b|```|\$\$|\\\[/);
  if (open >= 0) t = t.slice(0, open);
  if (!final) t = t.replace(/<[^<>]{0,40}$/, ''); // a tag that is still being typed: "<jarv"
  return t;
}

// Inline markdown to plain words.
function stripInline(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')           // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // links keep their text
    .replace(/<\/?[a-z][^>]*>/gi, ' ')               // stray html
    .replace(/https?:\/\/\S+/g, '')                  // bare urls are not worth reading out
    .replace(/\$[^$\n]+\$/g, ' ')                    // inline formulas
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')                     // inline code: say the identifier
    .replace(/(\*\*|__|\*|~~)/g, '')                 // emphasis markers
    .replace(/&nbsp;/g, ' ');
}

// One cleaned string where every line (heading, list item, paragraph) ends a sentence.
export function toSpeech(text, { final = false } = {}) {
  const lines = stripBlocks(text, final).split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) { out.push(''); continue; }
    if (/^\|/.test(line) || /^[-:| ]{3,}$/.test(line)) continue; // table rows and rules
    line = line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^([-*+]|\d+[.)])\s+/, '');
    line = stripInline(line).replace(/\s+/g, ' ').trim();
    if (!line) continue;
    // A heading or list item has no full stop of its own; give it one so it is read as a unit.
    out.push(/[.!?:;]["')\]]?$/.test(line) ? line : `${line}.`);
  }
  return out.join('\n').replace(/\n{2,}/g, '\n').trim();
}

// Is the "." at index i the end of a sentence? Not for 3.5, e.g., Dr. Smith, 10.30, file.js.
function isSentenceEnd(s, i) {
  const ch = s[i];
  if (ch === '\n') return true;
  if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') return false;
  let j = i + 1;
  while (j < s.length && /["')\]]/.test(s[j])) j += 1;
  if (j >= s.length) return null;                  // end of what we have: undecided
  if (!/\s/.test(s[j])) return false;              // "3.5", "file.js", "e.g.x"
  if (ch === '.') {
    const word = s.slice(0, i).match(/([A-Za-z.]+)$/)?.[1]?.toLowerCase();
    if (word && ABBREVIATIONS.has(word)) return false;
    if (/\b[A-Z]$/.test(s.slice(Math.max(0, i - 2), i))) return false; // an initial: "J. Smith"
  }
  return true;
}

// Splits `text` (already cleaned by toSpeech) into finished sentences and the unfinished rest;
// `consumed` is how many characters of `text` the sentences account for.
// While streaming (`final` false) a terminator at the very end is not trusted yet, because "3."
// may become "3.5"; once the reply is final everything left is a sentence.
export function takeSentences(text, { final = false, maxLength = 260 } = {}) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const end = isSentenceEnd(text, i);
    if (end === true || (end === null && final)) {
      const s = text.slice(start, i + 1).trim();
      if (s) sentences.push(s);
      start = i + 1;
    } else if (i - start >= maxLength && /[,;:]/.test(text[i]) && text[i + 1] === ' ') {
      // a very long sentence: speak the first part at a comma so audio can begin
      const s = text.slice(start, i + 1).trim();
      if (s) sentences.push(s);
      start = i + 1;
    }
  }
  const rest = text.slice(start);
  if (final) return { sentences: rest.trim() ? [...sentences, rest.trim()] : sentences, rest: '', consumed: text.length };
  return { sentences, rest, consumed: start };
}

// Incremental form for a streamed reply: feed the growing visible content, get the new sentences.
export function createSentenceStream() {
  let spoken = 0; // characters of the cleaned text already handed out
  return {
    push(content, { final = false } = {}) {
      const clean = toSpeech(content, { final });
      // Cleaning is not strictly prefix-stable (a late closing marker can change earlier text), so
      // only the text after what was already handed out is considered, never earlier text.
      if (clean.length <= spoken) return [];
      const { sentences, consumed } = takeSentences(clean.slice(spoken), { final });
      spoken += consumed;
      return sentences;
    },
  };
}
