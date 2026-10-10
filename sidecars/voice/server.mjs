// JARVIS voice sidecar: speech recognition and speech synthesis on localhost, through sherpa-onnx.
//
//   ASR  Nemotron 3.5 ASR Streaming 0.6B (multilingual transducer), streaming, CPU
//   TTS  Kokoro 82M v1.0, CPU
//
// Protocol (127.0.0.1 only; browsers must come from an allowed origin, see util.mjs):
//   GET  /health   { ok, asr: { state, ... }, tts: { state, ... } }
//   GET  /voices   { voices: [names], default }
//   WS   /asr      client -> binary: 16 kHz mono int16 little-endian PCM, any chunk size
//                  client -> text:   {"type":"language","language":"auto"|"en"|"de"|...}
//                                    {"type":"flush"}  finish the utterance now
//                  server -> text:   {"type":"ready"} {"type":"partial","text"} {"type":"final","text"}
//                                    {"type":"ignored","text","language"}  speech in a language that is not
//                                    allowed (config asr.languages); nothing else is sent for it
//                                    {"type":"error","message"}
//   WS   /tts      client -> text:   {"type":"speak","id":n,"text":"...","voice":"bm_george","speed":1}
//                                    {"type":"cancel"}  stop the current and every queued request
//                  server -> text:   {"type":"start","id":n,"sampleRate":24000} {"type":"end","id":n,"cancelled"?}
//                                    {"type":"error","id":n,"message"}
//                  server -> binary: uint32 id + float32 samples (util.packChunk), in order, per request
//
// Run: node server.mjs [--parent-stdin]   (--parent-stdin: exit when stdin closes, used by the app
// so the sidecar never outlives it).
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { VOICES, voiceId } from './voices.mjs';
import { originAllowed, pcm16ToFloat32, packChunk, resolveAsr, resolveTts, ttsVariant, pauseFor } from './util.mjs';
import { languageVerdict, stripForeignScript } from './language.mjs';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'voice.json'), 'utf8'));
const PORT = Number(process.env.JARVIS_VOICE_PORT) || config.port;
const modelsDir = process.env.JARVIS_VOICE_MODELS
  ? path.resolve(process.env.JARVIS_VOICE_MODELS)
  : path.resolve(root, config.modelsDir);

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// --- models --------------------------------------------------------------
const health = {
  asr: { state: 'loading', model: config.asr.model },
  tts: { state: 'loading', model: config.tts.model },
};
let recognizer = null;
let tts = null;                 // the engine of the default voice (health, sample rate)
const engines = new Map();      // 'us' | 'gb' -> Promise<OfflineTts>, loaded on first use

function describeMissing(r, what) {
  const names = r.missing.map((f) => path.relative(modelsDir, f)).join(', ');
  return `${what} model files not found in ${r.dir}: ${names}`;
}

function loadAsr() {
  const r = resolveAsr(modelsDir, config.asr);
  if (!r.ok) { health.asr = { ...health.asr, state: 'missing', message: describeMissing(r, 'ASR') }; return; }
  const t0 = Date.now();
  try {
    recognizer = new sherpa.OnlineRecognizer(r.config);
    health.asr = { ...health.asr, state: 'ready', sampleRate: 16000, loadMs: Date.now() - t0 };
    log(`asr ready in ${Date.now() - t0} ms`);
  } catch (e) {
    health.asr = { ...health.asr, state: 'error', message: String(e?.message ?? e) };
    log('asr failed:', e);
  }
}

// Kokoro reads English through a lexicon fixed when the engine is created, so British voices get
// their own engine (the British lexicon) next to the American one. The second loads the first
// time a voice of that kind is used (about a second and some hundred MB of memory).
function engine(variant) {
  if (!engines.has(variant)) {
    const r = resolveTts(modelsDir, config.tts, variant);
    if (!r.ok) return Promise.reject(new Error(describeMissing(r, 'TTS')));
    const t0 = Date.now();
    engines.set(variant, sherpa.OfflineTts.createAsync(r.config).then((e) => { log(`tts engine ${variant} loaded in ${Date.now() - t0} ms`); return e; }));
    engines.get(variant).catch(() => engines.delete(variant));
  }
  return engines.get(variant);
}

async function loadTts() {
  const r = resolveTts(modelsDir, config.tts, ttsVariant(config.tts.voice));
  if (!r.ok) { health.tts = { ...health.tts, state: 'missing', message: describeMissing(r, 'TTS') }; return; }
  const t0 = Date.now();
  try {
    tts = await engine(ttsVariant(config.tts.voice));
    health.tts = { ...health.tts, state: 'ready', sampleRate: tts.sampleRate, speakers: tts.numSpeakers, loadMs: Date.now() - t0 };
    log(`tts ready in ${Date.now() - t0} ms (${tts.sampleRate} Hz, ${tts.numSpeakers} speakers)`);
  } catch (e) {
    health.tts = { ...health.tts, state: 'error', message: String(e?.message ?? e) };
    log('tts failed:', e);
  }
}

// --- http ----------------------------------------------------------------
const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) { res.writeHead(403).end(); return; }
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET' }).end(); return; }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, headers).end(JSON.stringify({ ok: true, ...health }));
  } else if (req.method === 'GET' && url.pathname === '/voices') {
    res.writeHead(200, headers).end(JSON.stringify({ voices: VOICES, default: config.tts.voice }));
  } else {
    res.writeHead(404, headers).end(JSON.stringify({ error: 'not found' }));
  }
});

const wsAsr = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
const wsTts = new WebSocketServer({ noServer: true, maxPayload: 1 << 16 });

server.on('upgrade', (req, socket, head) => {
  if (!originAllowed(req.headers.origin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  const { pathname } = new URL(req.url, 'http://localhost');
  const target = pathname === '/asr' ? wsAsr : pathname === '/tts' ? wsTts : null;
  if (!target) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

const sendJson = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

// --- speech recognition --------------------------------------------------
wsAsr.on('connection', (ws) => {
  if (!recognizer) {
    sendJson(ws, { type: 'error', message: health.asr.message ?? `speech recognition is ${health.asr.state}` });
    ws.close();
    return;
  }
  const stream = recognizer.createStream();
  let language = 'auto';
  let last = '';
  // Diagnostics: what actually arrives from the microphone, logged every 3 s while audio flows.
  const stats = { frames: 0, samples: 0, peak: 0, decodeMs: 0, decodes: 0 };
  log('asr connected');
  const report = () => {
    if (!stats.frames) return;
    log(`asr audio: ${stats.frames} frames, ${(stats.samples / 16000).toFixed(1)} s, peak ${stats.peak.toFixed(3)}, decode ${stats.decodes} x avg ${stats.decodes ? Math.round(stats.decodeMs / stats.decodes) : 0} ms, text "${last}"`);
    stats.frames = 0; stats.samples = 0; stats.peak = 0; stats.decodeMs = 0; stats.decodes = 0;
  };
  const reportTimer = setInterval(report, 3000);
  ws.on('close', () => { clearInterval(reportTimer); log('asr closed'); });

  // The model puts two spaces after some punctuation; collapse them.
  const BLANK_SECONDS = 0.08; // one trailing blank frame is 80 ms of silence
  const MAX_UTTERANCE_S = 30;
  // config asr.autoEnd: true lets the recognizer decide when a sentence is finished (the old
  // behaviour). Off, the client decides with its keys and a flush ends the utterance.
  const autoEnd = process.env.JARVIS_VOICE_AUTOEND === '1' || config.asr.autoEnd === true; // env: tests only
  let utteranceSamples = 0;
  // Silence measured from the audio itself, which is ready at once; the model only reports
  // trailing blanks after its look-ahead (about half a second late). A chunk counts as speech when
  // it is clearly louder than the quiet of the room (the 20th percentile of the last 5 s).
  let totalSamples = 0;
  let lastVoice = 0;
  const loudness = [];
  const trackVoice = (samples) => {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    loudness.push(rms);
    if (loudness.length > 50) loudness.shift();
    const floor = [...loudness].sort((a, b) => a - b)[Math.floor(loudness.length * 0.2)];
    totalSamples += samples.length;
    if (rms > Math.max(0.006, floor * 2.5)) lastVoice = totalSamples;
  };
  // Letters of other alphabets (what mumbling turns into) never get past here; see language.mjs.
  const text = () => stripForeignScript(recognizer.getResult(stream).text);
  const decodeAll = () => {
    let decoded = false;
    while (recognizer.isReady(stream)) {
      const t = performance.now();
      recognizer.decode(stream);
      stats.decodeMs += performance.now() - t;
      stats.decodes += 1;
      decoded = true;
    }
    return decoded;
  };
  // Languages that may reach the chat (config asr.languages; the model itself cannot be restricted).
  const allowedLanguages = config.asr.languages;
  const publish = () => {
    const t = text();
    if (t === last) return false;
    last = t;
    // Words of a language that is not allowed are never shown, even while they are still coming in.
    if (languageVerdict(t, allowedLanguages, { partial: true }).allowed) sendJson(ws, { type: 'partial', text: t });
    return true;
  };
  const endUtterance = (why = 'flush') => {
    if (last) {
      const verdict = languageVerdict(last, allowedLanguages);
      if (verdict.allowed) {
        log(`asr final (${why}): "${last}"`);
        sendJson(ws, { type: 'final', text: last });
      } else {
        log(`asr ignored (${verdict.language}, ${verdict.why}): "${last}"`);
        sendJson(ws, { type: 'ignored', text: last, language: verdict.language });
      }
    }
    recognizer.reset(stream);
    last = '';
    utteranceSamples = 0;
  };
  // Is the speaker done? Silence is measured in the model's trailing blank frames, and how much of
  // it is enough depends on whether the words so far sound finished (pauseFor, util.mjs).
  // The audio must be quiet for `need` seconds and the model must agree that it has seen at least a
  // quarter second of blanks (so quiet speech is never mistaken for silence); or the model alone
  // reports the full time. Never while the words are still changing.
  const checkEnd = (changedNow) => {
    const blanks = recognizer.getResult(stream).num_trailing_blanks * BLANK_SECONDS;
    if (!last) {
      if (blanks > 10) { recognizer.reset(stream); utteranceSamples = 0; } // nothing said: keep the stream small
      return;
    }
    if (changedNow || !autoEnd) return; // manual: only a flush (push-to-talk key) ends an utterance
    const quiet = (totalSamples - lastVoice) / 16000;
    const need = pauseFor(last, config.asr.pause);
    if (blanks >= need || (quiet >= need && blanks >= 0.25)) endUtterance(`${quiet.toFixed(2)} s quiet, ${blanks.toFixed(2)} s blank, needed ${need}`);
    else if (utteranceSamples > MAX_UTTERANCE_S * 16000) endUtterance('length limit');
  };

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        const samples = pcm16ToFloat32(data);
        stats.frames += 1;
        stats.samples += samples.length;
        for (let i = 0; i < samples.length; i++) stats.peak = Math.max(stats.peak, Math.abs(samples[i]));
        stream.acceptWaveform({ sampleRate: 16000, samples });
        utteranceSamples += samples.length;
        trackVoice(samples);
        const changed = decodeAll() ? publish() : false;
        checkEnd(changed);
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'language') {
        language = String(msg.language || 'auto');
        // Unset means automatic language detection; the model reads this option on every decode.
        if (language === 'auto') { if (stream.hasOption('language')) stream.setOption('language', ''); }
        else stream.setOption('language', language);
      } else if (msg.type === 'flush') {
        // Pad with silence so the last words leave the model's look-ahead, then close the utterance.
        stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(16000 * 0.6) });
        decodeAll();
        publish();
        const heard = !!last;
        endUtterance();
        // Always answer a flush, even with nothing heard, so the client can leave its sending state.
        if (!heard) sendJson(ws, { type: 'final', text: '' });
      }
    } catch (e) {
      sendJson(ws, { type: 'error', message: String(e?.message ?? e) });
    }
  });
  sendJson(ws, { type: 'ready' });
});

// --- speech synthesis ----------------------------------------------------
wsTts.on('connection', (ws) => {
  if (!tts) {
    sendJson(ws, { type: 'error', id: 0, message: health.tts.message ?? `speech synthesis is ${health.tts.state}` });
    ws.close();
    return;
  }
  let epoch = 0;         // bumped by cancel; jobs from an older epoch are dropped
  let chain = Promise.resolve();

  async function run(job) {
    if (job.epoch !== epoch || ws.readyState !== ws.OPEN) { sendJson(ws, { type: 'end', id: job.id, cancelled: true }); return; }
    let sent = 0;
    const t0 = Date.now();
    try {
      const kokoro = await engine(ttsVariant(job.voice));
      sendJson(ws, { type: 'start', id: job.id, sampleRate: kokoro.sampleRate });
      const audio = await kokoro.generateAsync({
        text: job.text,
        enableExternalBuffer: true,
        generationConfig: new sherpa.GenerationConfig({ sid: job.sid, speed: job.speed, silenceScale: 0.2 }),
        onProgress: ({ samples }) => {
          if (job.epoch !== epoch || ws.readyState !== ws.OPEN) return 0; // stop generating
          ws.send(packChunk(job.id, samples), { binary: true });
          sent += samples.length;
          return 1;
        },
      });
      // Some builds do not report progress: send the whole result then.
      if (!sent && job.epoch === epoch && ws.readyState === ws.OPEN) {
        ws.send(packChunk(job.id, audio.samples), { binary: true });
        sent = audio.samples.length;
      }
      log(`tts #${job.id} ${job.voice} ${job.text.length} chars -> ${(sent / kokoro.sampleRate).toFixed(2)} s audio in ${Date.now() - t0} ms`);
      sendJson(ws, { type: 'end', id: job.id, ...(job.epoch !== epoch ? { cancelled: true } : {}) });
    } catch (e) {
      sendJson(ws, { type: 'error', id: job.id, message: String(e?.message ?? e) });
    }
  }

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'cancel') { epoch += 1; return; }
    if (msg.type !== 'speak') return;
    const id = Number(msg.id) >>> 0;
    const text = String(msg.text ?? '').trim().slice(0, 2000);
    if (!text) { sendJson(ws, { type: 'end', id }); return; }
    const sid = voiceId(msg.voice ?? config.tts.voice);
    if (sid < 0) { sendJson(ws, { type: 'error', id, message: `unknown voice ${msg.voice}` }); return; }
    const speed = Math.min(2, Math.max(0.5, Number(msg.speed) || config.tts.speed));
    const job = { id, text, sid, speed, epoch, voice: msg.voice ?? config.tts.voice };
    chain = chain.then(() => run(job));
  });
});

// --- start ---------------------------------------------------------------
server.listen(PORT, '127.0.0.1', () => {
  log(`listening on 127.0.0.1:${PORT}, models in ${modelsDir}`);
  // Load after listening so /health answers "loading" while the models come up. The recognizer
  // constructor is synchronous (about a second or two), the synthesizer loads off the main thread.
  // Loading two models for a couple of seconds uses several cores and a lot of disk; run below
  // normal priority meanwhile so the app's window (and everything else) is never starved, then back.
  const setPriority = (p) => { try { os.setPriority(0, p); } catch { /* not permitted: keep going */ } };
  setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  setImmediate(async () => {
    loadAsr();
    await loadTts();
    setPriority(os.constants.priority.PRIORITY_NORMAL);
  });
});
server.on('error', (e) => { log('server error:', e.message); process.exit(1); });

if (process.argv.includes('--parent-stdin')) {
  process.stdin.resume();
  process.stdin.on('end', () => { log('parent closed stdin, exiting'); process.exit(0); });
  process.stdin.on('close', () => process.exit(0));
}
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
