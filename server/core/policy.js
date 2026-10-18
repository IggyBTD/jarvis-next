// Policy as code. Pure: decide() maps (action, tier, source) to auto | ask | deny from config/server/policy.json.
// Rules that no config can loosen: T3 is never auto, scheduled jobs never run T3, and a prompt cannot change any of this.
const TIERS = ['T0', 'T1', 'T2', 'T3'];

export function createPolicy(cfg) {
  const modes = cfg.modes;
  const override = (name) => (Object.hasOwn(cfg.actions ?? {}, name) ? cfg.actions[name] : null);
  const allowedScheduled = (job, name) => Object.hasOwn(cfg.scheduled_allow ?? {}, job) && cfg.scheduled_allow[job].includes(name);

  // { name, tier, source: 'user'|'voice'|'scheduled'|'agent', job? } -> { mode, queueable, reason }
  function decide({ name, tier, source = 'user', job = null }) {
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

    if (source === 'agent') return { mode: 'ask', queueable: false, reason: 'asked by the coding agent' };

    let mode = forced ?? modes.chat[t];
    if (t === 'T3' && mode === 'auto') mode = 'ask';
    return { mode, queueable: false, reason: forced ? 'policy.json action override' : `${t} default` };
  }
  return { decide };
}

// Glob match with * only; used for command allow and destructive lists.
const globToRe = (g) => new RegExp(`^${g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`, 'i');

// Classifies a shell command asked for by OpenCode: 'allow' (read-only allowlist, auto-approved and logged),
// 'destructive' (T3, ask with full details) or 'ask' (everything else, T2). Chained or substituted commands never auto-allow.
export function classifyCommand(command, cfg) {
  const c = String(command ?? '').trim();
  if (!c || c.length > cfg.maxCommandLength) return { class: 'ask', tier: 'T3', reason: c ? 'command is very long' : 'empty command' };
  if (cfg.destructive.some((g) => globToRe(g).test(c))) return { class: 'destructive', tier: 'T3', reason: 'matches a destructive pattern' };
  const chained = /[;&|`<>\n\r]|\$\(|\$\{/.test(c);
  if (!chained && cfg.allowCommands.some((g) => globToRe(g).test(c))) return { class: 'allow', tier: 'T0', reason: 'read-only allowlist' };
  return { class: 'ask', tier: 'T2', reason: chained ? 'chained or substituted command' : 'not on the allowlist' };
}
