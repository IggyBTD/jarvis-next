// Plain-words descriptions of what JARVIS is doing, for the steps row in the chat. Pure functions, used by the UI (what a call is about
// to do, from its tool name and arguments) and by the server (a one-line summary and a short preview of what came back).
// Nothing here is ever sent to the model or used for a decision: it is display text only.

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const clipText = (s, n) => { const t = one(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const q = (s, n = 60) => `"${clipText(s, n)}"`;
const host = (u) => { try { const x = new URL(u); return clipText(x.host + (x.pathname === '/' ? '' : x.pathname), 60); } catch { return clipText(u, 60); } };
const base = (p) => { const t = one(p).replace(/[\\/]+$/, ''); const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')); return i >= 0 && i < t.length - 1 ? `${t.slice(i + 1)}` : t; };
const inAcct = (a) => (a.account ? ` (${clipText(a.account, 30)})` : '');
const days = (n) => (n ? `the next ${n} day${Number(n) === 1 ? '' : 's'}` : 'the next few days');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// name -> (args) -> [while it runs, once it is done]
const T = {
  // the guarded browser
  browser_navigate: (a) => [`Opening ${host(a.url)}`, `Opened ${host(a.url)}`],
  browser_read: () => ['Reading the page', 'Read the page'],
  browser_click: (a) => [`Clicking ${q(a.text ?? a.selector ?? 'an element')}`, `Clicked ${q(a.text ?? a.selector ?? 'an element')}`],
  browser_type: (a) => [`Typing into ${q(a.selector ?? 'a field', 40)}`, `Typed into ${q(a.selector ?? 'a field', 40)}`],
  browser_press: (a) => [`Pressing ${a.key ?? 'a key'}`, `Pressed ${a.key ?? 'a key'}`],
  browser_screenshot: () => ['Taking a screenshot of the page', 'Took a screenshot of the page'],
  browser_back: () => ['Going back a page', 'Went back a page'],
  browser_resume: () => ['Continuing in the browser', 'Continued in the browser'],
  browser_close: () => ['Closing the browser page', 'Closed the browser page'],
  // the coding agent
  agent_task: (a) => [`Handing a task to the coding agent: ${q(a.prompt, 90)}`, `Started the coding agent on: ${q(a.prompt, 90)}`],
  // mail, calendar, drive
  google_gmail_search: (a) => [`Searching Gmail${inAcct(a)} for ${q(a.query)}`, `Searched Gmail${inAcct(a)} for ${q(a.query)}`],
  google_gmail_read: (a) => [`Reading ${a.ids?.length > 1 ? `${a.ids.length} emails` : 'an email'}${inAcct(a)}`, `Read ${a.ids?.length > 1 ? `${a.ids.length} emails` : 'an email'}${inAcct(a)}`],
  google_calendar_events: (a) => [`Checking Google Calendar${inAcct(a)} for ${days(a.days)}`, `Checked Google Calendar${inAcct(a)} for ${days(a.days)}`],
  google_drive_search: (a) => [`Searching Google Drive${inAcct(a)} for ${q(a.query)}`, `Searched Google Drive${inAcct(a)} for ${q(a.query)}`],
  google_drive_read: (a) => [`Reading a Drive file${inAcct(a)}`, `Read a Drive file${inAcct(a)}`],
  microsoft_mail_search: (a) => [`Searching Outlook${inAcct(a)} for ${q(a.query ?? (a.unread ? 'unread mail' : 'recent mail'))}`, `Searched Outlook${inAcct(a)} for ${q(a.query ?? (a.unread ? 'unread mail' : 'recent mail'))}`],
  microsoft_mail_read: (a) => [`Reading ${a.ids?.length > 1 ? `${a.ids.length} Outlook emails` : 'an Outlook email'}${inAcct(a)}`, `Read ${a.ids?.length > 1 ? `${a.ids.length} Outlook emails` : 'an Outlook email'}${inAcct(a)}`],
  microsoft_calendar_events: (a) => [`Checking the Outlook calendar${inAcct(a)} for ${days(a.days)}`, `Checked the Outlook calendar${inAcct(a)} for ${days(a.days)}`],
  microsoft_onedrive_search: (a) => [`Searching OneDrive${inAcct(a)} for ${q(a.query)}`, `Searched OneDrive${inAcct(a)} for ${q(a.query)}`],
  // files and folders
  list_dir: (a) => [`Listing the folder ${q(a.path, 70)}`, `Listed the folder ${q(a.path, 70)}`],
  read_file: (a) => [`Reading ${q(base(a.path), 50)}`, `Read ${q(base(a.path), 50)}`],
  search_files: (a) => [`Searching ${q(a.path, 50)} for files matching ${q(a.pattern, 40)}`, `Searched ${q(a.path, 50)} for files matching ${q(a.pattern, 40)}`],
  file_info: (a) => [`Checking ${q(base(a.path), 50)}`, `Checked ${q(base(a.path), 50)}`],
  copy_file: (a) => [`Copying ${q(base(a.from), 40)} to ${q(a.to, 50)}`, `Copied ${q(base(a.from), 40)} to ${q(a.to, 50)}`],
  move_file: (a) => [`Moving ${q(base(a.from), 40)} to ${q(a.to, 50)}`, `Moved ${q(base(a.from), 40)} to ${q(a.to, 50)}`],
  trash_file: (a) => [`Moving ${q(base(a.path), 50)} to the trash`, `Moved ${q(base(a.path), 50)} to the trash`],
  zip_folder: (a) => [`Zipping ${q(base(a.path), 50)}`, `Zipped ${q(base(a.path), 50)}`],
  find_duplicates: (a) => [`Looking for duplicate files in ${q(a.path, 60)}`, `Looked for duplicate files in ${q(a.path, 60)}`],
  git_status: (a) => [`Checking git status in ${q(a.path ?? '.', 50)}`, `Checked git status in ${q(a.path ?? '.', 50)}`],
  git_diff: (a) => [`Reading the git diff in ${q(a.path ?? '.', 50)}`, `Read the git diff in ${q(a.path ?? '.', 50)}`],
  // apps and the computer
  open_app: (a) => [`Opening ${a.app ?? 'an app'}`, `Opened ${a.app ?? 'an app'}`],
  focus_app: (a) => [`Switching to ${a.app ?? 'an app'}`, `Switched to ${a.app ?? 'an app'}`],
  close_app: (a) => [`Closing ${a.app ?? 'an app'}`, `Closed ${a.app ?? 'an app'}`],
  open_url: (a) => [`Opening ${host(a.url)} in the browser`, `Opened ${host(a.url)} in the browser`],
  open_file: (a) => [`Opening ${q(base(a.path), 50)}`, `Opened ${q(base(a.path), 50)}`],
  open_folder: (a) => [`Opening the folder ${q(a.path, 60)}`, `Opened the folder ${q(a.path, 60)}`],
  set_volume: (a) => [`Setting the volume to ${a.level}%`, `Set the volume to ${a.level}%`],
  set_brightness: (a) => [`Setting the brightness to ${a.level}%`, `Set the brightness to ${a.level}%`],
  keep_awake: (a) => [`Keeping the computer awake for ${plural(a.minutes ?? 0, 'minute')}`, `Kept the computer awake for ${plural(a.minutes ?? 0, 'minute')}`],
  ping: (a) => [`Pinging ${a.host}`, `Pinged ${a.host}`],
  spotlight_search: (a) => [`Searching this Mac for ${q(a.query)}`, `Searched this Mac for ${q(a.query)}`],
  list_top_processes: () => ['Checking which programs use the most CPU', 'Checked which programs use the most CPU'],
  kill_process: (a) => [`Ending process ${a.pid}`, `Ended process ${a.pid}`],
  run_user_script: (a) => [`Running your script ${q(a.name)}`, `Ran your script ${q(a.name)}`],
  run_shortcut: (a) => [`Running the shortcut ${q(a.name)}`, `Ran the shortcut ${q(a.name)}`],
  remember: (a) => [`Saving a memory: ${q(a.text, 80)}`, `Saved a memory: ${q(a.text, 80)}`],
  forget: (a) => [`Forgetting ${q(a.note, 60)}`, `Forgot ${q(a.note, 60)}`],
  set_timer: (a) => [`Setting a ${plural(a.minutes ?? 0, 'minute')} timer${a.label ? ` for ${q(a.label, 30)}` : ''}`, `Set a ${plural(a.minutes ?? 0, 'minute')} timer${a.label ? ` for ${q(a.label, 30)}` : ''}`],
  set_reminder: (a) => [`Setting a reminder: ${q(a.text, 60)}`, `Set a reminder: ${q(a.text, 60)}`],
  show_notification: (a) => [`Showing a notification: ${q(a.title ?? a.text, 50)}`, `Showed a notification: ${q(a.title ?? a.text, 50)}`],
  screenshot: () => ['Taking a screenshot of the screen', 'Took a screenshot of the screen'],
  list_action_categories: () => ['Looking up which tools are available', 'Looked up which tools are available'],
};

// Fallback for the many other tools: "get_system_info" -> "Reading system info", "list_dir" style names get their verb turned around.
const VERBS = { get: ['Reading', 'Read'], list: ['Listing', 'Listed'], set: ['Setting', 'Set'], open: ['Opening', 'Opened'], close: ['Closing', 'Closed'], start: ['Starting', 'Started'],
  stop: ['Stopping', 'Stopped'], check: ['Checking', 'Checked'], show: ['Showing', 'Showed'], toggle: ['Switching', 'Switched'], clear: ['Clearing', 'Cleared'], find: ['Looking for', 'Looked for'],
  run: ['Running', 'Ran'], cancel: ['Cancelling', 'Cancelled'], install: ['Installing', 'Installed'], flush: ['Flushing', 'Flushed'], empty: ['Emptying', 'Emptied'], create: ['Creating', 'Created'] };
const generic = (name, a) => {
  const [v, ...rest] = String(name).split('_');
  const object = rest.join(' ');
  const [doing, did] = VERBS[v] ?? [null, null];
  const key = Object.entries(a ?? {}).find(([, x]) => typeof x === 'string' && x)?.[1];
  const tail = key ? ` (${clipText(key, 50)})` : '';
  if (doing) return [`${doing} ${object}${tail}`.trim(), `${did} ${object}${tail}`.trim()];
  const human = String(name).replace(/_/g, ' ');
  return [`Using ${human}${tail}`, `Used ${human}${tail}`];
};

// { doing, did }: the same step as it runs and once it is finished.
export function describeCall(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  let pair;
  try { pair = (T[name] ?? ((x) => generic(name, x)))(a); } catch { pair = generic(name, {}); }
  return { doing: pair[0], did: pair[1] };
}

// What the coding agent (OpenCode or Claude Code) does inside a task: one line per tool it uses.
export function describeAgentTool(tool, input) {
  const a = input && typeof input === 'object' ? input : {};
  const t = String(tool ?? '').toLowerCase();
  const file = a.filePath ?? a.file_path ?? a.path;
  switch (t) {
    case 'bash': return a.description ? `Ran a command: ${clipText(a.description, 80)}` : `Ran a command: ${clipText(a.command, 100)}`;
    case 'read': return `Read ${clipText(file, 80)}`;
    case 'edit': case 'multiedit': case 'patch': return `Edited ${clipText(file, 80)}`;
    case 'write': return `Wrote ${clipText(file, 80)}`;
    case 'grep': return `Searched the code for ${q(a.pattern ?? a.query)}`;
    case 'glob': return `Looked for files matching ${q(a.pattern)}`;
    case 'list': case 'ls': return `Listed ${clipText(a.path ?? '.', 80)}`;
    case 'webfetch': return `Fetched ${host(a.url)}`;
    case 'websearch': return `Searched the web for ${q(a.query)}`;
    case 'todowrite': case 'todoread': return 'Updated its plan';
    case 'task': return `Started a helper: ${clipText(a.description ?? a.prompt, 80)}`;
    default: return clipText(`Used ${t || 'a tool'}${file ? ` on ${file}` : ''}`, 100);
  }
}

// ---- results ----------------------------------------------------------------------------------------------------------------------
const LISTS = ['events', 'messages', 'files', 'items', 'results', 'entries', 'matches', 'threads', 'apps', 'windows', 'processes', 'devices', 'memories', 'tasks', 'schedules'];
const count = (v) => (Array.isArray(v) ? v.length : null);
const noun = (key) => ({ events: 'event', messages: 'message', files: 'file', items: 'item', results: 'result', entries: 'entry', matches: 'match', threads: 'thread', apps: 'app', windows: 'window', processes: 'process', devices: 'device', memories: 'memory', tasks: 'task', schedules: 'schedule' })[key] ?? 'item';

// { summary: one line, detail: a short preview of the answer } from a tool's data (or its error).
export function summarizeResult(name, data, error) {
  if (error) return { summary: clipText(error, 140), detail: clipText(error, 500) };
  if (data === undefined || data === null) return { summary: 'Done', detail: '' };
  const detail = (() => { try { return clipText(typeof data === 'string' ? data : JSON.stringify(data), 500); } catch { return ''; } })();
  if (typeof data === 'string') return { summary: clipText(data, 120) || 'Done', detail };
  if (Array.isArray(data)) return { summary: data.length === 0 ? 'Nothing found' : plural(data.length, 'item'), detail };
  if (typeof data !== 'object') return { summary: clipText(String(data), 80), detail };
  if (name === 'browser_read' && typeof data.text === 'string') return { summary: `${data.title ? `${clipText(data.title, 60)}: ` : ''}${data.text.length.toLocaleString('en-US')} characters of text`, detail };
  if (name === 'agent_task' && data.taskId) return { summary: `Started task ${data.taskId}${data.state === 'queued' ? ' (waiting for the one running)' : ''}`, detail };
  for (const k of LISTS) if (count(data[k]) !== null) { const n = data[k].length; return { summary: n === 0 ? `No ${noun(k)}s` : plural(n, noun(k)), detail }; }
  if (typeof data.exitCode === 'number') return { summary: data.exitCode === 0 ? 'Finished' : `Exited with code ${data.exitCode}`, detail };
  for (const k of ['summary', 'message', 'status', 'title', 'text', 'name']) if (typeof data[k] === 'string' && data[k]) return { summary: clipText(data[k], 120), detail };
  const keys = Object.keys(data);
  return { summary: keys.length ? clipText(keys.slice(0, 4).map((k) => `${k}: ${typeof data[k] === 'object' ? '…' : data[k]}`).join(', '), 120) : 'Done', detail };
}

// A saved tool message ("[PC] name finished:\n<untrusted ...>{json}</untrusted>") back into a summary, for chats that are reopened.
export function summarizeSaved(name, content) {
  const text = String(content ?? '');
  const ok = /\] \S+ finished:/.test(text.slice(0, 300));
  const inner = text.match(/<untrusted[^>]*>\n?([\s\S]*?)\n?<\/untrusted>/)?.[1] ?? text.replace(/^\[[^\]]*\]\s*\S+\s+(finished|failed|was not run):?\s*/, '');
  if (!ok) return { summary: clipText(inner, 140), detail: clipText(inner, 500) };
  try { return summarizeResult(name, JSON.parse(inner)); } catch { return { summary: clipText(inner, 120) || 'Done', detail: clipText(inner, 500) }; }
}
