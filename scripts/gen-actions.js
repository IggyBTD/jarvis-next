// Bootstraps config/server/actions.json from the compact table below. After the first run the JSON is the contract
// (edit it directly, e.g. to flip "enabled"); re-running this script keeps the "enabled" flags that are already there.
// Row: [name, category, tier, platforms (w=win32, d=darwin), description, params, flags]
// params: space separated "name:type" with ! for required. Types: s string, i integer (i0-100 range), b boolean, e(a|b) enum.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROWS = [
  ['open_app', 'apps', 'T1', 'wd', 'Open an application by its alias from apps.json.', 'app:s!', 'mvp'],
  ['focus_app', 'apps', 'T1', 'wd', 'Bring a running application to the front.', 'app:s!'],
  ['list_running_apps', 'apps', 'T0', 'wd', 'List the applications that are running.', ''],
  ['close_app', 'apps', 'T2', 'wd', 'Ask an application to quit.', 'app:s!'],
  ['force_quit_app', 'apps', 'T3', 'wd', 'Force an application to quit (unsaved work is lost).', 'app:s!'],
  ['open_url', 'apps', 'T1', 'wd', 'Open an http or https address in the default browser.', 'url:s!'],
  ['open_file', 'apps', 'T1', 'wd', 'Open a file inside the allowed folders with its default application.', 'path:s!'],
  ['open_folder', 'apps', 'T1', 'wd', 'Open a folder inside the allowed folders in the file manager.', 'path:s!'],
  ['reveal_in_file_manager', 'apps', 'T1', 'wd', 'Show a file in the file manager.', 'path:s!'],
  ['show_desktop', 'apps', 'T1', 'wd', 'Minimise windows to show the desktop.', ''],
  ['list_windows', 'apps', 'T0', 'wd', 'List open windows with their titles.', ''],
  ['tile_windows', 'apps', 'T1', 'w', 'Tile the open windows side by side.', ''],

  ['open_workspace', 'workspaces', 'T1', 'wd', 'Open a named workspace: its apps, addresses and folders from workspaces.json.', 'name:s!', 'mvp'],
  ['close_workspace', 'workspaces', 'T2', 'wd', 'Close the apps of a named workspace.', 'name:s!'],
  ['list_workspaces', 'workspaces', 'T0', 'wd', 'List the configured workspaces.', ''],
  ['start_dev_server', 'workspaces', 'T1', 'wd', 'Start a predefined dev command of a workspace.', 'workspace:s! command:s!'],
  ['stop_dev_server', 'workspaces', 'T2', 'wd', 'Stop a dev server that JARVIS started.', 'workspace:s! command:s!'],
  ['list_dev_servers', 'workspaces', 'T0', 'wd', 'List the dev servers that JARVIS started.', ''],

  ['set_volume', 'audio', 'T1', 'wd', 'Set the system volume from 0 to 100.', 'level:i0-100!', 'mvp'],
  ['get_volume', 'audio', 'T0', 'wd', 'Read the system volume.', '', 'mvp'],
  ['mute', 'audio', 'T1', 'wd', 'Mute the system audio.', ''],
  ['unmute', 'audio', 'T1', 'wd', 'Unmute the system audio.', ''],
  ['list_audio_devices', 'audio', 'T0', 'wd', 'List audio output devices.', ''],
  ['set_audio_output', 'audio', 'T1', 'wd', 'Switch the audio output device by name.', 'device:s!'],
  ['media_play_pause', 'audio', 'T1', 'wd', 'Play or pause the current media.', ''],
  ['media_next', 'audio', 'T1', 'wd', 'Skip to the next track.', ''],
  ['media_previous', 'audio', 'T1', 'wd', 'Go to the previous track.', ''],

  ['turn_off_display', 'display', 'T1', 'wd', 'Turn the display off (the session stays unlocked).', ''],
  ['set_brightness', 'display', 'T1', 'd', 'Set the screen brightness from 0 to 100.', 'level:i0-100!'],
  ['toggle_dark_mode', 'display', 'T1', 'wd', 'Switch between light and dark appearance.', ''],
  ['list_displays', 'display', 'T0', 'wd', 'List the connected displays.', ''],
  ['set_wallpaper', 'display', 'T1', 'wd', 'Set the desktop wallpaper to an image inside the allowed folders.', 'path:s!'],
  ['night_light', 'display', 'T1', 'w', 'Turn the night light on or off.', 'enabled:b!'],

  ['get_power_plan', 'power', 'T0', 'wd', 'Read the active power plan or mode.', ''],
  ['set_power_plan', 'power', 'T2', 'w', 'Switch the Windows power plan.', 'plan:e(balanced|high_performance|power_saver)!'],
  ['lock_screen', 'power', 'T1', 'wd', 'Lock the screen.', '', 'mvp'],
  ['sleep', 'power', 'T2', 'wd', 'Put the computer to sleep.', ''],
  ['hibernate', 'power', 'T2', 'w', 'Hibernate the computer.', ''],
  ['keep_awake', 'power', 'T1', 'wd', 'Keep the computer awake for a number of minutes.', 'minutes:i1-720!'],
  ['cancel_keep_awake', 'power', 'T1', 'wd', 'Stop keeping the computer awake.', ''],
  ['schedule_shutdown', 'power', 'T3', 'wd', 'Shut the computer down after a number of minutes.', 'minutes:i1-1440!'],
  ['cancel_shutdown', 'power', 'T3', 'wd', 'Cancel a scheduled shutdown.', ''],
  ['shutdown', 'power', 'T3', 'wd', 'Shut the computer down now.', ''],
  ['restart', 'power', 'T3', 'wd', 'Restart the computer now.', ''],
  ['sign_out', 'power', 'T3', 'wd', 'Sign the current user out.', ''],
  ['battery_status', 'power', 'T0', 'wd', 'Read the battery level and charging state.', ''],

  ['game_mode_on', 'performance', 'T2', 'w', 'Switch to the high performance plan, enable Game Mode, close the configured apps and optionally launch a game.', 'launch:s', 'mvp'],
  ['game_mode_off', 'performance', 'T2', 'w', 'Return to the balanced plan.', '', 'mvp'],
  ['list_top_processes', 'performance', 'T0', 'wd', 'List the processes using the most CPU.', 'count:i1-30'],
  ['set_process_priority', 'performance', 'T2', 'w', 'Change the priority of a process.', 'pid:i1-4194304! priority:e(low|below_normal|normal|above_normal|high)!'],
  ['kill_process', 'performance', 'T3', 'wd', 'Terminate a process by its id.', 'pid:i1-4194304!'],
  ['list_startup_items', 'performance', 'T0', 'wd', 'List the programs that start with the computer.', ''],
  ['clear_temp_files', 'performance', 'T3', 'w', 'Delete temporary files. Use dryRun first.', 'dryRun:b'],
  ['empty_trash', 'performance', 'T3', 'd', 'Empty the Trash.', ''],
  ['empty_recycle_bin', 'performance', 'T3', 'w', 'Empty the Recycle Bin.', ''],

  ['get_system_info', 'system', 'T0', 'wd', 'Operating system, host name, CPU, memory and uptime summary.', '', 'mvp'],
  ['cpu_usage', 'system', 'T0', 'wd', 'Current CPU load in percent.', '', 'mvp'],
  ['memory_usage', 'system', 'T0', 'wd', 'Memory used and total in GiB.', '', 'mvp'],
  ['disk_usage', 'system', 'T0', 'wd', 'Free and total space per disk.', '', 'mvp'],
  ['gpu_usage', 'system', 'T0', 'w', 'GPU load, memory and temperature.', '', 'mvp'],
  ['temperatures', 'system', 'T0', 'w', 'Hardware temperatures.', '', 'mvp'],
  ['uptime', 'system', 'T0', 'wd', 'Time since the last boot.', '', 'mvp'],
  ['installed_apps', 'system', 'T0', 'wd', 'List the installed applications.', ''],
  ['pending_updates', 'system', 'T0', 'wd', 'List available software updates (read only).', ''],
  ['disk_health', 'system', 'T0', 'wd', 'Physical disk health status.', ''],
  ['list_services', 'system', 'T0', 'wd', 'List system services and their state.', ''],

  ['network_info', 'network', 'T0', 'wd', 'Network adapters and addresses.', ''],
  ['wifi_status', 'network', 'T0', 'wd', 'Current Wi-Fi connection.', ''],
  ['list_wifi', 'network', 'T0', 'wd', 'Wi-Fi networks in range.', ''],
  ['ping', 'network', 'T0', 'wd', 'Ping a host name or address four times.', 'host:s!'],
  ['public_ip', 'network', 'T0', 'wd', 'The public IP address (makes an external request).', ''],
  ['flush_dns', 'network', 'T2', 'wd', 'Flush the DNS cache.', ''],
  ['toggle_wifi', 'network', 'T3', 'wd', 'Turn Wi-Fi on or off.', 'enabled:b!'],
  ['tailscale_status', 'network', 'T0', 'wd', 'Tailscale connection status.', ''],
  ['open_ports', 'network', 'T0', 'wd', 'Listening network ports.', ''],
  ['wake_on_lan', 'network', 'T1', 'wd', 'Send a Wake-on-LAN packet to a MAC address.', 'mac:s!'],

  ['list_dir', 'files', 'T0', 'wd', 'List a folder inside the allowed roots.', 'path:s!'],
  ['read_file', 'files', 'T0', 'wd', 'Read a text file inside the allowed roots.', 'path:s!'],
  ['search_files', 'files', 'T0', 'wd', 'Find files by name inside the allowed roots.', 'path:s! pattern:s!'],
  ['file_info', 'files', 'T0', 'wd', 'Size and dates of a file.', 'path:s!'],
  ['find_duplicates', 'files', 'T0', 'wd', 'Find duplicate files in a folder by content hash.', 'path:s!'],
  ['copy_file', 'files', 'T2', 'wd', 'Copy a file inside the allowed roots.', 'from:s! to:s!'],
  ['move_file', 'files', 'T2', 'wd', 'Move a file inside the allowed roots.', 'from:s! to:s!'],
  ['trash_file', 'files', 'T3', 'wd', 'Move a file to the Recycle Bin or Trash.', 'path:s!'],
  ['zip_folder', 'files', 'T2', 'wd', 'Zip a folder inside the allowed roots.', 'path:s! to:s'],
  ['transfer_file', 'files', 'T3', 'wd', 'Copy a file to the other machine.', 'path:s!'],
  ['clean_downloads', 'files', 'T3', 'wd', 'Propose and then move old files out of Downloads (proposal first).', 'apply:b'],

  ['get_clipboard', 'clipboard', 'T2', 'wd', 'Read the clipboard text (may hold secrets).', ''],
  ['set_clipboard', 'clipboard', 'T1', 'wd', 'Put text on the clipboard.', 'text:s!'],
  ['screenshot', 'clipboard', 'T2', 'wd', 'Take a screenshot and save it in the workspace. It stays on the machine.', ''],
  ['show_notification', 'clipboard', 'T1', 'wd', 'Show a desktop notification.', 'title:s! text:s!'],

  ['set_timer', 'time', 'T1', 'wd', 'Start a timer in whole minutes; the server notifies the client.', 'minutes:i1-1440! label:s', 'internal'],
  ['set_reminder', 'time', 'T1', 'wd', 'Set a reminder at a local time (YYYY-MM-DD HH:MM).', 'when:s! text:s!', 'internal'],
  ['list_schedules', 'time', 'T0', 'wd', 'List timers, reminders and scheduled jobs.', '', 'internal'],

  ['open_terminal_at', 'dev', 'T1', 'wd', 'Open a terminal in a folder inside the allowed roots.', 'path:s!'],
  ['open_editor_at', 'dev', 'T1', 'wd', 'Open the code editor on a folder inside the allowed roots.', 'path:s!'],
  ['git_status', 'dev', 'T0', 'wd', 'git status of a workspace repository.', 'path:s'],
  ['git_diff', 'dev', 'T0', 'wd', 'git diff of a workspace repository.', 'path:s'],
  ['docker_ps', 'dev', 'T0', 'wd', 'List docker containers.', ''],
  ['docker_start', 'dev', 'T2', 'wd', 'Start a named docker container.', 'name:s!'],
  ['docker_stop', 'dev', 'T2', 'wd', 'Stop a named docker container.', 'name:s!'],
  ['port_in_use', 'dev', 'T0', 'wd', 'Check what is listening on a port.', 'port:i1-65535!'],

  ['check_updates', 'maintenance', 'T0', 'wd', 'Check for software updates (read only).', ''],
  ['install_updates', 'maintenance', 'T3', 'wd', 'Install software updates.', ''],
  ['create_restore_point', 'maintenance', 'T2', 'w', 'Create a Windows restore point.', ''],
  ['backup_folder', 'maintenance', 'T2', 'wd', 'Copy a folder to the configured backup destination.', 'path:s!'],
  ['defender_status', 'maintenance', 'T0', 'w', 'Microsoft Defender status.', ''],
  ['quick_scan', 'maintenance', 'T2', 'w', 'Start a Microsoft Defender quick scan.', ''],

  ['run_shortcut', 'mac', 'T2', 'd', 'Run a named macOS Shortcut.', 'name:s!'],
  ['run_applescript_named', 'mac', 'T2', 'd', 'Run a named AppleScript from the scripts manifest.', 'name:s!'],
  ['spotlight_search', 'mac', 'T0', 'd', 'Search with Spotlight inside the allowed roots.', 'query:s!'],
  ['caffeinate', 'mac', 'T1', 'd', 'Prevent sleep for a number of minutes.', 'minutes:i1-720!'],

  ['run_user_script', 'scripts', 'T1', 'wd', 'Run a script that is listed in scripts.json (tier per entry).', 'name:s! args:s', 'mvp'],
];

function paramSchema(spec) {
  const properties = {};
  const required = [];
  for (const tok of spec.split(/\s+/).filter(Boolean)) {
    const m = /^(\w+):([sib]|i(\d+)-(\d+)|e\(([^)]+)\))(!?)$/.exec(tok);
    if (!m) throw new Error(`bad param spec ${tok}`);
    const [, name, kind, lo, hi, en, req] = m;
    properties[name] = en ? { type: 'string', enum: en.split('|') }
      : kind === 's' ? { type: 'string', maxLength: 2000 }
        : kind === 'b' ? { type: 'boolean' }
          : lo !== undefined ? { type: 'integer', minimum: Number(lo), maximum: Number(hi) } : { type: 'integer' };
    if (req) required.push(name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'server', 'actions.json');
let prior = {};
try { for (const a of JSON.parse(fs.readFileSync(file, 'utf8')).actions) prior[a.name] = a.enabled; } catch { /* first run */ }
const platforms = (p) => [...(p.includes('w') ? ['win32'] : []), ...(p.includes('d') ? ['darwin'] : [])];
const actions = ROWS.map(([name, category, tier, p, description, params, flags = '']) => ({
  name, description, category, tier, platforms: platforms(p),
  enabled: prior[name] ?? (flags.includes('mvp') || flags.includes('internal')),
  params: paramSchema(params), returns: 'object',
  ...(flags.includes('mvp') ? { mvp: true } : {}),
  ...(flags.includes('internal') ? { internal: true } : {}),
}));
fs.writeFileSync(file, `${JSON.stringify({ maxToolsPerRequest: 15, actions }, null, 2)}\n`);
console.log(`${actions.length} actions written to ${path.relative(process.cwd(), file)}`);
