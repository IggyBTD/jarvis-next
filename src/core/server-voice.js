// Push-to-talk against the JARVIS server: hold Ctrl+Space, speak, release. The microphone is captured at 16 kHz mono (echo
// cancellation and noise suppression on) and streamed as binary frames (0x01 + PCM16); the reply comes back as speech frames
// (0x02 + PCM16 at 24 kHz) that play as they arrive. Speaking over the reply stops it (the server's energy gate does the cutting;
// the player here drops what it had queued). The desktop build can register Ctrl+Space as a global shortcut later (HUMAN_TODO).
import { onLink, serverMode, state, voiceStart, voiceStop, voiceBargeIn, sendBinary } from './server-link.js';

const MIC = 0x01;
const TTS_RATE = 24000;
let stream = null; let ctx = null; let node = null; let holding = false;
let playCtx = null; let playAt = 0; const playing = new Set();

const toast = (text) => document.dispatchEvent(new CustomEvent('jarvis:toast', { detail: { text } }));

async function startMic() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } });
  ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  // ponytail: ScriptProcessor is deprecated but works everywhere; the existing pcm-worklet can replace it for lower latency
  node = ctx.createScriptProcessor(512, 1, 1);
  node.onaudioprocess = (e) => {
    if (!holding) return;
    const f = e.inputBuffer.getChannelData(0);
    const out = new Uint8Array(1 + f.length * 2);
    out[0] = MIC;
    const v = new DataView(out.buffer);
    for (let i = 0; i < f.length; i++) v.setInt16(1 + i * 2, Math.max(-1, Math.min(1, f[i])) * 32767, true);
    sendBinary(out);
  };
  src.connect(node); node.connect(ctx.destination);
}
function stopMic() { node?.disconnect(); ctx?.close(); stream?.getTracks().forEach((t) => t.stop()); stream = ctx = node = null; }

function play(pcm) {
  playCtx ??= new AudioContext({ sampleRate: TTS_RATE });
  const n = pcm.length >> 1;
  const buf = playCtx.createBuffer(1, n, TTS_RATE);
  const ch = buf.getChannelData(0);
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < n; i++) ch[i] = v.getInt16(i * 2, true) / 32768;
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);
  playAt = Math.max(playAt, playCtx.currentTime + 0.02);
  src.start(playAt);
  playAt += buf.duration;
  playing.add(src);
  src.onended = () => playing.delete(src);
}
const flush = () => { playing.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } }); playing.clear(); playAt = 0; };

onLink((e) => {
  if (e.type === 'voice.audio' && e.frame[0] === 0x02) play(e.frame.subarray(1));
  if (e.type === 'voice.state' && e.state === 'listening') flush();
  if (e.type === 'voice.error') toast(e.reason);
  if (e.type === 'voice.transcript') toast(`Heard: ${e.text}`);
});

const wanted = (e) => e.code === 'Space' && e.ctrlKey && serverMode() && state.voice?.enabled;
document.addEventListener('keydown', async (e) => {
  if (!wanted(e) || e.repeat) return;
  e.preventDefault();
  try { await startMic(); } catch { toast('The microphone is not available.'); return; }
  if (playing.size) voiceBargeIn();
  holding = true;
  voiceStart('push_to_talk');
});
document.addEventListener('keyup', (e) => {
  if (!holding || e.code !== 'Space' && e.key !== 'Control') return;
  holding = false;
  voiceStop();
  setTimeout(() => { if (!holding) stopMic(); }, 1500);
});
