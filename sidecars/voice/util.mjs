// Pure helpers for the voice sidecar (no native code, unit-tested in tools/tests/voice-sidecar.test.mjs).
import fs from 'node:fs';
import path from 'node:path';

// Pages that may talk to the sidecar. A browser always sends Origin on a WebSocket upgrade and on
// cross-origin fetches, so any other web page open on this machine is refused. A request without
// an Origin header does not come from a web page (a local script), which is already as trusted
// as the user's own account.
const ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/;
export const originAllowed = (origin) => !origin || ORIGIN_RE.test(origin);

// Little-endian 16-bit PCM bytes to floats in [-1, 1). Handles an odd trailing byte and any
// Buffer alignment (a Buffer from a socket is usually a slice of a shared pool).
export function pcm16ToFloat32(bytes) {
  const n = bytes.length >> 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

// One TTS audio frame on the wire: uint32 request id (little endian) then float32 samples. The
// 4-byte header keeps the samples 4-byte aligned for a Float32Array view on the client.
export function packChunk(id, samples) {
  const buf = new ArrayBuffer(4 + samples.length * 4);
  new DataView(buf).setUint32(0, id >>> 0, true);
  new Float32Array(buf, 4).set(samples);
  return Buffer.from(buf);
}

export function unpackChunk(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const copy = bytes.buffer.slice(bytes.byteOffset + 4, bytes.byteOffset + bytes.byteLength);
  return { id: view.getUint32(0, true), samples: new Float32Array(copy) };
}

// The files each model needs. Returns { ok, config } or { ok: false, missing: [...] } so the
// health endpoint can say exactly what to download instead of crashing in native code.
export function resolveAsr(modelsDir, asr) {
  const dir = path.join(modelsDir, asr.model);
  const files = {
    encoder: path.join(dir, 'encoder.int8.onnx'),
    decoder: path.join(dir, 'decoder.int8.onnx'),
    joiner: path.join(dir, 'joiner.int8.onnx'),
    tokens: path.join(dir, 'tokens.txt'),
  };
  const missing = Object.values(files).filter((f) => !fs.existsSync(f));
  if (missing.length) return { ok: false, dir, missing };
  return {
    ok: true,
    dir,
    config: {
      featConfig: { sampleRate: 16000, featureDim: 128 },
      modelConfig: {
        transducer: { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner },
        tokens: files.tokens,
        numThreads: asr.threads ?? 4,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
      // The built-in endpointing waits a fixed time of silence; the server decides itself from the
      // text instead (pauseFor), so it is switched off here.
      enableEndpoint: 0,
    },
  };
}

// How long a silence must last before what was said counts as a finished message, judged from
// the words so far, the way a listener does: after a sentence that sounds complete the answer
// may start almost at once, after a word that is plainly mid-thought ("and", "the", "um", a
// comma) the speaker is given time to find the next one.
const HANGING = new Set([
  'and', 'but', 'or', 'so', 'because', 'cause', 'that', 'which', 'who', 'whom', 'whose', 'if', 'then', 'than', 'unless', 'while',
  'when', 'where', 'how', 'what', 'why', 'whether', 'to', 'of', 'in', 'on', 'at', 'with', 'for', 'from', 'by', 'about', 'as',
  'into', 'onto', 'over', 'under', 'between', 'through', 'the', 'a', 'an', 'my', 'your', 'our', 'their', 'his', 'her', 'its',
  'this', 'these', 'those', 'some', 'any', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'have', 'has', 'had', 'do', 'does',
  'did', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'not', 'just', 'really', 'very', 'also',
  'maybe', 'actually', 'basically', 'like', 'well', 'um', 'uh', 'er', 'erm', 'hmm', 'mm', 'i', "i'm", "i've", "i'll", "i'd",
  'we', 'they', 'he', 'she', "we're", "they're", "he's", "she's", "it's", "that's", "there's", 'let', "let's", 'also', 'plus',
]);

// A verb that needs an object ("...create an artifact that will simulate") is a mid-thought stop
// too, however ordinary the word. Listed verbs, plus a suffix rule for the many verbs not listed
// (simulate, visualize, clarify) with the few nouns that share those endings left out.
const VERBS = new Set([
  'create', 'make', 'build', 'write', 'show', 'tell', 'explain', 'generate', 'design', 'find', 'give', 'get', 'take', 'put',
  'use', 'need', 'want', 'help', 'see', 'add', 'remove', 'change', 'fix', 'run', 'open', 'check', 'draw', 'render', 'display',
  'plot', 'describe', 'summarize', 'summarise', 'analyze', 'analyse', 'compare', 'convert', 'develop', 'implement', 'program',
  'code', 'model', 'list', 'name', 'pick', 'choose', 'try', 'start', 'stop', 'continue', 'keep', 'call', 'send', 'read',
  'look', 'think', 'know', 'mean', 'say', 'ask', 'play', 'set', 'turn', 'move', 'save', 'load', 'copy', 'paste', 'delete',
  'update', 'edit', 'review', 'test', 'debug', 'deploy', 'install', 'search', 'translate', 'calculate', 'compute', 'solve',
  'prove', 'teach', 'learn', 'understand', 'consider', 'imagine', 'suppose', 'assume', 'include', 'contain', 'involve',
  'represent', 'demonstrate', 'illustrate', 'visualise', 'visualize', 'animate', 'simulate', 'emulate', 'mimic', 'connect',
  'combine', 'split', 'sort', 'filter', 'count', 'measure', 'track', 'monitor', 'handle', 'manage', 'support', 'provide',
]);
const VERB_SUFFIX = /(ate|ize|ise|ify)$/;
const NOUNS_WITH_VERB_ENDINGS = new Set(['climate', 'estate', 'private', 'senate', 'candidate', 'delegate', 'advocate', 'appetite', 'website', 'satellite', 'surprise', 'exercise', 'promise', 'premise', 'enterprise', 'expertise', 'franchise', 'disguise', 'noise', 'rise', 'wise', 'precise', 'concise', 'otherwise', 'likewise', 'mate', 'date', 'state', 'rate', 'gate', 'plate', 'slate', 'update']);
const needsObject = (w) => VERBS.has(w) || (w.length >= 6 && VERB_SUFFIX.test(w) && !NOUNS_WITH_VERB_ENDINGS.has(w));

// The model rarely writes the final "?" or "." before the speaker stops, so a sentence shaped like
// a question (starts with a question word or an auxiliary, enough words, no hanging end) counts as
// probably finished too.
const QUESTION_START = /^(what|what's|how|why|who|where|when|which|can|could|would|should|will|do|does|did|is|are|was|were|have|has|tell|explain|show|give|write|make|list|find|open|close|start|stop|please)\b/i;

export function pauseFor(text, pause = {}) {
  const { complete = 0.4, likely = 0.5, unsure = 1.0, open = 2.5 } = pause;
  const t = String(text).trim();
  if (!t) return open;
  if (/(\.\.\.|…|[,;:–—-])["')\]]*$/.test(t)) return open; // trailing off, or a comma
  const words = t.split(/\s+/).length;
  const last = t.replace(/["')\]]+$/, '').split(/\s+/).pop().toLowerCase();
  if (/[.?!]["')\]]*$/.test(t)) return words >= 3 ? complete : unsure; // "Yes." alone may be the start of more
  const word = last.replace(/[.,;:!?]+$/, '');
  if (HANGING.has(word) || needsObject(word)) return open;
  if (words >= 5 && QUESTION_START.test(t)) return likely;
  return unsure;
}

// `variant` picks the English pronunciation lexicon: 'gb' for the British voices (b*), 'us' otherwise.
export const ttsVariant = (voiceName) => (String(voiceName).startsWith('b') ? 'gb' : 'us');

export function resolveTts(modelsDir, tts, variant = 'us') {
  const dir = path.join(modelsDir, tts.model);
  const files = {
    model: path.join(dir, 'model.onnx'),
    voices: path.join(dir, 'voices.bin'),
    tokens: path.join(dir, 'tokens.txt'),
    dataDir: path.join(dir, 'espeak-ng-data'),
    lexEn: path.join(dir, variant === 'gb' ? 'lexicon-gb-en.txt' : 'lexicon-us-en.txt'),
    lexZh: path.join(dir, 'lexicon-zh.txt'),
  };
  const missing = Object.values(files).filter((f) => !fs.existsSync(f));
  if (missing.length) return { ok: false, dir, missing };
  return {
    ok: true,
    dir,
    config: {
      model: {
        kokoro: {
          model: files.model,
          voices: files.voices,
          tokens: files.tokens,
          dataDir: files.dataDir,
          lexicon: `${files.lexEn},${files.lexZh}`,
        },
        debug: false,
        numThreads: tts.threads ?? 4,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    },
  };
}
