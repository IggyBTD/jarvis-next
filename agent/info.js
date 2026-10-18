// Live facts about this machine for the system prompt (GET /info). Nothing is hardcoded in the prompts.
import os from 'node:os';
import path from 'node:path';
import { runProgram as realRun } from './registry/common.js';

export async function getInfo({ machine, platform = process.platform, runProgram = realRun, now = new Date() }) {
  let osVersion = os.release();
  if (platform === 'darwin') {
    const r = await runProgram({ file: 'sw_vers', args: ['-productVersion'], timeoutMs: 3000 }).catch(() => null);
    if (r?.code === 0) osVersion = `macOS ${r.stdout.trim()}`;
  } else if (platform === 'win32') osVersion = `Windows ${os.version?.() ?? os.release()}`.replace(/^Windows Windows/, 'Windows');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    os: platform, os_version: osVersion, hostname: os.hostname(), user: os.userInfo().username, home: os.homedir(),
    shell: platform === 'win32' ? 'PowerShell' : 'zsh', path_sep: path.sep === '\\' ? '\\' : '/',
    workspace_dir: machine.workspaceDir, package_manager: platform === 'win32' ? 'winget' : 'Homebrew',
    modifier_key: platform === 'win32' ? 'Ctrl' : 'Cmd', locale: Intl.DateTimeFormat().resolvedOptions().locale, timezone: tz,
    date: now.toLocaleString('en-CA', { timeZone: tz, hour12: false }).replace(',', ''),
  };
}
