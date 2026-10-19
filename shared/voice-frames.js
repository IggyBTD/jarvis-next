// Binary WebSocket frames for voice. First byte is the kind: 0x01 microphone audio (client to server, PCM16 mono 16 kHz,
// little endian), 0x02 speech audio (server to client, PCM16 mono at the rate the TTS sent, little endian).
export const MIC = 0x01;
export const TTS = 0x02;
export const frame = (kind, pcm) => { const out = Buffer.allocUnsafe(1 + pcm.length); out[0] = kind; Buffer.from(pcm.buffer ?? pcm, pcm.byteOffset ?? 0, pcm.byteLength ?? pcm.length).copy(out, 1); return out; };
export const parse = (buf) => { const b = Buffer.from(buf); return b.length < 1 ? null : { kind: b[0], pcm: b.subarray(1) }; };

// PCM16 mono -> WAV file bytes (what OpenAI-compatible transcription servers accept).
export function wav(pcm, sampleRate = 16000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// RMS energy of a PCM16 frame, 0..1.
export function rms(pcm) {
  const n = Math.floor(pcm.length / 2);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
  return Math.sqrt(s / n);
}
