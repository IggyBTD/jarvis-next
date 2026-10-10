// Attachment text extraction (file-extract.js). Run: node --test tools/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzip, extractDocx, extractPptx, extractXlsx, decodeText, kindOf, fitToBudget } from '../../src/core/file-extract.js';

const fx = (name) => { const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('docx: paragraphs, entities, tabs, table cells, no field codes', async () => {
  const text = await extractDocx(fx('sample.docx'));
  assert.match(text, /^Quarterly report\nRevenue was 4\.2 million & rising\n/);
  assert.match(text, /Code:\tFALCON-9082/);
  assert.match(text, /\nNorth\t12$/);
  assert.ok(!text.includes('MERGEFORMAT'));
  assert.ok(!text.includes('<'));
});

test('docx stored without compression', async () => {
  assert.equal(await extractDocx(fx('stored.docx')), 'stored entry');
});

test('pptx: slides in numeric order', async () => {
  const text = await extractPptx(fx('sample.pptx'));
  assert.equal(text, '--- Slide 1 ---\nTitle <one>\n\n--- Slide 2 ---\nSecond slide\nBudget 700\n\n--- Slide 3 ---\nTenth slide');
});

test('xlsx: shared strings, numbers, inline strings, sheet name', async () => {
  const text = await extractXlsx(fx('sample.xlsx'));
  assert.equal(text, '--- Sheet: Prices & FX ---\nTicker\tPrice\nAAPL\t231.4\tnote\t');
});

test('unzip rejects non-zip data; wrong office type fails cleanly', async () => {
  await assert.rejects(unzip(fx('binary.bin')), /not a zip/);
  await assert.rejects(extractPptx(fx('sample.docx')), /no slides/);
});

test('decodeText: utf-8, utf-16 BOM, binary is null', () => {
  assert.equal(decodeText(new TextEncoder().encode('héllo').buffer), 'héllo');
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]).buffer), 'hi');
  assert.equal(decodeText(fx('binary.bin')), null);
});

test('kindOf', () => {
  assert.equal(kindOf('a.PDF'), 'pdf');
  assert.equal(kindOf('photo.png', 'image/png'), 'image');
  assert.equal(kindOf('logo.svg', 'image/svg+xml'), 'text');
  assert.equal(kindOf('x.docx'), 'docx');
  assert.equal(kindOf('x.xls'), 'legacy-office');
  assert.equal(kindOf('main.rs'), 'text');
});

test('fitToBudget: small files whole, big file cut, total within budget', () => {
  const out = fitToBudget([{ name: 'big', content: 'x'.repeat(1000) }, { name: 'small', content: 'y'.repeat(50) }], 300);
  assert.equal(out[1].text.length, 50);
  assert.equal(out[1].truncated, false);
  assert.equal(out[0].text.length, 250);
  assert.deepEqual([out[0].truncated, out[0].total], [true, 1000]);
  assert.deepEqual(fitToBudget([], 100), []);
});
