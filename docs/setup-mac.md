# Setting up the Mac

The Mac runs only an agent (port 7422) and, if you want the desktop app, the client.

1. Install Xcode command line tools (`xcode-select --install`), Node 22 or newer, and (for the app) Rust and the Tauri prerequisites.
2. Clone the repository by git into a folder that is not inside iCloud Desktop or Documents. `npm install`.
3. Copy `mac.token` and `ui.token` from the PC to `data/tokens/` on the Mac by hand (not through iCloud or chat).
4. Install OpenCode at the pinned version. `node scripts/install.js --os darwin --apply` creates the LaunchAgent.
5. Grant Accessibility, Automation and Microphone when macOS asks (Screen Recording only if you enable `screenshot`).
6. `node scripts/doctor.js --agent-only`.
7. In the app: Settings, JARVIS server: address `ws://pc:7410`, the UI token, enable.

Mac action checklist (try each once for real, then enable its category): open_app, set_volume, lock_screen (needs "require password immediately" or Accessibility), system info set. `memory_usage` uses `vm_stat` (free plus inactive plus speculative pages) because `os.freemem()` on macOS ignores cache.

Away from home: see `docs/remote.md` (Tailscale on both machines, then use the away link from `node scripts/client-link.js`).

The UI token is stored in the app's local storage; moving it to the macOS keychain needs a Tauri plugin and is a known item.

## Open JARVIS on the Mac (the easy way)

1. On the PC: `node scripts/make-mac-bundle.js --with-tokens` makes `dist-mac/jarvis-mac-with-tokens.zip` (it contains `ui.token` and `mac.token`: AirDrop or USB only, delete it afterwards). Without the flag the zip has no tokens and you copy `ui.token` into `data/tokens/` yourself.
2. On the Mac: unzip to `~/jarvis`, `npm install` once (Node 22+: `brew install node`), then double-click `JARVIS.app` (drag it to the Dock; the first open needs right-click > Open).
3. It checks the PC's server. If the PC is on but the server is not running, it rings `scripts/pc-starter.js` on the PC (port 7411, starts at the PC's logon from the Startup folder), waits, then opens the window. If `data/wake.json` exists (see `WHAT_YOU_DO.md`), it can wake a sleeping PC too.
4. PC, once, in an admin PowerShell: `New-NetFirewallRule -DisplayName "JARVIS starter" -Direction Inbound -Protocol TCP -LocalPort 7411 -RemoteAddress 100.64.0.0/10 -Action Allow` (Tailscale only, like the server rule). `node scripts/install.js --os win32` lists it too.
5. Failures show a dialog and are logged in `data/logs/open-mac.log`.
