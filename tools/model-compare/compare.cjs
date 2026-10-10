// Head-to-head of two local models through LM Studio: the same tasks, scored automatically where
// the answer can be checked (Python hidden tests, a to-do app driven in headless Chrome, a concept
// rubric) and saved for reading where it cannot (shell command, explanation quality).
//
// Usage: node tools/model-compare/compare.cjs <out.json> <modelKey> [modelKey...]
// Env: TASKS=py-merge,py-duration (default all), CTX=32768 (context length both models are loaded
// with, so neither is cut off by LM Studio's small default), RESTORE=<modelKey> (loaded at the end).
// Results are merged into <out.json> after every task, so a run can be split into several
// commands. It loads one model at a time (unloading the others first, as JARVIS does). Model-written shell commands are
// never executed. Needs LM Studio on :1234 and Chrome for the HTML check.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const BASE = 'http://localhost:1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => {
  const r = await fetch(`${BASE}/api/v1${p}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`);
  return r.json();
};
const loadedInstances = (d) => d.models.filter((m) => m.type === 'llm').flatMap((m) => (m.loaded_instances || []).map((i) => ({ key: m.key, id: i.id })));

const CTX = Number(process.env.CTX || 32768);
async function only(key, { context = true } = {}) {
  for (const i of loadedInstances(await api('/models'))) await api('/models/unload', { instance_id: i.id });
  const t0 = Date.now();
  await api('/models/load', context ? { model: key, context_length: CTX } : { model: key });
  for (let n = 0; n < 120; n++) {
    const hit = loadedInstances(await api('/models')).find((i) => i.key === key);
    if (hit) return { id: hit.id, loadSeconds: (Date.now() - t0) / 1000 };
    await sleep(1000);
  }
  throw new Error('model did not load: ' + key);
}

// Streams the reply: a non-streaming request that thinks for more than five minutes before its
// first byte is cut off by Node's default header timeout.
async function ask(instance, prompt) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: instance, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 14000, stream: true, stream_options: { include_usage: true } }),
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  if (!r.ok) throw new Error(`chat ${r.status} ${await r.text()}`);
  let content = ''; let reasoningChars = 0; let usage = null; let finish = null; let buffer = ''; let tFirst = null;
  const decoder = new TextDecoder();
  for await (const chunk of r.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const d = JSON.parse(line.slice(6));
      if (d.usage) usage = d.usage;
      const c = d.choices?.[0];
      if (c?.finish_reason) finish = c.finish_reason;
      if (c?.delta?.content) { tFirst ??= Date.now(); content += c.delta.content; }
      if (c?.delta?.reasoning_content) reasoningChars += c.delta.reasoning_content.length;
    }
  }
  const seconds = (Date.now() - t0) / 1000;
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const completion = usage?.completion_tokens ?? 0;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  return { text, finish, seconds, completion, reasoning, answerTokens: completion - reasoning, tps: completion / seconds, hadReasoning: reasoningChars > 0 };
}

const block = (text, langs) => {
  const re = /```([\w+-]*)\n([\s\S]*?)```/g;
  let m; let first = null;
  while ((m = re.exec(text))) { first ??= m[2]; if (langs.includes(m[1].toLowerCase())) return m[2]; }
  return first ?? text;
};

// ---------------------------------------------------------------- tasks
const PY_MERGE = {
  id: 'py-merge', title: 'Python: merge_intervals',
  prompt: 'Write a Python function merge_intervals(intervals) that takes a list of [start, end] pairs (lists of two ints, in any order, possibly nested or overlapping) and returns a new list of merged, sorted [start, end] lists. Intervals that merely touch (for example [1,3] and [3,5]) must be merged. An empty list returns an empty list. The input must not be modified. Return only the code in one python block.',
  test: `
import copy
cases = [([], []), ([[1,3],[2,6],[8,10],[15,18]], [[1,6],[8,10],[15,18]]), ([[1,4],[4,5]], [[1,5]]), ([[5,7],[1,2],[2,3]], [[1,3],[5,7]]), ([[1,10],[2,3],[4,5]], [[1,10]]), ([[3,3]], [[3,3]]), ([[2,4],[1,1]], [[1,1],[2,4]])]
bad = 0
for inp, want in cases:
    snapshot = copy.deepcopy(inp)
    got = merge_intervals(inp)
    ok = [list(x) for x in got] == want and inp == snapshot
    bad += 0 if ok else 1
    if not ok: print('FAIL', inp, '->', got, 'want', want)
print('PASSED', len(cases) - bad, 'of', len(cases))
`,
};
const PY_DUR = {
  id: 'py-duration', title: 'Python: parse_duration',
  prompt: 'Write a Python function parse_duration(text) that converts strings like "1h 30m 15s", "45s", "2h", "90m" or "1H30M" into a total number of seconds (int). Units are h, m, s (case-insensitive), in any order, separated by optional spaces, each appearing at most once. Raise ValueError for an empty string, an unknown unit, a missing number, a repeated unit, or any other malformed input (for example "10", "5x", "h", "1h 1h", "1.5h", "-5m"). Return only the code in one python block.',
  test: `
good = [("1h 30m 15s", 5415), ("45s", 45), ("2h", 7200), ("90m", 5400), ("1H30M", 5400), ("30m1h", 5400), ("0s", 0)]
badin = ["", "10", "5x", "h", "1h 1h", "1.5h", "-5m", "abc", "1h30"]
score = 0
for s, want in good:
    try:
        got = parse_duration(s)
        if got == want and isinstance(got, int): score += 1
        else: print('FAIL', repr(s), got, want)
    except Exception as e: print('FAIL', repr(s), 'raised', e)
for s in badin:
    try:
        r = parse_duration(s); print('FAIL', repr(s), 'should raise, got', r)
    except ValueError: score += 1
    except Exception as e: print('FAIL', repr(s), 'wrong exception', type(e).__name__)
print('PASSED', score, 'of', len(good) + len(badin))
`,
};
const HTML_TODO = {
  id: 'html-todo', title: 'HTML: to-do app',
  prompt: 'Write a single self-contained HTML file (inline CSS and JS, no libraries) for a to-do list app with a dark theme. Required: a text input with id="new-item", a button with id="add-item", and an empty <ul id="items">. Adding an item (click the button or press Enter in the input) appends an <li> containing the text and a <button class="delete">; clicking delete removes that item. Empty or whitespace-only input is ignored, and the input is cleared after each add. Return only the HTML in one html block.',
};
const BASH = {
  id: 'bash', title: 'Terminal: largest files',
  prompt: 'Give one bash command (a single pipeline) that prints the 5 largest regular files under the current directory, with human-readable sizes, ignoring everything inside any node_modules directory and handling file names that contain spaces. Return only the command in one bash block.',
};
const CONCEPT = {
  id: 'concept', title: 'Concept: TCP congestion control',
  prompt: 'Explain how TCP congestion control works to a smart beginner who knows what a network packet is. Cover how a connection discovers how fast it may send and what happens when packets are lost. Be clear and accurate, and keep it under 350 words.',
  rubric: [/slow[- ]start/i, /congestion window|cwnd/i, /loss|dropped|lost/i, /ssthresh|threshold/i, /additive|linear|one (segment|packet|MSS)/i, /halv|multiplicative|cut|reduce/i, /acknowledg|ACK/i],
};

function runPython(code, test) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
  const file = path.join(dir, 't.py');
  fs.writeFileSync(file, `${code}\n\n${test}`);
  const r = spawnSync('python', [file], { encoding: 'utf8', timeout: 20000 });
  fs.rmSync(dir, { recursive: true, force: true });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/PASSED (\d+) of (\d+)/);
  return { score: m ? `${m[1]}/${m[2]}` : 'crashed', pass: m ? +m[1] : 0, total: m ? +m[2] : null, detail: out.split('\n').filter((l) => l.startsWith('FAIL') || /Error|Traceback/.test(l)).slice(0, 4).join(' | ') };
}

async function checkTodo(html, browser, shot) {
  const page = await (await browser.newContext({ viewport: { width: 900, height: 650 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const checks = {};
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const add = (t) => page.fill('#new-item', t);
    await add('Buy milk'); await page.click('#add-item');
    await add('Walk dog'); await page.click('#add-item');
    checks.addsByClick = (await page.locator('#items li').count()) === 2;
    checks.textShown = /Buy milk/.test(await page.locator('#items li').first().innerText());
    checks.inputCleared = (await page.inputValue('#new-item')) === '';
    await add('   '); await page.click('#add-item');
    checks.ignoresEmpty = (await page.locator('#items li').count()) === 2;
    await add('Read book'); await page.press('#new-item', 'Enter');
    checks.enterAdds = (await page.locator('#items li').count()) === 3;
    checks.hasDelete = (await page.locator('#items li button.delete').count()) === 3;
    await page.locator('#items li').first().locator('button.delete').click();
    checks.deleteWorks = (await page.locator('#items li').count()) === 2 && !/Buy milk/.test(await page.locator('#items').innerText());
    checks.noErrors = errors.length === 0;
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
    checks.darkTheme = bg.reduce((a, b) => a + b, 0) / 3 < 90;
  } catch (e) { checks.crashed = String(e).slice(0, 160); }
  await page.screenshot({ path: shot }).catch(() => {});
  await page.context().close();
  const passed = Object.entries(checks).filter(([k, v]) => v === true).length;
  return { score: `${passed}/9`, pass: passed, total: 9, checks, errors };
}

(async () => {
  const [outFile, ...keys] = process.argv.slice(2);
  const before = loadedInstances(await api('/models')).map((i) => i.key);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { models: {} };
  results.startedWith ??= before;
  const wanted = process.env.TASKS ? process.env.TASKS.split(',') : null;
  const shots = path.dirname(path.resolve(outFile));
  try {
    for (const key of keys) {
      console.log(`\n=== ${key}: loading`);
      const { id, loadSeconds } = await only(key);
      const info = (await api('/models')).models.find((m) => m.key === key);
      const res = results.models[key] ?? { tasks: {} };
      Object.assign(res, { quant: info.quantization?.name, sizeGB: +(info.size_bytes / 1e9).toFixed(1), loadSeconds, context: CTX });
      results.models[key] = res;
      for (const task of [PY_MERGE, PY_DUR, HTML_TODO, BASH, CONCEPT].filter((t) => !wanted || wanted.includes(t.id))) {
        console.log(`  ${task.title} ...`);
        let a;
        try { a = await ask(id, task.prompt); } catch (e) { res.tasks[task.id] = { error: String(e).slice(0, 200) }; console.log('   error', e.message); continue; }
        const t = { seconds: +a.seconds.toFixed(1), tokens: a.completion, thinkingTokens: a.reasoning, answerTokens: a.answerTokens, tps: +a.tps.toFixed(1), finish: a.finish, text: a.text };
        if (task.test) Object.assign(t, runPython(block(a.text, ['python', 'py']), task.test));
        if (task.id === 'html-todo') {
          const html = block(a.text, ['html']);
          t.htmlChars = html.length;
          Object.assign(t, await checkTodo(html, browser, path.join(shots, `todo-${key.replace(/[^\w]+/g, '_')}.png`)));
        }
        if (task.rubric) { const hits = task.rubric.filter((re) => re.test(a.text)).length; t.score = `${hits}/${task.rubric.length}`; t.words = a.text.split(/\s+/).length; }
        res.tasks[task.id] = t;
        fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
        console.log(`   ${t.score ?? '-'}  ${t.seconds}s  ${t.tokens} tok (${t.thinkingTokens} thinking)  ${t.tps} t/s  ${t.finish}${t.detail ? '  ' + t.detail.slice(0, 120) : ''}`);
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
    const restore = process.env.RESTORE;
    try { if (restore) { console.log(`\nrestoring ${restore}`); await only(restore, { context: false }); } } catch (e) { console.log('restore failed:', e.message); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
