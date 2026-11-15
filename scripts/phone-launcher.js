// The page the phone's home-screen icon opens (served by the PC's starter, port 7411, which runs even when the JARVIS server does not).
// From the home screen it starts the server if it is down, waits for it, and moves on to the app. In Safari (first visit) it explains how to
// put the icon on the home screen first. It holds no secrets: the key comes from the address after "#", which is never sent anywhere, and
// every request it makes to the starter carries it. Plain system colours only (Canvas, CanvasText): it follows the iPhone's appearance.
export function launcherHtml({ serverPort }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="JARVIS">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>JARVIS</title>
<style>
  html { background: Canvas; color: CanvasText; font: 16px/24px -apple-system, system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
  body { margin: 0; min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 24px; text-align: center; }
  h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
  p { margin: 0; max-width: 30ch; opacity: 0.7; }
  button { margin-top: 12px; min-height: 48px; padding: 0 24px; border: 0; border-radius: 12px; background: AccentColor; color: AccentColorText; font: inherit; font-weight: 600; }
  [hidden] { display: none; }
</style>
</head>
<body>
<h1 id="title">JARVIS</h1>
<p id="note"></p>
<button id="go" hidden>Open JARVIS</button>
<script>
const SERVER_PORT = ${serverPort};
const token = new URLSearchParams(location.hash.slice(1)).get('token');
const $ = (id) => document.getElementById(id);
const say = (title, note) => { $('title').textContent = title; $('note').textContent = note || ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { authorization: 'Bearer ' + token };
const appUrl = location.protocol + '//' + location.hostname + ':' + SERVER_PORT + '/mobile.html#token=' + token;
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

async function status() { try { const r = await fetch('/health', { headers }); return r.ok ? await r.json() : null; } catch { return null; } }
async function run() {
  if (!token) { say('One more step', 'Open the phone link from your PC (node scripts/client-link.js). It has the key in it.'); return; }
  let h = await status();
  if (!h) { say('Cannot reach your PC', 'Is it on, and is Tailscale connected on this phone?'); $('go').hidden = false; $('go').textContent = 'Try again'; $('go').onclick = () => location.reload(); return; }
  if (!h.server) {
    say('Starting JARVIS on your PC...', 'This takes a few seconds.');
    await fetch('/start', { method: 'POST', headers }).catch(() => {});
    for (let i = 0; i < 60 && !(h && h.server); i++) { await sleep(2000); h = await status(); }
  }
  if (h && h.server) location.replace(appUrl);
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
