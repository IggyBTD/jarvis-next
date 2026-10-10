// A silent microphone: holding F8 for a second must say so in the conversation, and send nothing.
// Same setup as voice-keys.cjs (fake microphone file, stubbed LM Studio). Needs the dev server and the voice sidecar.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
(async () => {
  const wav = path.join(os.tmpdir(), 'jarvis-silent-mic.wav');
  const n = 16000 * 10;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(wav, Buffer.concat([h, Buffer.alloc(n * 2)]));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['microphone'] })).newPage();
  let sent = 0;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await page.route('http://localhost:1234/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (route.request().url().endsWith('/api/v1/models')) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [{ type: 'llm', key: 'qwen/qwen3-14b', loaded_instances: [{ id: 'qwen/qwen3-14b' }] }] }) });
    if (route.request().url().endsWith('/v1/chat/completions')) sent++;
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.click('#dock-mic');
  await page.waitForFunction(() => /^HOLD F8/.test(document.getElementById('hud-chat-input').placeholder), null, { timeout: 20000 });
  await page.keyboard.down('F8');
  await page.waitForTimeout(1200);
  await page.keyboard.up('F8');
  await page.waitForTimeout(1500);
  const lines = await page.evaluate(() => [...document.querySelectorAll('#chat-output .chat-line.system')].map((l) => l.textContent));
  const ok = lines.some((l) => /microphone gave no sound/.test(l)) && sent === 0;
  console.log(ok ? 'PASS  a silent microphone is reported and nothing is sent' : `FAIL  lines ${JSON.stringify(lines)} sent ${sent}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
