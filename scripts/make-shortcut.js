// Creates the "JARVIS NEXT" shortcut (Desktop and Start menu) with the app icon, so it starts like any other app.
// Windows only. Run again after moving the folder.   node scripts/make-shortcut.js [--no-desktop]
import path from 'node:path';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';

const PS = `
$w = New-Object -ComObject WScript.Shell
$places = @($w.SpecialFolders.Item('Programs'))
if ($env:JARVIS_DESKTOP -eq '1') { $places += $w.SpecialFolders.Item('Desktop') }
foreach ($dir in $places) {
  $s = $w.CreateShortcut((Join-Path $dir 'JARVIS NEXT.lnk'))
  $s.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'
  $s.Arguments = '"' + $env:JARVIS_VBS + '"'
  $s.WorkingDirectory = $env:JARVIS_ROOT
  $s.IconLocation = $env:JARVIS_ICO + ',0'
  $s.Description = 'JARVIS NEXT'
  $s.WindowStyle = 7
  $s.Save()
  Write-Output $s.FullName
}`;

if (isMain(import.meta.url)) {
  if (process.platform !== 'win32') { console.error('This makes a Windows shortcut. On the Mac, open JARVIS in the browser and use "Add to Dock" (Safari) or "Install app" (Chrome).'); process.exit(1); }
  const r = await runProgram({
    file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', PS], timeoutMs: 30_000,
    env: { JARVIS_VBS: path.join(ROOT, 'scripts', 'jarvis-next.vbs'), JARVIS_ROOT: ROOT, JARVIS_ICO: path.join(ROOT, 'src-tauri', 'icons', 'icon.ico'), JARVIS_DESKTOP: process.argv.includes('--no-desktop') ? '0' : '1' },
  });
  console.log(r.code === 0 ? `Created:\n${r.stdout.trim()}` : `Failed: ${r.stderr || r.stdout}`);
  process.exit(r.code === 0 ? 0 : 1);
}
