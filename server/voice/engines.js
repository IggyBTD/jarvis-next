// Voice building blocks. Engines are external OpenAI-compatible servers (speech-to-text and text-to-speech), so Silero VAD,
// Whisper and Kokoro/Piper can sit behind them; the old JARVIS voice sidecar can be wrapped the same way. Each piece below is
// small and replaceable: vad (energy), turn (silence timeout), stt, tts, and the deterministic target-switch matcher.
import { rms, wav } from '../../shared/voice-frames.js';

// --- voice activity: a frame is speech when its energy passes the threshold (ponytail: swap for Silero VAD behind this call)
export const createVad = ({ energyThreshold = 0.02 } = {}) => ({ isSpeech: (pcm) => rms(pcm) >= energyThreshold });

// --- end of turn: speech has been heard and then silence lasted silenceMs (ponytail: Smart Turn v3 can replace this; the silence timeout stays as the fallback)
export function createTurn({ silenceMs = 900, minSpeechMs = 200, maxUtteranceMs = 30_000, frameMs = 30 }) {
  let speechMs = 0; let quietMs = 0; let totalMs = 0;
  return {
    // returns 'continue' | 'end'
    push(isSpeech, ms = frameMs) {
      totalMs += ms;
      if (isSpeech) { speechMs += ms; quietMs = 0; } else quietMs += ms;
      if (totalMs >= maxUtteranceMs) return 'end';
      return speechMs >= minSpeechMs && quietMs >= silenceMs ? 'end' : 'continue';
    },
    heardSpeech: () => speechMs >= minSpeechMs,
    reset() { speechMs = 0; quietMs = 0; totalMs = 0; },
  };
}

// --- speech to text: POST multipart to /v1/audio/transcriptions, language auto-detected
export function createStt({ url, model, timeoutMs = 30_000, fetchImpl = fetch }) {
  return async function transcribe(pcm) {
    const form = new FormData();
    form.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    const res = await fetchImpl(url, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`speech-to-text answered ${res.status}`);
    const j = await res.json();
    return { text: String(j.text ?? '').trim(), language: String(j.language ?? 'en').slice(0, 2).toLowerCase() };
  };
}

// --- text to speech: POST /v1/audio/speech, raw PCM16 back, voice chosen by language
export function createTts({ url, model, voices, timeoutMs = 30_000, fetchImpl = fetch }) {
  return async function speak(text, language = 'en', signal) {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: text, voice: voices[language] ?? voices.en ?? Object.values(voices)[0], response_format: 'pcm' }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`text-to-speech answered ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
}

// --- deterministic target-switch matcher (English, Spanish, French). Code, not the model: only a clear sentence matches.
const NAMES = { pc: '(?:pc|computer|windows|desktop|ordenador|ordinateur|el pc|le pc)', mac: '(?:mac|macbook|el mac|le mac)' };
const VERBS = '(?:switch|change|go|move|control|use|work on|cambia|cambiar|pasa|pasar|usa|usar|controla|controlar|trabaja en|pasa a|passe|passer|change de|bascule|utilise|contrôle)';
const PREP = '(?:to|onto|over to|a|al|en|sur|vers|à|au|on|the|my|el|la|le|mi|mon|ma|mes)';
const norm = (s) => String(s).toLowerCase().replace(/[.,!?¿¡;:]/g, ' ').replace(/\s+/g, ' ').trim();
export function matchTarget(text) {
  const t = norm(text);
  for (const [target, names] of Object.entries(NAMES)) {
    if (new RegExp(`^(?:please |por favor |s'il te plaît )?(?:${VERBS})(?: ${PREP})*(?: ${PREP})? ?${names}(?: please| por favor)?$`).test(t)) return target;
  }
  return null;
}
export const matchYesNo = (text) => {
  const t = norm(text);
  if (/^(yes|yeah|yep|sure|ok|okay|confirm|do it|sí|si|vale|claro|adelante|oui|ouais|d'accord|bien sûr)( .*)?$/.test(t) && !/\bno\b/.test(t)) return true;
  if (/^(no|nope|cancel|stop|don't|do not|nunca|cancela|cancelar|non|annule|pas)( .*)?$/.test(t)) return false;
  return null;
};
export const confirmQuestion = (target, label, language) => ({ en: `Switch to the ${label}? Say yes to confirm.`, es: `¿Cambio al ${label}? Di sí para confirmar.`, fr: `Passer sur le ${label} ? Dites oui pour confirmer.` }[language] ?? `Switch to the ${label}? Say yes to confirm.`);
