// THE chokepoint. Every tool call goes  tool-router -> policy -> gate -> audit -> agent  and nothing else reaches an agent
// (only this file imports agent-client; scripts/check-chokepoint.js and a test enforce it). The router validates the call
// against the contract, refuses any attempt to name a target, binds the target the turn started with, asks policy, asks the
// gate when needed, writes the audit lines and returns a size-bounded, target-tagged, untrusted-wrapped result.
import { validate } from '../../shared/schema.js';
import { wrapUntrusted, clip } from '../../shared/util.js';
import { createAgentClient, AgentUnreachable } from './agent-client.js';
import { selectTools, allCategories, categoryScores } from './tool-select.js';
import { askWhenTainted } from './taint.js';

const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;
const FORBIDDEN_KEYS = /^(target|targets|host|hostname|machine|machineid|computer|device_target)$/i;
const MAX_RESULT_CHARS = 6000;
export const safeName = (n) => String(n ?? '').replace(/[^\w.-]/g, '_').slice(0, 64) || 'unnamed';

function hasForbiddenKey(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 4) return false;
  return Object.keys(v).some((k) => FORBIDDEN_KEYS.test(k) || hasForbiddenKey(v[k], depth + 1));
}
const brief = (args) => clip(Object.entries(args ?? {}).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(clip(v, 80)) : JSON.stringify(v)}`).join(', '), 200);
const toolFn = (d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.params } });

/**
 * @param {object} o
 * @param {object} o.cfg loaded config
 * @param {object} o.policy from createPolicy
 * @param {object} o.gate from createGate
 * @param {object} o.audit from createAuditLog
 * @param {(machine: string) => string} o.tokens current agent token for a machine
 */
export function createToolRouter({ cfg, policy, gate, audit, tokens, fetchImpl = fetch, now = () => Date.now() }) {
  const machines = cfg.machines.machines;
  const agent = createAgentClient({ machines, tokens, fetchImpl });
  const internal = new Map();   // name -> definition (tools that are not in actions.json, plus handlers for internal contract entries)
  const contract = new Map(cfg.actions.actions.map((a) => [a.name, a]));
  const scriptTier = (args) => cfg.scripts.scripts.find((s) => s.name === args?.name)?.tier ?? 'T3';

  // definition: { name, description, category, tier | tierOf(args), params, handler(args, ctx), alwaysOn?, dryRun?(args) }
  function register(def) {
    if (!NAME_RE.test(def.name) && !/^browser_[a-z_]+$/.test(def.name)) throw new Error(`bad tool name ${def.name}`);
    internal.set(def.name, def);
  }

  const osOf = (target) => machines[target].os;

  function lookup(name, target) {
    const os = osOf(target);
    const c = contract.get(name);
    if (c) {
      if (!c.enabled || !c.platforms.includes(os) || c.system) return null; // system actions are for the server's own use (tasks), never for the model
      if (c.internal) {
        const h = internal.get(name);
        return h ? { ...h, kind: 'internal', tier: h.tier ?? c.tier, params: c.params, description: c.description, category: c.category, maxResultChars: c.maxResultChars } : null;
      }
      return { name, kind: 'agent', tier: c.tier, tierOf: name === 'run_user_script' ? scriptTier : null, params: c.params, description: c.description, category: c.category, timeoutMs: c.timeoutMs };
    }
    const h = internal.get(name);
    return h && !contract.has(name) ? { ...h, kind: 'internal', tier: h.tier ?? 'T1' } : null;
  }

  // Tools for one model request. Registry tools are capped; the always-on extras sit on top of the cap.
  function toolDefs(target, { text = '', recent = [], unlocked = new Set(), max = cfg.actions.maxToolsPerRequest } = {}) {
    const os = osOf(target);
    const regDefs = cfg.actions.actions.filter((a) => a.enabled && !a.system && a.platforms.includes(os) && (!a.internal || internal.has(a.name))).map((a) => ({ ...a }));
    const { tools, categories } = selectTools({ defs: regDefs, text, recent, unlocked, max });
    const wantBrowser = categoryScores(text).browser > 0 || unlocked.has('browser') || recent.some((n) => n.startsWith('browser_'));
    const extras = [...internal.values()].filter((d) => !contract.has(d.name) && (d.alwaysOn || (d.category === 'browser' && wantBrowser)));
    const list = [...tools, ...extras, listCategoriesDef];
    return { tools: list.map(toolFn), names: list.map((d) => d.name), registryCount: tools.length, categories };
  }

  const listCategoriesDef = {
    name: 'list_action_categories', category: 'meta', tier: 'T0', kind: 'internal',
    description: 'List the groups of actions available on the active computer. Pass a category to make its actions available for the rest of this conversation.',
    params: { type: 'object', properties: { category: { type: 'string', maxLength: 40 } }, required: [], additionalProperties: false },
    handler(args, ctx) {
      const os = osOf(ctx.target);
      const defs = cfg.actions.actions.filter((a) => a.enabled && !a.system && a.platforms.includes(os) && (!a.internal || internal.has(a.name)));
      const cats = allCategories(defs);
      if (args.category) {
        if (!cats.includes(args.category)) return { error: `unknown category. Available: ${cats.join(', ')}` };
        ctx.conversation?.unlocked?.add(args.category);
        return { unlocked: args.category, actions: defs.filter((a) => a.category === args.category).map((a) => a.name) };
      }
      return { categories: cats.map((c) => ({ category: c, actions: defs.filter((a) => a.category === c).length })), unlocked: [...(ctx.conversation?.unlocked ?? [])] };
    },
  };

  const envelope = (ok, target, name, content, extra = {}) => ({ ok, target, name, content, ...extra });
  const tag = (target) => machines[target].label;

  // ---- the call ---------------------------------------------------------------------------------------------------------
  async function invoke(call, ctx) {
    const started = now();
    const target = ctx.target;
    const source = ctx.source ?? 'user';
    const name = safeName(call.name);
    if (!machines[target]) return envelope(false, target, name, `Unknown target "${target}".`);
    const base = { component: 'router', target, source, taskId: ctx.taskId };
    let args = call.args;
    if (args === undefined) { try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = null; } }
    let tier = null;

    const refuse = async (reason, decision = 'deny', extra = {}) => {
      await audit.append({ ...base, action: name, args: args && typeof args === 'object' ? args : { raw: clip(call.arguments, 200) }, tier, decision, outcome: 'refused', reason, durationMs: now() - started }).catch(() => {}); // a refusal stands even if it cannot be written down
      return envelope(false, target, name, `[${tag(target)}] ${name} was not run: ${reason}`, { refused: true, ...extra });
    };

    if (!args || typeof args !== 'object' || Array.isArray(args)) return refuse('the arguments must be a JSON object', 'invalid');
    if (hasForbiddenKey(args)) return refuse('arguments named target, host or machine are not accepted: only the user chooses the computer', 'invalid');
    if (!NAME_RE.test(String(call.name ?? '')) && !/^browser_[a-z_]+$/.test(String(call.name ?? ''))) return refuse('unknown tool', 'invalid');
    // ctx.offered: the tools the model was given in this request (the chat loop). A name it was not given is unknown to it, whatever
    // the registry holds, so an injected tool name cannot reach a tool that selection kept out.
    if (ctx.offered && !ctx.offered.has(call.name)) return refuse(`unknown or unavailable tool "${name}" on ${tag(target)}`, 'invalid');
    const def = call.name === 'list_action_categories' ? listCategoriesDef : lookup(call.name, target);
    if (!def) return refuse(`unknown or unavailable tool "${name}" on ${tag(target)}`, 'invalid');
    const bad = validate(def.params, args);
    if (bad.length) return refuse(`bad arguments: ${bad.join('; ')}`, 'invalid');

    tier = def.tierOf ? def.tierOf(args) : def.tier;
    // A chat that has read outside content (ctx.tainted, server/core/taint.js) asks before calls that can carry data out, and the card
    // then shows the arguments whole (brief() clips them, which would hide the data being sent).
    const taintAsk = ctx.tainted ? askWhenTainted(call.name, args, { allowDomains: cfg.policy?.browser?.allowDomains ?? [] }) : null;
    const verdict = policy.decide({ name: call.name, tier, source, job: ctx.job, taintAsk });
    const summary = taintAsk ? `${call.name} on ${tag(target)}. ${taintAsk.reason}\n${taintAsk.show}` : `${call.name} on ${tag(target)}${Object.keys(args).length ? ` (${brief(args)})` : ''}`;

    let how = 'auto';
    if (verdict.mode === 'deny' && !verdict.queueable) return refuse(verdict.reason, 'deny');
    if (verdict.mode === 'deny' && verdict.queueable) {
      const q = await gate.requestApproval({ action: call.name, args, tier, target, source, taskId: ctx.taskId, summary, queueable: true });
      return envelope(false, target, name, `[${tag(target)}] ${name} needs approval and nobody is here to give it. It was queued; the user will see it when they connect.`, { queued: true, requestId: q.id });
    }
    if (verdict.mode === 'ask') {
      let dryRun = null;
      try { dryRun = def.dryRun ? def.dryRun(args) : def.kind === 'agent' ? (await agent.call(target, call.name, args, { dryRun: true, signal: ctx.signal, timeoutMs: 8000 })).data ?? null : null; } catch { /* the preview is a courtesy */ }
      const answer = await gate.requestApproval({ action: call.name, args, tier, target, source, taskId: ctx.taskId, summary, dryRun });
      if (!answer.approved) {
        await audit.append({ ...base, action: call.name, args, tier, decision: answer.decision, outcome: 'not_run', reason: answer.reason, durationMs: now() - started }).catch(() => {});
        return envelope(false, target, name, `[${tag(target)}] The user did not approve ${call.name} (${answer.decision}). Do not retry it or look for a way around it.`, { denied: true });
      }
      how = 'approved';
    }
    // a T2 or T3 action runs only once the audit log holds the line saying it started: no line, no action (F1-5)
    if (tier === 'T2' || tier === 'T3') {
      try { await audit.append({ ...base, action: call.name, args, tier, decision: how, outcome: 'started' }); } catch { return envelope(false, target, name, `[${tag(target)}] ${name} was not run: the audit log could not be written, and a ${tier} action never runs unrecorded.`, { refused: true }); }
    }
    return execute({ def, name: call.name, args, tier, how, ctx, started, base });
  }

  async function execute({ def, name, args, tier, how, ctx, started, base }) {
    const target = ctx.target;
    let data;
    let ok = true;
    let error = null;
    try {
      if (def.kind === 'agent') {
        const r = await agent.call(target, name, args, { signal: ctx.signal, timeoutMs: def.timeoutMs ?? 60_000 });
        ok = !!r.ok;
        data = r.data;
        error = r.error ?? null;
      } else {
        const caps = capabilities(target, ctx);
        data = await def.handler(args, { ...ctx, caps, escalate: (req) => gate.requestApproval({ target, source: ctx.source, taskId: ctx.taskId, ...req }) });
        if (data && typeof data === 'object' && data.error && Object.keys(data).length === 1) { ok = false; error = data.error; }
      }
    } catch (e) {
      ok = false;
      error = e instanceof AgentUnreachable ? e.message : String(e.message ?? e);
      if (ctx.signal?.aborted) error = 'cancelled';
    }
    const durationMs = now() - started;
    await audit.append({ ...base, action: name, args, tier, decision: how, outcome: ok ? 'ok' : `error: ${clip(error, 120)}`, durationMs }).catch(() => {}); // it already ran; the started line is on record
    const label = tag(target);
    const body = ok ? wrapUntrusted(`${name} result from ${label}`, JSON.stringify(data ?? null), { max: def.maxResultChars ?? cfg.models?.maxToolResultChars ?? MAX_RESULT_CHARS }) : wrapUntrusted(`${name} error from ${label}`, error ?? 'failed', { max: 600 });
    return envelope(ok, target, name, `[${label}] ${name} ${ok ? 'finished' : 'failed'}:\n${body}`, { data: ok ? data : undefined, error: ok ? undefined : error, durationMs });
  }

  // Restricted handles for internal tools (OpenCode, browser). They reach the agent only through allowlisted proxy routes.
  function capabilities(target, ctx = {}) {
    return {
      opencode: (method, sub, body, o) => agent.opencode(target, method, sub, body, { signal: ctx.signal, ...o }),
      claude: (method, sub, body, o) => agent.claude(target, method, sub, body, { signal: ctx.signal, ...o }),
      browser: (method, sub, body, o) => agent.browser(target, method, sub, body, { signal: ctx.signal, ...o }),
      events: (onEvent, o) => agent.events(target, onEvent, o),
      // system actions only (git snapshots and changes for tasks, path resolution for the bridge): never offered to the model, no side
      // effect a person would approve. Every other action goes through invoke, with policy, the gate and the audit.
      call: (name, args, o) => (contract.get(name)?.system ? agent.call(target, name, args, { signal: ctx.signal, ...o }) : Promise.resolve({ ok: false, error: `${name} is not a system action; tools go through invoke` })),
    };
  }

  // A queued request that the user approved later: policy and gate already ran, so execute the same request again.
  async function runApproved(request) {
    const def = lookup(request.action, request.target);
    if (!def) return { ok: false, error: 'tool no longer available' };
    const bad = validate(def.params, request.args ?? {});
    if (bad.length) return { ok: false, error: `bad arguments: ${bad.join('; ')}` };
    const ctx = { target: request.target, source: request.source, taskId: request.taskId, signal: AbortSignal.timeout(120_000) };
    return execute({ def, name: request.action, args: request.args, tier: request.tier, how: 'approved-queued', ctx, started: now(), base: { component: 'router', target: request.target, source: request.source, taskId: request.taskId } });
  }
  gate.setExecutor(runApproved);

  return {
    invoke, register, toolDefs, runApproved,
    capabilities: (target, ctx) => capabilities(target, ctx),
    info: (target) => agent.info(target),
    health: (target) => agent.health(target),
    has: (name, target) => !!lookup(name, target),
    tierOf: (name, args) => { const c = contract.get(name) ?? internal.get(name); return name === 'run_user_script' ? scriptTier(args) : c?.tier ?? null; },
  };
}
