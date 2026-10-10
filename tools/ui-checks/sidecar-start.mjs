// How long the speech sidecar takes to be ready: recognizer (needed to listen) and synthesizer (needed to speak).
// Starts its own sidecar on port 18767 and polls /health. Needs the models in models/voice.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const t0 = Date.now();
const child = spawn(process.execPath, [path.join(root, 'sidecars', 'voice', 'server.mjs')], { cwd: root, env: { ...process.env, JARVIS_VOICE_PORT: '18767' }, stdio: 'ignore' });
let asr = null; let tts = null;
for (let i = 0; i < 300 && (asr === null || tts === null); i++) {
  try {
    const h = await fetch('http://127.0.0.1:18767/health').then((r) => r.json());
    if (asr === null && h.asr.state !== 'loading') asr = Date.now() - t0;
    if (tts === null && h.tts.state !== 'loading') tts = Date.now() - t0;
  } catch { /* not listening yet */ }
  await new Promise((r) => setTimeout(r, 50));
}
console.log(`recognizer ready after ${asr} ms (listening can start), synthesizer after ${tts} ms (speaking can start)`);
child.kill();
