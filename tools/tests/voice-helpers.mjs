// Small client for the voice sidecar, used by the tests and by hand. Node 22+ (global WebSocket).
import fs from 'node:fs';
import { unpackChunk } from '../../sidecars/voice/util.mjs';

export const BASE = process.env.JARVIS_VOICE_URL ?? 'http://127.0.0.1:8765';
const WS = BASE.replace(/^http/, 'ws');

export async function health() {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

function open(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}${path}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`cannot connect to ${WS}${path}`));
  });
}

// Synthesize one text. Returns { samples: Float32Array, sampleRate, chunks }.
export async function synthesize(text, { voice, speed, id = 1 } = {}) {
  const ws = await open('/tts');
  try {
    return await new Promise((resolve, reject) => {
      const parts = [];
      let sampleRate = 0;
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') { parts.push(unpackChunk(new Uint8Array(ev.data)).samples); return; }
        const m = JSON.parse(ev.data);
        if (m.type === 'start') sampleRate = m.sampleRate;
        else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'end') {
          const total = parts.reduce((n, p) => n + p.length, 0);
          const samples = new Float32Array(total);
          let at = 0;
          for (const p of parts) { samples.set(p, at); at += p.length; }
          resolve({ samples, sampleRate, chunks: parts.length });
        }
      };
      ws.send(JSON.stringify({ type: 'speak', id, text, voice, speed }));
    });
  } finally { ws.close(); }
}

// Reads a PCM16 WAV file into mono floats at 16 kHz (the format of sherpa's test_wavs).
export function readWav16k(file) {
  const b = fs.readFileSync(file);
  let at = 12;
  let fmt = null;
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('only 16-bit PCM wav is supported');
      const n = Math.floor(Math.min(size, b.length - at - 8) / 2 / fmt.channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(at + 8 + i * 2 * fmt.channels) / 32768;
      return resample(out, fmt.rate, 16000);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in ' + file);
}

// Linear-interpolation resampler, good enough for test audio.
export function resample(samples, from, to) {
  if (from === to) return samples;
  const n = Math.floor((samples.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * from) / to;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + (samples[Math.min(i0 + 1, samples.length - 1)] * frac);
  }
  return out;
}

export function toPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  return out;
}

// Stream 16 kHz float audio to /asr in `chunkMs` pieces at `speedup` times real time and collect
// the messages. `trailingSilenceS` of silence after the audio lets the endpointer close the utterance.
export async function transcribe(samples16k, { chunkMs = 100, speedup = 4, trailingSilenceS = 2, language } = {}) {
  const ws = await open('/asr');
  const events = [];
  try {
    await new Promise((resolve, reject) => {
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === 'ready') resolve();
        else if (m.type === 'error') reject(new Error(m.message));
      };
    });
    const t0 = performance.now();
    ws.onmessage = (ev) => events.push({ ...JSON.parse(ev.data), at: performance.now() - t0 });
    if (language) ws.send(JSON.stringify({ type: 'language', language }));
    const padded = new Float32Array(samples16k.length + Math.round(trailingSilenceS * 16000));
    padded.set(samples16k);
    const step = (16000 * chunkMs) / 1000;
    for (let at = 0; at < padded.length; at += step) {
      const pcm = toPcm16(padded.subarray(at, at + step));
      ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
      await new Promise((r) => setTimeout(r, chunkMs / speedup));
    }
    // Sped-up audio can arrive faster than the model decodes it: wait until the server has gone
    // quiet (nothing new for 1.2 s, at most 10 s) instead of closing with results still on the way.
    const waitStart = performance.now();
    let lastCount = -1;
    let lastChange = performance.now();
    while (performance.now() - waitStart < 10000) {
      await new Promise((r) => setTimeout(r, 150));
      if (events.length !== lastCount) { lastCount = events.length; lastChange = performance.now(); }
      else if (performance.now() - lastChange > 1200) break;
    }
  } finally { ws.close(); }
  return events;
}

// Fundamental frequency by autocorrelation on the loudest 40 ms windows, in Hz (median).
export function medianPitch(samples, sampleRate) {
  const win = Math.round(sampleRate * 0.04);
  const lagMin = Math.round(sampleRate / 400);
  const lagMax = Math.round(sampleRate / 70);
  const found = [];
  for (let at = 0; at + win + lagMax < samples.length; at += win) {
    let energy = 0;
    for (let i = 0; i < win; i++) energy += samples[at + i] ** 2;
    if (energy / win < 1e-3) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let c = 0;
      for (let i = 0; i < win; i++) c += samples[at + i] * samples[at + i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag && best / energy > 0.5) found.push(sampleRate / bestLag);
  }
  found.sort((a, b) => a - b);
  return found.length ? found[found.length >> 1] : 0;
}
