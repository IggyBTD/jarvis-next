// The JARVIS server (runs on the PC): composes the model path, the chokepoint (router, policy, gate, audit), the chat loop, the
// coding-agent and browser tools, telemetry, the scheduler and digest, voice, and the HTTP/WebSocket API. Start: npm run server
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { cleanLatex } from '../shared/latex.js';
import { buildMacBundle } from '../scripts/make-mac-bundle.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, dataPath, resolveData } from './core/config.js';
import { createAuth, loadTokens, generateTokens } from './core/auth.js';
import { createAuditLog } from './core/audit-log.js';
import { createPolicy } from './core/policy.js';
import { createGate } from './core/gate.js';
import { createBus } from './core/event-bus.js';
import { createToolRouter } from './core/tool-router.js';
import { createTargetState } from './core/target-state.js';
import { createConversations } from './core/conversations.js';
import { createPromptBuilder } from './core/prompt-builder.js';
import { createLlmClient } from './core/llm-client.js';
import { createQueue } from './core/llm-queue.js';
import { createLlmProxy } from './core/llm-proxy.js';
import { createOrchestrator } from './core/orchestrator.js';
import { createAgentTasks, registerAgentTaskTool } from './core/agent-tasks.js';
import { createOpencodeBridge } from './core/opencode-bridge.js';
import { createPermissionMode } from './core/permission-mode.js';
import { createCodeBackend } from './core/code-backend.js';
import { registerBrowserTools } from './core/browser-tools.js';
import { createReminders, registerTimeTools } from './core/reminders.js';
import { createMemory, registerMemoryTools } from './core/memory.js';
import { createScheduler } from './core/scheduler.js';
import { createTelemetry, createLhmProvider, createMacProvider, createPcProvider } from './telemetry/index.js';
import { summarize } from './telemetry/summary.js';
import { createGoogle } from './digest/google.js';
import { createOpensky } from './osint/opensky.js';
import { createDigest } from './digest/pipeline.js';
import { createVoice } from './voice/session.js';
import { createVad, createStt, createTts } from './voice/engines.js';
import { createHttpHandler, createHealth } from './api/http.js';
import { attachWs } from './api/ws.js';
import { resolveBind } from '../shared/net.js';
import { installProcessGuards, isMain } from '../shared/util.js';

// The git branch of a folder on this PC, read from .git/HEAD (the server never starts programs). Null when it is not a repository.
function gitInfo(folder) {
  try {
    const head = fs.readFileSync(path.join(folder, '.git', 'HEAD'), 'utf8').trim();
    return Promise.resolve({ branch: head.startsWith('ref:') ? head.replace(/^ref:\s*refs\/heads\//, '') : `detached at ${head.slice(0, 7)}`, dirty: null });
  } catch { return Promise.resolve(null); }
}

// The project folder the person picked in the Environment tab (read for the git branch); empty = the default.
const projectFolder = (dataDir) => { try { const f = JSON.parse(fs.readFileSync(path.join(dataDir, 'project.json'), 'utf8')).folder; return typeof f === 'string' && fs.existsSync(f) ? f : null; } catch { return null; } };

export async function createServerApp({ cfg = loadConfig(), log = (l) => console.error(`${new Date().toISOString()} ${l}`), env = process.env } = {}) {
  const machines = cfg.machines.machines;
  const ids = Object.keys(machines);
  const created = generateTokens(cfg);
  if (created.length) log(`created tokens: ${created.join(', ')} (copy mac and ui to the Mac by hand)`);
  let tokens = loadTokens(cfg);
  const reload = () => { tokens = loadTokens(cfg); return tokens; };

  const bus = createBus();
  const audit = createAuditLog({ dir: dataPath(cfg, 'audit') });
  let wsApi = null;
  const clientCount = () => wsApi?.clientCount() ?? 0;
  const gate = createGate({ audit, bus, clientCount, dataDir: cfg.dataDir, timeoutMs: cfg.policy.approvalTimeoutMs, expiryMs: cfg.policy.pendingExpiryMs });
  const policy = createPolicy(cfg.policy);
  const router = createToolRouter({ cfg, policy, gate, audit, tokens: (id) => tokens.machines[id]?.[0] ?? '' });
  const targetState = createTargetState({ dataDir: cfg.dataDir, machines: ids, bus });
  const conversations = createConversations({ dir: dataPath(cfg, 'conversations') });
  const memory = createMemory({ dataDir: cfg.dataDir });
  const prompts = createPromptBuilder({ prompts: cfg.prompts, machines, timezone: cfg.schedules.timezone, getInfo: (id) => router.info(id), notes: memory.prompt });
  const llm = createLlmClient({ config: cfg.models });
  // The model picked in the app's model menu outlives a restart; models.json names the one to start with.
  const choiceFile = path.join(cfg.dataDir, 'active-model.json');
  try { const key = JSON.parse(fs.readFileSync(choiceFile, 'utf8')).model; if (typeof key === 'string' && key) llm.applyProfile(key); } catch { /* no choice saved yet */ }
  const queue = createQueue({ concurrency: cfg.models.concurrency, preempt: !!cfg.models.preemptInteractive });
  const orchestrator = createOrchestrator({ llm, queue, router, prompts, conversations, targetState, bus, models: cfg.models });
  const llmProxy = createLlmProxy({ llm, queue, audit, modelId: cfg.models.modelId });

  const modes = createPermissionMode({ dataDir: cfg.dataDir, bus });
  const backend = createCodeBackend({ dataDir: cfg.dataDir, bus });
  const tasks = createAgentTasks({ router, bus, audit, conversations, dataDir: cfg.dataDir, taskTimeoutMs: cfg.policy.opencode.taskTimeoutMs, modes, backend });
  registerAgentTaskTool(router, tasks);
  registerBrowserTools(router, { notify: (m) => bus.publish(m.type, m) });
  const bridge = createOpencodeBridge({ router, gate, audit, tasks, policyCfg: cfg.policy, machines, modes, log });

  const reminders = createReminders({ dataDir: cfg.dataDir, bus, clientCount, timezone: cfg.schedules.timezone });
  const jobRun = async (name) => {
    if (name === 'digest') return digest.run({});
    if (name === 'pending-approvals-expire') { gate.expire(); return reminders.tick(); }
    if (name === 'audit-verify') { const v = audit.verify(); if (!v.ok) { bus.publish('digest.error', { reason: `audit log check failed: ${v.errors[0]}` }); throw new Error(v.errors[0]); } return undefined; }
    if (name === 'log-rotate') return telemetry.prune();
    return undefined; // telemetry-rollup: the telemetry service already writes minute rows; this job exists so the schedule shows it
  };
  const scheduler = createScheduler({ schedules: cfg.schedules, dataDir: cfg.dataDir, run: jobRun, log });
  registerMemoryTools(router, { memory });
  registerTimeTools(router, { reminders, scheduler, timezone: cfg.schedules.timezone });

  const macInvoke = async (name) => { const r = await router.invoke({ name, args: {} }, { target: 'mac', source: 'scheduled', job: 'telemetry-rollup' }); if (!r.ok) throw new Error(r.error ?? 'failed'); return r.data; };
  const telemetry = createTelemetry({ bus, dataDir: cfg.dataDir, providers: { pc: createPcProvider({ lhm: createLhmProvider({ url: env.LHM_URL }) }), mac: createMacProvider({ invoke: macInvoke }) }, log });
  const google = createGoogle({ clientFile: resolveData(cfg, cfg.digest.google.clientFile), tokenFile: resolveData(cfg, cfg.digest.google.tokenFile) });
  const digest = createDigest({ llm, queue, google, cfg: cfg.digest, dataDir: cfg.dataDir, bus, timezone: cfg.schedules.timezone, log, summarizeTelemetry: (fromMs, toMs) => summarize({ dir: telemetry.dir, machine: 'pc', fromMs, toMs, thresholds: cfg.digest.thresholds }) });

  let voice = null;
  if (cfg.voice.enabled) {
    voice = createVoice({ voiceCfg: cfg.voice, vad: createVad(cfg.voice.vad), stt: createStt(cfg.voice.stt), tts: createTts(cfg.voice.tts), targetState, orchestrator, labelOf: (id) => machines[id].label, log,
      send: (c, o) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(o)), sendBinary: (c, b) => c.ws.readyState === 1 && c.ws.send(b) });
  }

  const auth = createAuth({ tokens, reload });
  setInterval(() => { reload(); auth.reload(); }, 60_000).unref();
  const health = createHealth({ llm, queue, router, machines, contextLength: cfg.models.contextLength });
  const server = http.createServer();
  wsApi = attachWs({ server, cfg, auth, bus, gate, orchestrator, targetState, prompts, router, conversations, telemetry, health, digest, agentTasks: tasks, modes, backend, reminders, voice, log });
  // The Intel page's browser view: the guarded browser of whichever computer is the active target, driven by the person. Reaches the
  // agent only through router.capabilities (allowlisted routes). Everything but looking is audited; typed text is never logged.
  const VIEW = { navigate: 'view_navigate', click: 'view_click', type: 'view_type', press: 'view_press', scroll: 'view_scroll', back: 'view_back', forward: 'view_forward', reload: 'view_reload', close: 'close' };
  const browserView = {
    async shot(ifNoneMatch) {
      const target = targetState.get();
      const caps = router.capabilities(target);
      const st = await caps.browser('GET', '/state').catch(() => null);
      if (!st?.json?.running) return null;
      const r = await caps.browser('GET', '/screenshot');
      if (!r.json?.jpeg) return null;
      const jpeg = Buffer.from(r.json.jpeg, 'base64');
      const etag = `"${target}-${crypto.createHash('sha1').update(jpeg).digest('hex')}"`;
      return ifNoneMatch === etag ? { unchanged: true, etag } : { jpeg, etag, url: st.json.url, target };
    },
    async act(body) {
      const route = Object.hasOwn(VIEW, body?.type) ? VIEW[body.type] : null;
      if (!route) return { status: 'refused', reason: 'unknown action' };
      const target = targetState.get();
      const { type, ...args } = body;
      if (type !== 'scroll') audit.append({ component: 'browser-view', source: 'user', target, action: `view_${type}`, args: type === 'type' ? { characters: String(args.text ?? '').length } : args, tier: 'T1', decision: 'auto', outcome: 'sent' }).catch(() => {});
      const r = await router.capabilities(target).browser('POST', `/${route}`, args).catch((e) => ({ json: { status: 'error', reason: e.message } }));
      return r.json ?? { status: 'error', reason: 'the browser did not answer' };
    },
  };
  // The LaTeX pad (Ctrl+L) asks here when what was typed is words, not symbols: one short model call, bare LaTeX back.
  const latex = async (text) => {
    if (!text.trim()) return { latex: '' };
    const r = await queue.run('interactive', (signal) => llm.chat({ messages: [{ role: 'system', content: 'Convert the maths the user describes into LaTeX. Reply with the LaTeX only: no dollar signs, no code fences, no explanation.' }, { role: 'user', content: text }], tools: null, use: 'tools', signal, maxTokens: 300 }));
    return { latex: cleanLatex(r.content) };
  };
  let bundleCache ={ at: 0, zip: null };
  const bundle = async () => {
    if (bundleCache.zip && Date.now() - bundleCache.at < 60_000) return bundleCache.zip;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bundle-'));
    try { const b = await buildMacBundle({ root: cfg.root, outDir: out }); bundleCache = { at: Date.now(), zip: fs.readFileSync(b.zip) }; } finally { fs.rmSync(out, { recursive: true, force: true }); }
    return bundleCache.zip;
  };
  const osint = createOpensky({ dataDir: cfg.dataDir, watchFile: path.join(cfg.root, 'config', 'osint-watch.json') });
  server.on('request', createHttpHandler({ cfg, auth: { check: (h, o) => auth.check(h, o) }, llmProxy, environment: async () => {
    const machine = targetState.get();
    const facts = prompts.facts(machine) ?? (await prompts.refresh(machine).then((e) => e.facts).catch(() => null)) ?? {};
    const workspace = facts.workspace_dir ?? machines[machine]?.workspaceDir ?? null;
    // the project the branch is read from: the one the person picked, else the working folder if it is a repository, else the folder JARVIS itself runs from
    let project = machine === 'pc' ? projectFolder(cfg.dataDir) : null;
    let git = null;
    if (machine === 'pc') {
      git = project ? await gitInfo(project) : null;
      if (!git && workspace) { git = await gitInfo(workspace); if (git) project = workspace; }
      if (!git && !projectFolder(cfg.dataDir)) { project = cfg.root; git = await gitInfo(project); }
    }
    return { machine, label: machines[machine]?.label ?? machine, hostname: facts.hostname ?? null, os: facts.os_version ?? facts.os ?? null, user: facts.user ?? null, folder: workspace, project, branch: git?.branch ?? null, dirty: git?.dirty ?? null, repo: git ? true : machine === 'pc' ? false : null, remote: { on: true, url: cfg.machines.server.url ?? null, devices: clientCount() } };
  }, setProject: (p) => {
    const folder = path.resolve(String(p ?? ''));
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw Object.assign(new Error('that folder does not exist'), { status: 400 });
    fs.writeFileSync(path.join(cfg.dataDir, 'project.json'), JSON.stringify({ folder }));
    return { folder };
  }, models: {
    list: () => llm.listModels(),
    select: async (key) => {
      if (queue.depth() > 0) throw Object.assign(new Error('The model is answering right now. Try again when it has finished.'), { status: 409 });
      const r = await llm.selectModel(key);
      try { fs.writeFileSync(choiceFile, JSON.stringify({ model: key })); } catch (e) { log(`could not save the model choice: ${e.message}`); }
      await health({ fresh: true }).catch(() => {}); // refreshes the cached health, so the next push to the app names the new model
      return r;
    },
  }, health, audit, conversations, digest, osint, browserView, bundle, latex, buildState: () => wsApi.buildState(), log }));

  // The same handlers also answer on loopback, so this PC's own app works whatever the network address does (Tailscale down, a new LAN IP).
  const loopback = http.createServer();
  for (const ev of ['request', 'upgrade']) server.listeners(ev).forEach((l) => loopback.on(ev, l));

  return {
    cfg, bus, router, gate, audit, orchestrator, targetState, telemetry, scheduler, digest, reminders, tasks, wsApi, server,
    async start({ port = cfg.machines.server.port, host } = {}) {
      const bind = host ? { host, reason: 'given' } : resolveBind(cfg.machines.server.bind);
      await new Promise((ok, no) => { server.once('error', no); server.listen(port, bind.host, ok); });
      const a0 = server.address();
      if (!['127.0.0.1', '0.0.0.0', '::', '::1'].includes(bind.host)) await new Promise((ok) => { loopback.once('error', (e) => { log(`not also listening on 127.0.0.1: ${e.message}`); ok(); }); loopback.listen(a0.port, '127.0.0.1', ok); });
      bridge.start(); telemetry.start(); scheduler.start();
      const rem = setInterval(() => reminders.tick(), 10_000); rem.unref();
      const a = server.address();
      log(`JARVIS server listening on ${a.address}:${a.port} (${bind.reason})`);
      return a;
    },
    async stop() {
      gate.denyAll(); orchestrator.abortAll(); bridge.stop(); scheduler.stop(); telemetry.stop(); wsApi.close();
      server.closeAllConnections?.();
      loopback.closeAllConnections?.();
      await new Promise((ok) => server.close(ok));
      if (loopback.listening) await new Promise((ok) => loopback.close(ok));
    },
  };
}

if (isMain(import.meta.url)) {
  const logFile = path.join(dataPath(loadConfig({ only: ['machines.json'] }), 'logs'), 'server.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (l) => { const line = `${new Date().toISOString()} ${l}\n`; process.stderr.write(line); try { fs.appendFileSync(logFile, line); } catch { /* disk full: keep running */ } };
  installProcessGuards(log);
  const app = await createServerApp({ log });
  await app.start();
  const stop = async () => { await app.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
