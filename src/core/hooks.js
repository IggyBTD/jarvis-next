// Hooks: shell commands the user configures (config/hooks.json) to run around the agent's actions.
// Pure matching and command building here; actions.js runs them through agent-client (the same
// project folder and shell as run_command, never the model's own words). Events:
//   before  runs before an action; with "block": true a failing command (exit code not 0) refuses
//           the action and its output is the reason the model reads
//   after   runs after a successful action; its output is added to the result the model reads
// "match" is an action name or "a|b" list ("*" for all); "path" (optional) is a glob on the
// primary argument ("src/**/*.js"). The command may use {path} and {tool}; a value with a quote,
// newline or shell metacharacter is refused rather than escaped, and the hook is skipped.
const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);

export function matchHooks(hooks, event, name, primary) {
  return (hooks ?? []).filter((h) => {
    if (h.event !== event || !h.command) return false;
    const names = String(h.match ?? '*').split('|').map((s) => s.trim());
    if (!names.includes('*') && !names.includes(name)) return false;
    if (h.path && !(primary && globToRegExp(h.path).test(String(primary).replace(/\\/g, '/')))) return false;
    return true;
  });
}

const SAFE = /^[\w./:@+=,\- ]*$/; // path-like characters only

// Returns the command with placeholders filled, or null when a value is not safe to put in a shell.
export function buildCommand(template, vars) {
  let ok = true;
  const out = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = String(vars[key] ?? '');
    if (!SAFE.test(v)) ok = false;
    return v;
  });
  return ok ? out : null;
}
