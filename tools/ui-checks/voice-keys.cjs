// Talk keys end to end in real Chrome: a fake microphone plays a question spoken by Kokoro; the test
// holds F8 while it plays; Nemotron transcribes it into the field; releasing F8 sends it to a STUBBED
// LM Studio (the real one is never touched). Also checks F9 (press to start, press again to send),
// that nothing is sent without a key, and the waveform and the reaction while talking.
//
// Needs: the dev server (http://localhost:5173) and the voice sidecar (`npm run voice`, or the
// running app). Exits 1 when a check fails. Replaces voice-flow.cjs, which assumed automatic sending.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const QUESTION = 'Hello JARVIS. What is two plus two?';
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

  // The "microphone": 4 s of silence, the question, then silence. Chrome loops the file.
  const speech = await synthesize(QUESTION, { voice: 'af_heart' });
  const s16 = resample(speech.samples, speech.sampleRate, 16000);
  const questionS = s16.length / 16000;
  const mic = new Float32Array(16000 * 4 + s16.length + 16000 * 6);
  mic.set(s16, 16000 * 4);
  const wavPath = path.join(os.tmpdir(), 'jarvis-fake-mic.wav');
  fs.writeFileSync(wavPath, wav16(mic, 16000));

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/transformCallback|currentWindow|plugin:/.test(String(e))) errors.push(String(e).slice(0, 300)); });
  page.on('console', (m) => { if (m.type() === 'error' && /voice|mic|asr/i.test(m.text())) console.log('console error:', m.text().slice(0, 200)); });

  const sent = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await page.route('http://localhost:1234/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    if (url.endsWith('/api/v1/models')) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [{ type: 'llm', key: 'qwen/qwen3-14b', loaded_instances: [{ id: 'qwen/qwen3-14b' }] }] }) });
    if (url.endsWith('/v1/chat/completions')) {
      sent.push(JSON.parse(req.postData()));
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Four. That is simple arithmetic, and here is a longer sentence so that the reply is still being spoken when the next key press arrives.' } }] })}\n\ndata: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`;
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  const asrFrames = [];
  page.on('websocket', (ws) => { if (ws.url().endsWith('/asr')) ws.on('framesent', (f) => { if (typeof f.payload !== 'string') asrFrames.push(Date.now()); }); });

  await page.goto(process.env.APP_URL || 'http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const placeholder = () => page.evaluate(() => document.getElementById('hud-chat-input').placeholder);
  check('placeholder at rest', (await placeholder()) === 'MESSAGE JARVIS', await placeholder());

  // Turn the microphone on from the dock, then wait until it listens (the file starts playing when the stream opens).
  const tMic = Date.now();
  await page.click('#dock-mic');
  await page.waitForFunction(() => /^HOLD F8/.test(document.getElementById('hud-chat-input').placeholder), null, { timeout: 20000 }).catch(() => {});
  check('mic on: the field says how to talk', /^HOLD F8 OR PRESS F9/.test(await placeholder()), await placeholder());

  // No key pressed yet: while the question is played, nothing must reach the recognizer or the model.
  await page.waitForTimeout(Math.max(0, 4000 + questionS * 1000 + 800 - (Date.now() - tMic)));
  check('nothing is sent to the recognizer without a key', asrFrames.length === 0, `${asrFrames.length} frames`);
  check('and nothing is sent to the model', sent.length === 0);

  // The file loops: its next question starts 10 s + questionS after the first. Hold F8 across it.
  const loopS = 4 + questionS + 6;
  const nextStart = tMic + (loopS + 4) * 1000;
  await page.waitForTimeout(Math.max(0, nextStart - 800 - Date.now()));
  await page.keyboard.down('F8');
  await page.waitForTimeout(150);
  check('holding F8 shows the release hint', /^RELEASE F8/.test(await placeholder()), await placeholder());
  const wave = await page.evaluate(() => { const c = document.getElementById('voice-wave'); return c ? { shown: c.classList.contains('on'), w: c.width, h: c.height } : null; });
  check('the waveform is shown while talking', !!wave && wave.shown && wave.w > 0, JSON.stringify(wave));
  check('the dock mic shows that it is recording', await page.evaluate(() => document.getElementById('dock-mic').classList.contains('recording')));
  await page.waitForTimeout(2500); // into the question
  const midField = await page.inputValue('#hud-chat-input');
  const ink = await page.evaluate(() => { const c = document.getElementById('voice-wave'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; });
  check('the waveform draws while the voice plays', ink > 200, `${ink} lit pixels`);
  await page.screenshot({ path: path.join(__dirname, 'voice-talking.png') });
  await page.waitForTimeout(Math.max(0, nextStart + questionS * 1000 + 600 - Date.now()));
  console.log('field while talking:', JSON.stringify(midField));
  check('words appear in the field while talking', /two|jarvis|hello/i.test(midField), JSON.stringify(midField));
  await page.keyboard.up('F8');
  await page.waitForSelector('.chat-line.user', { timeout: 15000 }).catch(() => {});
  const userLine = await page.evaluate(() => document.querySelector('.chat-line.user .chat-text')?.textContent ?? null);
  console.log('user line:', JSON.stringify(userLine));
  check('releasing F8 sent the question', !!userLine && /two plus two/i.test(userLine), JSON.stringify(userLine));
  check('the reply came back', await page.waitForFunction(() => document.querySelector('.chat-line.assistant') !== null, null, { timeout: 15000 }).then(() => true, () => false));
  // Pressing the talk key while the reply is being spoken takes over instead of being ignored.
  await page.waitForTimeout(700);
  await page.keyboard.down('F8');
  await page.waitForTimeout(250);
  check('F8 while JARVIS speaks starts a talk and stops the speech', /^RELEASE F8/.test(await placeholder()), await placeholder());
  await page.keyboard.up('F8');
  await page.waitForTimeout(1200);
  check('the waveform is gone after release', await page.evaluate(() => !document.getElementById('voice-wave')?.classList.contains('on')));
  check('and the dock mic is no longer recording', await page.evaluate(() => !document.getElementById('dock-mic').classList.contains('recording')));

  // F9: press to start, press again to send. Nothing is said: the field must stay as typed and nothing is sent.
  await page.waitForTimeout(3000); // let the spoken reply finish
  const before = sent.length;
  await page.fill('#hud-chat-input', 'typed draft');
  await page.keyboard.press('F9');
  await page.waitForTimeout(300);
  check('F9 starts a talk', /^PRESS F9 TO SEND/.test(await placeholder()), await placeholder());
  await page.keyboard.press('F9');
  await page.waitForTimeout(1500);
  check('F9 again ends it', /^HOLD F8/.test(await placeholder()), await placeholder());
  check('an empty talk sends nothing and keeps the typed draft', sent.length === before && (await page.inputValue('#hud-chat-input')) === 'typed draft', `${sent.length} vs ${before}, field ${JSON.stringify(await page.inputValue('#hud-chat-input'))}`);

  await page.click('#dock-mic');
  await page.waitForTimeout(500);
  check('placeholder restored when the mic is off', (await placeholder()) === 'MESSAGE JARVIS', await placeholder());
  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
