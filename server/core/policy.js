// Policy as code. Pure: decide() maps (action, tier, source) to auto | ask | deny from config/server/policy.json.
// Rules that no config can loosen: T3 is never auto, scheduled jobs never run T3, and a prompt cannot change any of this.
// The coding agent's permissions (opencode-bridge.js) come through here too: the permission mode answers what it may, policy has the
// last word.
import { readOnly, pathsOf, resolveLexical, within } from '../../shared/command-scope.js';

const TIERS = ['T0', 'T1', 'T2', 'T3'];
const EDIT_KINDS = new Set(['edit', 'write', 'patch', 'multiedit']);

// What a permission mode answers for the coding agent without asking: 'once', 'reject', or null (ask the person). T3 (outside the
// workspace, destructive, interpreters, files that arm later commands) is never answered 'once'. Only commands on the read-only
// allowlist (cls.class 'allow') run by themselves in Auto; every other command asks. Manual asks for everything. Plan runs nothing by
// itself: reads, web fetches and trusted folders ask, anything that could change something is refused.
export function modeAnswer(mode, { kind, cls, tier, armed }) {
  const isEdit = EDIT_KINDS.has(kind);
  const isShell = kind === 'bash' || kind === 'shell';
  const isDir = kind === 'external_directory'; // T2 here means a folder the person trusts; anything else arrives as T3
  const readOnly = isShell && cls?.class === 'allow';
  const safe = tier !== 'T3' && !armed;
  if (mode === 'plan') return readOnly || kind === 'webfetch' || (isDir && safe) ? null : 'reject';
  if (mode === 'manual') return null;
  if (mode === 'accept-edits') return readOnly || ((isEdit || isDir) && safe) ? 'once' : null;
  if (mode === 'auto') return readOnly || (safe && (isEdit || isDir || kind === 'webfetch')) ? 'once' : null;
  if (mode === 'bypass') return safe ? 'once' : null;
  return null;
}

export function createPolicy(cfg) {
  const modes = cfg.modes;
  const override = (name) => (Object.hasOwn(cfg.actions ?? {}, name) ? cfg.actions[name] : null);
  const allowedScheduled = (job, name) => Object.hasOwn(cfg.scheduled_allow ?? {}, job) && cfg.scheduled_allow[job].includes(name);

  // { name, tier, source: 'user'|'voice'|'scheduled'|'agent', job?, taintAsk?, permission? } -> { mode, queueable, reason }
  // taintAsk: set (server/core/taint.js askWhenTainted) when the chat has read outside content and this call can carry data out,
  //   store text for later or start something. It turns auto into ask whatever the tier or a policy.json override says, and is a
  //   deny for a scheduled source (nobody is there to answer). Only a policy.json deny is stronger.
  // permission: { mode, kind, cls, armed } for a request from the coding agent (the permission bridge).
  function decide({ name, tier, source = 'user', job = null, taintAsk = null, permission = null }) {
    const t = TIERS.includes(tier) ? tier : 'T3';
    const forced = override(name);
    if (forced === 'deny') return { mode: 'deny', queueable: false, reason: 'denied by policy.json' };

    if (taintAsk && source === 'scheduled') return { mode: 'deny', queueable: false, reason: 'the chat has read outside content and nobody is there to approve' };
    if (source === 'scheduled') {
      if (t === 'T3') return { mode: 'deny', queueable: true, reason: 'T3 never runs unattended' };
      if (t === 'T2') {
        if (job && allowedScheduled(job, name)) return { mode: 'auto', queueable: false, reason: `allowed for scheduled job ${job}` };
        return { mode: 'deny', queueable: forced === null, reason: 'T2 needs approval and no one is there to give it' };
      }
      return { mode: modes.scheduled[t] === 'auto' ? 'auto' : 'deny', queueable: false, reason: 'scheduled tier default' };
    }

    if (source === 'agent') {
      if (!permission) return { mode: 'ask', queueable: false, reason: 'asked by the coding agent' };
      const answer = modeAnswer(permission.mode, { ...permission, tier: t });
      if (answer === 'reject') return { mode: 'deny', queueable: false, reason: `permission mode ${permission.mode}` };
      if (answer === 'once' && t !== 'T3' && forced !== 'ask') return { mode: 'auto', queueable: false, reason: `permission mode ${permission.mode}` };
      return { mode: 'ask', queueable: false, reason: forced === 'ask' ? 'policy.json action override' : `permission mode ${permission.mode}` };
    }

    let mode = forced ?? modes.chat[t];
    let reason = forced ? 'policy.json action override' : `${t} default`;
    if (mode === 'auto' && taintAsk) { mode = 'ask'; reason = String(taintAsk.reason ?? 'the chat has read outside content'); }
    if (t === 'T3' && mode === 'auto') mode = 'ask';
    return { mode, queueable: false, reason };
  }
  return { decide };
}

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
// Glob with * only, matched anywhere in the command at a word start: "rm -rf*" also catches "cd x; rm -rf y" and "cmd /c rm -rf y".
const globAnywhere = (g) => new RegExp(`${g.startsWith('*') ? '' : '(?:^|(?<=[\\s;&|(){}\'"`=,\\\\/]))'}${g.split('*').map(esc).join('[\\s\\S]*')}`, 'i');

// The forms a T3 pattern is looked for in: as written, and with quotes and escape characters taken out (r"m" -rf, r^m -rf).
const forms = (c) => { const one = c.replace(/[ \t]+/g, ' '); return [...new Set([one, one.replace(/["'^`\\]/g, '')])]; };

// Classifies a shell command asked for by the coding agent on one machine. scope: { os, workspace, trusted } (absolute folders).
//   'allow' (T0): one read-only command on the allowlist, its flags on that command's list, every path inside the workspace
//     (shared/command-scope.js parses it; without a scope nothing is allowed);
//   'destructive' (T3): a destructive pattern anywhere, an interpreter, inline or encoded code, an install, a registry or scheduler
//     write, a variable or substitution (what it touches cannot be known), or a path outside the workspace and trusted folders;
//   'ask' (T2): everything else.
export function classifyCommand(command, cfg, scope = null) {
  const c = String(command ?? '').trim();
  if (!c || c.length > cfg.maxCommandLength) return { class: 'ask', tier: 'T3', reason: c ? 'command is very long' : 'empty command' };
  if (scope && touchesProtected(c, scope)) return { class: 'destructive', tier: 'T3', reason: 'touches JARVIS\'s own folder' };
  const ro = scope?.workspace ? readOnly(c, { os: scope.os, workspace: scope.workspace, enabled: cfg.allowCommands }) : { ok: false, reason: 'no workspace to check paths against' };
  if (ro.ok) return { class: 'allow', tier: 'T0', reason: ro.reason };
  const variants = forms(c);
  if (cfg.destructive.some((g) => variants.some((v) => globAnywhere(g).test(v)))) return { class: 'destructive', tier: 'T3', reason: 'matches a destructive pattern' };
  if ((cfg.interpreters ?? []).some((g) => variants.some((v) => globAnywhere(g).test(v)))) return { class: 'destructive', tier: 'T3', reason: 'runs an interpreter, inline or encoded code, or an install' };
  // a command that prints the environment it runs in (OpenCode's own password is in it): set, env, printenv, export, declare -x
  if (/(^|[;&|]\s*)(set|env|printenv|export|declare(\s+-[a-z]+)*|typeset)\s*($|[;&|])/i.test(c)) return { class: 'destructive', tier: 'T3', reason: 'prints the environment' };
  if (scope) {
    const { dynamic, paths } = pathsOf(c, scope);
    if (dynamic) return { class: 'destructive', tier: 'T3', reason: 'uses a variable or substitution, so what it touches cannot be known' };
    if (paths.some((p) => !p || !inRoots(p, scope))) return { class: 'destructive', tier: 'T3', reason: 'names a path outside the workspace, or one that cannot be resolved' };
  }
  return { class: 'ask', tier: 'T2', reason: ro.reason };
}

const inRoots = (p, scope) => [scope.workspace, ...(scope.trusted ?? [])].filter(Boolean).some((r) => within(p, r, scope.os));
// scope.protected: JARVIS's own folder and data folder on that machine. Nothing under them is ever routine for the coding agent:
// matched on every resolved path (case ignored) and on the command text itself, whichever slash it uses.
export const isProtected = (p, scope) => !!p && (scope.protected ?? []).some((r) => within(p, r, scope.os, { loose: true }));
function touchesProtected(c, scope) {
  if (!(scope.protected ?? []).length) return false;
  const text = c.toLowerCase().replace(/\//g, '\\');
  if (scope.protected.some((r) => text.includes(r.toLowerCase().replace(/\//g, '\\')))) return true;
  const { paths } = pathsOf(c, scope);
  return paths.some((p) => isProtected(p, scope));
}

// The coding agent's paths (as it sent them; relative ones are under the workspace) resolved, or null for one that cannot be. A
// trailing wildcard (C:\proj\src\*) names the folder itself.
export const resolveRequestPath = (p, scope) => resolveLexical(String(p ?? '').replace(/[\\/]\*+$/, '') || '.', { os: scope.os, cwd: scope.workspace });
// True when any of them is outside the workspace and the trusted folders, under JARVIS's own folders, or cannot be resolved.
export const pathsOutside = (paths, scope) => paths.some((p) => { const r = resolveRequestPath(p, scope); return !r || !inRoots(r, scope) || isProtected(r, scope); });
export const pathsProtected = (paths, scope) => paths.some((p) => isProtected(resolveRequestPath(p, scope), scope));
