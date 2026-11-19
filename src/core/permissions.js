// Permission decisions for model actions. Pure: no DOM, no storage, so it can be tested in node.
//
// Rules are strings: "name" matches every call of that action, "name(pattern)" matches calls whose
// primary argument fits the pattern (* matches any run of characters, including slashes).
// Order: blocked actions and blocked commands never run; then deny, then ask, then allow;
// otherwise the action's tier.
//
// Shell commands (kind "command") get extra care, because one string can hide several commands:
// the line is split at ; | || && and every part must be allowed on its own; anything that can run
// more than it shows (a subshell, backticks, redirection, background &) is never allowed by a
// rule and always falls back to asking.

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const globToRe = (pattern) => new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`, 's');

export function parseRule(rule) {
  const m = String(rule).trim().match(/^([\w-]+)(?:\(([\s\S]*)\))?$/);
  return m ? { name: m[1], pattern: m[2] ?? null } : null;
}

export function ruleMatches(rule, name, primary) {
  const r = parseRule(rule);
  if (!r || r.name !== name) return false;
  if (r.pattern === null) return true;
  return primary != null && globToRe(r.pattern).test(String(primary));
}

// --- shell command analysis ------------------------------------------------------------------

// Returns { segments, unsafe }. Quotes are respected: operators inside quotes are plain text, but
// an expansion ($( or a backtick) is unsafe even inside double quotes.
export function splitCommand(command) {
  const segments = [];
  let current = '';
  let unsafe = false;
  let quote = null;
  const cut = () => { if (current.trim()) segments.push(current.trim()); current = ''; };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote === "'") {
      current += c;
      if (c === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (c === '\\' && next !== undefined) { current += c + next; i++; continue; }
      if (c === '`' || (c === '$' && next === '(')) unsafe = true;
      current += c;
      if (c === '"') quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '\\' && next !== undefined) { current += c + next; i++; continue; }
    if (c === '`' || c === '<' || c === '>' || (c === '$' && next === '(')) { unsafe = true; current += c; continue; }
    if (c === '&' && next === '&') { cut(); i++; continue; }
    if (c === '&') { unsafe = true; current += c; continue; } // background job or call operator
    if (c === '|' && next === '|') { cut(); i++; continue; }
    if (c === '|' || c === ';' || c === '\n' || c === '\r') { cut(); continue; }
    current += c;
  }
  if (quote) unsafe = true; // an unterminated quote: the line is not what it looks like
  cut();
  return { segments, unsafe };
}

// blocked: array of RegExp (compiled from config/blocked-commands.json by the caller).
export const isBlockedCommand = (command, blocked = []) => blocked.some((re) => re.test(command));

export function compileBlocked(patterns) {
  return patterns.map((p) => new RegExp(p, 'i'));
}

// Commands whose first words are safe enough to offer "Always allow" as a prefix rule.
const PREFIX_OK = {
  git: ['status', 'diff', 'log', 'show', 'add', 'commit'],
  npm: ['test', 'run', 'build', 'lint'],
  pnpm: ['test', 'run', 'build', 'lint'],
  yarn: ['test', 'run', 'build', 'lint'],
  cargo: ['test', 'check', 'build', 'clippy', 'fmt'],
};

// The rule text offered on "Always allow": the exact call, except for a few well known
// developer commands where the first two words are offered with a wildcard.
export function suggestRule(name, primary, kind) {
  if (primary == null || primary === '') return name;
  if (kind === 'command') {
    const { segments, unsafe } = splitCommand(primary);
    if (unsafe || segments.length !== 1) return `${name}(${primary})`;
    const [program, sub] = segments[0].split(/\s+/);
    if (PREFIX_OK[program]?.includes(sub)) return `${name}(${program} ${sub}*)`;
  }
  return `${name}(${primary})`;
}

// --- the decision ----------------------------------------------------------------------------

const anyMatch = (rules, name, parts) => (rules ?? []).some((r) => parts.some((p) => ruleMatches(r, name, p)));

// Returns { decision: 'allow' | 'ask' | 'deny', reason }.
export function decide({ name, primary, tier = 'ask', rules = {}, kind = null, blocked = [] }) {
  if (tier === 'blocked') return { decision: 'deny', reason: 'blocked action' };

  let parts = [primary];
  let analysis = null;
  if (kind === 'command' && primary != null) {
    if (isBlockedCommand(String(primary), blocked)) return { decision: 'deny', reason: 'this command is on the blocked list' };
    analysis = splitCommand(String(primary));
    parts = [primary, ...analysis.segments];
  }

  if (anyMatch(rules.deny, name, parts)) return { decision: 'deny', reason: 'denied by a permission rule' };
  if (anyMatch(rules.ask, name, parts)) return { decision: 'ask', reason: 'a permission rule asks first' };

  if (analysis) {
    const covered = !analysis.unsafe && analysis.segments.length > 0
      && analysis.segments.every((seg) => (rules.allow ?? []).some((r) => ruleMatches(r, name, seg)));
    if (covered) return { decision: 'allow', reason: 'allowed by a permission rule' };
    return tier === 'auto'
      ? { decision: 'allow', reason: 'automatic action' }
      : { decision: 'ask', reason: analysis.unsafe ? 'the command uses a subshell, redirection or background job' : 'needs approval' };
  }

  if (anyMatch(rules.allow, name, parts)) return { decision: 'allow', reason: 'allowed by a permission rule' };
  return tier === 'auto'
    ? { decision: 'allow', reason: 'automatic action' }
    : { decision: 'ask', reason: 'needs approval' };
}

// Effect classes ("effect" in config/actions.json): what an action can do outside the chat. The class
// is a floor under the rules above: publish and money always ask, and careful mode asks before
// anything that changes files, processes or settings. A missing or unknown class asks.
export const EFFECTS = ['read', 'local-write', 'local-mutate', 'publish', 'money'];
export function effectFloor(effect, mode = 'normal') {
  if (!EFFECTS.includes(effect) || effect === 'publish' || effect === 'money') return 'ask';
  return mode === 'careful' && effect === 'local-mutate' ? 'ask' : null;
}

// The rule text for a call, kept for callers that do not know the action kind.
export function ruleFor(name, primary) {
  return primary == null || primary === '' ? name : `${name}(${primary})`;
}
