// Policy as code. Pure: decide() maps (action, tier, source) to auto | ask | deny from config/server/policy.json.
// Rules that no config can loosen: T3 is never auto, scheduled jobs never run T3, and a prompt cannot change any of this.
// The coding agent's permissions (opencode-bridge.js) come through here too: the permission mode answers what it may, policy has the
// last word.
const TIERS = ['T0', 'T1', 'T2', 'T3'];
const EDIT_KINDS = new Set(['edit', 'write', 'patch', 'multiedit']);

// Tools that ask, whatever their tier, once the turn has taken in untrusted content (a tool result: mail, web, files, task notes).
const ASK_WHEN_TAINTED = new Set(['agent_task']);

// What a permission mode answers for the coding agent without asking: 'once', 'reject', or null (ask the person). T3 (outside the
// workspace, destructive, interpreters, files that arm later commands) is never answered 'once'. Only commands on the read-only
// allowlist (cls.class 'allow') run by themselves in Auto; every other command asks.
export function modeAnswer(mode, { kind, cls, tier, armed }) {
  const isEdit = EDIT_KINDS.has(kind);
  const isShell = kind === 'bash' || kind === 'shell';
  const isDir = kind === 'external_directory'; // T2 here means a folder the person trusts; anything else arrives as T3
  const readOnly = isShell && cls?.class === 'allow';
  const safe = tier !== 'T3' && !armed;
  if (mode === 'plan') return readOnly || kind === 'webfetch' || (isDir && safe) ? 'once' : 'reject';
  if (mode === 'manual') return readOnly ? 'once' : null;
  if (mode === 'accept-edits') return readOnly || ((isEdit || isDir) && safe) ? 'once' : null;
  if (mode === 'auto') return readOnly || (safe && (isEdit || isDir || kind === 'webfetch')) ? 'once' : null;
  if (mode === 'bypass') return safe ? 'once' : null;
  return null;
}

export function createPolicy(cfg) {
  const modes = cfg.modes;
  const override = (name) => (Object.hasOwn(cfg.actions ?? {}, name) ? cfg.actions[name] : null);
  const allowedScheduled = (job, name) => Object.hasOwn(cfg.scheduled_allow ?? {}, job) && cfg.scheduled_allow[job].includes(name);

  // { name, tier, source: 'user'|'voice'|'scheduled'|'agent', job?, tainted?, permission? } -> { mode, queueable, reason }
  // permission: { mode, kind, cls, armed } for a request from the coding agent (the permission bridge).
  function decide({ name, tier, source = 'user', job = null, tainted = false, permission = null }) {
    const t = TIERS.includes(tier) ? tier : 'T3';
    const forced = override(name);
    if (forced === 'deny') return { mode: 'deny', queueable: false, reason: 'denied by policy.json' };

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
    if (mode === 'auto' && tainted && ASK_WHEN_TAINTED.has(name)) { mode = 'ask'; reason = 'this turn has read untrusted content'; }
    if (t === 'T3' && mode === 'auto') mode = 'ask';
    return { mode, queueable: false, reason };
  }
  return { decide };
}

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
// Glob with * only, matched anywhere in the command at a word start: "rm -rf*" also catches "cd x; rm -rf y" and "cmd /c rm -rf y".
const globAnywhere = (g) => new RegExp(`${g.startsWith('*') ? '' : '(?:^|(?<=[\\s;&|(){}\'"`=,\\\\/]))'}${g.split('*').map(esc).join('[\\s\\S]*')}`, 'i');
// Glob with * only, anchored at both ends: the read-only allowlist.
const globWhole = (g) => new RegExp(`^${g.split('*').map(esc).join('[\\s\\S]*')}$`, 'i');

// The forms a T3 pattern is looked for in: as written, and with quotes and escape characters taken out (r"m" -rf, r^m -rf).
const forms = (c) => { const one = c.replace(/[ \t]+/g, ' '); return [...new Set([one, one.replace(/["'^`\\]/g, '')])]; };

// Classifies a shell command asked for by the coding agent: 'allow' (read-only allowlist, T0), 'destructive' (T3: a destructive
// pattern anywhere, an interpreter, inline or encoded code, a package install, a registry or scheduler write) or 'ask' (T2).
// Chained or substituted commands never auto-allow.
export function classifyCommand(command, cfg) {
  const c = String(command ?? '').trim();
  if (!c || c.length > cfg.maxCommandLength) return { class: 'ask', tier: 'T3', reason: c ? 'command is very long' : 'empty command' };
  const variants = forms(c);
  if (cfg.destructive.some((g) => variants.some((v) => globAnywhere(g).test(v)))) return { class: 'destructive', tier: 'T3', reason: 'matches a destructive pattern' };
  if ((cfg.interpreters ?? []).some((g) => variants.some((v) => globAnywhere(g).test(v)))) return { class: 'destructive', tier: 'T3', reason: 'runs an interpreter, inline or encoded code, or an install' };
  const chained = /[;&|`<>(){}\n\r]/.test(c); // also parentheses and braces: PowerShell runs a command inside (...) and { ... }
  if (!chained && cfg.allowCommands.some((g) => globWhole(g).test(c))) return { class: 'allow', tier: 'T0', reason: 'read-only allowlist' };
  return { class: 'ask', tier: 'T2', reason: chained ? 'chained or substituted command' : 'not on the allowlist' };
}
