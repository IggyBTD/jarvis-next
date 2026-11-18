// The five permission modes of the coding agent, in the order they are listed. The server enforces them (opencode-bridge.js);
// the app only picks one. Whatever the mode, T3 (destructive commands, system changes, secret reads, JARVIS's own folders and the
// system's) always asks.
export const MODES = ['auto', 'manual', 'accept-edits', 'plan', 'bypass'];
export const DEFAULT_MODE = 'auto';
export const MODE_LABELS = { auto: 'Auto', manual: 'Manual', 'accept-edits': 'Accept edits', plan: 'Plan', bypass: 'Bypass permissions' };
export const MODE_HINTS = {
  auto: 'Edits in the project and read-only commands run; other commands ask',
  manual: 'Asks before every edit and command',
  'accept-edits': 'Everything runs, except destructive commands and system folders',
  plan: 'Researches and proposes a plan, changes nothing',
  bypass: 'Same as Accept edits: only what is always asked asks',
};
export const PLAN_NOTE = 'Plan mode: research and read as much as you need, then write a plan. Do not change any file and do not run anything that changes something.';
