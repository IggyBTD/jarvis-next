// Turns an attached file into text the model can read. Pure functions over bytes (no DOM), so
// they run in the app and under `node --test`. PDF needs pdf.js and lives in attachments.js.
//
// Office files (docx, pptx, xlsx) are zip archives of XML: a small zip reader pulls out the
// parts that hold the text and regular expressions lift the text out of the markup.

const decoder = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Reads the entries of a zip whose name passes `want`. Returns Map(name -> Uint8Array).
// Handles stored and deflated entries; zip64 and encryption are not supported (throws).
export async function unzip(buffer, want = () => true) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip archive');
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  if (pos === 0xffffffff) throw new Error('zip64 archives are not supported');

  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    if (flags & 1) throw new Error('password-protected file');
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`unsupported zip compression (${method})`);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? m;
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const stripTags = (xml) => unescapeXml(xml.replace(/<[^>]+>/g, ''));
const tidy = (text) => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const xmlOf = (files, name) => (files.has(name) ? decoder.decode(files.get(name)) : '');
const numbered = (files, re) => [...files.keys()].filter((k) => re.test(k)).sort((a, b) => Number(a.match(re)[1]) - Number(b.match(re)[1]));

function docxText(xml) {
  return tidy(stripTags(xml
    .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '') // field codes, not visible text
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)[^>]*\/>/g, '\n')
    .replace(/<\/w:p>\s*<\/w:tc>/g, '\t') // table cells sit on one line, tab separated
    .replace(/\t?<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')));
}

export async function extractDocx(buffer) {
  const files = await unzip(buffer, (n) => n === 'word/document.xml');
  if (!files.size) throw new Error('no document text found');
  return docxText(xmlOf(files, 'word/document.xml'));
}

export async function extractPptx(buffer) {
  const re = /^ppt\/slides\/slide(\d+)\.xml$/;
  const files = await unzip(buffer, (n) => re.test(n));
  if (!files.size) throw new Error('no slides found');
  return numbered(files, re).map((name, i) => {
    const text = tidy(stripTags(xmlOf(files, name).replace(/<a:br[^>]*\/>/g, '\n').replace(/<\/a:p>/g, '\n')));
    return `--- Slide ${i + 1} ---\n${text}`;
  }).join('\n\n');
}

export async function extractXlsx(buffer) {
  const re = /^xl\/worksheets\/sheet(\d+)\.xml$/;
  const files = await unzip(buffer, (n) => re.test(n) || n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml');
  const shared = [...xmlOf(files, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const names = [...xmlOf(files, 'xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
  const sheets = numbered(files, re);
  if (!sheets.length) throw new Error('no worksheets found');
  return sheets.map((name, i) => {
    const rows = [...xmlOf(files, name).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => (
      [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = '']) => {
        const type = attrs.match(/\bt="(\w+)"/)?.[1];
        if (type === 'inlineStr') return stripTags(inner);
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        return type === 's' ? (shared[Number(v)] ?? '') : unescapeXml(v);
      }).join('\t')
    ));
    return `--- Sheet: ${names[i] ?? i + 1} ---\n${rows.join('\n')}`;
  }).join('\n\n');
}

// Plain text: UTF-8 (BOM stripped) or UTF-16 with a BOM. Returns null when the bytes are binary.
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.includes('\u0000') ? null : text;
}

const ext = (name) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

// What kind of attachment a file is: 'image', 'pdf', 'docx', 'pptx', 'xlsx', 'legacy-office' or 'text'.
export function kindOf(name, mime = '') {
  const e = ext(name);
  if (mime.startsWith('image/') && e !== 'svg') return 'image';
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (e === 'docx' || e === 'docm') return 'docx';
  if (e === 'pptx' || e === 'pptm') return 'pptx';
  if (e === 'xlsx' || e === 'xlsm') return 'xlsx';
  if (['doc', 'xls', 'ppt'].includes(e)) return 'legacy-office';
  return 'text';
}

// Shares one character budget across the text attachments of a message so a large file cannot
// overflow the model's context. Each file gets an equal share; unused share goes to the others.
// Returns [{ name, text, truncated, total }].
export function fitToBudget(files, budget) {
  let left = budget;
  let remaining = files.length;
  const order = files.map((f, i) => i).sort((a, b) => files[a].content.length - files[b].content.length);
  const out = new Array(files.length);
  for (const i of order) {
    const share = Math.floor(left / remaining);
    const f = files[i];
    const text = f.content.length > share ? f.content.slice(0, share) : f.content;
    out[i] = { name: f.name, text, truncated: text.length < f.content.length, total: f.content.length };
    left -= text.length;
    remaining -= 1;
  }
  return out;
}
