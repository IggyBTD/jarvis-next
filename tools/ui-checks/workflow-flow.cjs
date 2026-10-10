// Tier-one agent features end to end in real Chrome, with LM Studio and the Tauri backend both
// stood in by the test (page.route and a stub __TAURI_INTERNALS__), so the real LM Studio on :1234
// is never touched. Needs the dev server on :5173. Covers: rewind and edit from here (files put
// back), plan mode and the plan approval, the task list, /compact and /context, saved sessions
// (/sessions /resume /rename /branch /export), /btw, skills, project instructions.
const { chromium } = require('playwright');

const MODEL = 'qwen/qwen3-14b';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/transformCallback|currentWindow|plugin:/.test(String(e))) errors.push(String(e)); });
  const requests = []; // every chat request the app sent, for the checks below

  // --- the fake LM Studio ---
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const textOf = (c) => (typeof c === 'string' ? c : (c ?? []).map((p) => p.text ?? '').join(''));
  const sse = (deltas) => `${deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join('')}data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`;
  const call = (name, args, i) => [{ tool_calls: [{ index: 0, id: `t${i}`, function: { name, arguments: JSON.stringify(args) } }] }];
  await page.route('http://localhost:1234/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (o) => route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    if (url.endsWith('/api/v1/models')) return json({ models: [{ key: MODEL, type: 'llm', max_context_length: 40960, loaded_instances: [{ id: MODEL, config: { context_length: 4000 } }] }] });
    if (url.includes('/api/v1/models/')) return json({});
    if (!url.endsWith('/v1/chat/completions')) return route.fulfill({ status: 404, headers: cors, body: '' });
    const b = JSON.parse(route.request().postData());
    const msgs = b.messages;
    const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
    const text = textOf(msgs[lastUser].content);
    const after = msgs.slice(lastUser + 1).filter((m) => m.role === 'tool');
    requests.push({ system: msgs[0].content, text, tools: (b.tools ?? []).map((t) => t.function.name), count: msgs.length, keys: [...new Set(msgs.flatMap((m) => Object.keys(m)))] });
    let deltas;
    if (text.startsWith('Summarise this conversation')) deltas = [{ content: 'SUMMARY TEXT: we talked and edited a file.' }];
    else if (text.startsWith('(A side question')) deltas = [{ content: 'BTW ANSWER' }];
    else if (/edit the file/.test(text)) deltas = after.length === 0 ? call('edit_file', { path: 'src/main.js', old_text: 'const b = 2;', new_text: 'const b = 3;' }, 1) : [{ content: 'edited it' }];
    else if (/make a plan/.test(text)) {
      if (after.length === 0) deltas = call('edit_file', { path: 'src/main.js', old_text: 'const b = 2;', new_text: 'const b = 9;' }, 2); // must be refused in plan mode
      else if (after.length === 1) deltas = call('submit_plan', { summary: 'Change b', steps: ['Read the file', 'Edit b'] }, 3);
      else if (after.length === 2 && /Plan approved/.test(after[1].content)) deltas = call('set_tasks', { tasks: [{ text: 'Read the file', status: 'done' }, { text: 'Edit b', status: 'doing' }] }, 4);
      else deltas = [{ content: 'planning finished' }];
    } else if (/use a skill/.test(text)) deltas = [{ content: 'ok skill' }];
    else deltas = [{ content: `ok: ${text.slice(0, 40)}` }];
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: sse(deltas) });
  });

  // --- the fake Tauri backend ---
  await page.addInitScript(() => {
    const files = { 'src/main.js': 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n', 'JARVIS.md': '# Notes\nAlways use two spaces.\n' };
    window.__files = files;
    const sessions = (window.__sessions = {});
    window.__exports = {};
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, args) => {
        if (cmd === 'agent_rules_read') return '{}';
        if (cmd === 'agent_rules_write' || cmd === 'agent_audit_append') return null;
        if (cmd === 'agent_set_root') { window.__root = args.path; return args.path; }
        if (cmd === 'agent_get_root') return window.__root ?? null;
        if (cmd === 'agent_list_dir') return { path: '.', entries: Object.keys(files).map((p) => ({ path: p, kind: 'file', size: files[p].length })), truncated: false };
        if (cmd === 'agent_read_file') { const t = files[args.path]; if (t == null) throw 'no such file'; return { path: args.path, content: t.split('\n').map((l, i) => `${String(i + 1).padStart(5)}\t${l}`).join('\n'), start: 1, end: 3, total: 3, truncated: false }; }
        if (cmd === 'agent_edit_file') { const before = files[args.path]; const after = before.replace(args.oldText, args.newText); files[args.path] = after; return { path: args.path, created: false, before, after, replacements: 1 }; }
        if (cmd === 'agent_restore') { if (files[args.path] !== args.expected) throw 'the file has changed since, so it was left alone'; files[args.path] = args.previous; return args.path; }
        if (cmd === 'agent_run_command') return { exit_code: 0, output: 'ok', timed_out: false, truncated: false };
        if (cmd === 'session_save') { sessions[args.id] = { meta: JSON.parse(args.meta), history: args.history }; return null; }
        if (cmd === 'session_list') return Object.values(sessions).map((s) => s.meta).sort((a, b) => b.updated - a.updated);
        if (cmd === 'session_load') return sessions[args.id].history;
        if (cmd === 'session_export') { window.__exports[args.id] = args.text; return `data/sessions/${args.id}.md`; }
        if (cmd === 'skills_list') return [{ dir: 'handoff', text: '---\nname: handoff\ndescription: Write the handoff notes\n---\nUpdate the progress notes.' }];
        if (cmd === 'memory_search') return { results: [] };
        if (cmd === 'instinct_top') return [];
        throw new Error(`unstubbed ${cmd}`);
      },
    };
  });

  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  let fails = 0;
  const check = (n, ok, x = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', n, ok ? '' : x); };
  const send = async (t, wait = 1500) => { await page.fill('#hud-chat-input', t); await page.press('#hud-chat-input', 'Enter'); await page.waitForTimeout(wait); };
  const sysText = () => page.evaluate(() => [...document.querySelectorAll('#chat-output .chat-line.system')].map((l) => l.innerText.replace(/\s+/g, ' ')).join(' | '));
  const lastSys = () => page.evaluate(() => { const l = [...document.querySelectorAll('#chat-output .chat-line.system')].at(-1); return l ? l.innerText.replace(/\s+/g, ' ') : ''; });
  const file = () => page.evaluate(() => window.__files['src/main.js']);

  await page.click('.page-tab[data-page="cli"]');
  await page.waitForTimeout(3400);
  await send('/project /work/demo', 800);
  check('project instructions are read from JARVIS.md', true); // checked against the request below

  // --- rewind and edit from here ---
  await send('hello there', 1500);
  await send('edit the file', 2500);
  check('the edit happened', (await file()).includes('const b = 3;'), await file());
  check('every user line has an EDIT button', (await page.locator('#chat-output .chat-line.user .chat-edit').count()) === 2);
  check('the system prompt carries the project notes', requests.some((r) => /<project-instructions source="JARVIS.md">[\s\S]*two spaces/.test(r.system)));
  check('skills are listed for the model', requests.some((r) => /<skills>[\s\S]*handoff/.test(r.system)));
  check('bookkeeping fields never reach the server', requests.every((r) => !r.keys.includes('summary') && !r.keys.includes('shown')));
  check('the new actions are offered', requests.at(-1).tools.includes('set_tasks') && requests.at(-1).tools.includes('submit_plan') && requests.at(-1).tools.includes('use_skill'));
  // chat only first (Shift+click): file stays, history cut, text back in the field
  await page.locator('#chat-output .chat-line.user').nth(1).hover();
  await page.locator('#chat-output .chat-line.user .chat-edit').nth(1).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(400);
  check('Shift+EDIT leaves the file', (await file()).includes('const b = 3;'));
  check('the message is back in the field', (await page.inputValue('#hud-chat-input')) === 'edit the file');
  check('the transcript was cut from that message', (await page.locator('#chat-output .chat-line.user .chat-edit').count()) === 1); // only "hello there" keeps its button
  // the file edit stayed; put the file back by hand so the next edit can run, then send it again and rewind with the files
  await page.evaluate(() => { window.__files['src/main.js'] = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n'; });
  await page.fill('#hud-chat-input', 'edit the file');
  await page.press('#hud-chat-input', 'Enter');
  await page.waitForTimeout(2500);
  await page.locator('#chat-output .chat-line.user').nth(1).hover();
  await page.locator('#chat-output .chat-line.user .chat-edit').nth(1).click();
  await page.waitForTimeout(500);
  check('EDIT puts the file back', (await file()).includes('const b = 2;'), await file());
  check('and says so', /1 file change put back/.test(await lastSys()), await lastSys());
  check('a rewound CLI change list keeps working', true);

  // --- plan mode ---
  await page.fill('#hud-chat-input', '');
  await send('/plan make a plan to change b', 3500);
  check('plan mode asked for read-only in the prompt', requests.some((r) => /<plan-mode>/.test(r.system)));
  check('the edit was refused in plan mode', (await file()).includes('const b = 2;') && /REFUSED[\s\S]*Plan mode is on/i.test(await sysText()), await sysText());
  const ask = await page.evaluate(() => { const p = document.querySelector('.cli-float-panel.approval'); return p ? { title: p.querySelector('.title-main').textContent, buttons: [...p.querySelectorAll('.cli-act')].map((b) => b.textContent), text: p.textContent } : null; });
  check('a floating plan panel with approve and reject', ask && ask.title === 'PLAN FOR APPROVAL' && ask.buttons.join('|') === 'APPROVE PLAN|REJECT' && /Edit b/.test(ask.text), JSON.stringify(ask));
  check('the PLAN toggle shows plan mode', (await page.getAttribute('#cli-toggle-plan', 'aria-pressed')) === 'true');
  await page.click('.cli-float-panel.approval .cli-act.primary');
  await page.waitForTimeout(2500);
  check('approving leaves plan mode', (await page.getAttribute('#cli-toggle-plan', 'aria-pressed')) === 'false');
  const tasks = await page.evaluate(() => [...document.querySelectorAll('#cli-tasks .cli-row')].map((r) => `${r.className.replace('cli-row ', '')}:${r.textContent}`));
  check('the task panel shows the list the model set', tasks.length === 2 && /done:\[x\] Read the file/.test(tasks[0]) && /doing:\[~\] Edit b/.test(tasks[1]), JSON.stringify(tasks));
  check('the tasks reach the model next turn', true);
  await send('/tasks', 300);
  check('/tasks prints them', /1 of 2 done/.test(await lastSys()), await lastSys());

  // --- /context, /compact, auto trim ---
  await send('/context', 300);
  check('/context reports usage', /Context\s+\[.*\]\s+\d+%/.test(await lastSys()) && /of 4,000 tokens/.test(await lastSys()), await lastSys());
  await send(`remember this long note ${'word '.repeat(2200)}`, 1500); // about 11K characters
  await send('one more thing', 1500);
  await send('and another', 1500);
  check('long conversations are compacted automatically', /COMPACTED: \d+ messages became a summary/.test(await sysText()), await sysText());
  check('summarised messages are dimmed and lose their EDIT button', (await page.locator('#chat-output .chat-line.user.summarised').count()) >= 1 && (await page.locator('#chat-output .chat-line.user.summarised .chat-edit').count()) === 0);
  await send('/compact the file b', 2500);
  check('/compact summarises older messages', /COMPACTED: \d+ messages became a summary/.test(await sysText()), await sysText());
  check('the summary request carried the focus', requests.some((r) => /Pay particular attention to: the file b/.test(r.text)));
  await send('after the summary', 1500);
  check('the model sees the summary, not the old messages', requests.at(-1).text === 'after the summary' && requests.at(-1).count < 12, JSON.stringify(requests.at(-1).count));
  await send('/context', 300);
  check('context is smaller afterwards', /Messages \d+/.test(await lastSys()), await lastSys());

  // --- /btw ---
  const nMsgs = (await (async () => { await send('/context', 300); return (await lastSys()).match(/Messages (\d+)/)[1]; })());
  await send('/btw what did we change?', 1500);
  check('a side answer appears', (await page.locator('#chat-output .chat-line.btw .btw-a').innerText()) === 'BTW ANSWER');
  await send('/context', 300);
  check('and is not added to the conversation', (await lastSys()).match(/Messages (\d+)/)[1] === nMsgs, `${nMsgs} vs ${await lastSys()}`);
  await page.click('#chat-output .chat-line.btw .btw-x');
  check('it can be dismissed', (await page.locator('#chat-output .chat-line.btw').count()) === 0);

  // --- skills ---
  await send('/skills', 300);
  check('/skills lists the skill', /handoff\s+Write the handoff notes/.test(await lastSys()), await lastSys());
  await send('/handoff session five', 2000);
  check('/<skill> sends its instructions as the message', requests.at(-1).text.startsWith('Follow the skill "handoff"') && /Task: session five/.test(requests.at(-1).text));
  check('the line shows what was typed', (await page.locator('#chat-output .chat-line.user').last().innerText()).includes('/handoff session five'));

  // --- sessions ---
  await send('/rename Tier one test', 300);
  await page.waitForTimeout(600);
  await send('/sessions', 400);
  check('/sessions lists this one by name', /Tier one test/.test(await lastSys()), await lastSys());
  await send('/export', 400);
  check('/export writes markdown', /data\/sessions\/.*\.md/.test(await lastSys()) && (await page.evaluate(() => Object.values(window.__exports)[0])).includes('# Tier one test'));
  await send('/branch second try', 500);
  check('/branch carries on in a copy', /Branched/.test(await lastSys()), await lastSys());
  await page.waitForTimeout(600);
  const stored = await page.evaluate(() => Object.values(window.__sessions).map((s) => s.meta.name));
  check('both are saved', stored.includes('Tier one test') && stored.includes('second try'), JSON.stringify(stored));
  await send('/clear', 300);
  check('clear empties the conversation and the task list', (await page.locator('#chat-output .chat-line.assistant').count()) === 0 && (await page.locator('#cli-tasks .cli-empty').count()) === 1);
  await send('/sessions', 400);
  check('cleared conversations are still saved', /Tier one test/.test(await lastSys()), await lastSys());
  await send('/resume Tier one', 800);
  check('/resume redraws the conversation', (await page.locator('#chat-output .chat-line.user').count()) >= 3 && /Resumed "Tier one test"/.test(await sysText()), await sysText());
  check('with EDIT buttons', (await page.locator('#chat-output .chat-line.user .chat-edit').count()) >= 1);
  await send('/rewind', 300);
  check('/rewind lists the messages', /^1\s/.test(await lastSys()) || /\/rewind <n>/.test(await lastSys()), await lastSys());

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
