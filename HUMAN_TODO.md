# Things only you can do

Exact commands are for the PC (PowerShell) unless a line says Mac. Nothing below was run for you. Tick items off as you go.

## 1. First start (PC)
```powershell
cd C:\Users\bethe\Jarvis-Next
npm install
npm run gen-tokens        # creates data\tokens\ui.token, pc.token, mac.token
npm test                  # must be green before anything else
```

## 2. Model on the PC
1. Install LM Studio 0.4.14 or newer, or `llama-server`. Load Qwen3.8-27B at Q4. Keep it bound to localhost:1234.
2. Set the model alias to `local` (LM Studio: model settings, API identifier) and the context to 65536.
3. Run `npm run bench -- --help` (scripts\bench-model.js) and record the numbers in `docs\benchmarks.md`. Try MTP on and off, ROCm and Vulkan.
4. Confirm the thinking switch works: `node scripts\bench-model.js --check-thinking`. If thinking text still appears, change `thinkingMethod` in `config\server\models.json` to `no_think`.

## 3. Network
1. Install Tailscale on both machines. Set the machine names to `pc` and `mac` (or edit `host` in `config\server\machines.json`).
2. Copy `data\tokens\mac.token` and `data\tokens\ui.token` to the Mac by hand (USB or AirDrop, not iCloud and not chat). Keep them at `~/jarvis/data/tokens/`.
3. Firewall, one command per port, scoped to the Tailscale range. Run in an elevated PowerShell:
```powershell
New-NetFirewallRule -DisplayName "JARVIS server" -Direction Inbound -Protocol TCP -LocalPort 7410 -RemoteAddress 100.64.0.0/10 -Action Allow
```
   On LAN only, use `-RemoteAddress 192.168.0.0/16` (weaker guarantee, see docs\network.md). The PC agent (7421) listens on localhost only and needs no rule.
4. Wake-on-LAN (optional): enable it in BIOS and in the network adapter's Power Management tab, then put the PC's MAC address in `machines.json` (`mac` field of `pc`).

## 4. Google (digest)
1. Google Cloud console: new project, enable Gmail API and Google Calendar API.
2. OAuth consent screen: External, add yourself as a test user, then set Publishing status to **In production** (otherwise refresh tokens die after 7 days). The unverified-app warning is expected for personal use.
3. Credentials: OAuth client ID, type Desktop. Download the JSON to `data\tokens\google-client.json`.
4. `node scripts\google-auth.js` and follow the link. Scopes are read-only (gmail.readonly, calendar.readonly).
5. Set `JARVIS_TOKEN_KEY` (any long random string) in the environment of the server task. It encrypts the saved Google token.

## 5. Mac
```bash
xcode-select --install
# install Node 22+, Rust and the Tauri prerequisites, then:
git clone <your private remote> ~/jarvis && cd ~/jarvis   # not inside iCloud Desktop or Documents
npm install
bash scripts/install-mac.sh
```
Grant Accessibility, Automation and Microphone (and Screen Recording if you enable `screenshot`) when macOS asks. Then run the Mac action checklist in `docs/setup-mac.md`.

## 6. Install autostart (PC)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-pc.ps1     # prints firewall commands, creates the scheduled tasks
node scripts\doctor.js                                              # pass/fail table
```

## 7. Real-action checks
Each enabled action category is only trusted after you ran it for real:
```powershell
$env:JARVIS_REAL_ACTIONS = "1"; npm run test:real
```
Checklist (tick when verified on that OS): open_app, set_volume/get_volume, lock_screen, game_mode_on/off (check the power plan afterwards), open_workspace, system info set.
Then flip `enabled` to `true` in `config\server\actions.json` one category at a time.

## 8. OpenCode (both machines)
Install the pinned version (see `config\server\policy.json`, `opencode.version`) and run `node scripts/opencode-verify.js` against it. It checks the permission endpoints and that `POST /session/:id/shell` is never needed. Acceptance: "clone this repo and run its tests" in the workspace, every non-allowlisted command asks.

## 9. Voice
Run an OpenAI-compatible speech-to-text server on :8770 and text-to-speech on :8771 (the old JARVIS voice sidecar can be wrapped), set `enabled` to `true` in `config\server\voice.json`, then test with a real microphone in English, Spanish and French.

## 10. Other decisions
- Decide whether the PC should wake for the 07:00 digest (BIOS wake timer) or stay on.
- Sync method between machines: a private git remote.
- Desktop build: `npm run tauri build` on each OS. Store the UI token in the OS keychain (see docs/setup-mac.md); the browser build keeps it in localStorage.
