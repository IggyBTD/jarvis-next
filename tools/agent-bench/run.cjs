// Agentic coding benchmark. One real agent (OpenCode, headless) per task, same harness for every model.
// Usage: node run.cjs <modelAlias:base|ft> [--tasks t1,t2] [--seeds 2] [--out results.jsonl]
// Env: CTX (default 49152), TIMEOUT_MIN (25). Hidden tests are copied in only after the agent has stopped.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, spawnSync } = require('child_process');
const BASE = 'http://localhost:1234', CTX = Number(process.env.CTX || 49152), TMO = Number(process.env.TIMEOUT_MIN || 25) * 60000;
const KEYS = { base: 'qwen3.8-27b', ft: 'qwen3.8-27b-turbo-fable-cold-fusion-735-882-heretic-uncensored-neo-coder-max-mtp' };
const LOAD = { base: { flash_attention: true }, ft: { flash_attention: true, speculative_draft_mtp: false } };
const args = process.argv.slice(2), alias = args[0];
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const seeds = Number(opt('seeds', 2)), out = path.resolve(opt('out', path.join(__dirname, 'results.jsonl')));
const only = opt('tasks', '') ? opt('tasks').split(',') : null;
const api = async (p, body) => { const r = await fetch(`${BASE}/api/v1${p}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(p + ' ' + t); return JSON.parse(t); };
async function loadOnly(alias) {
  for (const m of (await api('/models')).models) for (const i of m.loaded_instances || []) await api('/models/unload', { instance_id: i.id });
  await api('/models/load', { model: KEYS[alias], context_length: CTX, ...LOAD[alias] });
}
const OC = process.env.OPENCODE_BIN || path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
const cp = (a, b) => fs.cpSync(a, b, { recursive: true });
function sh(cmd, cwd, timeout = 120000) { return spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout }); }
function runAgent(cwd, prompt, sessionId, model) {
  return new Promise((resolve) => {
    const a = ['run', '--pure', '--format', 'json', '-m', 'lmstudio/' + model, '--dir', cwd];
    if (sessionId) a.push('-s', sessionId);
    a.push(prompt);
    const p = spawn(OC, a, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENCODE_CONFIG: path.join(__dirname, 'opencode.bench.json') } });
    let buf = '', events = [], timedOut = false;
    const timer = setTimeout(() => { timedOut = true; spawnSync(`taskkill /pid ${p.pid} /T /F`, { shell: true }); }, TMO);
    p.stdout.on('data', (d) => { buf += d; const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) { try { events.push(JSON.parse(l)); } catch {} } });
    p.stderr.on('data', () => {}); p.on('close', () => { clearTimeout(timer); resolve({ events, timedOut }); });
  });
}
function metrics(events) {
  let steps = 0, tools = 0, toolErrors = 0, tin = 0, tout = 0, sid = null, loops = 0; const seen = new Map(), touched = new Set();
  for (const e of events) {
    sid = sid || e.sessionID;
    if (e.type === 'step_finish') { steps++; tin += e.part?.tokens?.input || 0; tout += e.part?.tokens?.output || 0; }
    if (e.type === 'tool_use') {
      tools++; const st = e.part.state; if (st.status === 'error') toolErrors++;
      const key = e.part.tool + JSON.stringify(st.input); const n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n === 3) loops++;
      if (/edit|write/.test(e.part.tool) && st.input?.filePath) touched.add(st.input.filePath);
    }
  }
  return { steps, tools, toolErrors, loops, inputTokens: tin, outputTokens: tout, sessionID: sid, edited: [...touched] };
}
function score(work, task) {
  const hid = path.join(work, '__hidden__'); cp(path.join(task.dir, 'hidden'), hid);
  if (task.pre) sh(task.pre, work);
  const r = sh(`node ${task.scorer ? task.scorer : "--test --test-reporter=tap \"__hidden__/*.test.js\""}`, work, 300000);
  const o = (r.stdout || '') + (r.stderr || '');
  const g = (k) => Number((o.match(new RegExp('# ' + k + ' (\\d+)')) || [])[1] || 0);
  return { pass: g('pass'), fail: g('fail'), total: g('tests'), solved: g('fail') === 0 && g('pass') > 0 && r.status === 0, tail: o.slice(-600) };
}
(async () => {
  const tasksDir = path.join(__dirname, 'tasks'); await loadOnly(alias);
  for (const id of fs.readdirSync(tasksDir).sort()) {
    if (only && !only.includes(id)) continue;
    const task = { ...JSON.parse(fs.readFileSync(path.join(tasksDir, id, 'task.json'), 'utf8')), dir: path.join(tasksDir, id), id };
    for (let s = (id === opt('skipSeed0', '') ? 1 : 0); s < seeds; s++) {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${id}-`)); cp(path.join(task.dir, 'seed'), work);
      sh('git init -q && git add -A && git -c user.email=a@b -c user.name=b commit -qm seed', work);
      const t0 = Date.now(); let r = await runAgent(work, task.prompt, null, alias), m = metrics(r.events), timedOut = r.timedOut;
      if (task.followup && !timedOut) { const r2 = await runAgent(work, task.followup, m.sessionID, alias); const m2 = metrics(r2.events); for (const k of ['steps', 'tools', 'toolErrors', 'loops', 'inputTokens', 'outputTokens']) m[k] += m2[k]; m.edited = [...new Set([...m.edited, ...m2.edited])]; timedOut = r2.timedOut; }
      const secs = (Date.now() - t0) / 1000;
      const diff = sh('git add -A && git diff --cached --stat', work).stdout;
      const sc = score(work, task);
      const row = { task: id, model: alias, seed: s, secs: Math.round(secs), timedOut, ...m, ...sc, diffStat: diff.split('\n').slice(-2, -1)[0] };
      fs.appendFileSync(out, JSON.stringify(row) + '\n'); console.log(id, alias, s, sc.solved ? 'SOLVED' : `fail ${sc.pass}/${sc.total}`, `${Math.round(secs)}s steps=${m.steps} toolErr=${m.toolErrors}`);
      fs.writeFileSync(path.join(work, '__agent_events__.json'), JSON.stringify(r.events)); // kept for blind review
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
