// Slash commands typed in the chat box. They run locally, are never sent to the model,
// and only the user can issue them (the model has no way to call them).
import {
  saveMemory, searchMemory, setMemoryStatus, memoryDoctor,
  addInstinct, listInstincts, adjustInstinct, retireInstinct, promoteInstinct,
} from './memory-client.js';
import { setProject, getProject, pickFolder } from './agent-client.js';
import { copyClipboard, serverMode } from './server-link.js';
import { listRules, removeLocalRule, listHooks } from './actions.js';
import { getSkills } from './skills.js';
import { readAudit, verifyAudit } from './audit.js';
import {
  voicePhase, getVoicePrefs, voices, setVoice, setSpeed, setSpeakTyped, setLanguage, stopSpeaking, setPing, getAllowedLanguages,
} from './voice.js';
import modelConfig from '../../config/models.json';
import { listModes, getMode, getPreset } from './llm-client.js';
import { isWhiteboardMode, enterWhiteboardMode, exitWhiteboardMode } from './whiteboard-mode.js';
import { openArtifact, openPanelIds } from './whiteboard.js';
import { listArtifacts, getArtifact } from './artifacts.js';
import { attachmentNames, removeAttachment } from './attachments.js';
import { SHORTCUTS } from './shortcuts.js';

// chat-ui.js lends the commands the parts of the conversation they act on (history, transcript).
let host = {};
export const registerCommandHost = (h) => { host = h; };

// "--flag value" and "--flag=value" options anywhere before the free text.
function parseFlags(args) {
  const flags = {};
  let rest = args.trim();
  for (;;) {
    const m = rest.match(/^--([a-z]+)(?:[=\s]+(?!--)([^\s]+))?\s*/i);
    if (!m) break;
    flags[m[1].toLowerCase()] = m[2] ?? true;
    rest = rest.slice(m[0].length);
  }
  return { flags, text: rest.trim() };
}

// A flag followed by free text would swallow its first word as a value; boolean flags need care.
function parseRemember(args) {
  const BOOLEAN = new Set(['user']);
  const tokens = args.trim().split(/\s+/);
  const flags = {};
  while (tokens.length && tokens[0].startsWith('--')) {
    const [name, inline] = tokens.shift().slice(2).split('=');
    if (BOOLEAN.has(name)) flags[name] = true;
    else flags[name] = inline ?? tokens.shift();
  }
  return { flags, text: tokens.join(' ').trim() };
}

const shortTitle = (text) => {
  const first = text.split(/[.\n]/)[0].trim();
  return first.length <= 70 ? first : `${first.slice(0, 67).replace(/\s+\S*$/, '')}...`;
};

const line = (m) => `${m.id}  ${m.kind}/${m.scope}  ${m.title}`;
const habitLine = (i) => `${i.id}  ${i.confidence.toFixed(2)}  ${i.scope}/${i.domain}  when ${i.trigger} => ${i.action}`;

const handlers = {

  async remember(args) {
    const { flags, text } = parseRemember(args);
    if (!text) return 'Usage: /remember [--user] [--kind fact] [--tags a,b] <text>';
    const m = await saveMemory({
      title: shortTitle(text),
      body: text,
      kind: flags.kind || 'note',
      scope: flags.user ? 'user' : 'project',
      tags: flags.tags ? String(flags.tags).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
      source: 'manual',
    });
    return `Saved ${m.id} (${m.kind}, ${m.scope}).`;
  },

  async memories(args) {
    const r = await searchMemory(args.trim(), { limit: 8 });
    if (!r.results.length) return r.truncated ? 'No match, but the scan was cut short, so this is not a complete answer.' : 'No matching memories.';
    const notes = [];
    if (r.malformed) notes.push(`${r.malformed} unreadable file(s), run /memory`);
    if (r.truncated) notes.push('scan was truncated');
    return [...r.results.map((h) => line(h.memory)), ...(notes.length ? [`(${notes.join('; ')})`] : [])].join('\n');
  },

  async forget(args) {
    const id = args.trim();
    if (!id) return 'Usage: /forget <id>';
    const m = await setMemoryStatus(id, 'rejected');
    return `${m.id} will no longer be recalled (the file is kept).`;
  },

  async habit(args) {
    const { flags, text } = parseFlags(args);
    const [rawTrigger, action] = text.split('=>').map((s) => s?.trim());
    if (!rawTrigger || !action) return 'Usage: /habit [--global] [--domain x] when <trigger> => <action>';
    const trigger = rawTrigger.replace(/^when\s+/i, '');
    const i = await addInstinct({
      trigger,
      action,
      domain: typeof flags.domain === 'string' ? flags.domain.toLowerCase() : null,
      scope: flags.global ? 'global' : 'project',
      evidence: ['added by the user with /habit'],
    });
    return `Habit ${i.id} saved at confidence ${i.confidence.toFixed(2)}. It is shown to the model from 0.70 up.`;
  },

  async habits() {
    const list = await listInstincts(false);
    return list.length ? list.map(habitLine).join('\n') : 'No habits yet. Add one with /habit when ... => ...';
  },

  async 'habit+'(args) {
    const i = await adjustInstinct(args.trim(), 0.1, 'user confirmed');
    return `${i.id} is now at ${i.confidence.toFixed(2)}.`;
  },

  async 'habit-'(args) {
    const i = await adjustInstinct(args.trim(), -0.1, 'user lowered');
    return `${i.id} is now at ${i.confidence.toFixed(2)}.`;
  },

  async unhabit(args) {
    const i = await retireInstinct(args.trim());
    return `${i.id} retired.`;
  },

  async promote(args) {
    const i = await promoteInstinct(args.trim());
    return `${i.id} is now a global habit.`;
  },

  async voice(args) {
    const name = args.trim();
    if (name) {
      await setVoice(name);
      return `Voice set to ${name}.`;
    }
    const p = getVoicePrefs();
    return [
      `Voice: ${voicePhase()}. Speaking as ${p.voice} at ${p.speed}x, listening for ${p.language}.`,
      `Typed messages are ${p.speakTyped ? '' : 'not '}spoken (/speak on or off). With the microphone on, replies are always spoken.`,
    ].join('\n');
  },

  async voices() {
    const { voices: all, default: fallback } = await voices();
    return `${all.join('  ')}\n(a = American, b = British, e = Spanish, f = French, h = Hindi, i = Italian, j = Japanese, p = Portuguese, z = Mandarin; f / m = female / male. Default ${fallback}.)`;
  },

  async speak(args) {
    const a = args.trim().toLowerCase();
    if (a === 'stop') { stopSpeaking(); return 'Stopped.'; }
    if (a !== 'on' && a !== 'off') return 'Usage: /speak on|off|stop';
    setSpeakTyped(a === 'on');
    return `Typed messages will ${a === 'on' ? '' : 'not '}be spoken.`;
  },

  async speed(args) {
    setSpeed(args.trim());
    return `Speaking speed ${getVoicePrefs().speed}x.`;
  },

  async ping(args) {
    const a = args.trim().toLowerCase();
    if (a !== 'on' && a !== 'off') return 'Usage: /ping on|off';
    setPing(a === 'on');
    return `The thinking note is ${a}.`;
  },

  async lang(args) {
    const code = args.trim().toLowerCase();
    const allowed = getAllowedLanguages();
    if (code !== 'auto' && !allowed.includes(code)) return `Usage: /lang auto|${allowed.join('|')} (only these languages are listened for)`;
    setLanguage(code);
    return `The microphone now listens for ${code}.`;
  },

  async stop() {
    return 'Nothing is running. (/stop ends a running turn; it is handled while JARVIS is busy.)';
  },

  async project(args) {
    const a = args.trim();
    if (!a) {
      const root = await getProject().catch(() => null);
      return root ? `Project folder: ${root}` : 'No project folder set. Use /project <path> or /project pick.';
    }
    const path = a.toLowerCase() === 'pick' ? await pickFolder() : a.replace(/^"(.*)"$/, '$1');
    if (!path) return 'No folder chosen.';
    return `Project folder set to ${await setProject(path)}. File tools stay inside it; commands run there.`;
  },

  async permissions(args) {
    const m = args.trim().match(/^remove\s+([\s\S]+)$/i);
    if (m) return removeLocalRule(m[1].trim()) ? `Removed the rule ${m[1].trim()}.` : 'No such rule among yours. The shipped rules are in config/permissions.json.';
    const { shipped, local } = listRules();
    const part = (title, rules) => `${title}\n${(['allow', 'ask', 'deny'].map((k) => `  ${k}: ${rules[k].length ? rules[k].join('  ') : '-'}`)).join('\n')}`;
    return `${part('Yours (data/agent/permissions.local.json)', local)}\n${part('Shipped (config/permissions.json)', shipped)}\nOrder: blocked commands, deny, ask, allow, then the action's own default.`;
  },

  async audit(args) {
    const n = Math.max(1, Math.min(50, parseInt(args, 10) || 10));
    const list = readAudit();
    const check = await verifyAudit(list);
    const rows = list.slice(-n).map((e) => `${e.t.slice(11, 19)}  ${e.decision.padEnd(6)} ${e.ok ? 'ok    ' : 'failed'} ${e.action} ${JSON.stringify(e.args).slice(0, 90)}`);
    return `${rows.length ? rows.join('\n') : 'No actions logged yet.'}\nLog chain: ${check.ok ? 'intact' : `BROKEN at entry ${check.at}`} (${list.length} entries kept here; the full record is data/agent/audit.jsonl).`;
  },

  async memory() {
    const d = await memoryDoctor();
    const out = [`${d.files} memory file(s), ${d.active} active.`];
    if (d.malformed.length) out.push(`Unreadable: ${d.malformed.join('; ')}`);
    if (d.broken_links.length) out.push(`Broken links: ${d.broken_links.join('; ')}`);
    if (d.duplicate_ids.length) out.push(`Duplicate ids: ${d.duplicate_ids.join(', ')}`);
    if (d.symlinks_skipped) out.push(`${d.symlinks_skipped} symlink(s) ignored.`);
    if (d.truncated) out.push('The scan hit its file limit, results are incomplete.');
    return out.join('\n');
  },

  async help(args) {
    const q = args.trim().replace(/^\//, '').toLowerCase();
    const list = q ? searchCommands(q) : COMMANDS;
    if (!list.length) return `No command matches "${q}". Type / to browse them.`;
    const width = Math.max(...list.map((c) => usage(c).length)) + 2;
    const rows = [];
    for (const g of GROUPS) {
      const inGroup = list.filter((c) => c.group === g);
      if (!inGroup.length) continue;
      rows.push(g, ...inGroup.map((c) => `  ${usage(c).padEnd(width)}${c.desc}`));
    }
    return `${rows.join('\n')}\n\nType / in the message field to search them as you type.`;
  },

  async clear() {
    return host.clear ? host.clear() : 'Nothing to clear here.';
  },

  async new() {
    return host.clear ? host.clear() : 'Nothing to clear here.';
  },

  async context() { return host.context ? host.context() : 'No conversation yet.'; },
  async compact(args) { return host.compact ? host.compact(args.trim()) : 'Nothing to compact.'; },
  async plan(args) { return host.plan ? host.plan(args) : 'Plan mode is not available here.'; },
  async tasks(args) { return host.tasks ? host.tasks(args) : 'No tasks.'; },
  async rewind(args) { return host.rewind ? host.rewind(args) : 'Nothing to rewind.'; },
  async sessions() { return host.sessions(); },
  async resume(args) { return host.resume(args); },
  async rename(args) { return host.rename(args.trim()); },
  async branch(args) { return host.branch(args.trim()); },
  async export() { return host.export(); },
  async btw() { return 'Usage: /btw <question>. It sees this conversation, answers briefly, and is not added to it.'; },
  async skills(args) { return host.skills ? host.skills(args) : 'No skills.'; },
  async skill(args) {
    const [name] = args.trim().split(/\s+/);
    return name ? `Type /${name} <task> to run that skill.` : handlers.skills('');
  },
  async hooks() {
    const hooks = listHooks();
    return hooks.length
      ? hooks.map((h) => `${h.event}  ${h.match ?? '*'}${h.path ? `  ${h.path}` : ''}  ${h.command}${h.block ? '  (blocks)' : ''}`).join('\n')
      : 'No hooks. Add them in config/hooks.json (the file explains the format).';
  },

  // /clip [mac|pc]: puts the other computer's clipboard on this one's, or this one's on the named one. With no argument the
  // clipboard goes away from this computer: a window on the PC itself sends to the Mac, any other window sends to the PC.
  async clip(args) {
    if (!serverMode()) return 'The clipboard copy needs the JARVIS server (Settings, Server).';
    const here = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'pc' : 'mac';
    const to = args.trim().toLowerCase() || (here === 'pc' ? 'mac' : 'pc');
    if (to !== 'pc' && to !== 'mac') return 'Usage: /clip mac (the PC clipboard to the Mac) or /clip pc (the Mac clipboard to the PC).';
    return (await copyClipboard(to === 'mac' ? 'pc' : 'mac', to)).message;
  },

  async retry() {
    return host.retry ? host.retry() : 'Nothing to retry.';
  },

  async copy(args) {
    const all = args.trim().toLowerCase() === 'all';
    const text = host.transcript ? host.transcript(all) : '';
    if (!text) return 'Nothing to copy yet.';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return 'The clipboard refused the copy.';
    }
    return all ? 'Copied the whole conversation.' : 'Copied the last reply.';
  },

  async mode(args) {
    const name = args.trim().toLowerCase();
    if (!name) return `Mode: ${getMode()} (${getPreset().model}). Choose with /mode <${listModes().join('|')}>.`;
    if (!listModes().includes(name)) return `Unknown mode "${name}". Modes: ${listModes().join(', ')}.`;
    host.selectMode?.(name);
    return `Mode set to ${name} (${getPreset().model}). The model loads when you next send a message.`;
  },

  async modes() {
    const cur = getMode();
    return listModes().map((n) => `${n === cur ? '>' : ' '} ${n.padEnd(12)}${getPreset.call(null, n) && presetModel(n)}`).join('\n');
  },

  async model() {
    return `${getPreset().model} (mode ${getMode()})`;
  },

  async status() {
    const p = getVoicePrefs();
    const project = await getProject().catch(() => null);
    const files = attachmentNames();
    return [
      `Mode        ${getMode()} (${getPreset().model})`,
      `Whiteboard  ${isWhiteboardMode() ? 'open' : 'closed'}, ${openPanelIds().length} panel(s)`,
      `Voice       ${voicePhase()}, ${p.voice} at ${p.speed}x`,
      `Project     ${project || 'not set'}`,
      `Attached    ${files.length ? files.join(', ') : 'nothing'}`,
      `Messages    ${host.count ? host.count() : 0} in this conversation`,
    ].join('\n');
  },

  async keys() {
    return SHORTCUTS.map((s) => `${s.keys.padEnd(20)}${s.does}`).join('\n');
  },

  async time() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  async date() {
    return new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  },

  async whiteboard() {
    if (isWhiteboardMode()) { exitWhiteboardMode(); return 'Whiteboard closed. The panels stay where they are.'; }
    enterWhiteboardMode();
    return 'Whiteboard open.';
  },

  async panels() {
    const ids = openPanelIds();
    return ids.length ? `Open on the whiteboard: ${ids.join(', ')}` : 'No panels are open.';
  },

  async artifacts() {
    const list = listArtifacts();
    return list.length ? list.map((a) => `${a.id}  ${a.type}  ${a.title}`).join('\n') : 'No artifacts in this session yet.';
  },

  async open(args) {
    const id = args.trim();
    if (!id) return 'Usage: /open <artifact id> (see /artifacts)';
    if (!getArtifact(id)) return `No artifact "${id}". See /artifacts.`;
    openArtifact(id);
    return `Opened ${id}.`;
  },

  async attach() {
    document.getElementById('attach-pc')?.click();
    return 'Choose the files to attach.';
  },

  async attachments() {
    const files = attachmentNames();
    return files.length ? files.map((n, i) => `${i + 1}  ${n}`).join('\n') : 'Nothing is attached.';
  },

  async detach() {
    const n = attachmentNames().length;
    for (let i = n - 1; i >= 0; i--) removeAttachment(i);
    return n ? `Removed ${n} attachment(s).` : 'Nothing is attached.';
  },

  async reload() {
    setTimeout(() => location.reload(), 150);
    return 'Reloading. The conversation on screen is lost; memories and habits are kept.';
  },
};

// Every command with the text the "/" menu (command-palette.js) and /help show. Order is the order
// of the menu when nothing has been typed yet.
export const GROUPS = ['Conversation', 'Work', 'Sessions', 'View', 'Memory and habits', 'Voice', 'Agent', 'Info'];

// A command name, or false: lets chat-ui.js tell /<skill> from a command.
export const hasCommand = (name) => !!handlers[String(name).toLowerCase()];
export const COMMANDS = [
  { group: 'Conversation', name: 'clear', desc: 'Wipe the conversation on screen and start fresh' },
  { group: 'Conversation', name: 'new', desc: 'Same as /clear: start a new conversation' },
  { group: 'Conversation', name: 'retry', desc: 'Ask your last message again, dropping the old answer' },
  { group: 'Conversation', name: 'copy', args: '[all]', desc: 'Copy the last reply, or the whole conversation, to the clipboard' },
  { group: 'Conversation', name: 'stop', desc: 'End a running turn (works while JARVIS is busy)' },
  { group: 'Conversation', name: 'attach', desc: 'Choose files to attach to your next message' },
  { group: 'Conversation', name: 'attachments', desc: 'List the files attached to your next message' },
  { group: 'Conversation', name: 'detach', desc: 'Remove every attached file' },

  { group: 'Work', name: 'plan', args: '[task|off]', desc: 'Plan mode: JARVIS researches and proposes a plan; nothing changes until you approve' },
  { group: 'Work', name: 'tasks', args: '[clear]', desc: 'Show the task checklist JARVIS keeps for a job' },
  { group: 'Work', name: 'context', desc: 'How full the context window of the model is' },
  { group: 'Work', name: 'compact', args: '[focus]', desc: 'Summarise the older conversation to free context' },
  { group: 'Work', name: 'rewind', args: '[n] [chat]', desc: 'Go back to before one of your messages (files too), to edit it' },
  { group: 'Work', name: 'btw', args: '<question>', desc: 'A side question: sees the conversation, is not added to it' },
  { group: 'Work', name: 'skills', args: '[reload]', desc: 'List the skills in skills/ ; /<skill> <task> runs one' },
  { group: 'Work', name: 'hooks', desc: 'List the hooks from config/hooks.json' },
  { group: 'Sessions', name: 'sessions', desc: 'List saved conversations' },
  { group: 'Sessions', name: 'resume', args: '[n|name]', desc: 'Open a saved conversation' },
  { group: 'Sessions', name: 'rename', args: '<name>', desc: 'Name this conversation' },
  { group: 'Sessions', name: 'branch', args: '[name]', desc: 'Keep this conversation as it is and carry on in a copy' },
  { group: 'Sessions', name: 'export', desc: 'Save this conversation as a markdown file' },

  { group: 'View', name: 'mode', args: '[general|coding|visual|abliterated]', desc: 'Show or switch the mode (the model JARVIS answers with)' },
  { group: 'View', name: 'modes', desc: 'List the modes and the model behind each' },
  { group: 'View', name: 'whiteboard', desc: 'Open or close the whiteboard' },
  { group: 'View', name: 'panels', desc: 'List the panels open on the whiteboard' },
  { group: 'View', name: 'artifacts', desc: 'List the code, pages and documents made in this session' },
  { group: 'View', name: 'open', args: '<artifact id>', desc: 'Show an artifact on the whiteboard' },
  { group: 'View', name: 'reload', desc: 'Reload the app window (the conversation on screen is lost)' },

  { group: 'Memory and habits', name: 'remember', args: '[--user] [--kind fact] [--tags a,b] <text>', desc: 'Save something to memory' },
  { group: 'Memory and habits', name: 'memories', args: '[query]', desc: 'Search saved memories (project and user)' },
  { group: 'Memory and habits', name: 'forget', args: '<id>', desc: 'Stop recalling a memory (the file is kept)' },
  { group: 'Memory and habits', name: 'memory', desc: 'Health check of the memory vault' },
  { group: 'Memory and habits', name: 'habit', args: '[--global] [--domain x] <when ...> => <do ...>', desc: 'Teach JARVIS a habit: when this happens, do that' },
  { group: 'Memory and habits', name: 'habits', desc: 'List habits with their confidence' },
  { group: 'Memory and habits', name: 'habit+', args: '<id>', desc: 'Raise a habit\'s confidence by 0.1' },
  { group: 'Memory and habits', name: 'habit-', args: '<id>', desc: 'Lower a habit\'s confidence by 0.1' },
  { group: 'Memory and habits', name: 'unhabit', args: '<id>', desc: 'Retire a habit' },
  { group: 'Memory and habits', name: 'promote', args: '<id>', desc: 'Make a project habit global' },

  { group: 'Voice', name: 'voice', args: '[name]', desc: 'Show the voice settings, or choose a voice (plays a sample)' },
  { group: 'Voice', name: 'voices', desc: 'List the available voices' },
  { group: 'Voice', name: 'speak', args: 'on|off|stop', desc: 'Speak typed replies too, or stop talking now' },
  { group: 'Voice', name: 'speed', args: '<0.5-2>', desc: 'How fast JARVIS speaks' },
  { group: 'Voice', name: 'ping', args: 'on|off', desc: 'The soft repeating note while JARVIS thinks (voice only)' },
  { group: 'Voice', name: 'lang', args: '<auto|en|es|fr|it>', desc: 'The language the microphone listens for (nothing else is heard)' },

  { group: 'Agent', name: 'clip', args: '[mac|pc]', desc: 'Copy one computer’s clipboard text to the other: /clip mac sends the PC’s to the Mac' },
  { group: 'Agent', name: 'project', args: '[path|pick]', desc: 'Show, set or choose the folder the coding tools work in' },
  { group: 'Agent', name: 'permissions', args: '[remove <rule>]', desc: 'List the rules that decide what JARVIS may do, or drop one of yours' },
  { group: 'Agent', name: 'audit', args: '[n]', desc: 'The last n actions JARVIS took, and whether the log is intact' },

  { group: 'Info', name: 'help', args: '[word]', desc: 'List every command, or only those matching a word' },
  { group: 'Info', name: 'status', desc: 'Mode, whiteboard, voice, project and attachments at a glance' },
  { group: 'Info', name: 'model', desc: 'The model JARVIS is using right now' },
  { group: 'Info', name: 'keys', desc: 'List the keyboard shortcuts' },
  { group: 'Info', name: 'time', desc: 'The current time' },
  { group: 'Info', name: 'date', desc: 'Today\'s date' },
];

export const usage = (c) => `/${c.name}${c.args ? ` ${c.args}` : ''}`;

// Commands whose name or description fits what was typed after the slash, best fit first:
// name starts with it, a part of the name starts with it, name contains it, description contains it.
export function searchCommands(query) {
  const q = query.trim().replace(/^\//, '').toLowerCase();
  const all = [...COMMANDS, ...getSkills().filter((k) => !hasCommand(k.name)).map((k) => ({ group: 'Work', name: k.name, args: '<task>', desc: `Skill: ${k.description}` }))];
  if (!q) return all;
  const rank = (c) => {
    if (c.name.startsWith(q)) return 0;
    if (c.name.split(/[+-]/).some((w) => w.startsWith(q))) return 1;
    if (c.name.includes(q)) return 2;
    if (c.desc.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return all.map((c, i) => ({ c, i, r: rank(c) })).filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
}

// Returns the text to show, or null when the input is not a slash command.
export async function runCommand(input) {
  const m = input.match(/^\/([\w+-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const handler = handlers[m[1].toLowerCase()];
  if (!handler) return `Unknown command /${m[1]}. Type /help.`;
  try {
    return await handler(m[2] ?? '');
  } catch (e) {
    return String(e?.message ?? e);
  }
}
