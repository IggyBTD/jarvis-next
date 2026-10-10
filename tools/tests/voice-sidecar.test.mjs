// Voice sidecar: pure helpers always; the models (Nemotron ASR, Kokoro TTS) only when they are
// installed in models/voice. Run: node --test tools/tests/*.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { originAllowed, pcm16ToFloat32, packChunk, unpackChunk, resolveAsr, resolveTts, pauseFor } from '../../sidecars/voice/util.mjs';
import { VOICES, voiceId } from '../../sidecars/voice/voices.mjs';
import { languageVerdict, stripForeignScript } from '../../sidecars/voice/language.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'voice.json'), 'utf8'));
const modelsDir = path.resolve(root, config.modelsDir);

test('only this machine\'s pages (and non-browser clients) may connect', () => {
  for (const ok of [undefined, '', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']) {
    assert.equal(originAllowed(ok), true, String(ok));
  }
  for (const bad of ['http://evil.example', 'https://localhost.evil.example', 'http://localhost.evil.example:5173', 'null', 'file://', 'http://192.168.1.5:5173']) {
    assert.equal(originAllowed(bad), false, bad);
  }
});

test('int16 PCM converts to floats, even for odd lengths and shared buffers', () => {
  const pool = Buffer.alloc(64);
  const bytes = pool.subarray(3, 3 + 9); // odd offset, odd length
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  [0, 32767, -32768, 16384].forEach((v, i) => view.setInt16(i * 2, v, true));
  const f = pcm16ToFloat32(bytes);
  assert.equal(f.length, 4);
  assert.deepEqual([...f].map((x) => Math.round(x * 1000) / 1000), [0, 1, -1, 0.5]);
});

test('audio frames round trip with their request id', () => {
  const samples = new Float32Array([0, 0.25, -0.5, 1]);
  const { id, samples: back } = unpackChunk(packChunk(4000000000, samples));
  assert.equal(id, 4000000000);
  assert.deepEqual([...back], [...samples]);
});

test('missing model files are listed instead of crashing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-'));
  const a = resolveAsr(empty, config.asr);
  const t = resolveTts(empty, config.tts);
  assert.equal(a.ok, false);
  assert.equal(t.ok, false);
  assert.ok(a.missing.some((f) => f.endsWith('encoder.int8.onnx')));
  assert.ok(t.missing.some((f) => f.endsWith('voices.bin')));
  fs.rmSync(empty, { recursive: true });
});

test('the default voice exists and ids follow the table', () => {
  assert.ok(voiceId(config.tts.voice) >= 0);
  assert.equal(voiceId('bm_george'), 26);
  assert.equal(new Set(VOICES).size, VOICES.length);
});

// --- with the real models --------------------------------------------------
const installed = resolveAsr(modelsDir, config.asr).ok && resolveTts(modelsDir, config.tts).ok;
const PORT = 18765;
let child = null;
let helpers = null;

before(async () => {
  if (!installed) return;
  process.env.JARVIS_VOICE_URL = `http://127.0.0.1:${PORT}`;
  helpers = await import('./voice-helpers.mjs');
  // The endpointing tests below test the automatic mode (config asr.autoEnd), so the child runs with it on.
  child = spawn(process.execPath, [path.join(root, 'sidecars', 'voice', 'server.mjs')], {
    cwd: root, env: { ...process.env, JARVIS_VOICE_PORT: String(PORT), JARVIS_VOICE_AUTOEND: '1' }, stdio: 'ignore',
  });
  const start = Date.now();
  for (;;) {
    try {
      const h = await helpers.health();
      if (h.asr.state !== 'loading' && h.tts.state !== 'loading') break;
    } catch { /* not listening yet */ }
    if (Date.now() - start > 60000) throw new Error('sidecar did not start');
    await new Promise((r) => setTimeout(r, 250));
  }
});
after(() => { child?.kill(); });


const skip = installed ? false : 'voice models are not installed in models/voice';

// Manual mode (the default, config asr.autoEnd false): the recognizer never ends an utterance by
// itself; only a flush does, and it always answers, even with nothing heard.
test('manual mode: no final until a flush, and an empty flush still answers', { skip }, async () => {
  const manualPort = 18766;
  const manual = spawn(process.execPath, [path.join(root, 'sidecars', 'voice', 'server.mjs')], {
    cwd: root, env: { ...process.env, JARVIS_VOICE_PORT: String(manualPort) }, stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 240; i++) {
      try { const h = await fetch(`http://127.0.0.1:${manualPort}/health`).then((r) => r.json()); if (h.asr.state !== 'loading') break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const tts = await helpers.synthesize('Please open the pod bay doors.', { voice: 'bm_george' });
    const speech = helpers.resample(tts.samples, tts.sampleRate, 16000);
    const ws = new WebSocket(`ws://127.0.0.1:${manualPort}/asr`, { headers: { Origin: `http://127.0.0.1:${manualPort}` } });
    const got = [];
    await new Promise((resolve, reject) => {
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); got.push(m); if (m.type === 'ready') resolve(); };
      ws.onerror = () => reject(new Error('could not connect'));
    });
    // the words, then three seconds of silence: automatic mode would have sent by now
    const audio = new Float32Array(speech.length + 16000 * 3);
    audio.set(speech);
    const step = 1600; // 100 ms
    for (let at = 0; at < audio.length; at += step) {
      const pcm = new Int16Array(step);
      for (let i = 0; i < step; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round((audio[at + i] ?? 0) * 32767)));
      ws.send(pcm.buffer);
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(got.filter((m) => m.type === 'final' || m.type === 'ignored').length, 0, JSON.stringify(got.slice(-3)));
    ws.send(JSON.stringify({ type: 'flush' }));
    await new Promise((r) => setTimeout(r, 2000));
    assert.ok(got.some((m) => m.type === 'final' && /open the/i.test(m.text)), `the flush gives the sentence: ${JSON.stringify(got.slice(-3))}`);
    ws.close();
    // an empty flush still answers, so the client can leave its sending state
    const ws2 = new WebSocket(`ws://127.0.0.1:${manualPort}/asr`, { headers: { Origin: `http://127.0.0.1:${manualPort}` } });
    const got2 = [];
    await new Promise((resolve) => { ws2.onmessage = (ev) => { const m = JSON.parse(ev.data); got2.push(m); if (m.type === 'ready') resolve(); }; });
    ws2.send(JSON.stringify({ type: 'flush' }));
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(got2.some((m) => m.type === 'final' && m.text === ''), 'an empty flush answers with an empty final');
    ws2.close();
  } finally {
    manual.kill();
  }
});

test('both models load', { skip }, async () => {
  const h = await helpers.health();
  assert.equal(h.asr.state, 'ready');
  assert.equal(h.tts.state, 'ready');
  assert.equal(h.tts.sampleRate, 24000);
});

test('a page from another origin is refused over http and websocket', { skip }, async () => {
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/health', headers: { Origin: 'http://evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
  const { WebSocket } = await import('../../sidecars/voice/node_modules/ws/wrapper.mjs');
  const outcome = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/asr`, { headers: { Origin: 'http://evil.example' } });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('open', () => resolve('open'));
    ws.on('error', () => resolve('error'));
  });
  assert.equal(outcome, 403);
});

test('what Kokoro says, Nemotron hears (and the pause ends the utterance)', { skip }, async () => {
  const tts = await helpers.synthesize('Please open the pod bay doors.', { voice: 'bm_george' });
  assert.ok(tts.samples.length / tts.sampleRate > 1.5);
  const lead = new Float32Array(16000 * 0.5); // a live microphone has a moment of room noise first
  const speech = helpers.resample(tts.samples, tts.sampleRate, 16000);
  const audio = new Float32Array(lead.length + speech.length);
  audio.set(speech, lead.length);
  const events = await helpers.transcribe(audio, { speedup: 4, trailingSilenceS: 2.5 });
  const finals = events.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1, JSON.stringify(events));
  assert.match(finals[0].text.toLowerCase(), /open the .*bay doors/); // "pod" is heard as "pard" now and then: a synthetic voice, not a bug
  assert.ok(events.some((e) => e.type === 'partial'), 'partial results arrive while speaking');
  assert.ok(!/\s{2,}/.test(finals[0].text), 'no double spaces');
});

test('cancel stops a long text part way', { skip }, async () => {
  const text = Array.from({ length: 8 }, (_, i) => `This is sentence number ${i + 1} of a long paragraph that keeps going.`).join(' ');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/tts`);
  ws.binaryType = 'arraybuffer';
  await new Promise((r) => (ws.onopen = r));
  let chunks = 0;
  const end = await new Promise((resolve) => {
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') { chunks += 1; if (chunks === 1) ws.send(JSON.stringify({ type: 'cancel' })); return; }
      const m = JSON.parse(ev.data);
      if (m.type === 'end') resolve(m);
    };
    ws.send(JSON.stringify({ type: 'speak', id: 7, text }));
  });
  ws.close();
  assert.equal(end.id, 7);
  assert.equal(end.cancelled, true);
  assert.ok(chunks < 8, `${chunks} of 8 sentences were produced after cancelling`);
});

test('an unknown voice is an error, not silence', { skip }, async () => {
  await assert.rejects(helpers.synthesize('Hello.', { voice: 'nobody' }), /unknown voice/);
});

// --- when is a message finished? ----------------------------------------------
test('pauseFor: short after a finished sentence, long after a hanging word', () => {
  const p = { complete: 0.5, likely: 0.6, unsure: 0.9, open: 1.8 };
  assert.equal(pauseFor('What is the capital of France?', p), 0.5);
  assert.equal(pauseFor('Please explain how it works.', p), 0.5);
  assert.equal(pauseFor('Yes.', p), 0.9, 'a lone "Yes." may be the start of more');
  assert.equal(pauseFor('I want to build a', p), 1.8);
  assert.equal(pauseFor('I was thinking that, um', p), 1.8);
  assert.equal(pauseFor('Well, so', p), 1.8);
  assert.equal(pauseFor('I want to build a website,', p), 1.8);
  assert.equal(pauseFor('and then...', p), 1.8);
  assert.equal(pauseFor('the weather was lovely yesterday', p), 0.9, 'ordinary ending without punctuation');
  assert.equal(pauseFor('tell me about the Roman Empire', p), 0.6, 'question or request shaped, no punctuation yet');
  assert.equal(pauseFor('what is', p), 1.8, 'a question that trails off on a hanging word');
  assert.equal(pauseFor('I want you to create an artifact that will simulate', p), 1.8, 'a verb that still needs its object');
  assert.equal(pauseFor('make me a website that will visualize', p), 1.8, 'verbs that are not listed, by their ending');
  assert.equal(pauseFor('I need a bit of help with the climate', p), 0.9, 'a noun that merely looks like a verb');
  assert.equal(pauseFor('', p), 1.8);
});

// Speech, silence, speech, as one microphone signal at 16 kHz.
async function say(parts) {
  const chunks = [];
  for (const part of parts) {
    if (typeof part === 'number') { chunks.push(new Float32Array(Math.round(part * 16000))); continue; }
    const t = await helpers.synthesize(part, { voice: 'af_heart' });
    chunks.push(helpers.resample(t.samples, t.sampleRate, 16000));
  }
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

test('a pause in the middle of a thought does not send the message', { skip }, async () => {
  const audio = await say([0.6, 'I would like you to', 1.3, 'explain how a transformer works.']);
  const events = await helpers.transcribe(audio, { speedup: 4, trailingSilenceS: 3 });
  const finals = events.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1, JSON.stringify(finals));
  assert.match(finals[0].text.toLowerCase(), /like you to.*explain.*transformer/);
});

test('a finished question is sent within about a second of the last word', { skip }, async () => {
  const lead = 0.6;
  const speech = await say(['What is the capital of France?']);
  const audio = await say([lead]);
  const full = new Float32Array(audio.length + speech.length);
  full.set(speech, audio.length);
  const endOfSpeech = (lead * 1000) + (speech.length / 16) ; // ms into the stream
  const events = await helpers.transcribe(full, { speedup: 1, trailingSilenceS: 3 });
  const final = events.find((e) => e.type === 'final');
  assert.ok(final, JSON.stringify(events));
  assert.match(final.text.toLowerCase(), /capital of france/);
  const lag = final.at - endOfSpeech;
  assert.ok(lag < 1300, `final came ${Math.round(lag)} ms after the last word`);
});

test('"I want you to create an artifact that will simulate ..." is not cut off at the pause, with or without room noise', { skip }, async () => {
  for (const amp of [0, 0.02]) {
    const audio = await say([0.6, 'I want you to create an artifact that will simulate', 1.6, 'a solar system with all eight planets.']);
    for (let i = 0; i < audio.length; i++) audio[i] += (Math.random() * 2 - 1) * amp;
    const finals = (await helpers.transcribe(audio, { speedup: 4, trailingSilenceS: 4 })).filter((e) => e.type === 'final');
    assert.equal(finals.length, 1, `noise ${amp}: ${JSON.stringify(finals.map((e) => e.text))}`);
    assert.match(finals[0].text.toLowerCase(), /simulate.*solar system/);
  }
});

// --- the thinking note --------------------------------------------------------
import { pulseSamples, TONE } from '../../src/core/thinking-tone.js';

test('the thinking note is quiet, starts and ends at silence so it loops without a click', () => {
  const s = pulseSamples(48000);
  assert.equal(s.length, Math.round(48000 * TONE.period));
  assert.equal(s[0], 0);
  assert.ok(Math.abs(s[s.length - 1]) < 1e-3, 'ends practically silent');
  const peak = s.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  assert.ok(peak > 0.03 && peak <= TONE.peak, `peak ${peak}`);
});

test('the speech recognizer hears no words in the thinking note, even after a minute of it', { skip }, async () => {
  const period = pulseSamples(16000);
  const audio = new Float32Array(16000 + period.length * 35); // 1 s of room, then 35 repeats (about a minute)
  for (let i = 0; i < 35; i++) audio.set(period, 16000 + i * period.length);
  const events = await helpers.transcribe(audio, { speedup: 40, trailingSilenceS: 2 });
  const heard = events.filter((e) => e.type === 'partial' || e.type === 'final').map((e) => e.text);
  assert.deepEqual(heard, [], `the recognizer heard: ${JSON.stringify(heard)}`);
});

// --- only English, Spanish, French and Italian are listened for ----------------------------------
const ALLOWED = ['en', 'es', 'fr', 'it'];

test('language filter: English, Spanish, French and Italian pass, other languages are dropped', () => {
  const keep = ['Hello Jarvis what is two plus two', 'I want you to create an artifact that will simulate a solar system', 'Puedes mostrarme cómo funciona un transformador', 'Quiero que me hagas una página sobre los planetas', 'Peux-tu m’expliquer comment fonctionne ce modèle', 'Je voudrais que tu écrives un programme pour moi', 'Puoi spiegarmi come funziona questo modello', 'Vorrei che tu creassi una pagina sui pianeti', 'Please open the file and show me the first ten lines', 'Dammi un esempio di codice per favore', 'Hola', 'OK Jarvis'];
  const drop = ['Alles hat ein Ende, nur die Wurst hat zwei', 'Ich möchte dass du mir eine Seite über die Planeten machst', 'Eu quero que você faça uma página sobre os planetas', 'Ik wil dat je een pagina over de planeten maakt', 'Ти питощу твоя країна може зробити для тебе', 'لا تسأل ماذا يمكنن كبلتك', '今日は天気がいいですね', 'Bana gezegenler hakkında bir sayfa yapmak istiyorum', 'Tôi muốn bạn làm cho tôi một trang về các hành tinh', 'Jag vill att du gör en sida om planeterna'];
  for (const t of keep) assert.equal(languageVerdict(t, ALLOWED).allowed, true, `should keep: ${t}`);
  for (const t of drop) assert.equal(languageVerdict(t, ALLOWED).allowed, false, `should drop: ${t}`);
  assert.equal(languageVerdict('Alles hat ein Ende', []).allowed, true, 'no list means no filter');
});

test('letters of other alphabets are removed from the text, accents on Latin letters stay', () => {
  assert.equal(stripForeignScript('I want μ the page'), 'I want the page');
  assert.equal(stripForeignScript('αβγ δεζ'), '');
  assert.equal(stripForeignScript('Hola — привет amigo'), 'Hola — amigo');
  assert.equal(stripForeignScript('ありがとう thank you。'), 'thank you');
  assert.equal(stripForeignScript('ok θ'), 'ok');
  assert.equal(stripForeignScript('Привіт. , ?'), '', 'only punctuation left means nothing was said');
  assert.equal(stripForeignScript('Привет. Hello there'), 'Hello there');
  assert.equal(stripForeignScript('I said, привет, ok'), 'I said, ok');
  assert.equal(stripForeignScript('mumble � here'), 'mumble here');
  assert.equal(stripForeignScript('Ça va très bien, señor Núñez à Zürich'), 'Ça va très bien, señor Núñez à Zürich');
  assert.equal(stripForeignScript('Café au lait (2 euros)'), 'Café au lait (2 euros)');
  assert.equal(stripForeignScript('Tell me 3.5 things, ok?'), 'Tell me 3.5 things, ok?');
});

test('the config allows exactly English, Spanish, French and Italian', () => {
  assert.deepEqual(config.asr.languages, ALLOWED);
});

test('real speech: Spanish and French get through, German, Ukrainian and Arabic are dropped and reported', { skip }, async () => {
  const dir = path.join(modelsDir, config.asr.model, 'test_wavs');
  const lead = new Float32Array(8000);
  const feed = async (file) => {
    const speech = helpers.readWav16k(path.join(dir, file));
    const audio = new Float32Array(lead.length + speech.length);
    audio.set(speech, lead.length);
    return helpers.transcribe(audio, { speedup: 4, trailingSilenceS: 3 });
  };
  for (const file of ['es.wav', 'fr.wav']) {
    const ev = await feed(file);
    assert.equal(ev.filter((e) => e.type === 'final').length, 1, `${file}: ${JSON.stringify(ev.slice(-3))}`);
    assert.equal(ev.filter((e) => e.type === 'ignored').length, 0, file);
  }
  // Latin-script speech in another language (German): dropped and reported.
  {
    const ev = await feed('de.wav');
    assert.equal(ev.filter((e) => e.type === 'final').length, 0, `de.wav must not reach the chat: ${JSON.stringify(ev.filter((e) => e.type === 'final'))}`);
    assert.ok(ev.some((e) => e.type === 'ignored'), 'de.wav is reported as ignored');
  }
  // Speech in another alphabet (Ukrainian, Arabic): its letters are removed, so there is nothing
  // left to show, send or report. Not one non-Latin letter may appear in any event.
  for (const file of ['uk.wav', 'ar.wav']) {
    const ev = await feed(file);
    assert.equal(ev.filter((e) => e.type === 'final').length, 0, `${file}: ${JSON.stringify(ev.filter((e) => e.type === 'final'))}`);
    assert.equal(ev.filter((e) => e.type === 'ignored').length, 0, `${file} is silent, not reported`);
    const letters = ev.map((e) => e.text ?? '').join('').match(/\p{L}/gu) ?? [];
    assert.ok(letters.every((c) => /\p{Script=Latin}/u.test(c)), `${file} produced non-Latin letters`);
  }
  // Nothing recognised at all (Japanese comes out empty) also never becomes a message.
  assert.equal((await feed('ja.wav')).filter((e) => e.type === 'final').length, 0);
});

test('real speech: English made by Kokoro gets through', { skip }, async () => {
  // (Kokoro's Italian voices are too poor to use as Italian test speech: the recogniser hears
  // "Buffy vor PIC am fansa". Italian is covered by the sentence test above, not by real audio.)
  const t = await helpers.synthesize('Please tell me about the Roman Empire and its history.', { voice: 'af_heart' });
  const speech = helpers.resample(t.samples, t.sampleRate, 16000);
  const audio = new Float32Array(8000 + speech.length);
  audio.set(speech, 8000);
  const ev = await helpers.transcribe(audio, { speedup: 4, trailingSilenceS: 3 });
  const finals = ev.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1, JSON.stringify(ev.slice(-3)));
  assert.match(finals[0].text, /roman empire/i);
  assert.equal(ev.filter((e) => e.type === 'ignored').length, 0);
});
