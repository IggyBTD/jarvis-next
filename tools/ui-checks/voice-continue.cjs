// Carrying on after a pause that only sounded like the end of the sentence. The fake microphone
// says "I want to see a solar system where I can look around", pauses 1.3 s, then "and also zoom
// in on any planet". LM Studio is STUBBED and answers slowly (the real one is never touched).
// Expect: the first part is sent, then taken back when the speaker carries on, and ONE message with
// both parts is sent; the transcript shows a single user line and a single reply.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PART_A = 'I want to see a solar system where I can look around.';
const PART_B = 'And also zoom in on any planet.';
const checks = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); };

function wav16(samples, rate) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

(async () => {
  const { synthesize, resample, health } = await import('../tests/voice-helpers.mjs');
  const h = await health().catch(() => null);
  if (!h || h.asr.state !== 'ready' || h.tts.state !== 'ready') { console.log('voice sidecar is not ready:', JSON.stringify(h)); process.exit(1); }

  const a = resample((await synthesize(PART_A, { voice: 'af_heart' })).samples, 24000, 16000);
  const b = resample((await synthesize(PART_B, { voice: 'af_heart' })).samples, 24000, 16000);
  const gap = 16000 * 1.3;
  const mic = new Float32Array(16000 * 4 + a.length + gap + b.length + 16000 * 10);
  mic.set(a, 16000 * 4);
  mic.set(b, 16000 * 4 + a.length + gap);
  const wavPath = path.join(os.tmpdir(), 'jarvis-fake-mic-continue.wav');
  fs.writeFileSync(wavPath, wav16(mic, 16000));

  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['microphone'] });
  const page = await context.newPage();
  await page.addInitScript((p) => localStorage.setItem('jarvis.voice.port', String(p)), process.env.JARVIS_VOICE_PORT || 8765);
  page.on('pageerror', (e) => { if (!String(e).includes('transformCallback')) console.log('pageerror', String(e).slice(0, 300)); });

  const requests = []; // every chat request: { text, finished }
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await page.route('http://localhost:1234/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    if (url.endsWith('/api/v1/models')) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [{ type: 'llm', key: 'qwen/qwen3-14b', loaded_instances: [{ id: 'qwen/qwen3-14b' }] }] }) });
    if (url.endsWith('/v1/chat/completions')) {
      const body = JSON.parse(req.postData());
      const entry = { text: body.messages.at(-1).content, finished: false };
      requests.push(entry);
      await new Promise((r) => setTimeout(r, 5000)); // a slow model: the window to carry on
      entry.finished = true;
      const reply = 'Here is a solar system you can look around in, with zoom.';
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.click('#dock-mic');
  await page.waitForFunction(() => document.getElementById('hud-chat-input').placeholder === 'LISTENING...', null, { timeout: 20000 }).catch(() => {});

  // The merged message is sent as the second request.
  await page.waitForFunction(() => document.querySelectorAll('.chat-line.assistant .md').length >= 1, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  console.log('requests:', JSON.stringify(requests));
  check('two requests were made: the early one and the merged one', requests.length === 2, `${requests.length}`);
  check('the early request carried only the first part', !!requests[0] && /look around/i.test(requests[0].text) && !/zoom/i.test(requests[0].text), JSON.stringify(requests[0]?.text));
  check('the second request carries both parts', !!requests[1] && /look around/i.test(requests[1].text) && /zoom/i.test(requests[1].text), JSON.stringify(requests[1]?.text));
  const lines = await page.evaluate(() => [...document.querySelectorAll('.chat-line')].map((l) => `${l.classList.contains('user') ? 'user' : l.classList.contains('assistant') ? 'assistant' : l.className}: ${l.querySelector('.chat-text')?.textContent.slice(0, 120)}`));
  console.log('transcript:', JSON.stringify(lines));
  check('the transcript shows one user message and one reply', lines.filter((l) => l.startsWith('user')).length === 1 && lines.filter((l) => l.startsWith('assistant')).length === 1, JSON.stringify(lines));
  check('no error line from the cancelled request', !lines.some((l) => /error|FAILURE/i.test(l)));

  await page.click('#dock-mic');
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
