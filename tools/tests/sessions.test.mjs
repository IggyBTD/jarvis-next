// Saved-chat helpers (sessions.js). sessions.js now imports the JARVIS server link, which touches the page when it loads, so this
// file gives it a bare stand-in for the browser globals before importing it.
import test from 'node:test';
import assert from 'node:assert/strict';

const el = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, append() {}, replaceChildren() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, hidden: true });
globalThis.document ??= { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, createElement: el, body: el(), documentElement: el() };
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.addEventListener ??= () => {};
globalThis.location ??= { href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost', origin: 'http://localhost', search: '', hash: '' };
globalThis.CustomEvent ??= class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const { slimHistory, sessionTitle, toMarkdown } = await import('../../src/core/sessions.js');

test('history is saved without images; titles and markdown read well', () => {
  const h = [
    { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: 'A diagram.' },
  ];
  const slim = slimHistory(h);
  assert.equal(JSON.stringify(slim).includes('base64'), false);
  assert.equal(slim[0].content[1].text, '[image]');
  assert.equal(sessionTitle(h), 'what is this?');
  assert.equal(sessionTitle([]), 'Untitled');
  const md = toMarkdown('T', h);
  assert.match(md, /\*\*You:\*\* what is this\?/);
  assert.match(md, /\*\*JARVIS:\*\* A diagram\./);
});
