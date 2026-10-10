// Waiting feedback in real Chrome: a fake microphone asks for something, a STUBBED LM Studio (a tiny
// server of this script; the real one is never touched) first has to swap models (slow unload and
// load), then reasons for several seconds, then answers. Expect: a spoken "loading the ... model"
// line, the microphone listening again afterwards, a repeating soft note while it waits, a spoken
// "thinking" line after a while, the note gone once the answer is spoken.
//
// Needs a voice sidecar on JARVIS_VOICE_PORT (default 8765) and the app on APP_URL (default
// http://localhost:5173):  JARVIS_VOICE_PORT=18770 APP_URL=http://localhost:5199 node voice-wait.cjs
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STUB_PORT = 19234;
const QUESTION = 'Please make me a simple page about the planets.';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wav16(samples, rate) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// A tiny LM Studio: the 27B is loaded, the app wants the 14B, so it must unload and load.
const lm = { loaded: ['qwen/qwen3.8-27b'], calls: [] };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (d) => (s += d)).on('end', () => resolve(s ? JSON.parse(s) : {})); });
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
  const json = (obj) => { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/v1/models') {
    return json({ models: ['qwen/qwen3-14b', 'qwen/qwen3.8-27b'].map((key) => ({ type: 'llm', key, loaded_instances: lm.loaded.includes(key) ? [{ id: key }] : [] })) });
  }
  if (req.url === '/api/v1/models/unload') { const b = await body(req); lm.calls.push('unload'); await sleep(1500); lm.loaded = lm.loaded.filter((k) => k !== b.instance_id); return json({}); }
  if (req.url === '/api/v1/models/load') { const b = await body(req); lm.calls.push('load'); await sleep(2500); lm.loaded = [b.model]; return json({}); }
  if (req.url === '/v1/chat/completions') {
    await body(req);
    lm.calls.push('chat');
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    for (let i = 0; i < 9; i++) { send({ reasoning_content: `Thinking about the layout, step ${i + 1}. ` }); await sleep(600); } // about 5.4 s of reasoning
    send({ content: 'Here is a simple page about the planets. It lists all eight of them.' });
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  res.writeHead(404, cors).end('{}');
});

(async () => {
  const { synthesize, resample, health } = await import('../tests/voice-helpers.mjs');
  const h = await health().catch(() => null);
  if (!h || h.asr.state !== 'ready' || h.tts.state !== 'ready') { console.log('voice sidecar is not ready:', JSON.stringify(h)); process.exit(1); }
  await new Promise((r) => server.listen(STUB_PORT, '127.0.0.1', r));

  const q = resample((await synthesize(QUESTION, { voice: 'af_heart' })).samples, 24000, 16000);
  const mic = new Float32Array(16000 * 4 + q.length + 16000 * 40);
  mic.set(q, 16000 * 4);
  const wavPath = path.join(os.tmpdir(), 'jarvis-fake-mic-wait.wav');
  fs.writeFileSync(wavPath, wav16(mic, 16000));

  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['microphone'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => { if (!String(e).includes('transformCallback')) console.log('pageerror', String(e).slice(0, 300)); });
  await page.addInitScript((p) => localStorage.setItem('jarvis.voice.port', String(p)), process.env.JARVIS_VOICE_PORT || 8765);

  // Count the looping note (the only looping buffer source) and when it starts and stops.
  await page.addInitScript(() => {
    window.__tone = { events: [] };
    const t0 = performance.now();
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...a) { if (this.loop) window.__tone.events.push(['start', Math.round(performance.now() - t0)]); return start.apply(this, a); };
    AudioBufferSourceNode.prototype.stop = function (...a) { if (this.loop) window.__tone.events.push(['stop', Math.round(performance.now() - t0)]); return stop.apply(this, a); };
  });

  // The app thinks LM Studio is on :1234; send those requests to the stub.
  await page.route('http://localhost:1234/**', (route) => route.continue({ url: route.request().url().replace('localhost:1234', `127.0.0.1:${STUB_PORT}`) }));

  const spoken = [];
  const t0 = Date.now();
  page.on('websocket', (ws) => {
    if (ws.url().endsWith('/tts')) ws.on('framesent', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'speak') spoken.push({ text: m.text, at: Date.now() - t0 }); } catch { /* binary */ } });
  });

  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.click('#dock-mic');
  await page.waitForFunction(() => document.getElementById('hud-chat-input').placeholder === 'LISTENING...', null, { timeout: 20000 }).catch(() => {});

  // Wait for the whole exchange: the answer is spoken last.
  await page.waitForFunction(() => document.querySelectorAll('.chat-line.assistant .md').length >= 1, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(6000); // let the answer be spoken
  const tone = await page.evaluate(() => window.__tone.events);
  console.log('spoken:', JSON.stringify(spoken));
  console.log('tone events (ms since page load):', JSON.stringify(tone));
  console.log('stub saw:', JSON.stringify(lm.calls));

  check('the app had to swap models (stub saw unload, load, chat)', ['unload', 'load', 'chat'].every((c) => lm.calls.includes(c)), JSON.stringify(lm.calls));
  const loadingLine = spoken.find((s) => /loading the general model in|bringing the general model in/i.test(s.text));
  check('it said it is loading the (general) model', !!loadingLine, JSON.stringify(spoken[0]));
  const thinkingLine = spoken.find((s) => /thinking about how|think this through/i.test(s.text));
  check('it said it is thinking, after the reasoning had gone on for a while', !!thinkingLine && !!loadingLine && thinkingLine.at > loadingLine.at, JSON.stringify(thinkingLine));
  const answer = spoken.find((s) => /simple page about the planets/i.test(s.text));
  check('the answer was spoken after both status lines', !!answer && !!thinkingLine && answer.at > thinkingLine.at, JSON.stringify(answer));
  check('the repeating note started while waiting', tone.some((e) => e[0] === 'start'), JSON.stringify(tone));
  const lastStart = [...tone].reverse().find((e) => e[0] === 'start');
  const lastStop = [...tone].reverse().find((e) => e[0] === 'stop');
  check('and it was stopped again before the answer ended', !!lastStart && !!lastStop && lastStop[1] >= lastStart[1], JSON.stringify([lastStart, lastStop]));
  const placeholder = await page.evaluate(() => document.getElementById('hud-chat-input').placeholder);
  check('listening again at the end', placeholder === 'LISTENING...', placeholder);

  await page.click('#dock-mic');
  await browser.close();
  server.close();
  const failed = checks.filter((c) => !c).length;
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
