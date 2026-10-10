// Voice conversation: the microphone switch starts listening, finished sentences are sent to the
// model like typed ones, and replies are spoken as they stream in.
//
// Half duplex on purpose: while JARVIS is working on a reply or speaking it, no audio goes to the
// recognizer, so it never hears itself through the speakers. (Interrupting by voice would need
// echo cancellation we have not verified; see JARVIS_Progress.md.)
//
//   mic switch on  -> listening (nothing is sent). Hold F8 and talk: the words appear in the field,
//                     releasing F8 sends them. Or press F9 to start, and F9 again to send. The
//                     recognizer never decides for itself that you have finished (config asr.autoEnd).
//   mic switch off -> nothing is heard; F8 or F9 switch the microphone on first.
//                     Typed messages are not spoken unless /speak on
import config from '../../config/voice.json';
import models from '../../config/models.json';
import { onEvent as onModelEvent, getPreset } from './llm-client.js';
import { invoke } from '@tauri-apps/api/core';
import { createThinkingTone } from './thinking-tone.js';
import { getSwitches, onSwitchChange, getMicStream, setMic } from './switches.js';
import { setSpeechLevel } from './mesh-state.js';
import { createSentenceStream } from './speech-text.js';
import { reportService } from './service-status.js';
import { attach, detach, setTalking, isSilent } from './voice-wave.js';
import { ensureSidecar, createListener, createSpeaker, listVoices } from './voice-client.js';

const KEY = 'jarvis.voice';
const RESUME_DELAY_MS = 350; // let the room's tail of the last spoken word die out before listening again

const TONE_DELAY_MS = 1200;    // a quick answer never gets a "thinking" note in front of it
const THINK_LINE_AFTER_MS = 2500; // reasoning must last this long before JARVIS says it is thinking

const prefs = { voice: config.tts.voice, speed: config.tts.speed, language: config.asr.language, speakTyped: false, ping: true };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  if (typeof saved.voice === 'string') prefs.voice = saved.voice;
  if (typeof saved.speed === 'number') prefs.speed = saved.speed;
  if (typeof saved.language === 'string') prefs.language = saved.language;
  if (prefs.language !== 'auto' && !(config.asr.languages ?? []).includes(prefs.language)) prefs.language = 'auto'; // saved before the language filter
  if (typeof saved.speakTyped === 'boolean') prefs.speakTyped = saved.speakTyped;
  if (typeof saved.ping === 'boolean') prefs.ping = saved.ping;
} catch { /* storage unavailable: defaults */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

// off | starting | listening | hearing | thinking | speaking | busy
// thinking: a message was sent and nothing has been said back yet. The microphone stays open, so
// if the speaker carries on (the sentence only sounded finished) the message is taken back and
// merged with what they say next. busy: the short settling time after the last spoken word.
let phase = 'off';
let talk = null; // 'hold' or 'toggle' while the user is talking (see beginTalk)
let talkStartedAt = 0;
let turnMuted = false; // the user took over with a talk key: the rest of this reply is not spoken
let pendingTalk = null; // a talk key pressed while the microphone was off: start talking once it listens
const changeCallbacks = new Set();
export const onVoiceChange = (cb) => { changeCallbacks.add(cb); return () => changeCallbacks.delete(cb); };
let voiceError = ''; // why the last start failed; shown in the notch until the next start
const reportVoice = () => {
  if (phase === 'starting') { voiceError = ''; reportService('voice', 'idle', 'starting'); }
  else if (phase !== 'off') reportService('voice', 'ok', `sidecar connected, ${phase}`);
  else if (!voiceError) reportService('voice', 'idle', 'microphone off');
};
const setPhase = (p) => {
  if (p === phase) return;
  phase = p;
  reportVoice();
  changeCallbacks.forEach((cb) => cb(phase));
  paintPlaceholder();
};
reportVoice();
export const voicePhase = () => phase;
export const getVoicePrefs = () => ({ ...prefs });
export const getAllowedLanguages = () => [...(config.asr.languages ?? [])];

// --- chat binding --------------------------------------------------------
let chat = null; // { input, submit(), notify(text), interrupt() }
let placeholder = '';
export function bindChat(binding) {
  chat = binding;
  placeholder = binding.input.placeholder;
}
const notify = (text) => chat?.notify?.(text);

const KEY_HOLD = config.keys?.hold ?? 'F8';
const KEY_TOGGLE = config.keys?.toggle ?? 'F9';
function paintPlaceholder() {
  if (!chat) return;
  const text = {
    starting: 'Starting voice...',
    listening: `Hold ${KEY_HOLD} or press ${KEY_TOGGLE} to talk`,
    hearing: talk === 'hold' ? `Release ${KEY_HOLD} to send` : `Press ${KEY_TOGGLE} to send`,
  }[phase];
  chat.input.placeholder = text ?? placeholder;
}

// --- speaking ------------------------------------------------------------
const speaker = createSpeaker({
  onLevel: (v) => setSpeechLevel(v),
  // The first sound is about to play: from here the microphone would hear it, so stop listening.
  onStart: () => { if (listener) { listener.pause(); setPhase('speaking'); } },
  onBusy: (busy) => {
    if (!busy) {
      // A spoken status line ("loading the model") ended but the answer is still being made: listen
      // again (and keep the take-back window open) instead of waiting for the answer's speech.
      if (turnActive && !replyQueued && listener) resumeWhileWaiting();
      else afterSpeech();
      if (!listener) scheduleIdleStop();
    }
    updateTone();
  },
  onError: (message) => notify(`Voice: ${message}`),
});

let turnActive = false; // a reply is being generated for the current message
let replyQueued = false; // some of the real answer has been handed to the speaker

function resumeWhileWaiting() {
  const mine = listener;
  setTimeout(() => {
    if (listener !== mine || !turnActive || replyQueued || speaker.busy || phase !== 'speaking') return;
    listener.resume();
    setPhase('thinking');
  }, RESUME_DELAY_MS);
}

// --- waiting feedback: a repeating soft note and short spoken status lines ----------------------
// Only for a voice conversation (the microphone is on) or when typed messages are spoken too.
const tone = createThinkingTone();
let toneTimer = 0;
const voiceActive = () => !!listener || prefs.speakTyped;
const wantTone = () => turnActive && !replyQueued && prefs.ping && !speaker.busy && voiceActive();
function updateTone() {
  clearTimeout(toneTimer);
  if (!wantTone()) { tone.stop(); return; }
  if (!tone.running) toneTimer = setTimeout(() => { if (wantTone()) tone.start(); }, TONE_DELAY_MS);
}

const announce = (text) => {
  if (!voiceActive() || replyQueued) return;
  speaker.speak(text, { voice: prefs.voice, speed: prefs.speed });
};

// What the user calls the model that is loading.
const MODEL_NAMES = { visual: 'vision', abliterated: 'alternate' };
const modelName = (key) => {
  const preset = Object.entries(models.models).find(([, m]) => m.model === key)?.[0];
  return MODEL_NAMES[preset] ?? preset ?? 'new';
};
const LOADING_LINES = ['Alright, loading the {m} model in.', 'One moment, bringing the {m} model in.'];
const THINKING_LINES = ["Okay, I'm thinking about how to do this.", 'Okay, let me think this through.'];
let lineCount = 0;
const nextLine = (lines) => lines[lineCount++ % lines.length];

// A swap is announced once, when it starts (llm-client emits unloading, then loading, then idle).
let swapAnnounced = false;
onModelEvent((e) => {
  if (e.type !== 'phase') return;
  if (e.phase === 'idle') { swapAnnounced = false; return; }
  if (swapAnnounced) return;
  swapAnnounced = true;
  // The event names the model being unloaded first; what is coming in is the current preset.
  announce(nextLine(LOADING_LINES).replace('{m}', modelName(getPreset().model)));
});

// Back to listening once the reply is complete and the last word has been said.
function afterSpeech() {
  if (turnActive || speaker.busy || !listener) return;
  setPhase('busy'); // the room's tail of the last word
  const mine = listener;
  setTimeout(() => {
    if (listener !== mine || turnActive || speaker.busy || phase !== 'busy') return;
    listener.resume();
    setPhase('listening');
  }, RESUME_DELAY_MS);
}

// Called by the chat for every reply. Returns null when nothing should be spoken, else an object
// to feed: push(visibleContentSoFar) while it streams, end(finalContent), abort() on failure.
export function beginTurn() {
  turnActive = true;
  replyQueued = false;
  turnMuted = false;
  if (listener) setPhase('thinking'); // still listening; a talk started now is sent as its own message
  if (!listener && !prefs.speakTyped) { turnActive = false; return null; }
  const sentences = createSentenceStream();
  let thinkTimer = 0;
  let thoughtSaid = false;
  const say = (list) => {
    if (!list.length || turnMuted) return;
    replyQueued = true; // the real answer has begun: no more waiting sounds or status lines
    clearTimeout(thinkTimer);
    updateTone();
    list.forEach((s) => speaker.speak(s, { voice: prefs.voice, speed: prefs.speed }));
  };
  const finish = () => {
    turnActive = false;
    clearTimeout(thinkTimer);
    updateTone();
    if (!speaker.busy) afterSpeech();
  };
  updateTone();
  return {
    push(content) { say(sentences.push(content)); },
    end(content) { say(sentences.push(content, { final: true })); finish(); },
    abort() { speaker.cancel(); finish(); },
    // The model has started reasoning. If that goes on for a while, say so once.
    thinking() {
      if (thoughtSaid || thinkTimer) return;
      thinkTimer = setTimeout(() => {
        thoughtSaid = true;
        if (turnActive && !replyQueued) announce(nextLine(THINKING_LINES));
      }, THINK_LINE_AFTER_MS);
    },
  };
}

export function stopSpeaking() {
  speaker.cancel();
}

// --- freeing the speech models when voice is not in use ---------------------
// The sidecar holds about 1.2 GB of RAM (no VRAM, no CPU while idle). With the microphone off and
// typed replies not spoken it is stopped after a quiet spell (desktop app only: the Rust side
// started it); the next use of the microphone starts it again (about 3 s, "STARTING VOICE...").
// 5 minutes, not 15 s: with the talk keys the sidecar is started by a key press, and starting it
// takes about 3 s, which is a long wait to repeat every time the microphone has been off for a moment.
const IDLE_STOP_MS = 5 * 60 * 1000;
let idleStopTimer = 0;
function scheduleIdleStop() {
  clearTimeout(idleStopTimer);
  idleStopTimer = setTimeout(async () => {
    if (listener || prefs.speakTyped || speaker.busy || phase === 'starting' || !window.__TAURI_INTERNALS__) return;
    try {
      await invoke('voice_stop');
    } catch { /* nothing to stop */ }
  }, IDLE_STOP_MS);
}

// --- listening -----------------------------------------------------------
let listener = null;
let startToken = 0;
let prefix = ''; // what was already in the field when this utterance began

const setField = (text) => {
  chat.input.value = text;
  chat.input.dispatchEvent(new Event('input')); // lets the field grow or shrink
};

// The words of the talk so far appear in the field, after whatever was typed before the talk began.
function onPartial(text) {
  if (!chat || !text || !talk) return;
  if (phase === 'busy' || phase === 'speaking') return;
  setField(prefix ? `${prefix} ${text}` : text);
}

// The flush after a talk ends (the sidecar always answers it). Sent only if something was heard;
// otherwise the field keeps what was typed before the talk, and nothing is sent.
function onFinal(text) {
  if (!chat) return;
  const heard = (text ?? '').trim();
  const before = prefix;
  prefix = '';
  setPhase('listening');
  if (!heard) { setField(before); return; }
  setField([before, heard].filter(Boolean).join(' '));
  chat.submit(); // when a reply is still in flight the message is sent after it, see chat-ui.js
}

// Key talk: 'hold' while the hold key is down, 'toggle' between two presses of the toggle key.
function beginTalk(mode) {
  if (!getSwitches().mic) { pendingTalk = mode; setMic(true).catch((e) => notify(`Voice offline: ${e.message}`)); return; }
  if (!listener) { pendingTalk = mode; return; } // still starting: onStartDone picks it up
  if (talk) return;
  // Pressing a talk key while JARVIS is speaking takes over: the speech stops at once (so the
  // microphone cannot hear it) and the rest of that reply is not spoken.
  if (phase === 'busy' || phase === 'speaking' || speaker.busy) {
    turnMuted = true;
    speaker.cancel();
    tone.stop();
    listener.resume();
  }
  talk = mode;
  talkStartedAt = performance.now();
  prefix = chat.input.value.trim();
  listener.setSending(true);
  setPhase('hearing');
  setTalking(true);
  paintPlaceholder();
}

function endTalk() {
  if (!talk) return;
  talk = null;
  listener?.setSending(false);
  listener?.flush(); // the final answer arrives in onFinal
  const peak = setTalking(false);
  // A talk of half a second or more in which the microphone gave nothing: say so, because from the
  // outside that looks exactly like "it is not listening".
  if (isSilent(peak) && performance.now() - talkStartedAt > 500) {
    notify('VOICE: the microphone gave no sound. Check the input device in Windows (Settings, System, Sound, Input) and that JARVIS may use the microphone.');
  }
  paintPlaceholder();
}

// Keys. Function keys only: typing is never affected. Holding repeats keydown, so e.repeat is ignored.
document.addEventListener('keydown', (e) => {
  if (e.repeat || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === KEY_HOLD) { e.preventDefault(); if (!talk) beginTalk('hold'); }
  else if (e.key === KEY_TOGGLE) { e.preventDefault(); if (talk) endTalk(); else beginTalk('toggle'); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === KEY_HOLD && talk === 'hold') endTalk();
});
window.addEventListener('blur', endTalk); // a key released while another window had focus is never seen

// Speech in a language that is not allowed was heard and dropped by the sidecar (config asr.languages).
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', it: 'Italian' };
let lastIgnoredNote = 0;
function onIgnored() {
  if (talk) { talk = null; setTalking(false); } // the flush is answered by this instead of a final text
  if (phase === 'hearing') onFinal(''); // nothing of it stays in the field
  if (performance.now() - lastIgnoredNote < 15000) return; // say it at most every 15 s
  lastIgnoredNote = performance.now();
  const names = getAllowedLanguages().map((c) => LANGUAGE_NAMES[c] ?? c);
  notify(`VOICE: ignored speech that was not ${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);
}

async function startListening() {
  clearTimeout(idleStopTimer);
  const token = ++startToken;
  setPhase('starting');
  speaker.prime(); // the mic click is a user gesture: let audio play later without one
  let created = null;
  try {
    const health = await ensureSidecar({ need: ['asr'] }); // listening does not wait for the synthesizer
    if (token !== startToken) return;
    if (health.asr.state !== 'ready') throw new Error(health.asr.message ?? `speech recognition is ${health.asr.state}`);
    const stream = getMicStream();
    if (!stream) throw new Error('the microphone is not open');
    created = await createListener({
      stream,
      language: prefs.language,
      onPartial,
      onFinal,
      onIgnored,
      onError: (m) => notify(`VOICE: ${m}`),
      onClose: () => { if (listener === created) failed('the voice sidecar went away'); },
    });
    if (token !== startToken) { created.close(); return; }
    listener = created;
    attach(listener);
    setPhase('listening');
    if (pendingTalk) { const mode = pendingTalk; pendingTalk = null; beginTalk(mode); }
  } catch (e) {
    created?.close();
    if (token === startToken) failed(e.message);
  }
}

function failed(message) {
  stopListening();
  voiceError = message;
  reportService('voice', 'error', message);
  notify(`VOICE OFFLINE: ${message}`);
  setMic(false).catch(() => {});
}

function stopListening() {
  startToken += 1; // abandons a start that is still waiting for the sidecar
  listener?.close();
  listener = null;
  detach();
  talk = null;
  pendingTalk = null;
  prefix = '';
  speaker.cancel();
  turnActive = false;
  updateTone();
  setPhase('off');
  scheduleIdleStop();
}

onSwitchChange((s) => {
  if (s.mic && !listener && phase !== 'starting') startListening();
  else if (!s.mic && (listener || phase === 'starting')) stopListening();
});
if (getSwitches().mic) startListening();

// --- settings (slash commands) -------------------------------------------
export async function voices() {
  await ensureSidecar();
  return listVoices();
}

export async function setVoice(name) {
  const { voices: all } = await voices();
  if (!all.includes(name)) throw new Error(`unknown voice "${name}", try /voices`);
  prefs.voice = name;
  persist();
  clearTimeout(idleStopTimer);
  speaker.prime();
  speaker.speak('Good evening. This is how I sound.', { voice: name, speed: prefs.speed });
}

export function setSpeed(value) {
  const v = Number(value);
  if (!(v >= 0.5 && v <= 2)) throw new Error('speed is a number from 0.5 to 2');
  prefs.speed = v;
  persist();
}

export function setSpeakTyped(on) {
  prefs.speakTyped = on;
  persist();
  if (on) clearTimeout(idleStopTimer); else if (!listener) scheduleIdleStop();
}

export function setPing(on) {
  prefs.ping = on;
  persist();
  updateTone();
}

export function setLanguage(code) {
  prefs.language = code;
  persist();
  listener?.setLanguage(code);
}
