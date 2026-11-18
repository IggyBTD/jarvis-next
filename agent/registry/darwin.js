// macOS implementations (plan + parse, argument arrays only). AppleScript is a fixed string that reads its values from
// `argv` (osascript -e ... arg), so model text is never parsed as script. Unit-tested with a command-runner mock; the real
// run is a human step on the Mac (HUMAN_TODO.md sections 5 and 7). UI scripting needs Accessibility/Automation permission.
import path from 'node:path';
import fs from 'node:fs';
import { action, safePath, writablePath, dirPath, resolveApp, tryJson, asList, clipText, spawnTracked } from './common.js';
import { gitRun } from './git.js';

const osa = (script, ...argv) => ({ file: 'osascript', args: ['-e', script, ...argv.map(String)] });
const text = (r) => clipText(r.at(-1).stdout.trim());
const simple = (spec, parse = text) => action({ plan: () => spec, parse });
const appName = (app, ctx) => resolveApp(app, ctx).target;
const KEY = (code) => osa(`tell application "System Events" to key code ${code}`);
// media keys through System Events are unreliable across macOS versions, so use the Music/Spotify-independent NX key events via a tiny script
const MEDIA = (n) => osa(`tell application "System Events" to key code ${n} using {function down}`);
const SHORTCUT_NAME = /^[\w .,'()&-]{1,80}$/;

export const darwin = {
  open_app: action({ plan: ({ app }, ctx) => { const r = resolveApp(app, ctx); return { file: 'open', args: ['-a', r.target, ...(r.args.length ? ['--args', ...r.args] : [])] }; }, parse: (_r, { app }) => ({ started: app }) }),
  focus_app: action({ plan: ({ app }, ctx) => osa('on run argv\ntell application (item 1 of argv) to activate\nend run', appName(app, ctx)), parse: (_r, { app }) => ({ focused: app }) }),
  list_running_apps: simple(osa('tell application "System Events" to get name of every application process whose background only is false'), (r) => text(r).split(', ').filter(Boolean)),
  list_windows: simple(osa('tell application "System Events" to get {name, title of windows} of every application process whose background only is false'), text),
  close_app: action({ plan: ({ app }, ctx) => osa('on run argv\ntell application (item 1 of argv) to quit\nend run', appName(app, ctx)), parse: (_r, { app }) => ({ asked: app }) }),
  force_quit_app: action({ plan: ({ app }, ctx) => ({ file: 'pkill', args: ['-x', appName(app, ctx)] }), parse: (_r, { app }) => ({ stopped: app }) }),
  open_url: action({ plan: ({ url }) => { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http and https addresses'); return { file: 'open', args: [u.href] }; }, parse: (_r, { url }) => ({ opened: url }) }),
  open_file: action({ plan: ({ path: p }, ctx) => ({ file: 'open', args: [safePath(p, ctx)] }), parse: (_r, { path: p }) => ({ opened: p }) }),
  open_folder: action({ plan: ({ path: p }, ctx) => ({ file: 'open', args: [dirPath(p, ctx)] }), parse: (_r, { path: p }) => ({ opened: p }) }),
  reveal_in_file_manager: action({ plan: ({ path: p }, ctx) => ({ file: 'open', args: ['-R', safePath(p, ctx)] }), parse: (_r, { path: p }) => ({ revealed: p }) }),
  show_desktop: simple(osa('tell application "System Events" to key code 103 using {fn down}'), () => ({ ok: true })),

  get_volume: simple(osa('output volume of (get volume settings) & "," & output muted of (get volume settings)'), (r) => { const [v, m] = text(r).split(','); return { volumePercent: Number(v), muted: m === 'true' }; }),
  set_volume: action({ plan: ({ level }) => osa(`set volume output volume ${Math.round(level)}`), parse: (_r, { level }) => ({ volumePercent: level }) }),
  mute: simple(osa('set volume output muted true'), () => ({ muted: true })),
  unmute: simple(osa('set volume output muted false'), () => ({ muted: false })),
  list_audio_devices: simple({ file: 'system_profiler', args: ['SPAudioDataType', '-json'], timeoutMs: 30_000 }, (r) => tryJson(r.at(-1).stdout, text(r))),
  media_play_pause: simple(KEY(16), () => ({ ok: true })), // best effort: F8 equivalent
  media_next: simple(MEDIA(17), () => ({ ok: true })),
  media_previous: simple(MEDIA(18), () => ({ ok: true })),

  turn_off_display: simple({ file: 'pmset', args: ['displaysleepnow'] }, () => ({ ok: true })),
  set_brightness: action({ plan: ({ level }) => osa(`tell application "System Events" to repeat 16 times\nkey code 145\nend repeat\nrepeat ${Math.round(level / 100 * 16)} times\nkey code 144\nend repeat`), parse: (_r, { level }) => ({ approximateBrightness: level, note: 'set with the brightness keys, so it is approximate' }) }),
  toggle_dark_mode: simple(osa('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode\ntell application "System Events" to tell appearance preferences to return dark mode'), (r) => ({ darkMode: text(r) === 'true' })),
  list_displays: simple({ file: 'system_profiler', args: ['SPDisplaysDataType', '-json'], timeoutMs: 30_000 }, (r) => tryJson(r.at(-1).stdout, text(r))),
  set_wallpaper: action({ plan: ({ path: p }, ctx) => osa('on run argv\ntell application "System Events" to tell every desktop to set picture to (item 1 of argv)\nend run', safePath(p, ctx)), parse: (_r, { path: p }) => ({ wallpaper: p }) }),

  get_power_plan: simple({ file: 'pmset', args: ['-g'] }),
  lock_screen: simple({ file: 'pmset', args: ['displaysleepnow'] }, () => ({ locked: 'display put to sleep; it locks if "require password immediately" is on in System Settings' })),
  sleep: simple({ file: 'pmset', args: ['sleepnow'] }, () => ({ sleeping: true })),
  keep_awake: action({ async run({ minutes }, ctx) { const pid = spawnTracked({ file: 'caffeinate', args: ['-di', '-t', String(minutes * 60)] }, ctx.background, 'keep_awake'); return { keepingAwakeForMinutes: minutes, pid }; } }),
  cancel_keep_awake: action({ async run(_a, ctx) { const e = ctx.background.get('keep_awake'); if (!e) throw new Error('not keeping awake'); e.child.kill(); return { cancelled: true }; } }),
  caffeinate: action({ async run({ minutes }, ctx) { const pid = spawnTracked({ file: 'caffeinate', args: ['-di', '-t', String(minutes * 60)] }, ctx.background, 'keep_awake'); return { minutes, pid }; } }),
  schedule_shutdown: action({ plan: ({ minutes }) => ({ file: 'shutdown', args: ['-h', `+${minutes}`] }), parse: (_r, { minutes }) => ({ shutdownInMinutes: minutes }) }),
  cancel_shutdown: simple({ file: 'killall', args: ['shutdown'] }, () => ({ cancelled: true })),
  shutdown: simple(osa('tell application "System Events" to shut down'), () => ({ shuttingDown: true })),
  restart: simple(osa('tell application "System Events" to restart'), () => ({ restarting: true })),
  sign_out: simple(osa('tell application "System Events" to log out'), () => ({ signedOut: true })),
  battery_status: simple({ file: 'pmset', args: ['-g', 'batt'] }, (r) => { const m = text(r).match(/(\d+)%;\s*([\w ]+)/); return m ? { percent: Number(m[1]), state: m[2].trim() } : { raw: text(r) }; }),

  list_top_processes: action({ plan: () => ({ file: 'ps', args: ['-Ao', 'pid,pcpu,rss,comm', '-r'] }), parse: (r, { count = 10 }) => text(r).split('\n').slice(0, count + 1).join('\n') }),
  kill_process: action({ plan: ({ pid }) => { if (pid <= 1 || pid === process.pid) throw new Error('refusing to stop launchd or the agent itself'); return { file: 'kill', args: ['-9', String(pid)] }; }, parse: (_r, { pid }) => ({ stopped: pid }) }),
  list_startup_items: simple(osa('tell application "System Events" to get the name of every login item'), (r) => text(r).split(', ').filter(Boolean)),
  empty_trash: simple(osa('tell application "Finder" to empty the trash'), () => ({ emptied: true })),

  memory_usage: action({
    plan: () => [{ file: 'vm_stat', args: [] }, { file: 'sysctl', args: ['-n', 'hw.memsize'] }],
    parse: (r) => {
      const page = Number(r[0].stdout.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
      const n = (label) => Number(r[0].stdout.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
      const total = Number(r[1].stdout.trim());
      const avail = (n('Pages free') + n('Pages inactive') + n('Pages speculative')) * page;
      return { usedGiB: Number(((total - avail) / 1024 ** 3).toFixed(1)), totalGiB: Number((total / 1024 ** 3).toFixed(1)), note: 'available = free + inactive + speculative pages' };
    },
  }),
  disk_usage: simple({ file: 'df', args: ['-k', '-l'] }, (r) => text(r).split('\n').slice(1).map((l) => l.split(/\s+/)).filter((c) => c[0].startsWith('/dev/')).map((c) => ({ mount: c.slice(8).join(' ') || c[8], freeGiB: Number((c[3] * 1024 / 1024 ** 3).toFixed(1)), totalGiB: Number((c[1] * 1024 / 1024 ** 3).toFixed(1)) }))),
  installed_apps: simple({ file: 'ls', args: ['/Applications'] }, (r) => text(r).split('\n').filter((l) => l.endsWith('.app')).map((l) => l.replace(/\.app$/, ''))),
  pending_updates: simple({ file: 'softwareupdate', args: ['-l'], timeoutMs: 120_000 }),
  check_updates: simple({ file: 'softwareupdate', args: ['-l'], timeoutMs: 120_000 }),
  install_updates: simple({ file: 'softwareupdate', args: ['-i', '-a'], timeoutMs: 3_600_000 }),
  disk_health: simple({ file: 'diskutil', args: ['info', '-all'], timeoutMs: 30_000 }, (r) => text(r).split('\n').filter((l) => /Device Identifier|SMART Status|Volume Name/.test(l)).join('\n')),
  list_services: simple({ file: 'launchctl', args: ['list'] }, (r) => text(r).split('\n').slice(0, 300).join('\n')),

  wifi_status: simple({ file: 'networksetup', args: ['-getairportnetwork', 'en0'] }),
  list_wifi: simple({ file: 'system_profiler', args: ['SPAirPortDataType'], timeoutMs: 30_000 }),
  ping: action({ plan: ({ host }) => { if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host)) throw new Error('not a host name or address'); return { file: 'ping', args: ['-c', '4', host], timeoutMs: 20_000 }; }, allowNonZero: true }),
  flush_dns: simple({ file: 'dscacheutil', args: ['-flushcache'] }, () => ({ flushed: true })),
  toggle_wifi: action({ plan: ({ enabled }) => ({ file: 'networksetup', args: ['-setairportpower', 'en0', enabled ? 'on' : 'off'] }), parse: (_r, { enabled }) => ({ wifi: enabled }) }),
  tailscale_status: simple({ file: 'tailscale', args: ['status', '--json'] }, (r) => { const j = tryJson(r.at(-1).stdout); return j?.Self ? { state: j.BackendState, self: j.Self.HostName, ips: j.Self.TailscaleIPs, peers: Object.values(j.Peer ?? {}).map((p) => ({ name: p.HostName, online: p.Online })) } : text(r); }),
  open_ports: simple({ file: 'lsof', args: ['-iTCP', '-sTCP:LISTEN', '-n', '-P'] }),

  trash_file: action({ plan: ({ path: p }, ctx) => osa('on run argv\ntell application "Finder" to delete POSIX file (item 1 of argv)\nend run', safePath(p, ctx)), parse: (_r, { path: p }) => ({ trashed: p }) }),
  zip_folder: action({ plan: ({ path: p, to }, ctx) => { const src = dirPath(p, ctx); const dst = to ? writablePath(to, ctx, { also: '.zip' }) : `${src}.zip`; if (fs.existsSync(dst)) throw new Error('destination exists'); return { file: 'ditto', args: ['-c', '-k', '--sequesterRsrc', '--keepParent', src, dst], timeoutMs: 300_000 }; }, parse: (_r, a) => ({ zipped: a.path }) }),

  get_clipboard: simple({ file: 'pbpaste', args: [] }, (r) => ({ text: clipText(r.at(-1).stdout, 4000) })),
  set_clipboard: action({ plan: ({ text: t }) => ({ file: 'pbcopy', args: [], stdin: t }), parse: () => ({ set: true }) }),
  screenshot: action({ plan: (_a, ctx) => { const dir = path.join(ctx.workspaceDir, 'screenshots'); fs.mkdirSync(dir, { recursive: true }); return { file: 'screencapture', args: ['-x', path.join(dir, `shot-${Date.now()}.png`)] }; }, parse: () => ({ saved: 'screenshots folder in the workspace', note: 'the image stays on this computer; macOS may ask for Screen Recording permission' }) }),
  show_notification: action({ plan: ({ title, text: t }) => osa('on run argv\ndisplay notification (item 1 of argv) with title (item 2 of argv)\nend run', t, title), parse: () => ({ shown: true }) }),

  open_terminal_at: action({ plan: ({ path: p }, ctx) => ({ file: 'open', args: ['-a', 'Terminal', dirPath(p, ctx)] }), parse: (_r, { path: p }) => ({ opened: p }) }),
  open_editor_at: action({ plan: ({ path: p }, ctx) => ({ file: 'open', args: ['-a', 'Visual Studio Code', dirPath(p, ctx)] }), parse: (_r, { path: p }) => ({ opened: p }) }),
  git_status: action({ run: ({ path: p }, ctx) => gitRun('status', p, ctx) }),
  git_diff: action({ run: ({ path: p }, ctx) => gitRun('diff', p, ctx) }),
  docker_ps: simple({ file: 'docker', args: ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'] }),
  docker_start: action({ plan: ({ name }) => { if (!/^[\w][\w.-]{0,63}$/.test(name)) throw new Error('bad container name'); return { file: 'docker', args: ['start', name] }; } }),
  docker_stop: action({ plan: ({ name }) => { if (!/^[\w][\w.-]{0,63}$/.test(name)) throw new Error('bad container name'); return { file: 'docker', args: ['stop', name] }; } }),
  port_in_use: action({ plan: ({ port }) => ({ file: 'lsof', args: ['-nP', `-iTCP:${port}`] }), allowNonZero: true, parse: (r) => ({ inUse: r.at(-1).stdout.trim().length > 0, output: text(r) }) }),

  run_shortcut: action({
    async run({ name }, ctx) {
      if (!SHORTCUT_NAME.test(name)) throw new Error('unusual shortcut name');
      const list = await ctx.runProgram({ file: 'shortcuts', args: ['list'] });
      if (!list.stdout.split('\n').map((s) => s.trim()).includes(name)) throw new Error(`no Shortcut named "${name}"`);
      const r = await ctx.runProgram({ file: 'shortcuts', args: ['run', name], timeoutMs: 120_000 });
      if (r.code !== 0) throw new Error(r.stderr.trim() || 'the shortcut failed');
      return { ran: name, output: clipText(r.stdout, 2000) };
    },
  }),
  run_applescript_named: action({ plan: ({ name }, ctx) => { const e = ctx.scripts.scripts.find((s) => s.name === name && s.platform === 'darwin' && s.file.endsWith('.applescript')); if (!e) throw new Error(`no AppleScript "${name}" in scripts.json`); return { file: 'osascript', args: [path.join(ctx.scriptsDir, e.file)], timeoutMs: 60_000 }; } }),
  spotlight_search: action({
    async run({ query }, ctx) {
      if (query.startsWith('-')) throw new Error('query must not start with a dash');
      const out = [];
      for (const root of (ctx.files.roots.darwin ?? []).map((r) => safePath(r, ctx))) {
        const r = await ctx.runProgram({ file: 'mdfind', args: ['-onlyin', root, query], timeoutMs: 20_000 });
        out.push(...r.stdout.split('\n').filter(Boolean));
      }
      return { results: out.slice(0, 50) };
    },
  }),
};
