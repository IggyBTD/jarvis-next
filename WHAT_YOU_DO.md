# What you need to do

Everything the build could do alone is done. These are the steps only you can do, in order. Tick them off as you go.

## A. On the PC (about 10 minutes)

- [ ] **1. Load the model in LM Studio.** Load Qwen at Q4 and load it; its identifier is `qwen3.8-27b`, which JARVIS is already set to.
- [ ] **2. Start JARVIS.** In `C:\Users\bethe\Jarvis-Next`, run these in two terminals and leave them open:
  ```
  npm run server
  npm run agent
  ```
- [ ] **3. Build the app and the Mac bundle** (once, and again after any change):
  ```
  npm run build
  node scripts/make-mac-bundle.js
  ```
  The bundle is created at `dist-mac\jarvis-mac.zip` (about 84 KB).
- [ ] **4. Get the link for the Mac** and keep it private (it contains your token):
  ```
  node scripts/client-link.js
  ```
- [ ] **5. Check everything:**
  ```
  node scripts/doctor.js
  ```
  Expect FAIL lines for the Mac agent, OpenCode and Google until the later steps are done.

## B. Move two files to the MacBook

- [ ] **6.** Copy `dist-mac\jarvis-mac.zip` to the Mac's Downloads folder (AirDrop or USB).
- [ ] **7.** Copy `data\tokens\mac.token` to the Mac the same way. **Never** through iCloud, email or chat.

## C. On the MacBook

- [ ] **8. Open Claude Code on the Mac** in your home folder.
- [ ] **9. Paste the prompt** from `docs\MAC_PROMPT.md` (everything between the two lines). Replace `<PC_ADDRESS>` with `192.168.1.32`, or the PC's Tailscale name if you set that up.
- [ ] **10. Answer its questions.** It will ask before installing Node, before installing OpenCode (optional) and before creating the startup item.
- [ ] **11. Grant the macOS permissions** it tells you about: Accessibility, Automation, Microphone (System Settings > Privacy & Security). Only you can do this.
- [ ] **12. Write down the Mac's address** that Claude Code reports at the end.

## D. Back on the PC

- [ ] **13.** Open `config\server\machines.json` and set `"host"` for `mac` to the Mac's address from step 12.
- [ ] **14.** Stop and restart `npm run server` so it picks that up.
- [ ] **15.** Run `node scripts/doctor.js` again. "Agent mac reachable" should now say PASS.

## E. Use it

- [ ] **16.** On the Mac, open the link from step 4 in Safari or Chrome. Settings should say **Connected**, and a **PC / Mac** switcher appears at the top right.
- [ ] **17.** Send a message. Click **Mac** in the switcher and ask it to do something on the Mac (for example "what is the volume?"). Anything risky shows an approval dialog first.

## F. Using it away from home

Follow `docs/remote.md` (about 15 minutes). Short version:

- [ ] **18.** Install Tailscale on the PC and the Mac, same account.
- [ ] **19.** On the PC (admin PowerShell): `powercfg /change standby-timeout-ac 0` and `powercfg /change hibernate-timeout-ac 0` so it never sleeps while plugged in.
- [ ] **20.** On the PC: `tailscale serve --bg 7410` (gives an HTTPS address, needed for the microphone).
- [ ] **21.** Put the Tailscale names into `machines.json` on both machines (see the doc), restart the server and the Mac agent.
- [ ] **22.** `node scripts/client-link.js` on the PC; open the **away** link on the Mac.
- [ ] **23.** Test: turn Mac Wi-Fi off, use a phone hotspot, and check Settings still says Connected.

## Optional, later

| Item | Why | How |
|---|---|---|
| Tailscale on both machines | Encrypts the link and stops the address changing | Install it on both, then use the Tailscale names instead of `192.168.1.32` |
| OpenCode (coding agent) | Lets JARVIS write code on either computer | Install version 1.19.1, then `node scripts/opencode-verify.js` |
| Google sign-in (morning digest) | Reads your calendar and mail (read only) | Steps in `HUMAN_TODO.md`, section 4 |
| Voice | Push-to-talk (hold Ctrl+Space) | Needs speech engines on ports 8770 and 8771; `HUMAN_TODO.md`, section 9 |
| Firewall rule | Lets the Mac reach the PC through Windows Firewall | `node scripts/install.js --os win32` prints the command to run in an admin PowerShell |

## If something goes wrong

| Symptom | Fix |
|---|---|
| "not connected, retrying" | The address or token is wrong, or the server is not running. Use the link from step 4. |
| "model not loaded" | Step 1: load `qwen3.8-27b` in LM Studio. |
| Mac page loads but cannot connect | Both machines must be on the same network, and Windows Firewall must allow port 7410 (see the table above). |
| Agent mac reachable: FAIL | Steps 13 and 14, and check the Mac agent is running (`node scripts/doctor.js --agent-only` on the Mac). |
| Anything else | Paste the exact error text to me. |

More detail: `HUMAN_TODO.md` (everything only you can do), `docs/setup-mac.md`, `docs/network.md`, `docs/known-issues.md`.

## Updating the Mac later (no AirDrop)

When the PC's JARVIS gets new features, the Mac helper needs them too. In Terminal on the Mac:

```bash
cd ~/jarvis-folder && node scripts/update.js
```

(use the folder where you put JARVIS on the Mac). It downloads the current helper from the PC, keeps your tokens and addresses, and restarts the Mac agent. The PC must be on and reachable (Tailscale connected). The first time, the Mac still has the old bundle without `update.js`: copy a fresh `dist-mac\jarvis-mac.zip` once (run `node scripts/make-mac-bundle.js` on the PC), unzip over the folder, then use `update.js` from then on.

The Mac also needs OpenCode at the exact version JARVIS expects: `npm install -g opencode-ai@1.19.1`.

## Start the PC from the Mac when it is asleep (away from home)

A sleeping PC cannot answer, and a wake-up packet from another network cannot reach your home network on its own. So you need **one small always-on device at home** that is on your Tailscale network and on the same network as the PC (a Raspberry Pi, a NAS, an old laptop, anything that can run Node). It sends the packet for you. No port is opened to the internet.

1. **On the PC (once):** `node scripts/wake.js --check` must list your network adapter. Also enable Wake on LAN in the BIOS/UEFI. Your PC is on Wi-Fi: that is the weak point. Plug in an Ethernet cable if you can; Wi-Fi wake from sleep works on some machines and never from a full shut down. Use Sleep, not Shut down, when you leave.
2. **On the PC (once):** make the server start by itself at logon, or waking the PC will not bring JARVIS back: `node scripts/install.js --os win32 --apply`.
3. **On the home device:** put the JARVIS folder on it (the Mac bundle is enough), install Tailscale, then run `node scripts/wake-relay.js --mac AC:36:1B:E9:A4:91 --host <its Tailscale address>`. It creates `data/tokens/wake.token`. Keep it running (the install script's startup item, or a systemd service).
4. **On the Mac (once):** copy that `wake.token` to the Mac's `data/tokens/` by hand. Create `data/wake.json` with `{ "mac": "AC:36:1B:E9:A4:91", "relay": "http://<the device's Tailscale address>:7430" }`.
5. **Whenever you need it:** `node scripts/wake.js`. It asks the relay, waits until JARVIS answers (up to 3 minutes), then you open your usual link.

At home, with no relay in `wake.json`, the same command sends the packet from the Mac directly.

## Start JARVIS NEXT like any other app (PC)

`node scripts/make-shortcut.js` puts **JARVIS NEXT** (and **Start JARVIS Old**, which replaces run_JARVIS.bat: same `npm run tauri dev`, no console window) on the Desktop and in the Start menu, with its icon. Clicking it starts the server and the PC agent in the background if they are not running, then opens JARVIS in its own window (no tabs, no address bar, its own taskbar icon). Right-click it in the taskbar or Start menu to pin it. Logs are in `data/logs/`. Run the script again if you move the folder; `node scripts/make-icon.js` redraws the icon.
