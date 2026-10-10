// AudioWorklet: turns the microphone into 100 ms blocks of 16-bit mono PCM for the speech
// recognizer. The AudioContext runs at 16 kHz (voice-client.js), so no resampling happens here.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Int16Array(1600);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.block[this.filled++] = s < 0 ? s * 32768 : s * 32767;
      if (this.filled === this.block.length) {
        const out = this.block.buffer;
        this.port.postMessage(out, [out]);
        this.block = new Int16Array(1600);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
