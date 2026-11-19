// Creates the "JARVIS NEXT" and "Start JARVIS Old" shortcuts (Desktop and Start menu) with their icons, so both start like any
// other app. Windows only. Run again after moving the folder.   node scripts/make-shortcut.js [--no-desktop]
import path from 'node:path';
import { ROOT } from '../server/core/config.js';
import { isMain } from '../shared/util.js';
import { runProgram } from '../agent/registry/common.js';

const PS = `
$w = New-Object -ComObject WScript.Shell
$places = @($w.SpecialFolders.Item('Programs'))
if ($env:JARVIS_DESKTOP -eq '1') { $places += $w.SpecialFolders.Item('Desktop') }
foreach ($item in ($env:JARVIS_ITEMS | ConvertFrom-Json)) {
  foreach ($dir in $places) {
    $s = $w.CreateShortcut((Join-Path $dir ($item.name + '.lnk')))
    $s.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'
    $s.Arguments = '"' + $item.vbs + '"'
    $s.WorkingDirectory = $env:JARVIS_ROOT
    $s.IconLocation = $item.ico + ',0'
    $s.Description = $item.name
    $s.WindowStyle = 7
    $s.Save()
    Write-Output $s.FullName
  }
}`;

export const ITEMS = (root = ROOT) => [
  { name: 'JARVIS NEXT', vbs: path.join(root, 'scripts', 'jarvis-next.vbs'), ico: path.join(root, 'src-tauri', 'icons', 'icon.ico') },
  { name: 'Start JARVIS Old', vbs: path.join(root, 'scripts', 'start-jarvis-old.vbs'), ico: path.join(root, 'src-tauri', 'icons', 'icon-old.ico') },
];

if (isMain(import.meta.url)) {
  if (process.platform !== 'win32') { console.error('This makes Windows shortcuts. On the Mac, open JARVIS in the browser and use "Add to Dock" (Safari) or "Install app" (Chrome).'); process.exit(1); }
  const r = await runProgram({
    file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', PS], timeoutMs: 30_000,
    env: { JARVIS_ITEMS: JSON.stringify(ITEMS()), JARVIS_ROOT: ROOT, JARVIS_DESKTOP: process.argv.includes('--no-desktop') ? '0' : '1' },
  });
  console.log(r.code === 0 ? `Created:\n${r.stdout.trim()}` : `Failed: ${r.stderr || r.stdout}`);
  process.exit(r.code === 0 ? 0 : 1);
}
