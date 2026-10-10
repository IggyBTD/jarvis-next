// End-to-end attachment check against the real LM Studio model: attach files through the real
// file input, send a question, print what was sent and what the model answered.
// Usage: node attach-flow.cjs "<question>" <file> [file...]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [question, ...files] = process.argv.slice(2);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const sent = [];
  page.on('request', (r) => { if (r.url().includes('/chat/completions')) sent.push(r.postData()); });
  page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.setInputFiles('#attach-input', files.map((f) => path.resolve(f)));
  await page.waitForTimeout(1500);
  console.log('chips:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.attach-chip')].map((c) => c.textContent))));
  console.log('attach title:', await page.getAttribute('#dock-attach', 'title'));
  await page.fill('#hud-chat-input', question);
  await page.press('#hud-chat-input', 'Enter');
  await page.waitForFunction(() => document.querySelector('.chat-line.assistant .chat-meta') || document.querySelector('.chat-line.error'), null, { timeout: 240000 });
  const body = sent.length ? JSON.parse(sent[sent.length - 1]) : null;
  const user = body?.messages?.filter((m) => m.role === 'user').pop();
  const shown = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content?.map((p) => (p.type === 'text' ? p.text : `[${p.type} ${p.image_url.url.slice(0, 40)}... ${p.image_url.url.length} chars]`)));
  console.log('model:', body?.model);
  console.log('user message sent (first 600):', String(shown).slice(0, 600));
  console.log('reply:', await page.evaluate(() => (document.querySelector('.chat-line.error') || [...document.querySelectorAll('.chat-line.assistant')].pop()).innerText.slice(0, 700)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
