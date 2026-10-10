// The microphone, made visible: a waveform strip above the message field and the reaction to a talk.
//
//   mic on, not talking  the strip is dim and still moves with the room, so you can see that the
//                        microphone is alive before you press a key
//   talking (F8 / F9)    the strip lights up, the dock microphone fills, the sphere follows your voice
//
// The line adapts to the voice: the height follows a running peak that rises at once and falls
// slowly, so a quiet voice fills the strip and a loud one does not clip it. Made with the Web Audio
// analyser and a canvas; no library, because nothing a library offers here is more than this.
import { setSpeechLevel, pulse } from './mesh-state.js';

const canvas = document.getElementById('voice-wave');
const dockMic = document.getElementById('dock-mic');
const ctx = canvas.getContext('2d');
const samples = new Float32Array(1024);
const POINTS = 96;
const FRAME_MS = 1000 / 60;
const SILENT = 0.004; // a whole talk quieter than this (peak, 0..1) means the microphone heard nothing

let listener = null; // anything with read(Float32Array)
let talking = false;
let raf = 0;
let nextDraw = 0;
let env = 0.05; // running peak, the adaptive scale
let level = 0; // smoothed loudness 0..1
let talkPeak = 0;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);

function draw(now) {
  raf = requestAnimationFrame(draw);
  if (now < nextDraw) return;
  nextDraw = Math.max(nextDraw + FRAME_MS, now - FRAME_MS);
  listener.read(samples);

  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; sum += samples[i] * samples[i]; }
  const rms = Math.sqrt(sum / samples.length);
  env = Math.max(peak, env * 0.985, 0.02); // fast up, slow down; the floor keeps room noise from filling the strip
  level += (Math.min(1, rms * 7) - level) * 0.35;
  if (talking) { talkPeak = Math.max(talkPeak, peak); setSpeechLevel(level); }

  const w = canvas.width;
  const h = canvas.height;
  const mid = h / 2;
  const gain = (h * 0.42) / env;
  ctx.clearRect(0, 0, w, h);

  // baseline
  const c = colours();
  ctx.strokeStyle = c.line;
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  // the wave: POINTS averages of the latest samples, edges faded so it starts and ends at the baseline
  const step = Math.floor(samples.length / POINTS);
  ctx.beginPath();
  for (let i = 0; i < POINTS; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += samples[i * step + k];
    const fade = Math.sin((i / (POINTS - 1)) * Math.PI);
    const x = (i / (POINTS - 1)) * w;
    const y = mid - (s / step) * gain * 1.6 * fade;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = (talking ? 2 : 1.5) * dpr;
  ctx.strokeStyle = talking ? c.warm : c.dim;
  ctx.shadowColor = c.warm;
  ctx.shadowBlur = talking ? 10 * dpr : 0;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// Colours come from the design tokens; looked up now and then, not every frame.
let cached = null;
let drawn = 0;
function colours() {
  if (!cached || drawn++ % 120 === 0) {
    const t = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    cached = { line: t('--border-strong'), dim: t('--accent-mid'), warm: t('--warm') };
  }
  return cached;
}

// Called when the microphone starts listening (listener = the object from createListener) and when it stops.
export function attach(source) {
  listener = source;
  canvas.hidden = false;
  resize();
  env = 0.05;
  if (!raf) raf = requestAnimationFrame(draw);
}

export function detach() {
  listener = null;
  talking = false;
  cancelAnimationFrame(raf);
  raf = 0;
  canvas.hidden = true;
  canvas.classList.remove('on');
  dockMic?.classList.remove('recording');
  setSpeechLevel(null);
}

// A talk begins or ends. Returns, on ending, the loudest sample of the talk (0..1), so the caller can
// tell a silent microphone from a quiet voice.
export function setTalking(on) {
  const was = talking;
  talking = on && !!listener;
  canvas.classList.toggle('on', talking);
  dockMic?.classList.toggle('recording', talking);
  if (talking && !was) { talkPeak = 0; pulse(); }
  if (!talking && was) { setSpeechLevel(null); return talkPeak; }
  return null;
}

export const isSilent = (peak) => peak !== null && peak < SILENT;
