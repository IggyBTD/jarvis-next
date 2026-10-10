// The sound JARVIS makes while it works on an answer: one soft note, struck over and over, so a long
// wait (a big model loading, a long stretch of reasoning) is never silent. It starts only after a
// short delay (voice.js), fades in and out, and stops the moment speech begins.
//
// pulseSamples is pure (no audio engine) so a test can feed the exact waveform to the speech
// recognizer and check that it never hears words in it.

export const TONE = { hz: 392, period: 1.7, peak: 0.07, attack: 0.03, decay: 0.4 };

// One period of the pattern: a sine note with a quiet octave overtone, a soft attack and an
// exponential decay that is practically silent again before the period ends, so the loop has no click.
export function pulseSamples(rate, { hz, period, peak, attack, decay } = TONE) {
  const n = Math.round(rate * period);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const envelope = t < attack ? t / attack : Math.exp((-(t - attack) / decay) * 3);
    const tone = Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(2 * Math.PI * 2 * hz * t);
    out[i] = (peak * envelope * tone) / 1.25;
  }
  return out;
}

export function createThinkingTone() {
  let ctx = null;
  let source = null;
  let gain = null;
  let running = false;

  return {
    get running() { return running; },

    start() {
      if (running) return;
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const samples = pulseSamples(ctx.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.4);
      source.connect(gain).connect(ctx.destination);
      source.start();
      running = true;
    },

    stop() {
      if (!running) return;
      running = false;
      const s = source;
      const g = gain;
      source = null;
      gain = null;
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.25);
      s.stop(now + 0.3);
      s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { /* gone */ } };
    },
  };
}
