// Agent actions end to end in a browser: a scripted fake LM Studio (mock-lm-studio.mjs, port 1234, stop the real one first)
// makes tool calls; a stand-in Tauri backend keeps files in memory. Start: node tools/ui-checks/mock-lm-studio.mjs & npm run dev
// then node tools/ui-checks/agent-flow.cjs. Errors about currentWindow / plugin:event are the stand-in backend, not the app.
const { chromium } = require('playwright');
const SP = __dirname;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const files = { 'src/main.js': 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n', 'README.md': '# Hi\n' };
    const log = (window.__calls = []);
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, args) => {
        log.push([cmd, JSON.stringify(args).slice(0, 120)]);
        if (cmd === 'agent_rules_read') return localStorage.getItem('rules_file') || '{}';
        if (cmd === 'agent_rules_write') { localStorage.setItem('rules_file', args.text); return null; }
        if (cmd === 'agent_audit_append') return null;
        if (cmd === 'agent_set_root') return args.path;
        if (cmd === 'agent_list_dir') return { path: '.', entries: Object.keys(files).map((p) => ({ path: p, kind: 'file', size: files[p].length })), truncated: false };
        if (cmd === 'agent_read_file') { const t = files[args.path]; if (t == null) throw 'nope'; return { path: args.path, content: t.split('\n').map((l, i) => `${String(i + 1).padStart(5)}\t${l}`).join('\n'), start: 1, end: 3, total: 3, truncated: false }; }
        if (cmd === 'agent_edit_file') { const before = files[args.path]; const after = before.replace(args.oldText, args.newText); files[args.path] = after; return { path: args.path, created: false, before, after, replacements: 1 }; }
        if (cmd === 'agent_write_file') { const before = files[args.path] ?? null; files[args.path] = args.content; return { path: args.path, created: before === null, before, after: args.content, replacements: 1 }; }
        if (cmd === 'agent_restore') { if (files[args.path] !== args.expected) throw 'the file has changed since, so it was left alone'; if (args.previous == null) delete files[args.path]; else files[args.path] = args.previous; return args.path; }
        if (cmd === 'agent_search') return { matches: [{ path: 'src/main.js', line: 1, text: 'const a = 1;' }], files_scanned: 2, truncated: false };
        if (cmd === 'agent_run_command') return { exit_code: args.command.startsWith('npm') ? 1 : 0, output: `ran: ${args.command}`, timed_out: false, truncated: false };
        throw new Error('unstubbed ' + cmd);
      },
    };
  });
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const send = async (t, wait = 3000) => { await page.fill('#hud-chat-input', t); await page.press('#hud-chat-input', 'Enter'); await page.waitForTimeout(wait); };
  const lines = () => page.evaluate(() => [...document.querySelectorAll('#chat-output .chat-line')].map((l) => l.className.replace('chat-line ', '') + ': ' + l.innerText.replace(/\s+/g, ' ').slice(0, 110)));
  const out = (label, v) => console.log(label, JSON.stringify(v, null, 1));

  await send('/project /work/demo', 600);
  await send('please use the coding model', 2500);
  out('mode', await page.evaluate(() => ({ active: document.querySelector('.matrix-btn.active-mode')?.dataset.preset, wb: document.body.classList.contains('wb-mode') })));
  await send('now run things', 4500);
  await page.screenshot({ path: SP + '/approval-wb.png' });
  out('pending approval', (await lines()).slice(-2));
  await send('/stop', 2000);
  out('after stop', (await lines()).slice(-3));
  out('busy again?', await page.evaluate(() => !!document.querySelector('.tool-card.approval.denied')));
  await send('go loop forever', 5000);
  out('LOOP', { toolCards: await page.$$eval('.tool-card', (n) => n.length), last: (await lines()).slice(-1) });
  await send('/stop', 500);
  out('idle stop', (await lines()).slice(-1));
  console.log('errors', JSON.stringify(errors));
  await page.screenshot({ path: SP + '/final.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
