// Time from pressing Enter to the first words of the reply, for 4 messages in a row, with LM Studio
// stood in by the test (its model list answers after 200 ms like the real one). Counts how many
// times the model list was asked for. Needs the dev server on :5173. Never touches the real LM Studio.
const { chromium } = require('playwright');
const MODEL = 'qwen/qwen3-14b';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  let lists = 0;
  await page.route('http://localhost:1234/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.endsWith('/api/v1/models')) { lists++; await new Promise((r) => setTimeout(r, 200)); return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [{ key: MODEL, type: 'llm', max_context_length: 40960, loaded_instances: [{ id: MODEL, config: { context_length: 32768 } }] }] }) }); }
    if (url.endsWith('/v1/chat/completions')) {
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello there' } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`;
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { transformCallback: () => 0, invoke: async () => { throw new Error('stub'); } }; });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const times = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    await page.fill('#hud-chat-input', `message ${i}`);
    await page.press('#hud-chat-input', 'Enter');
    await page.waitForFunction((n) => [...document.querySelectorAll('#chat-output .chat-line.assistant')].filter((l) => l.textContent.includes('hello there')).length > n, i, { timeout: 15000 });
    times.push(Date.now() - t0);
    await page.waitForTimeout(600);
  }
  console.log(`first reply after Enter: ${times.join(' ms, ')} ms   (model list asked ${lists} times in total)`);
  await browser.close();
})();
