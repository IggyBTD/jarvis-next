// The only module that talks to the voice sidecar (sidecars/voice, Node + sherpa-onnx):
// streaming speech recognition (Nemotron 3.5 ASR) and speech synthesis (Kokoro), on localhost.
// Protocol: see the header of sidecars/voice/server.mjs.
import config from '../../config/voice.json';
import workletSource from './pcm-worklet.js?raw';
import { invoke } from '@tauri-apps/api/core'; // a plain import: a lazy one is another late dev-server request
import { getSwitches } from './switches.js';

// A developer can point the page at another sidecar (tests run their own next to the app's):
// localStorage.setItem('jarvis.voice.port', '18770')
const PORT = (() => { try { return Number(localStorage.getItem('jarvis.voice.port')) || config.port; } catch { return config.port; } })();
// The capture worklet is built from its own source text when the page loads, never fetched from the
// dev server when the microphone is switched on: that late request failed ("failed to load worklet
// module script") whenever the dev server had stopped or was restarting, and it also does not
// depend on how a packaged build serves assets.
let workletBlobUrl = null;
const workletUrl = () => (workletBlobUrl ??= URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' })));

const HOST = `127.0.0.1:${PORT}`;
const HTTP = `http://${HOST}`;
const WS = `ws://${HOST}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inTauri = () => !!window.__TAURI_INTERNALS__;

// Same rule as the fetch guard: with the network link cut JARVIS talks to nothing, local or not.
function assertLinked() {
  if (!getSwitches().link) throw new Error('NETWORK LINK DISABLED');
}

export async function health() {
  assertLinked();
  const res = await fetch(`${HTTP}/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`voice sidecar answered ${res.status}`);
  return res.json();
}

// Starts the sidecar if needed (desktop app: the Rust side spawns it; in a plain browser it must
// be running already, `npm run voice`) and waits until both models are loaded or definitely not.
// Returns the health object; the caller decides what a 'missing' or 'error' model means for it.
// need: which parts must have finished loading. Listening only needs the recognizer, so it does not
// wait about a second more for the synthesizer; the speaker asks for both (the default).
export async function ensureSidecar({ timeoutMs = 30000, need = ['asr', 'tts'] } = {}) {
  assertLinked();
  if (inTauri()) {
    await invoke('voice_start'); // throws a readable message if Node or the script is missing
  }
  const start = Date.now();
  let lastError = null;
  for (;;) {
    try {
      const h = await health();
      if (need.every((part) => h[part].state !== 'loading')) return h;
    } catch (e) { lastError = e; }
    if (Date.now() - start > timeoutMs) {
      throw new Error(inTauri()
        ? 'the voice sidecar did not come up (see sidecars/voice/voice.log)'
        : `no voice sidecar on ${HOST}: run "npm run voice" in the project folder${lastError ? ` (${lastError.message})` : ''}`);
    }
    await sleep(300);
  }
}

export async function listVoices() {
  assertLinked();
  const res = await fetch(`${HTTP}/voices`, { cache: 'no-store' });
  return res.json();
}

function openSocket(path) {
  assertLinked();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}${path}`);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error(`cannot reach the voice sidecar on ${HOST}`)), { once: true });
  });
}

// --- listening -----------------------------------------------------------
// Streams `stream` (the microphone MediaStream) to the recognizer.
// Callbacks: onPartial(text) while a sentence is being said, onFinal(text) when it ends (the
// sidecar detects the pause), onError(message), onClose().
export async function createListener({ stream, language = 'auto', onPartial, onFinal, onIgnored, onError, onClose }) {
  const ws = await openSocket('/asr');
  await new Promise((resolve, reject) => {
    const first = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'ready') resolve();
      else if (m.type === 'error') reject(new Error(m.message));
    };
    ws.addEventListener('message', first, { once: true });
    ws.addEventListener('close', () => reject(new Error('voice sidecar closed the connection')), { once: true });
  });

  // Two separate gates: paused (the speaker is talking, so the microphone must not hear it) and
  // sending (the user is talking: push-to-talk or toggle, see voice.js). Audio reaches the
  // recognizer only when neither blocks it, so an idle microphone costs nothing downstream.
  let paused = false;
  let sending = false;
  let closed = false;
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return;
    const m = JSON.parse(ev.data);
    if (m.type === 'partial') onPartial?.(m.text);
    else if (m.type === 'final') onFinal?.(m.text);
    else if (m.type === 'ignored') onIgnored?.(m);
    else if (m.type === 'error') onError?.(m.message);
  });
  ws.addEventListener('close', () => { if (!closed) { closed = true; onClose?.(); } });

  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.sampleRate !== 16000) {
    ctx.close();
    ws.close();
    throw new Error(`audio engine refused 16 kHz (got ${ctx.sampleRate} Hz)`);
  }
  try {
    await ctx.audioWorklet.addModule(workletUrl());
  } catch (e) {
    ctx.close();
    ws.close();
    throw new Error(`the microphone processor could not be started (${e.message})`);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
  // Some engines only run a node that leads to the output; a silent gain keeps it pulled while
  // nothing of the microphone is ever audible.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.port.onmessage = (ev) => {
    if (sending && !paused && ws.readyState === WebSocket.OPEN) ws.send(ev.data);
  };
  source.connect(node);
  // The waveform and the level the sphere follows (voice-wave.js) read the live microphone here.
  // The analyser is not connected to the output: it only measures.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  node.connect(mute);
  mute.connect(ctx.destination); // gain 0: the mic is never played back
  if (ctx.state === 'suspended') await ctx.resume();
  if (language !== 'auto') ws.send(JSON.stringify({ type: 'language', language }));

  // A model that is handed speech the instant audio resumes loses the first word; a moment of
  // silence in front gives it something to settle on.
  const silence = () => { if (ws.readyState === WebSocket.OPEN) ws.send(new Int16Array(4800).buffer); };

  return {
    // Fills a Float32Array of 1024 with the latest microphone samples (-1..1).
    read(samples) { analyser.getFloatTimeDomainData(samples); },
    pause() { paused = true; },
    resume() { paused = false; },
    // Start of a talk: a moment of silence first, so the first word is not lost (see silence above).
    setSending(on) {
      if (on === sending) return;
      sending = on;
      if (on && !paused) silence();
    },
    // End of a talk: the sidecar pads with silence, ends the utterance and answers with a final text.
    flush() {
      sending = false;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flush' }));
    },
    setLanguage(code) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'language', language: code })); },
    close() {
      closed = true;
      paused = true;
      try { source.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already gone */ }
      ctx.close().catch(() => {});
      if (ws.readyState <= WebSocket.OPEN) ws.close();
    },
  };
}

// --- speaking ------------------------------------------------------------
// One speaker per app: queues texts, plays the audio gaplessly as it streams in.
// onBusy(boolean) fires when audio starts being produced or played and when everything is done;
// onStart() fires when the first sound is actually about to be heard;
// onLevel(0..1) follows the loudness of what is playing (drives the node mesh).
export function createSpeaker({ onBusy, onStart, onLevel, onError } = {}) {
  let ws = null;
  let connecting = null;
  let ctx = null;
  let analyser = null;
  let nextTime = 0;
  let nextId = 1;
  let busy = false;
  let audible = false;       // the first buffer of the current run has been scheduled
  let raf = 0;
  const pending = new Map();   // request id -> { ended }
  const playing = new Set();   // scheduled AudioBufferSourceNodes

  const setBusy = (value) => {
    if (busy === value) return;
    busy = value;
    if (value) pump(); else { audible = false; cancelAnimationFrame(raf); onLevel?.(null); }
    onBusy?.(value);
  };

  const audio = () => {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  const samples = new Float32Array(1024);
  function pump() {
    raf = requestAnimationFrame(pump);
    if (!analyser) return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    onLevel?.(Math.min(1, Math.sqrt(sum / samples.length) * 5));
  }

  function checkIdle() {
    if (pending.size === 0 && playing.size === 0) setBusy(false);
  }

  // Each sentence is synthesised on its own, so none carries the pause a speaker would leave
  // after it; without one they run into each other.
  const SENTENCE_GAP = 0.16;

  function play(rate, pcm, firstOfRequest) {
    const c = audio();
    const buffer = c.createBuffer(1, pcm.length, rate);
    buffer.copyToChannel(pcm, 0);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    const gap = firstOfRequest && nextTime > c.currentTime ? SENTENCE_GAP : 0;
    const at = Math.max(c.currentTime + 0.04, nextTime + gap);
    src.start(at);
    nextTime = at + buffer.duration;
    playing.add(src);
    if (!audible) { audible = true; onStart?.(); }
    src.onended = () => { playing.delete(src); checkIdle(); };
  }

  function onMessage(ev) {
    if (typeof ev.data !== 'string') {
      const view = new DataView(ev.data);
      const id = view.getUint32(0, true);
      const req = pending.get(id);
      if (!req) return; // cancelled while in flight
      const first = !req.played;
      req.played = true;
      play(req.sampleRate, new Float32Array(ev.data, 4), first);
      return;
    }
    const m = JSON.parse(ev.data);
    const req = pending.get(m.id);
    if (m.type === 'start' && req) req.sampleRate = m.sampleRate;
    else if (m.type === 'end') { pending.delete(m.id); checkIdle(); }
    else if (m.type === 'error') {
      pending.delete(m.id);
      onError?.(m.message);
      checkIdle();
    }
  }

  async function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    connecting ??= (async () => {
      await ensureSidecar();
      const socket = await openSocket('/tts');
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', () => {
        if (ws === socket) ws = null;
        pending.clear();
        checkIdle();
      });
      ws = socket;
      return socket;
    })().finally(() => { connecting = null; });
    return connecting;
  }

  return {
    get busy() { return busy; },

    // Queue one text. Resolves once it is sent; audio follows asynchronously.
    async speak(text, { voice, speed } = {}) {
      const id = nextId++;
      pending.set(id, { sampleRate: 24000 });
      setBusy(true);
      try {
        const socket = await connect();
        if (!pending.has(id)) return; // cancelled while connecting
        socket.send(JSON.stringify({ type: 'speak', id, text, voice, speed }));
      } catch (e) {
        pending.delete(id);
        onError?.(e.message);
        checkIdle();
      }
    },

    // Stop what is playing and drop everything queued.
    cancel() {
      pending.clear();
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel' }));
      for (const s of playing) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
      playing.clear();
      nextTime = 0;
      checkIdle();
    },

    // Call from a user gesture so the browser lets audio start later without one.
    prime() { audio(); },
  };
}
