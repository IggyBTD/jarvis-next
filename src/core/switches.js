// Privacy switches: microphone, internet access, network link.
//
// internet: when off, JS-level fetches to anything but this machine are refused.
// link:     when off, ALL JS-level fetches are refused (including LM Studio), so
//           JARVIS is fully cut off. Telemetry runs in Rust and is not affected.
// mic:      when on, the microphone is really opened; when off, every track is
//           stopped so the OS mic indicator goes out. Always starts off.
//
// Every future client (browser, Gmail, ...) must go through window.fetch so
// these switches apply to it too.

const KEY = 'jarvis.switches';
const state = { mic: false, internet: true, link: true };
const listeners = new Set();
let micStream = null;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  if (typeof saved.internet === 'boolean') state.internet = saved.internet;
  if (typeof saved.link === 'boolean') state.link = saved.link;
} catch { /* storage unavailable: defaults */ }

const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify({ internet: state.internet, link: state.link })); } catch { /* ignore */ }
};
const notify = () => listeners.forEach((cb) => cb({ ...state }));

export const getSwitches = () => ({ ...state });
export function onSwitchChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// --- fetch guard ---------------------------------------------------------
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const INTERNAL_HOSTS = /(^|\.)(ipc|tauri|asset)\.localhost$/;

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  let url;
  try {
    url = new URL(typeof input === 'string' ? input : input.url, location.href);
  } catch {
    return nativeFetch(input, init);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return nativeFetch(input, init);
  if (INTERNAL_HOSTS.test(url.hostname) || url.origin === location.origin) return nativeFetch(input, init);
  if (!state.link) return Promise.reject(new TypeError('NETWORK LINK DISABLED'));
  if (!state.internet && !LOCAL_HOSTS.has(url.hostname)) {
    return Promise.reject(new TypeError('INTERNET ACCESS DISABLED'));
  }
  return nativeFetch(input, init);
};

// --- setters -------------------------------------------------------------
export function setInternet(on) {
  state.internet = on;
  persist();
  notify();
}

export function setLink(on) {
  state.link = on;
  persist();
  notify();
}

export async function setMic(on) {
  if (on === state.mic) return;
  if (on) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); // throws if denied
    state.mic = true;
  } else {
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    state.mic = false;
  }
  notify();
}

// Future STT reads the live stream from here; null while the mic is off.
export const getMicStream = () => micStream;
