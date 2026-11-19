// The registry: config/server/actions.json is the single contract; platform code in portable.js, win32.js and darwin.js
// must satisfy the same names. Loads, validates arguments, resolves the OS implementation, supports dry runs, and returns
// { ok, data?, error?, durationMs }. An action that is not implemented for this OS answers "unsupported" and is hidden from list().
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../../shared/schema.js';
import { runProgram as realRun, expandHome } from './common.js';
import { portable } from './portable.js';
import { win32 } from './win32.js';
import { darwin } from './darwin.js';

const PLATFORM_IMPL = { win32, darwin };
const MAX_RESULT = 20_000;
const describeSpec = (s) => ({ program: s.file, args: s.args ?? [], env: Object.keys(s.env ?? {}).filter((k) => !k.startsWith('JARVIS_A_')).length ? '[custom]' : undefined, cwd: s.cwd, stdin: s.stdin !== undefined ? '[text]' : undefined });

export function createRegistry({ cfg, machineId, os = process.platform, runProgram = realRun, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), scriptsDir = path.join(cfg.root, 'scripts', 'user'), env = process.env }) {
  const machine = cfg.machines.machines[machineId];
  const impl = { ...portable, ...PLATFORM_IMPL[os] };
  const contract = new Map(cfg.actions.actions.map((a) => [a.name, a]));
  const workspaceDir = path.resolve(expandHome(machine.workspaceDir));
  const background = new Map();

  const ctx = {
    os, machineId, dataDir: cfg.dataDir, apps: cfg.apps, workspaces: cfg.workspaces, files: cfg.files, scripts: cfg.scripts, scriptsDir, workspaceDir,
    runProgram, fetch: fetchImpl, sleep, env, background, facts: null,
    call: (name, args) => execute(name, { args }),
  };

  const available = (name) => {
    const c = contract.get(name);
    return !!c && c.platforms.includes(os) && Object.hasOwn(impl, name) && !c.internal;
  };

  async function runPlan(def, args, c) {
    const planned = def.plan(args, ctx);
    const steps = Array.isArray(planned) ? planned : [planned];
    const results = [];
    for (const step of steps) {
      const r = await runProgram({ timeoutMs: c.timeoutMs ?? 30_000, ...step });
      results.push(r);
      const okCodes = def.okCodes ?? [0];
      if (!def.allowNonZero && !okCodes.includes(r.code)) throw new Error((r.stderr || r.stdout || `exit code ${r.code}`).trim().slice(0, 400));
    }
    if (def.after) return def.after(args, ctx, results);
    return def.parse ? def.parse(results, args, ctx) : results.at(-1).stdout.trim();
  }

  async function execute(name, { args = {}, dryRun = false } = {}) {
    const started = Date.now();
    const done = (o) => ({ ...o, durationMs: Date.now() - started });
    if (!contract.has(name)) return done({ ok: false, error: `unknown action "${name}"` });
    const c = contract.get(name);
    if (!available(name)) return done({ ok: false, error: 'unsupported' });
    if (!c.enabled) return done({ ok: false, error: 'disabled: this action is switched off in config/server/actions.json' });
    const bad = validate(c.params, args ?? {});
    if (bad.length) return done({ ok: false, error: `bad arguments: ${bad.join('; ')}` });
    const def = impl[name];
    try {
      if (dryRun) {
        if (def.describe) return done({ ok: true, data: { dryRun: true, ...def.describe(args, ctx) } });
        if (def.plan) { const p = def.plan(args, ctx); return done({ ok: true, data: { dryRun: true, would: (Array.isArray(p) ? p : [p]).map(describeSpec) } }); }
        return done({ ok: true, data: { dryRun: true, would: `run ${name}` } });
      }
      let data = def.run ? await def.run(args, ctx) : await runPlan(def, args, c);
      const text = JSON.stringify(data ?? null);
      if (text.length > MAX_RESULT) data = { truncated: true, text: text.slice(0, MAX_RESULT) };
      return done({ ok: true, data: data ?? null });
    } catch (e) {
      return done({ ok: false, error: String(e?.message ?? e).slice(0, 500) });
    }
  }

  return {
    ctx, execute, available,
    // what this machine can do right now: implemented for this OS (enabled or not, so the server can show what is switched off)
    list: () => [...contract.values()].filter((c) => available(c.name)).map((c) => ({ name: c.name, category: c.category, tier: c.tier, enabled: c.enabled })),
    // contract entries for this OS with no implementation: reported by tests and by doctor, hidden from the model
    missing: () => [...contract.values()].filter((c) => c.platforms.includes(os) && !c.internal && !Object.hasOwn(impl, c.name)).map((c) => c.name),
    stopBackground() { for (const { child } of background.values()) { try { child.kill(); } catch { /* gone */ } } background.clear(); },
    ensureWorkspace() { fs.mkdirSync(workspaceDir, { recursive: true }); return workspaceDir; },
  };
}
