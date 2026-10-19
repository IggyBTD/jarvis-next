// One voice session per connected client: idle -> listening -> transcribing -> thinking -> speaking. Push-to-talk is the default
// (no turn detection: the key says when you are done); "open" mode ends the turn on a silence timeout. Every stage checks an epoch,
// so barge-in (the user speaks over the reply) cancels the rest of the speech at once. A target switch by voice is matched by code,
// confirmed out loud, and only a spoken yes changes it.
import { MIC, TTS, frame, parse } from '../../shared/voice-frames.js';
import { createTurn, matchTarget, matchYesNo, confirmQuestion } from './engines.js';

export const splitSentences = (text) => String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
// Strip what reads badly aloud (markdown marks, code fences, links).
export const forSpeech = (t) => String(t).replace(/```[\s\S]*?```/g, ' (code omitted) ').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>|]/g, '');

export function createVoice({ voiceCfg, stt, tts, vad, targetState, orchestrator, labelOf, send, sendBinary, convId = 'voice', log = () => {} }) {
  const sessions = new Map();
  const get = (c) => { if (!sessions.has(c)) sessions.set(c, { state: 'idle', epoch: 0, chunks: [], mode: voiceCfg.mode, turn: createTurn({ ...voiceCfg.turn, ...voiceCfg.vad }), pendingSwitch: null, language: 'en' }); return sessions.get(c); };
  const setState = (c, s, state) => { s.state = state; send(c, { type: 'voice.state', state }); };

  async function say(c, s, text, epoch) {
    setState(c, s, 'speaking');
    for (const sentence of splitSentences(forSpeech(text))) {
      if (s.epoch !== epoch) return false;
      try {
        const pcm = await tts(sentence, s.language);
        if (s.epoch !== epoch) return false;
        for (let i = 0; i < pcm.length; i += 8192) sendBinary(c, frame(TTS, pcm.subarray(i, i + 8192)));
        send(c, { type: 'voice.speech', text: sentence });
      } catch (e) { log(`tts failed: ${e.message}`); send(c, { type: 'voice.error', reason: 'text-to-speech is not available' }); break; }
    }
    if (s.epoch === epoch) setState(c, s, 'idle');
    return true;
  }

  async function finish(c, s) {
    const epoch = ++s.epoch;
    const pcm = Buffer.concat(s.chunks);
    s.chunks = [];
    s.turn.reset();
    if (pcm.length < 3200) { setState(c, s, 'idle'); return; } // under 100 ms: a stray tap
    setState(c, s, 'transcribing');
    let heard;
    try { heard = await stt(pcm); } catch (e) { log(`stt failed: ${e.message}`); send(c, { type: 'voice.error', reason: 'speech-to-text is not available' }); setState(c, s, 'idle'); return; }
    if (s.epoch !== epoch) return;
    if (!heard.text) { setState(c, s, 'idle'); return; }
    s.language = ['en', 'es', 'fr'].includes(heard.language) ? heard.language : 'en';
    send(c, { type: 'voice.transcript', text: heard.text, language: s.language });

    if (s.pendingSwitch) {
      const target = s.pendingSwitch;
      s.pendingSwitch = null;
      if (matchYesNo(heard.text) === true) {
        try { targetState.set(target, { by: 'voice', clientId: c.id }); await say(c, s, { en: `Switched to the ${labelOf(target)}.`, es: `Cambiado al ${labelOf(target)}.`, fr: `Passé sur le ${labelOf(target)}.` }[s.language], epoch); } catch (e) { await say(c, s, e.message, epoch); }
      } else await say(c, s, { en: 'Cancelled.', es: 'Cancelado.', fr: 'Annulé.' }[s.language], epoch);
      return;
    }
    const wanted = matchTarget(heard.text);
    if (wanted) {
      if (wanted === targetState.get()) { await say(c, s, { en: `Already on the ${labelOf(wanted)}.`, es: `Ya estoy en el ${labelOf(wanted)}.`, fr: `Déjà sur le ${labelOf(wanted)}.` }[s.language], epoch); return; }
      s.pendingSwitch = wanted;
      await say(c, s, confirmQuestion(wanted, labelOf(wanted), s.language), epoch);
      return;
    }
    setState(c, s, 'thinking');
    const out = await orchestrator.runTurn({ convId, text: heard.text, source: 'voice', voiceMode: true });
    if (s.epoch !== epoch) return;
    if (out.ok && out.text) await say(c, s, out.text, epoch); else setState(c, s, 'idle');
  }

  return {
    start(c, { mode } = {}) {
      if (!voiceCfg.enabled) return send(c, { type: 'voice.error', reason: 'voice is switched off in config/server/voice.json' });
      if ((mode ?? voiceCfg.mode) === 'wake_word') return send(c, { type: 'voice.error', reason: 'wake word is not available yet' });
      const s = get(c);
      s.epoch += 1;
      s.chunks = [];
      s.turn.reset();
      s.mode = mode ?? voiceCfg.mode;
      setState(c, s, 'listening');
    },
    stop(c) { const s = sessions.get(c); if (!s) return; if (s.state === 'listening') finish(c, s).catch((e) => log(`voice: ${e.message}`)); else { s.epoch += 1; } },
    bargeIn(c) { const s = sessions.get(c); if (s) { s.epoch += 1; orchestrator.abort?.(convId); setState(c, s, 'listening'); } },
    onBinary(c, data) {
      const f = parse(data);
      if (!f || f.kind !== MIC) return;
      const s = get(c);
      const speech = vad.isSpeech(f.pcm);
      if (s.state === 'speaking' && speech) { s.epoch += 1; s.chunks = []; setState(c, s, 'listening'); } // the cheap energy gate: speaking over the reply stops it
      if (s.state !== 'listening') return;
      s.chunks.push(Buffer.from(f.pcm));
      if (s.mode === 'open' && s.turn.push(speech, f.pcm.length / 32) === 'end') finish(c, s).catch((e) => log(`voice: ${e.message}`));
    },
    forget(c) { sessions.delete(c); },
    state: (c) => sessions.get(c)?.state ?? 'idle',
  };
}
