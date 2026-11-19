// Drives how far the node mesh "opens" while JARVIS speaks.
// The level is simulated for now: streamed chunks only signal "speech is
// active"; the visible rhythm comes from a slow time-based oscillator, so the
// look does not depend on how many chunks per second the model emits.
// When TTS exists, call setSpeechLevel(0..1) with the real output volume and the
// mesh follows it instead; setSpeechLevel(null) returns to the simulation.

const HOLD = 0.35;          // s a pulse keeps speech "active" (bridges gaps between chunks)
const SPEECH_PEAK = 0.8;    // envelope ceiling for simulated speech

let holdLeft = 0;     // seconds of activity remaining since the last pulse
let activity = 0;     // 0..1, low-passed speech on/off
let phase = 0;        // syllable oscillator phase
let freq = 2.8;       // Hz, drifts between 2.2 and 3.4
let freqTarget = 2.8;
let nextRetarget = 0;
let depth = 0.8;      // swell depth variation per "syllable group"
let depthTarget = 0.8;
let external = null;  // real level from a future TTS volume tracker
let thinking = false;
let level = 0;        // smoothed value the renderer reads

// The renderer (node-mesh.js) registers here so a resting orb wakes when a reply starts.
let onWake = null;
export function setWakeListener(fn) {
  onWake = fn;
}

export function pulse() {
  holdLeft = HOLD;
  onWake?.();
}

export function setThinking(value) {
  thinking = value;
  if (value) onWake?.();
}

export function setSpeechLevel(value) {
  external = value == null ? null : Math.min(1, Math.max(0, value));
  if (external) onWake?.();
}

export function updateLevel(dt, t) {
  holdLeft = Math.max(0, holdLeft - dt);
  const on = holdLeft > 0 ? 1 : 0;
  // slower release than attack so the mesh closes gently after the last chunk
  activity += (on - activity) * Math.min(1, dt * (on ? 4 : 2.5));

  if (t > nextRetarget) {
    freqTarget = 2.2 + 1.2 * Math.random();
    depthTarget = 0.65 + 0.35 * Math.random();
    nextRetarget = t + 0.6 + 0.8 * Math.random();
  }
  freq += (freqTarget - freq) * Math.min(1, dt * 1.5);
  depth += (depthTarget - depth) * Math.min(1, dt * 2);
  phase += freq * 2 * Math.PI * dt;

  // swell between a resting floor and a depth-scaled peak
  const osc = 0.5 + 0.5 * Math.sin(phase);
  const speech = activity * SPEECH_PEAK * (0.2 + 0.8 * depth * osc);

  const idle = thinking ? 0.1 + 0.06 * Math.sin(t * 2.2) : 0;
  const target = external ?? Math.max(speech, idle);
  level += (target - level) * Math.min(1, dt * 9);
  return level;
}
