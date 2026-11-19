// Windows implementations. An action is plan(args, ctx) -> program spec(s) with an argument array, and optionally
// parse(results, args, ctx). PowerShell scripts are fixed strings: values reach them only through environment variables
// (JARVIS_A_<name>), so model-supplied text is never parsed as script. Written and unit-tested against a command-runner mock;
// the real-machine run is a human step (HUMAN_TODO.md section 7).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { action, safePath, writablePath, dirPath, resolveApp, tryJson, asList, clipText, clipboardText, spawnTracked } from './common.js';
import { gitRun } from './git.js';

const envA = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`JARVIS_A_${k}`, String(v)]));
const PS_HEAD = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ";
const ps = (script, env = {}, extra = {}) => ({ file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_HEAD + script], env: envA(env), ...extra });
const json = (r) => tryJson(r.at(-1).stdout.trim(), r.at(-1).stdout.trim());
const text = (r) => clipText(r.at(-1).stdout.trim());
const procName = (target) => {
  const n = path.win32.basename(target).replace(/\.exe$/i, '');
  if (!/^[\w .+-]{1,60}$/.test(n)) throw new Error('unsafe process name');
  return n;
};

// Core Audio through a small COM wrapper (no third-party module). Compiled by Add-Type on each call (about a second).
const AUDIO = `Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext); int j(); int GetMasterVolumeLevelScalar(out float pfLevel); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext); int GetMute(out bool pbMute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class JarvisAudio {
  static IAudioEndpointVolume Vol() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d = null; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); IAudioEndpointVolume v = null; var id = typeof(IAudioEndpointVolume).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static float Volume { get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; } set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); } }
  public static bool Mute { get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; } set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); } }
}
'@; `;
const volumeState = `@{ volumePercent = [math]::Round([JarvisAudio]::Volume * 100); muted = [JarvisAudio]::Mute } | ConvertTo-Json -Compress`;
const MEDIA_KEY = (vk) => ps(`Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, int f, int e); }'; [K]::keybd_event([byte]${vk}, 0, 0, 0); [K]::keybd_event([byte]${vk}, 0, 2, 0); 'ok'`);
const POWER = { balanced: '381b4222-f694-41f0-9685-ff5bb260df2e', high_performance: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', power_saver: 'a1841308-3541-4fab-bc81-f71556f20b4a' };
const PRIORITY = { low: 'Idle', below_normal: 'BelowNormal', normal: 'Normal', above_normal: 'AboveNormal', high: 'High' };
const GAME_MODE_KEY = "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Name AutoGameModeEnabled -Value ";

const simple = (spec, parse = text) => action({ plan: () => spec, parse });
const SHELL_OPEN = (envName) => `Start-Process -FilePath $env:${envName}; 'ok'`;

export const win32 = {
  open_app: action({
    describe: (a, ctx) => ({ would: `start ${resolveApp(a.app, ctx).target}` }),
    plan: ({ app }, ctx) => { const r = resolveApp(app, ctx); return ps("$a = $env:JARVIS_A_args | ConvertFrom-Json; if ($a.Count -gt 0) { Start-Process -FilePath $env:JARVIS_A_target -ArgumentList $a } else { Start-Process -FilePath $env:JARVIS_A_target }; 'started'", { target: r.target, args: JSON.stringify(r.args) }); },
    parse: (_r, { app }) => ({ started: app }),
  }),
  focus_app: action({
    plan: ({ app }, ctx) => ps("Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($env:JARVIS_A_name); 'ok'", { name: procName(resolveApp(app, ctx).target) }),
    parse: (_r, { app }) => ({ focused: app }),
  }),
  list_running_apps: simple(ps('Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Name, Id | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  list_windows: simple(ps('Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Name, Id, MainWindowTitle | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  close_app: action({ plan: ({ app }, ctx) => ps("$p = Get-Process -Name $env:JARVIS_A_name -ErrorAction SilentlyContinue; if (-not $p) { throw 'not running' }; $p | ForEach-Object { [void]$_.CloseMainWindow() }; 'asked'", { name: procName(resolveApp(app, ctx).target) }), parse: (_r, { app }) => ({ asked: app }) }),
  force_quit_app: action({ plan: ({ app }, ctx) => ps("Stop-Process -Name $env:JARVIS_A_name -Force; 'stopped'", { name: procName(resolveApp(app, ctx).target) }), parse: (_r, { app }) => ({ stopped: app }) }),
  open_url: action({
    plan: ({ url }) => { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http and https addresses'); return ps(SHELL_OPEN('JARVIS_A_url'), { url: u.href }); },
    parse: (_r, { url }) => ({ opened: url }),
  }),
  open_file: action({ plan: ({ path: p }, ctx) => ps(SHELL_OPEN('JARVIS_A_path'), { path: safePath(p, ctx) }), parse: (_r, { path: p }) => ({ opened: p }) }),
  open_folder: action({ plan: ({ path: p }, ctx) => ({ file: 'explorer.exe', args: [dirPath(p, ctx)] }), parse: (_r, { path: p }) => ({ opened: p }), okCodes: [0, 1] }),
  reveal_in_file_manager: action({ plan: ({ path: p }, ctx) => ({ file: 'explorer.exe', args: [`/select,${safePath(p, ctx)}`] }), parse: (_r, { path: p }) => ({ revealed: p }), okCodes: [0, 1] }),
  show_desktop: simple(ps("(New-Object -ComObject Shell.Application).ToggleDesktop(); 'ok'")),
  tile_windows: simple(ps("(New-Object -ComObject Shell.Application).TileVertically(); 'ok'")),

  get_volume: action({ plan: () => ps(AUDIO + volumeState), parse: json }),
  set_volume: action({ plan: ({ level }) => ps(`${AUDIO}[JarvisAudio]::Volume = [float]($env:JARVIS_A_level) / 100; ${volumeState}`, { level }), parse: json }),
  mute: action({ plan: () => ps(`${AUDIO}[JarvisAudio]::Mute = $true; ${volumeState}`), parse: json }),
  unmute: action({ plan: () => ps(`${AUDIO}[JarvisAudio]::Mute = $false; ${volumeState}`), parse: json }),
  list_audio_devices: simple(ps('Get-CimInstance Win32_SoundDevice | Select-Object Name, Status | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  media_play_pause: simple(MEDIA_KEY(0xB3)),
  media_next: simple(MEDIA_KEY(0xB0)),
  media_previous: simple(MEDIA_KEY(0xB1)),

  turn_off_display: simple(ps("Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\"user32.dll\")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l); }'; [void][M]::SendMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2); 'ok'")),
  toggle_dark_mode: simple(ps("$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; $v = (Get-ItemProperty $k).AppsUseLightTheme; $n = 1 - $v; Set-ItemProperty $k -Name AppsUseLightTheme -Value $n; Set-ItemProperty $k -Name SystemUsesLightTheme -Value $n; if ($n -eq 1) { 'light' } else { 'dark' }"), (r) => ({ mode: text(r) })),
  list_displays: simple(ps('Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ name = $_.DeviceName; primary = $_.Primary; width = $_.Bounds.Width; height = $_.Bounds.Height } } | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  set_wallpaper: action({ plan: ({ path: p }, ctx) => ps("Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class W { [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int SystemParametersInfo(int a, int b, string c, int d); }'; [void][W]::SystemParametersInfo(20, 0, $env:JARVIS_A_path, 3); 'ok'", { path: safePath(p, ctx) }), parse: (_r, { path: p }) => ({ wallpaper: p }) }),

  get_power_plan: simple(ps('powercfg /getactivescheme'), (r) => { const m = text(r).match(/GUID: ([0-9a-f-]+)\s+\((.+)\)/i); return m ? { guid: m[1], name: m[2] } : { raw: text(r) }; }),
  set_power_plan: action({ plan: ({ plan }) => ({ file: 'powercfg.exe', args: ['/setactive', POWER[plan]] }), parse: (_r, { plan }) => ({ plan }) }),
  lock_screen: simple({ file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] }, () => ({ locked: true })),
  sleep: simple({ file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] }, () => ({ sleeping: true })),
  hibernate: simple({ file: 'shutdown.exe', args: ['/h'] }, () => ({ hibernating: true })),
  keep_awake: action({
    async run({ minutes }, ctx) {
      const pid = spawnTracked(ps("Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class A { [DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f); }'; [void][A]::SetThreadExecutionState(0x80000003); Start-Sleep -Seconds ([int]$env:JARVIS_A_seconds)", { seconds: minutes * 60 }), ctx.background, 'keep_awake');
      return { keepingAwakeForMinutes: minutes, pid };
    },
  }),
  cancel_keep_awake: action({ async run(_a, ctx) { const e = ctx.background.get('keep_awake'); if (!e) throw new Error('not keeping awake'); e.child.kill(); return { cancelled: true }; } }),
  schedule_shutdown: action({ plan: ({ minutes }) => ({ file: 'shutdown.exe', args: ['/s', '/t', String(minutes * 60)] }), parse: (_r, { minutes }) => ({ shutdownInMinutes: minutes }) }),
  cancel_shutdown: simple({ file: 'shutdown.exe', args: ['/a'] }, () => ({ cancelled: true })),
  shutdown: simple({ file: 'shutdown.exe', args: ['/s', '/t', '0'] }, () => ({ shuttingDown: true })),
  restart: simple({ file: 'shutdown.exe', args: ['/r', '/t', '0'] }, () => ({ restarting: true })),
  sign_out: simple({ file: 'shutdown.exe', args: ['/l'] }, () => ({ signedOut: true })),
  battery_status: simple(ps('Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress'), (r) => { const b = asList(json(r))[0]; return b ? { percent: b.EstimatedChargeRemaining, charging: b.BatteryStatus === 2 } : { battery: false }; }),

  // Game mode: high performance plan, Game Mode on, the configured apps closed (workspaces.json "game".closeApps), optional launch.
  game_mode_on: action({
    describe: (a, ctx) => ({ would: 'switch to the high performance plan, enable Game Mode, close the apps listed in workspaces.json game.closeApps', closes: ctx.workspaces.game?.closeApps ?? [], launch: a.launch ?? null }),
    plan: (a, ctx) => [{ file: 'powercfg.exe', args: ['/setactive', POWER.high_performance] }, ps(`${GAME_MODE_KEY}1; 'ok'`)],
    async after(a, ctx) {
      const closed = [];
      for (const app of ctx.workspaces.game?.closeApps ?? []) { const r = await ctx.call('close_app', { app }); if (r.ok) closed.push(app); }
      if (a.launch) await ctx.call('open_app', { app: a.launch });
      return { plan: 'high_performance', gameMode: true, closed, launched: a.launch ?? null };
    },
  }),
  game_mode_off: action({ plan: () => [{ file: 'powercfg.exe', args: ['/setactive', POWER.balanced] }, ps(`${GAME_MODE_KEY}0; 'ok'`)], parse: () => ({ plan: 'balanced', gameMode: false }) }),

  list_top_processes: action({ plan: ({ count = 10 }) => ps('Get-Process | Sort-Object CPU -Descending | Select-Object -First ([int]$env:JARVIS_A_count) Name, Id, @{n="cpuSeconds";e={[math]::Round($_.CPU,1)}}, @{n="memoryMB";e={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress', { count }), parse: (r) => asList(json(r)) }),
  set_process_priority: action({ plan: ({ pid, priority }) => ps("(Get-Process -Id ([int]$env:JARVIS_A_pid)).PriorityClass = $env:JARVIS_A_priority; 'ok'", { pid, priority: PRIORITY[priority] }), parse: (_r, a) => a }),
  kill_process: action({
    plan: ({ pid }) => { if (pid <= 4 || pid === process.pid) throw new Error('refusing to stop a system process or the agent itself'); return ps("Stop-Process -Id ([int]$env:JARVIS_A_pid) -Force; 'stopped'", { pid }); },
    parse: (_r, { pid }) => ({ stopped: pid }),
  }),
  list_startup_items: simple(ps('Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  empty_recycle_bin: simple(ps('Clear-RecycleBin -Force; "emptied"'), () => ({ emptied: true })),

  memory_usage: action({ async run() { const t = os.totalmem(); const f = os.freemem(); return { usedGiB: Number(((t - f) / 1024 ** 3).toFixed(1)), totalGiB: Number((t / 1024 ** 3).toFixed(1)) }; } }),
  disk_usage: simple(ps('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ drive = $_.DeviceID; freeGiB = [math]::Round($_.FreeSpace/1GB,1); totalGiB = [math]::Round($_.Size/1GB,1) } } | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  installed_apps: simple(ps("Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion | Sort-Object DisplayName | ConvertTo-Json -Compress", {}, { timeoutMs: 60_000 }), (r) => asList(json(r)).slice(0, 300)),
  pending_updates: simple({ file: 'winget.exe', args: ['upgrade', '--include-unknown', '--disable-interactivity'], timeoutMs: 90_000 }),
  check_updates: simple({ file: 'winget.exe', args: ['upgrade', '--include-unknown', '--disable-interactivity'], timeoutMs: 90_000 }),
  install_updates: simple({ file: 'winget.exe', args: ['upgrade', '--all', '--include-unknown', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], timeoutMs: 1_800_000 }),
  disk_health: simple(ps('Get-PhysicalDisk | Select-Object FriendlyName, HealthStatus, OperationalStatus | ConvertTo-Json -Compress'), (r) => asList(json(r))),
  list_services: simple(ps('Get-Service | Select-Object Name, Status | ConvertTo-Json -Compress'), (r) => asList(json(r)).slice(0, 400)),

  wifi_status: simple({ file: 'netsh.exe', args: ['wlan', 'show', 'interfaces'] }),
  list_wifi: simple({ file: 'netsh.exe', args: ['wlan', 'show', 'networks'] }),
  ping: action({ plan: ({ host }) => { if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host)) throw new Error('not a host name or address'); return { file: 'ping.exe', args: ['-n', '4', host], timeoutMs: 20_000 }; }, allowNonZero: true }),
  flush_dns: simple({ file: 'ipconfig.exe', args: ['/flushdns'] }),
  toggle_wifi: action({ plan: ({ enabled }) => ({ file: 'netsh.exe', args: ['interface', 'set', 'interface', 'name=Wi-Fi', `admin=${enabled ? 'enabled' : 'disabled'}`] }), parse: (_r, { enabled }) => ({ wifi: enabled }) }),
  tailscale_status: simple({ file: 'tailscale.exe', args: ['status', '--json'] }, (r) => { const j = json(r); return j?.Self ? { state: j.BackendState, self: j.Self.HostName, ips: j.Self.TailscaleIPs, peers: Object.values(j.Peer ?? {}).map((p) => ({ name: p.HostName, online: p.Online })) } : j; }),
  open_ports: simple(ps('Get-NetTCPConnection -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess | Sort-Object LocalPort | ConvertTo-Json -Compress'), (r) => asList(json(r)).slice(0, 200)),

  trash_file: action({ plan: ({ path: p }, ctx) => ps("Add-Type -AssemblyName Microsoft.VisualBasic; $p = $env:JARVIS_A_path; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }; 'trashed'", { path: safePath(p, ctx) }), parse: (_r, { path: p }) => ({ trashed: p }) }),
  zip_folder: action({ plan: ({ path: p, to }, ctx) => { const src = dirPath(p, ctx); const dst = to ? writablePath(to, ctx, { also: '.zip' }) : `${src}.zip`; if (fs.existsSync(dst)) throw new Error('destination exists'); return ps('Compress-Archive -LiteralPath $env:JARVIS_A_src -DestinationPath $env:JARVIS_A_dst; "zipped"', { src, dst }, { timeoutMs: 300_000 }); }, parse: (_r, a) => ({ zipped: a.path }) }),

  get_clipboard: simple(ps('[Console]::Out.Write((Get-Clipboard -Raw))'), (r) => clipboardText(r.at(-1).stdout)), // Write: no newline added
  set_clipboard: action({ plan: ({ text: t }) => ps('Set-Clipboard -Value $env:JARVIS_A_text; "ok"', { text: t }), parse: () => ({ set: true }) }),
  screenshot: action({ plan: (_a, ctx) => { const dir = path.join(ctx.workspaceDir, 'screenshots'); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, `shot-${Date.now()}.png`); return ps("Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = [Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height; $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size); $bmp.Save($env:JARVIS_A_file); $g.Dispose(); $bmp.Dispose(); 'ok'", { file }); }, parse: (_r, _a, ctx) => ({ saved: 'screenshots folder in the workspace', note: 'the image stays on this computer' }) }),
  show_notification: action({ plan: ({ title, text: t }) => ps("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent('ToastText02'); $n = $x.GetElementsByTagName('text'); [void]$n.Item(0).AppendChild($x.CreateTextNode($env:JARVIS_A_title)); [void]$n.Item(1).AppendChild($x.CreateTextNode($env:JARVIS_A_text)); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('JARVIS').Show([Windows.UI.Notifications.ToastNotification]::new($x)); 'shown'", { title, text: t }), parse: () => ({ shown: true }) }),

  open_terminal_at: action({ plan: ({ path: p }, ctx) => ps("Start-Process -FilePath 'wt.exe' -ArgumentList @('-d', $env:JARVIS_A_path); 'ok'", { path: dirPath(p, ctx) }), parse: (_r, { path: p }) => ({ opened: p }) }),
  open_editor_at: action({ plan: ({ path: p }, ctx) => ps("Start-Process -FilePath 'code' -ArgumentList @($env:JARVIS_A_path); 'ok'", { path: dirPath(p, ctx) }), parse: (_r, { path: p }) => ({ opened: p }) }),
  git_status: action({ run: ({ path: p }, ctx) => gitRun('status', p, ctx) }),
  git_diff: action({ run: ({ path: p }, ctx) => gitRun('diff', p, ctx) }),
  docker_ps: simple({ file: 'docker.exe', args: ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'] }),
  docker_start: action({ plan: ({ name }) => { if (!/^[\w][\w.-]{0,63}$/.test(name)) throw new Error('bad container name'); return { file: 'docker.exe', args: ['start', name] }; } }),
  docker_stop: action({ plan: ({ name }) => { if (!/^[\w][\w.-]{0,63}$/.test(name)) throw new Error('bad container name'); return { file: 'docker.exe', args: ['stop', name] }; } }),
  port_in_use: action({ plan: ({ port }) => ps('Get-NetTCPConnection -LocalPort ([int]$env:JARVIS_A_port) -ErrorAction SilentlyContinue | Select-Object LocalAddress, State, OwningProcess | ConvertTo-Json -Compress', { port }), parse: (r) => ({ inUse: asList(json(r)).length > 0, connections: asList(json(r)) }) }),

  create_restore_point: simple(ps("Checkpoint-Computer -Description 'JARVIS' -RestorePointType MODIFY_SETTINGS; 'created'", {}, { timeoutMs: 120_000 }), () => ({ created: true })),
  defender_status: simple(ps('Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated | ConvertTo-Json -Compress'), json),
  quick_scan: simple(ps('Start-MpScan -ScanType QuickScan; "scan finished"', {}, { timeoutMs: 1_800_000 }), () => ({ scanned: true })),
};
