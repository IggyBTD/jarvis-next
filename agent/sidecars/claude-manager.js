// The Claude Code backend: starts the official, unmodified `claude` program in the workspace for one coding run, signed in as the
// person who runs it (its own login; JARVIS never reads, stores or passes on a credential, and the agent's environment is cleaned so
// no API key leaks in). The prompt goes in on stdin, the run's stream comes back as events. One run per id; Stop kills it.
// Routes (under /claude on the agent): GET /status, POST /run, POST /abort.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { claudeArgs } from '../../shared/claude-args.js';
import { MODES, PLAN_NOTE } from '../../shared/permission-modes.js';
import { cleanEnv } from './opencode-manager.js';

const SUBFOLDER = /^(?!.*\.\.)[\w .-]+(\/[\w .-]+)*$/;

export function findClaude(env = process.env, platform = process.platform) {
  if (platform === 'win32' && env.APPDATA) { const exe = path.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'); if (fs.existsSync(exe)) return exe; }
  return 'claude';
}

const readBody = (req) => new Promise((resolve, reject) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > 20_000) { reject(new Error('body too large')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { resolve(c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}); } catch { reject(new Error('body must be JSON')); } }); req.on('error', reject); });
const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

export function createClaudeManager({ workspaceDir, policy = {}, protect = [], env = process.env, spawnFn = spawn, command = findClaude(env), log = () => {} }) {
  const events = new EventEmitter();
  const runs = new Map(); // runId -> child
  const emit = (e) => events.emit('event', e);

  function start({ runId, prompt, mode, folder }) {
    const cwd = folder ? path.join(workspaceDir, folder) : workspaceDir;
    const text = `${mode === 'plan' ? `${PLAN_NOTE}\n\n` : ''}${prompt}`;
    const child = spawnFn(command, ['-p', ...claudeArgs(mode, policy.opencode ?? policy, { protect })], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv(env, {}) });
    runs.set(runId, child);
    let buf = '';
    let done = false;
    let errTail = '';
    const finish = (e) => { if (done) return; done = true; runs.delete(runId); emit({ type: 'claude.done', runId, ...e }); };
    const pick = (i) => Object.fromEntries(['command', 'description', 'file_path', 'path', 'pattern', 'url', 'query'].filter((k) => typeof i?.[k] === 'string').map((k) => [k, i[k].slice(0, 300)]));
    const line = (l) => {
      let m; try { m = JSON.parse(l); } catch { return; }
      if (m.type === 'assistant') for (const part of m.message?.content ?? []) {
        if (part.type === 'text' && part.text) emit({ type: 'claude.text', runId, text: part.text });
        else if (part.type === 'tool_use') emit({ type: 'claude.tool', runId, name: part.name, input: pick(part.input) }); // a few short fields, to say what it is doing; never file contents
      } else if (m.type === 'result') finish({ ok: !m.is_error, result: String(m.result ?? ''), denied: (m.permission_denials ?? []).length, sessionId: m.session_id, costUsd: m.total_cost_usd ?? null });
    };
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-500); });
    child.on('error', (e) => finish({ ok: false, error: `cannot start claude: ${e.code ?? e.message}` }));
    child.on('close', (code) => finish({ ok: false, error: `claude stopped (exit ${code})${errTail ? `: ${errTail.trim().slice(-200)}` : ''}` }));
    child.stdin.end(text);
  }

  return {
    events,
    status: () => ({ installed: command === 'claude' ? null : fs.existsSync(command), running: runs.size, command: path.basename(command) }),
    stop: async () => { for (const c of runs.values()) c.kill(); runs.clear(); },
    async proxy(req, res, sub) {
      const p = sub.split('?')[0];
      try {
        if (req.method === 'GET' && p === '/status') return reply(res, 200, this.status());
        if (req.method === 'POST' && p === '/run') {
          const b = await readBody(req);
          if (!/^[\w-]{1,40}$/.test(b.runId ?? '') || typeof b.prompt !== 'string' || !b.prompt || b.prompt.length > 8000 || !MODES.includes(b.mode) || (b.folder && !SUBFOLDER.test(b.folder))) return reply(res, 400, { error: 'bad run request' });
          if (runs.has(b.runId)) return reply(res, 409, { error: 'that run already exists' });
          start(b);
          return reply(res, 200, { ok: true });
        }
        if (req.method === 'POST' && p === '/abort') {
          const b = await readBody(req);
          runs.get(b.runId)?.kill();
          return reply(res, 200, { ok: true });
        }
        return reply(res, 404, { error: 'not found' });
      } catch (e) { return reply(res, 400, { error: e.message }); }
    },
  };
}
