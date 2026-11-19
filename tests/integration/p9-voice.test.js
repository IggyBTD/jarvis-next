import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createVoice, splitSentences, forSpeech } from '../../server/voice/session.js';
import { createVad, createTurn, createStt, createTts, matchTarget, matchYesNo } from '../../server/voice/engines.js';
import { frame, parse, MIC, TTS, wav, rms } from '../../shared/voice-frames.js';
import { createTargetState } from '../../server/core/target-state.js';
import { loadConfig } from '../../server/core/config.js';
import { tmpDir, rmDir, waitFor } from '../helpers.js';

const cfg = { ...loadConfig({ only: ['voice.json'] }).voice, enabled: true };
const loud = (ms = 300) => { const b = Buffer.alloc(16 * ms * 2); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * 12000), i * 2); return b; };
const quiet = (ms = 300) => Buffer.alloc(16 * ms * 2);

test('frames, wav header and energy', () => {
  const f = frame(MIC, Buffer.from([1, 2, 3]));
  assert.deepEqual([f[0], [...parse(f).pcm]], [MIC, [1, 2, 3]]);
  const w = wav(quiet(100));
  assert.equal(w.subarray(0, 4).toString(), 'RIFF');
  assert.equal(w.readUInt32LE(24), 16000);
  assert.ok(rms(loud()) > 0.1 && rms(quiet()) === 0);
  assert.equal(createVad({ energyThreshold: 0.02 }).isSpeech(loud(30)), true);
});

test('turn detection: ends after speech then silence, never on silence alone, always at the maximum', () => {
  const t = createTurn({ silenceMs: 90, minSpeechMs: 60, maxUtteranceMs: 600, frameMs: 30 });
  for (let i = 0; i < 10; i++) assert.equal(t.push(false), 'continue');
  t.reset();
  assert.deepEqual([t.push(true), t.push(true), t.push(false), t.push(false), t.push(false)], ['continue', 'continue', 'continue', 'continue', 'end']);
  t.reset();
  let last; for (let i = 0; i < 20; i++) last = t.push(true);
  assert.equal(last, 'end');
});

test('target-switch matcher: clear sentences in three languages match, everything else does not', () => {
  for (const [s, t] of [['switch to the mac', 'mac'], ['Switch to my PC.', 'pc'], ['go to the pc please', 'pc'], ['cambia al mac', 'mac'], ['pasa al ordenador', 'pc'], ['cambia a mac por favor', 'mac'], ['passe sur le mac', 'mac'], ['bascule sur le pc', 'pc'], ['change to the macbook', 'mac']]) assert.equal(matchTarget(s), t, s);
  for (const s of ['what is a mac address', 'open the mac app store', 'switch off the pc', 'should I switch to a mac someday', 'tell me about windows', 'the mac is slow, switch to it later', '']) assert.equal(matchTarget(s), null, s);
  assert.deepEqual(['yes', 'Sí', 'oui', 'okay do it', 'no', 'non', 'cancel', 'maybe'].map(matchYesNo), [true, true, true, true, false, false, false, null]);
  assert.equal(matchYesNo('yes and no'), null);
});

test('speech helpers: sentences and markdown removal', () => {
  assert.deepEqual(splitSentences('It is 30 percent. Anything else? Sure!'), ['It is 30 percent.', 'Anything else?', 'Sure!']);
  assert.equal(forSpeech('**Bold** `code` [link](http://x) ```js\nx\n```'), 'Bold code link  (code omitted) ');
});

test('stt and tts clients speak the OpenAI-compatible endpoints', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
      const body = Buffer.concat(c);
      seen.push({ url: req.url, type: req.headers['content-type'], body });
      if (req.url === '/stt') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ text: ' hola mundo ', language: 'spanish' })); }
      res.writeHead(200); res.end(Buffer.from([1, 2, 3, 4]));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const r = await createStt({ url: `${base}/stt`, model: 'w' })(loud(100));
    assert.deepEqual(r, { text: 'hola mundo', language: 'sp' }); // two letters: the engine's own code is used when it gives one
    assert.match(seen[0].type, /multipart\/form-data/);
    assert.ok(seen[0].body.includes('RIFF'));
    const pcm = await createTts({ url: `${base}/tts`, model: 'k', voices: { en: 'a', es: 'b' } })('hello', 'es');
    assert.deepEqual([...pcm], [1, 2, 3, 4]);
    assert.equal(JSON.parse(seen[1].body).voice, 'b');
  } finally { srv.close(); }
});

function rig({ ttsFail = false, language = 'en', text = 'hello there', ttsMs = 0 } = {}) {
  const dir = tmpDir('voice');
  const targetState = createTargetState({ dataDir: dir, machines: ['pc', 'mac'], bus: null });
  const sent = []; const bin = []; const turns = [];
  let said = text; let lang = language;
  const orchestrator = { runTurn: async (a) => { turns.push(a); return { ok: true, text: 'The volume is thirty percent. Anything else?' }; }, abort: () => {} };
  const voice = createVoice({
    voiceCfg: cfg, vad: createVad(cfg.vad), targetState, orchestrator, labelOf: (id) => ({ pc: 'PC', mac: 'Mac' }[id]),
    stt: async () => ({ text: said, language: lang }), tts: async (t) => { if (ttsFail) throw new Error('down'); if (ttsMs) await new Promise((ok) => setTimeout(ok, ttsMs)); return Buffer.alloc(20000, 1); },
    send: (c, o) => sent.push(o), sendBinary: (c, b) => bin.push(b),
  });
  const c = { id: 'c1' };
  const say = async (t, l = 'en', mode = 'push_to_talk') => { said = t; lang = l; voice.start(c, { mode }); voice.onBinary(c, frame(MIC, loud(400))); voice.stop(c); await waitFor(() => voice.state(c) === 'idle' && sent.some((m) => m.type === 'voice.transcript' && m.text === t)); };
  return { voice, c, sent, bin, turns, targetState, say, close: () => rmDir(dir) };
}

test('push to talk: audio in, transcript out, the turn runs in voice mode and the reply comes back as speech frames', async () => {
  const r = rig();
  try {
    await r.say('what is the volume');
    assert.deepEqual(r.turns.map((t) => [t.text, t.source, t.voiceMode]), [['what is the volume', 'voice', true]]);
    assert.ok(r.bin.length > 0 && r.bin.every((b) => b[0] === TTS));
    assert.deepEqual(r.sent.filter((m) => m.type === 'voice.speech').map((m) => m.text), ['The volume is thirty percent.', 'Anything else?']);
    assert.ok(r.sent.filter((m) => m.type === 'voice.state').map((m) => m.state).includes('thinking'));
  } finally { r.close(); }
});

test('a stray tap is ignored; silence in push to talk is not sent anywhere', async () => {
  const r = rig();
  try {
    r.voice.start(r.c, {}); r.voice.onBinary(r.c, frame(MIC, quiet(20))); r.voice.stop(r.c);
    await waitFor(() => r.voice.state(r.c) === 'idle');
    assert.equal(r.turns.length, 0);
    assert.ok(!r.sent.some((m) => m.type === 'voice.transcript'));
  } finally { r.close(); }
});

test('barge-in: speaking over the reply stops it and goes back to listening', async () => {
  const r = rig({ ttsMs: 100 });
  try {
    r.voice.start(r.c, {});
    r.voice.onBinary(r.c, frame(MIC, loud(400)));
    r.voice.stop(r.c);
    await waitFor(() => r.voice.state(r.c) === 'speaking');
    r.voice.onBinary(r.c, frame(MIC, loud(60)));
    assert.equal(r.voice.state(r.c), 'listening');
    const before = r.bin.length;
    await new Promise((ok) => setTimeout(ok, 60));
    assert.ok(r.bin.length - before <= 3); // nothing more than what was already in flight
  } finally { r.close(); }
});

test('spoken target switch: asks for confirmation out loud; only yes changes the target; no one else can', async () => {
  const r = rig();
  try {
    await r.say('switch to the mac');
    assert.equal(r.targetState.get(), 'pc');
    assert.ok(r.sent.some((m) => m.type === 'voice.speech' && /Switch to the Mac\?/.test(m.text)));
    assert.equal(r.turns.length, 0); // the model never saw it
    await r.say('no');
    assert.equal(r.targetState.get(), 'pc');
    await r.say('cambia al mac', 'es');
    assert.ok(r.sent.some((m) => m.type === 'voice.speech' && /Cambio al Mac\?/.test(m.text)));
    await r.say('yes');
    await waitFor(() => r.targetState.get() === 'mac');
    assert.ok(r.sent.some((m) => m.type === 'voice.speech' && /Switched to the Mac/.test(m.text)));
    assert.equal(r.turns.length, 0);
    await r.say('switch to the mac');
    assert.ok(r.sent.some((m) => /Already on the Mac/.test(m.text ?? '')));
  } finally { r.close(); }
});

test('open mode ends the turn on silence; wake word and disabled voice say so; tts failure is reported', async () => {
  const r = rig();
  try {
    r.voice.start(r.c, { mode: 'open' });
    for (let i = 0; i < 10; i++) r.voice.onBinary(r.c, frame(MIC, loud(30)));
    for (let i = 0; i < 40; i++) r.voice.onBinary(r.c, frame(MIC, quiet(30)));
    await waitFor(() => r.turns.length === 1);
    r.voice.start(r.c, { mode: 'wake_word' });
    assert.ok(r.sent.some((m) => m.type === 'voice.error' && /wake word is not available/.test(m.reason)));
  } finally { r.close(); }
  const t = rig({ ttsFail: true });
  try {
    await t.say('hello there');
    assert.ok(t.sent.some((m) => m.type === 'voice.error' && /text-to-speech/.test(m.reason)));
  } finally { t.close(); }
  const off = createVoice({ voiceCfg: { ...cfg, enabled: false }, vad: createVad(), targetState: null, orchestrator: null, labelOf: String, stt: null, tts: null, send: (c, o) => { off.got = o; }, sendBinary() {} });
  off.start({ id: 'x' }, {});
  assert.match(off.got.reason, /switched off/);
});

test('a client that disconnects mid-utterance is forgotten: nothing it said is transcribed or run', async () => {
  const r = rig();
  try {
    r.voice.start(r.c, {});
    r.voice.onBinary(r.c, frame(MIC, loud(400)));
    r.voice.forget(r.c);
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(r.turns.length, 0);
    assert.ok(!r.sent.some((m) => m.type === 'voice.transcript'));
  } finally { r.close(); }
});
