// Files queued for the next message. Documents are turned into text and put in the prompt
// (plain text and code, PDF, Word, PowerPoint, Excel); images go as image_url parts (visual
// model only). Extraction lives in file-extract.js; pdf.js is loaded on first use.
import { kindOf, decodeText, extractDocx, extractPptx, extractXlsx, fitToBudget } from './file-extract.js';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Characters of attached text per message, shared between the files. About 12K tokens, which
// leaves room for the conversation in a 32K context. Longer files are cut and say so.
export const TEXT_BUDGET = 48000;

const items = []; // { name, kind: 'text' | 'image', content }
const listeners = new Set();
const notify = () => listeners.forEach((cb) => cb([...items]));

export function onAttachmentsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let pdfjsReady = null;
async function extractPdf(buffer) {
  pdfjsReady ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  const pdfjs = await pdfjsReady;
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items: runs } = await (await doc.getPage(n)).getTextContent();
    const text = runs.map((r) => r.str + (r.hasEOL ? '\n' : '')).join('').trim();
    pages.push(`--- Page ${n} ---\n${text}`);
  }
  await task.destroy();
  if (!pages.some((p) => p.split('\n').slice(1).join('').trim())) throw new Error('no selectable text (a scanned PDF needs OCR)');
  return pages.join('\n\n');
}

function toDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

const EXTRACTORS = { pdf: extractPdf, docx: extractDocx, pptx: extractPptx, xlsx: extractXlsx };

// Returns an error string, or null on success.
export async function addFile(file) {
  const kind = kindOf(file.name, file.type);
  try {
    if (kind === 'image') {
      if (file.size > MAX_IMAGE_BYTES) return `${file.name}: image over 10 MB`;
      items.push({ name: file.name, kind: 'image', content: toDataUrl(await file.arrayBuffer(), file.type) });
    } else {
      if (kind === 'legacy-office') return `${file.name}: old Office format, save it as .docx, .xlsx or .pptx`;
      if (file.size > MAX_FILE_BYTES) return `${file.name}: over 30 MB`;
      const buffer = await file.arrayBuffer();
      const text = kind === 'text' ? decodeText(buffer) : await EXTRACTORS[kind](buffer);
      if (text === null) return `${file.name}: this file type cannot be read as text`;
      if (!text.trim()) return `${file.name}: the file is empty`;
      items.push({ name: file.name, kind: 'text', content: text });
    }
  } catch (e) {
    return `${file.name}: ${e.message || 'could not be read'}`;
  }
  notify();
  return null;
}

export function removeAttachment(index) {
  items.splice(index, 1);
  notify();
}

export const hasImages = () => items.some((i) => i.kind === 'image');
export const hasAttachments = () => items.length > 0;
export const attachmentNames = () => items.map((i) => i.name);

// Builds the message content for the pending text and clears the queue.
export function takeAsContent(text) {
  const textFiles = fitToBudget(items.filter((i) => i.kind === 'text'), TEXT_BUDGET);
  const images = items.filter((i) => i.kind === 'image');
  const blocks = textFiles.map((f) => {
    const note = f.truncated ? ` truncated="first ${f.text.length} of ${f.total} characters"` : '';
    return `<attached-file name="${f.name.replace(/"/g, "'")}"${note}>\n${f.text}\n</attached-file>`;
  });
  const body = [text, ...blocks].join('\n\n');
  const names = items.map((i) => i.name);
  items.length = 0;
  notify();
  const content = images.length
    ? [{ type: 'text', text: body }, ...images.map((i) => ({ type: 'image_url', image_url: { url: i.content } }))]
    : body;
  return { content, names };
}
