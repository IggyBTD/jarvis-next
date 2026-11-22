// The page the phone's home-screen icon opens (served by the PC's starter, port 7411, which runs even when the JARVIS server does not).
// From the home screen it starts the server if it is down, waits for it, and moves on to the app. In Safari (first visit) it explains how to
// put the icon on the home screen first. It holds no secrets: it is paired once with a short code and keeps its own token in its own
// storage, which every request it makes to the starter carries. Plain system colours only (Canvas, CanvasText): it follows the iPhone's appearance.
export function launcherHtml({ serverPort }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="JARVIS">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>JARVIS</title>
<style>
  html { background: Canvas; color: CanvasText; font: 16px/24px -apple-system, system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
  body { margin: 0; min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; }
  h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
  p { margin: 0; max-width: 30ch; opacity: 0.7; }
  button { margin-top: 12px; min-height: 48px; padding: 0 24px; border: 0; border-radius: 12px; background: AccentColor; color: AccentColorText; font: inherit; font-weight: 600; }
  input { min-height: 48px; padding: 0 12px; border: 1px solid GrayText; border-radius: 12px; background: Field; color: FieldText; font: inherit; letter-spacing: 0.1em; text-align: center; width: 12ch; }
  [hidden] { display: none; }
</style>
</head>
<body>
<h1 id="title">JARVIS</h1>
<p id="note"></p>
<form id="pair" hidden><input id="code" placeholder="XXXX-XXXX" maxlength="9" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Pairing code"> <button type="submit">Pair</button></form>
<button id="go" hidden>Open JARVIS</button>
<script>
const SERVER_PORT = ${serverPort};
const KEY = 'jarvis.launcher';
const store = { get: () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }, set: (v) => { try { localStorage.setItem(KEY, v); } catch {} } };
// An old link with the shared key after "#" still works once: the key is kept here and taken out of the address at once.
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromHash) { store.set(fromHash); history.replaceState(null, '', location.pathname + (location.hash.includes('go') ? '#go' : '')); }
let token = store.get();
const $ = (id) => document.getElementById(id);
const say = (title, note) => { $('title').textContent = title; $('note').textContent = note || ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = () => ({ authorization: 'Bearer ' + token });
const serverOrigin = location.protocol + '//' + location.hostname + ':' + SERVER_PORT;
const appUrl = serverOrigin + '/mobile.html'; // the app keeps its own token (it is paired with its own code); nothing secret in the address
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// Pairing: a short code from the PC (node scripts/client-link.js phone), typed here. The token comes back in the answer body only.
function askCode() {
  say('Pair this phone', 'On your PC run: node scripts/client-link.js phone. Type the first code here.');
  $('pair').hidden = false;
  $('code').focus();
  $('pair').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch(serverOrigin + '/api/devices/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('code').value, name: 'iPhone launcher' }) }).then((x) => x.json()).catch(() => ({ error: 'the PC did not answer (is JARVIS running on it?)' }));
    if (!r.token) { $('note').textContent = 'Not paired: ' + (r.error || 'try again'); return; }
    store.set(r.token); token = r.token; $('pair').hidden = true; run();
  };
}

async function status() { try { const r = await fetch('/health', { headers: headers() }); return r.ok ? await r.json() : r.status === 401 ? 'refused' : null; } catch { return null; } }
async function run() {
  if (!token) { askCode(); return; }
  let h = await status();
  if (h === 'refused') { token = ''; store.set(''); askCode(); return; } // revoked or rotated: pair again
  if (!h) { say('Cannot reach your PC', 'Is it on, and is Tailscale connected on this phone?'); $('go').hidden = false; $('go').textContent = 'Try again'; $('go').onclick = () => location.reload(); return; }
  if (!h.server) {
    say('Starting JARVIS on your PC...', 'This takes a few seconds.');
    await fetch('/start', { method: 'POST', headers: headers() }).catch(() => {});
    for (let i = 0; i < 60 && !(h && h.server); i++) { await sleep(2000); h = await status(); }
  }
  if (h && h.server) location.replace(appUrl + '?t=' + Date.now()); // a fresh address each time: Safari never shows a saved copy of the app
  else { say('JARVIS did not start', 'Check the PC.'); $('go').hidden = false; $('go').textContent = 'Try again'; $('go').onclick = () => location.reload(); }
}

if (standalone || location.hash.includes('go')) run();
else {
  // first visit in Safari: put the icon on the home screen first, so every later start goes through this page
  say('Add JARVIS to your home screen', 'Tap the Share button in Safari, then Add to Home Screen. After that, open JARVIS from your home screen: it starts your PC\\'s server if it is off.');
  $('go').hidden = false;
  $('go').textContent = 'Open JARVIS now';
  $('go').onclick = () => { $('go').hidden = true; run(); };
}
</script>
</body>
</html>
`;
}
