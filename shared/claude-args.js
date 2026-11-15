// How a JARVIS permission mode becomes the flags of the official `claude` program. A headless run cannot ask anything, so what a mode
// would have asked about is refused (and reported in the result) instead. Auto runs edits and the read-only allowlist and refuses every
// other command (the bridge would ask for it); only Bypass runs other commands. All of them keep the floors the permission bridge keeps
// (destructive commands, interpreters and installs, files that arm later commands, anything outside the working folder, which Claude
// Code itself does not edit). The flag --dangerously-skip-permissions and the bypassPermissions mode are never used.
import { ARMING } from './opencode-arming.js';
import { CLAUDE_SAFE } from './command-scope.js';

const SHELLS = ['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'py', 'node', 'deno', 'bun', 'npx', 'ruby', 'perl', 'php', 'osascript'];
const READ = ['Read', 'Grep', 'Glob', 'LS'];

// "git status*" -> Bash(git status:*), "ls" -> Bash(ls); patterns with a * anywhere else cannot be written as a rule and are skipped.
export function bashRule(glob) {
  const g = String(glob).trim();
  if (!g || g.slice(0, -1).includes('*')) return null;
  return g.endsWith('*') ? `Bash(${g.slice(0, -1).trim()}:*)` : `Bash(${g})`;
}

export function claudeArgs(mode, policy = {}) {
  // A prefix rule cannot check arguments (git diff --output=x writes a file), so only commands that stay harmless whatever they are given
  // become rules, and only those policy.json lists. Claude Code reads files with its own Read, Grep and Glob tools.
  const on = new Set((policy.allowCommands ?? []).map((g) => String(g).replace(/\*+$/, '').trim().toLowerCase()));
  const allow = CLAUDE_SAFE.filter((g) => on.has(g.replace(/\*+$/, '').toLowerCase())).map(bashRule).filter(Boolean);
  const destructive = [...(policy.destructive ?? []), ...(policy.interpreters ?? [])].map(bashRule).filter(Boolean);
  const arming = ARMING.map((p) => `Edit(**/${p})`);
  const floors = [...destructive, ...SHELLS.map((s) => `Bash(${s}:*)`), ...arming];
  const flags = ['--output-format', 'stream-json', '--verbose', '--setting-sources', 'project'];
  const tools = (allowed, denied = []) => ['--allowedTools', ...allowed, ...(denied.length ? ['--disallowedTools', ...denied] : [])];
  switch (mode) {
    case 'plan': return [...flags, '--permission-mode', 'plan', ...tools(READ, ['Edit', 'Write', 'NotebookEdit'])];
    case 'manual': return [...flags, '--permission-mode', 'default', ...tools(READ)];
    case 'accept-edits': return [...flags, '--permission-mode', 'acceptEdits', ...tools([...READ, 'Edit', 'Write', ...allow], floors)];
    case 'bypass': return [...flags, '--permission-mode', 'acceptEdits', ...tools([...READ, 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch'], floors)];
    default: return [...flags, '--permission-mode', 'acceptEdits', ...tools([...READ, 'Edit', 'Write', ...allow, 'WebFetch', 'WebSearch'], floors)]; // auto
  }
}
