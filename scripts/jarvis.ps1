# Dot-source once per PowerShell window:  . .\scripts\jarvis.ps1
# Then: Stop-Jarvis, Start-Jarvis (server, agent, app), or Restart-Jarvis.
$JarvisRoot = Split-Path $PSScriptRoot -Parent

function Stop-Jarvis {
  # everything started from this folder: node (server, agent, vite, sidecars), cargo, the app and its webviews
  # npm starts "node server/index.js" with a relative path, so the folder alone misses it: match those commands and the window titles too
  $me = $PID
  $rel = 'server[\\/]index\.js|agent[\\/]index\.js|sidecars[\\/]|npm-cli\.js"? run (server|agent|tauri|dev)|tauri\.js"? dev|jarvis (server|agent|app)'
  Get-CimInstance Win32_Process |
    Where-Object { $_.ProcessId -ne $me -and $_.Name -ne 'claude.exe' -and ($_.CommandLine -like "*$JarvisRoot*" -or $_.ExecutablePath -like "$JarvisRoot*" -or $_.CommandLine -match $rel) } |
    ForEach-Object { Write-Host "stopping $($_.Name) $($_.ProcessId)"; & taskkill /PID $_.ProcessId /T /F *> $null }
  Start-Sleep 2
  $left = netstat -ano | Select-String 'LISTENING' | Select-String ':(7410|7421|7422|5174|8765|4001)\s'
  if ($left) { Write-Warning "still listening:`n$left" } else { Write-Host 'all stopped' }
}

function Start-Jarvis {
  # each part gets its own window. Only the server needs the token key: it inherits it from this process (never on a command line, where
  # every program can read it), and the agent and the app are started after it is removed again.
  $key = [Environment]::GetEnvironmentVariable('JARVIS_TOKEN_KEY', 'User')
  if (-not $key) { Write-Warning 'JARVIS_TOKEN_KEY is not set (Google sign-in will fail)' }
  foreach ($p in @(@('server', 'npm run server'), @('agent', 'npm run agent'), @('app', 'npm run tauri dev'))) {
    if ($p[0] -eq 'server' -and $key) { $env:JARVIS_TOKEN_KEY = $key } else { Remove-Item Env:JARVIS_TOKEN_KEY -ErrorAction SilentlyContinue }
    $cmd = "`$host.UI.RawUI.WindowTitle = 'jarvis $($p[0])'; Set-Location '$JarvisRoot'; $($p[1])"
    Start-Process pwsh -ArgumentList '-NoExit', '-Command', $cmd
    Start-Sleep 3   # server and agent first, so the app finds them
  }
  Remove-Item Env:JARVIS_TOKEN_KEY -ErrorAction SilentlyContinue
}

function Restart-Jarvis { Stop-Jarvis; Start-Jarvis }
