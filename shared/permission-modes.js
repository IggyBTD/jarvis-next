// The five permission modes of the coding agent, in the order they are listed. The server enforces them (opencode-bridge.js);
// the app only picks one. Whatever the mode, T3 (outside the workspace, destructive, files that arm later commands) always asks.
export const MODES = ['auto', 'manual', 'accept-edits', 'plan', 'bypass'];
export const DEFAULT_MODE = 'auto';
export const MODE_LABELS = { auto: 'Auto', manual: 'Manual', 'accept-edits': 'Accept edits', plan: 'Plan', bypass: 'Bypass permissions' };
export const MODE_HINTS = {
  auto: 'Edits and routine commands run; risky ones ask',
  manual: 'Asks before every edit and command',
  'accept-edits': 'Edits run, commands ask',
  plan: 'Researches and proposes a plan, changes nothing',
  bypass: 'Nothing asks, except what is always asked',
};
export const PLAN_NOTE = 'Plan mode: research and read as much as you need, then write a plan. Do not change any file and do not run anything that changes something.';
