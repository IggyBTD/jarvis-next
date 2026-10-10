// Reply text to speech (speech-text.js). Run: node --test tools/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { toSpeech, takeSentences, createSentenceStream } from '../../src/core/speech-text.js';

// All sentences a stream yields when the reply arrives in pieces of `size` characters.
function streamed(reply, size) {
  const s = createSentenceStream();
  const out = [];
  for (let at = size; at < reply.length + size; at += size) {
    const last = at >= reply.length;
    out.push(...s.push(reply.slice(0, at), { final: false }));
    if (last) out.push(...s.push(reply, { final: true }));
  }
  return out;
}

test('markdown is read as plain words', () => {
  const t = toSpeech('## Plan\n\nUse **bold** and `npm run dev`, see [the docs](https://example.com/x).\n\n- first item\n- second item\n1. numbered');
  assert.equal(t, 'Plan.\nUse bold and npm run dev, see the docs.\nfirst item.\nsecond item.\nnumbered.');
});

test('code blocks, tables, formulas, urls and html are not spoken', () => {
  const t = toSpeech('Here is code:\n```js\nconst a = 1;\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n$$x^2$$ and $y$ at https://example.com/very/long/path done.');
  assert.equal(t, 'Here is code:\nand at done.');
});

test('artifacts and board tags are removed, an open one is held back or dropped', () => {
  const done = 'Built it. <jarvis-artifact id="a" type="html" title="T">\n<p>hi. there.</p>\n</jarvis-artifact> Anything else?\n<jarvis-board layout="split" panels="a" />';
  assert.equal(toSpeech(done, { final: true }), 'Built it. Anything else?');
  assert.equal(toSpeech('Building now. <jarvis-artifact id="a" type="html">\n<p>half', { final: false }), 'Building now.');
  assert.equal(toSpeech('Building now. <jarv', { final: false }), 'Building now.');
  assert.equal(toSpeech('Look at this ```py\nx = 1', { final: true }), 'Look at this.');
});

test('sentences do not split on decimals, abbreviations, initials or file names', () => {
  const { sentences } = takeSentences('It is 3.5 times faster, e.g. on Dr. Smith\'s machine. Open file.js now. J. Smith agrees. Done.', { final: true });
  assert.deepEqual(sentences, ["It is 3.5 times faster, e.g. on Dr. Smith's machine.", 'Open file.js now.', 'J. Smith agrees.', 'Done.']);
});

test('while streaming, a terminator at the very end is not trusted', () => {
  assert.deepEqual(takeSentences('The value is 3.', { final: false }).sentences, []);
  assert.deepEqual(takeSentences('The value is 3.5 now. Next', { final: false }).sentences, ['The value is 3.5 now.']);
  assert.deepEqual(takeSentences('The value is 3.', { final: true }).sentences, ['The value is 3.']);
});

test('a very long sentence is cut at a comma so speech can start', () => {
  const long = `${'word '.repeat(60).trim()}, and then the rest of it goes on and on without any end`;
  const { sentences, rest } = takeSentences(long, { final: false, maxLength: 100 });
  assert.equal(sentences.length, 1);
  assert.ok(sentences[0].endsWith(','));
  assert.ok(rest.trim().startsWith('and then'));
});

test('streaming in any chunking yields the same sentences as the whole reply at once', () => {
  const reply = 'Sure. The answer is 3.5, not 4.\n\n## Steps\n- Install it.\n- Run it.\n```sh\nnpm i\n```\n<jarvis-artifact id="x" type="code" lang="js" title="t">\nlet a = 1. 2. 3.\n</jarvis-artifact>\nThat is **all**. Anything else?';
  const whole = streamed(reply, reply.length);
  assert.deepEqual(whole, ['Sure.', 'The answer is 3.5, not 4.', 'Steps.', 'Install it.', 'Run it.', 'That is all.', 'Anything else?']);
  for (const size of [1, 2, 3, 5, 7, 11, 16, 40]) assert.deepEqual(streamed(reply, size), whole, `chunk size ${size}`);
});

test('an empty or markup-only reply speaks nothing', () => {
  assert.deepEqual(streamed('', 4), []);
  assert.deepEqual(streamed('<jarvis-artifact id="a" type="html">\n<p>x</p>\n</jarvis-artifact>', 6), []);
});
