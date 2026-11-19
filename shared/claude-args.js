// How a JARVIS permission mode becomes the flags of the official `claude` program. A headless run cannot ask anything, so what a mode
// would have asked about is refused (and reported in the result) instead. Auto runs edits and the read-only allowlist and refuses every
// other command (the bridge would ask for it), with the floors the bridge keeps (destructive commands, system changes, interpreters and
// installs, files that arm later commands). Accept edits and Bypass run any command except destructive ones, system changes, secret
// reads and nested shells. Every mode refuses JARVIS's own folders and the system's (extra.protect). The flag
// --dangerously-skip-permissions and the bypassPermissions mode are never used.
import { ARMING } from './opencode-arming.js';
import { CLAUDE_SAFE } from './command-scope.js';

const SHELLS = ['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'py', 'node', 'deno', 'bun', 'npx', 'ruby', 'perl', 'php', 'osascript'];
const NESTED = ['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'powershell', 'pwsh', 'osascript']; // shells only (a command inside them is unseen)
const READ = ['Read', 'Grep', 'Glob', 'LS'];

// "git status*" -> Bash(git status:*), "ls" -> Bash(ls); patterns with a * anywhere else cannot be written as a rule and are skipped.
export function bashRule(glob) {
  const g = String(glob).trim();
  if (!g || g.slice(0, -1).includes('*')) return null;
  return g.endsWith('*') ? `Bash(${g.slice(0, -1).trim()}:*)` : `Bash(${g})`;
}

// Claude Code writes absolute paths in rules as //path, with Windows paths in POSIX form (C:\Users\x is /c/Users/x).
export const absRule = (p) => { const s = String(p).replace(/\\/g, '/').replace(/^([a-z]):/i, (_, d) => `/${d.toLowerCase()}`).replace(/\/+$/, ''); return `/${s.startsWith('/') ? s : `/${s}`}`; };

// extra.protect: JARVIS's own folder and data folder on this machine; nothing in them may be read or changed, in any mode.
export function claudeArgs(mode, policy = {}, extra = {}) {
  const own = (extra.protect ?? []).flatMap((p) => [`Read(${absRule(p)}/**)`, `Edit(${absRule(p)}/**)`]);
  // A prefix rule cannot check arguments (git diff --output=x writes a file), so only commands that stay harmless whatever they are given
  // become rules, and only those policy.json lists. Claude Code reads files with its own Read, Grep and Glob tools.
  const on = new Set((policy.allowCommands ?? []).map((g) => String(g).replace(/\*+$/, '').trim().toLowerCase()));
  const allow = CLAUDE_SAFE.filter((g) => on.has(g.replace(/\*+$/, '').toLowerCase())).map(bashRule).filter(Boolean);
  const always = [...(policy.destructive ?? []), ...(policy.system ?? [])].map(bashRule).filter(Boolean);
  const destructive = [...always, ...(policy.interpreters ?? []).map(bashRule).filter(Boolean)];
  const arming = ARMING.map((p) => `Edit(**/${p})`);
  const floors = [...destructive, ...SHELLS.map((s) => `Bash(${s}:*)`), ...arming, ...own];
  // Accept edits and Bypass (the owner's choice, 2026-11-18): any command and edit, except destructive commands, system changes, secret
  // reads and protected folders. Nested shells stay refused: a prefix rule cannot see "rm -rf" inside "bash -c ...".
  const wideFloors = [...always, ...NESTED.map((s) => `Bash(${s}:*)`), ...own];
  const flags = ['--output-format', 'stream-json', '--verbose', '--setting-sources', 'project'];
  const tools = (allowed, denied = []) => ['--allowedTools', ...allowed, ...(denied.length ? ['--disallowedTools', ...denied] : [])];
  switch (mode) {
    case 'plan': return [...flags, '--permission-mode', 'plan', ...tools(READ, ['Edit', 'Write', 'NotebookEdit', ...own])];
    case 'manual': return [...flags, '--permission-mode', 'default', ...tools(READ, own)];
    case 'accept-edits':
    case 'bypass': return [...flags, '--permission-mode', 'acceptEdits', ...tools([...READ, 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch'], wideFloors)];
    default: return [...flags, '--permission-mode', 'acceptEdits', ...tools([...READ, 'Edit', 'Write', ...allow, 'WebFetch', 'WebSearch'], floors)]; // auto
  }
}
