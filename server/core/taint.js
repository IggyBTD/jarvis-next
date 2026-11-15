// The tainted-chat rule (docs/security/taint-design.md). Pure: no I/O, no imports, never throws.
// Once a chat has taken in text written by someone else (mail, a web page, a file, a task result), a prompt injection may be
// steering the model. From then on every call that can carry data out, store text for later, or start something asks the
// person first and shows them the whole thing. Both lists below name what is SAFE, so a new or unknown tool taints and asks.

// Results that are only this machine's own readings or JARVIS's own data. Anything not named here taints the chat.
const CLEAN = new Set([
  'list_action_categories',
  'get_volume', 'set_volume', 'mute', 'unmute', 'media_play_pause', 'media_next', 'media_previous',
  'turn_off_display', 'set_brightness', 'toggle_dark_mode', 'night_light', 'show_desktop', 'tile_windows',
  'get_power_plan', 'set_power_plan', 'lock_screen', 'sleep', 'hibernate', 'keep_awake', 'cancel_keep_awake', 'caffeinate',
  'schedule_shutdown', 'cancel_shutdown', 'shutdown', 'restart', 'sign_out', 'battery_status', 'game_mode_on', 'game_mode_off',
  'get_system_info', 'cpu_usage', 'memory_usage', 'disk_usage', 'gpu_usage', 'temperatures', 'uptime',
  'open_app', 'open_workspace',
  // JARVIS's own stores. They stay clean because writing to them asks once a chat is tainted (see askWhenTainted).
  'set_timer', 'set_reminder', 'list_schedules', 'remember', 'forget', 'list_memories',
]);

// Tools whose text arguments go nowhere an outsider can read: reads of the person's own accounts, reads of local files, and
// names that are checked against a config file. Every other tool asks, once the chat is tainted, when it carries any text.
const QUIET = new Set([
  'list_action_categories',
  'google_calendar_events', 'google_gmail_search', 'google_gmail_read', 'google_drive_search', 'google_drive_read',
  'microsoft_calendar_events', 'microsoft_mail_search', 'microsoft_mail_read', 'microsoft_onedrive_search',
  'read_file', 'list_dir', 'search_files', 'file_info', 'find_duplicates', 'git_status', 'git_diff', 'spotlight_search',
  'open_app', 'focus_app', 'open_workspace', 'set_audio_output',
]);

const SEEN = 'This chat has read outside content (mail, web, files or a task result)';
const REASON = {
  address: `${SEEN}. Opening an address can send data out in the address itself.`,
  page: `${SEEN}. This acts on a web page and can submit or move data.`,
  other: `${SEEN}. This call carries text that may not come from you.`,
};
// Tools that open an address: they ask unless the host is on the allowlist.
const ADDRESS = new Set(['browser_navigate', 'open_url']);
// Tools that always ask in a tainted chat, with or without text in the arguments.
const ALWAYS = {
  browser_click: REASON.page, browser_type: REASON.page, browser_press: REASON.page,
  agent_task: `${SEEN}. This starts a coding task.`,
  remember: `${SEEN}. This saves a note that the model is shown in every later chat.`,
  write_file: `${SEEN}. This writes a file.`,
  run_user_script: `${SEEN}. This runs a script.`,
};

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const safeName = (n) => (typeof n === 'string' && n ? n.replace(/[^\w.-]/g, '_').slice(0, 64) : 'an unknown tool');
// Control and direction-changing characters are written out, so nothing on the card is hidden or reordered. Never clipped.
// eslint-disable-next-line no-control-regex
const visible = (s, keepNewlines = false) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, (c) => (keepNewlines && c === '\n' ? c : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
const json = (v) => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };
const lines = (args) => Object.entries(args).map(([k, v]) => `${visible(k)}: ${typeof v === 'string' ? visible(v, true) : visible(json(v))}`).join('\n');
// Any text anywhere in the arguments. Numbers and booleans do not count; anything too deep or of an odd type does.
const carries = (v, depth = 0) => (typeof v === 'string' ? v.trim() !== ''
  : v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' ? false
    : typeof v !== 'object' || depth > 4 ? true
      : Object.values(v).some((x) => carries(x, depth + 1)));
const parseUrl = (s) => { try { return typeof s === 'string' ? new URL(s) : null; } catch { return null; } };
const onList = (host, list) => (Array.isArray(list) ? list : []).some((d) => typeof d === 'string' && d.trim() !== '' && (host === d.trim().toLowerCase() || host.endsWith(`.${d.trim().toLowerCase()}`)));

// Why this tool result taints the chat, or null. Orchestrator: call it with the router's envelope after every router.invoke,
// `const why = taintOf(c.name, r)`, and when it is not null `conv.taint = markTainted(stateOf(conv), why, now().toISOString())`
// before the tool message is appended (append saves the chat). A call the router refused, the person denied or that was queued
// never ran and its text is the router's own, so it does not taint. A failed call taints like a successful one: its error text
// comes from the same place as its result (a page, a script, a remote service).
export function taintOf(name, result) {
  const r = plain(result) ? result : {};
  if (r.refused === true || r.denied === true || r.queued === true) return null;
  if (typeof name === 'string' && CLEAN.has(name)) return null;
  return `${safeName(name)} ${r.ok === false ? 'error' : 'result'}`;
}

// Whether this call must ask in a tainted chat: null, or { reason, show }. reason is one line; show is the full, unclipped
// arguments (address and host first for anything that opens one; the whole note for remember). Router: after validation,
// `const taintAsk = ctx.tainted ? askWhenTainted(call.name, args, { allowDomains: cfg.policy.browser.allowDomains }) : null`,
// pass `taintAsk` to policy.decide and, when set, build the approval summary from reason and show instead of brief(args).
// Policy: a set taintAsk turns 'auto' into 'ask' for every tier and source, and into 'deny' (not queueable) for 'scheduled'.
export function askWhenTainted(name, args, { allowDomains = [] } = {}) {
  try {
    if (!plain(args)) return { reason: REASON.other, show: visible(json(args)) };
    if (ADDRESS.has(name)) {
      const u = parseUrl(args.url);
      const host = u?.hostname.toLowerCase() || null;
      if (u?.protocol === 'https:' && host && onList(host, allowDomains)) return null;
      const rest = lines(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'url')));
      return { reason: REASON.address, show: `Address: ${visible(args.url ?? '(none)')}\nHost: ${host ?? 'cannot be read'}${rest ? `\n${rest}` : ''}` };
    }
    if (typeof name === 'string' && Object.hasOwn(ALWAYS, name)) return { reason: ALWAYS[name], show: lines(args) };
    if ((typeof name === 'string' && QUIET.has(name)) || !carries(args)) return null;
    return { reason: REASON.other, show: lines(args) };
  } catch { return { reason: REASON.other, show: '(the arguments could not be shown)' }; }
}

// ---- state: a small plain object kept on the conversation as conv.taint and saved with it --------------------------------
// { tainted: boolean, reason: string | null, at: ISO string | null, clearedAt?: ISO string }

const valid = (s) => plain(s) && typeof s.tainted === 'boolean';

// The state of a chat that has read nothing from outside. A new chat needs no call: stateOf() gives this for an empty history.
export const cleanState = () => ({ tainted: false, reason: null, at: null });

// True unless the state is a well-formed clean one. Missing or malformed counts as tainted.
export const isTainted = (state) => !valid(state) || state.tainted;

// The state after outside content came in. The first cause and time are kept; nothing here ever turns tainted into clean.
// Also call it where a task note or a coding-agent reply is appended to a chat (agent-tasks.js finish): reason 'agent task note'.
export const markTainted = (state, reason, at) => (valid(state) && state.tainted ? state
  : { tainted: true, reason: typeof reason === 'string' && reason ? reason.slice(0, 120) : 'unknown', at: typeof at === 'string' ? at : null });

// A clean state, for one thing only: the person pressing a control that says they trust this chat again. Never call it from a
// tool, a turn, a timer or anything the model can reach. Without such a control, a new chat is the only reset.
export const clearTaint = (_state, at) => ({ ...cleanState(), clearedAt: typeof at === 'string' ? at : null });

// The state of a stored chat that has no taint field yet: tainted when any stored message is a tool result (other than a
// clean tool's), a note added to the chat (task notes are stored as system messages), or anything unreadable.
export function stateFromHistory(messages) {
  if (!Array.isArray(messages)) return markTainted(null, 'unreadable history', null);
  for (const m of messages) {
    const text = plain(m) && (typeof m.content === 'string' || (m.role === 'assistant' && (m.content ?? null) === null));
    const why = !plain(m) ? 'unreadable message'
      : m.role === 'tool' ? taintOf(m.name, {})
        : m.role === 'system' ? 'note added to the chat'
          : (m.role === 'user' || m.role === 'assistant') && text ? null : 'unreadable message';
    if (why) return markTainted(null, why, typeof m?.ts === 'string' ? m.ts : null);
  }
  return cleanState();
}

// The taint state of a conversation object: its stored field, or for a chat saved before the field existed the state its
// history gives, or tainted when either is unreadable. Orchestrator: `tainted: isTainted(stateOf(conv))` in the ctx of EVERY
// router.invoke (read it fresh per call, not once per turn). Conversations: `c.taint = stateOf(c)` when a chat is loaded.
export function stateOf(conv) {
  if (!plain(conv)) return markTainted(null, 'no conversation', null);
  if (conv.taint === undefined) return stateFromHistory(conv.messages);
  return valid(conv.taint) ? conv.taint : markTainted(null, 'unreadable taint state', null);
}
