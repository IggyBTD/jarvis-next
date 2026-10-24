# Prompt for Claude Code on the MacBook

Before pasting: on the MacBook, put `jarvis-mac.zip` (from the PC: `dist-mac\jarvis-mac.zip`) in your Downloads folder, and have `mac.token` ready (AirDrop or USB; never iCloud, never chat). You need the PC's address (its Tailscale name or LAN IP, for example `192.168.1.32`).

Paste everything between the lines into Claude Code, started in your home folder.

---

You are setting up the light JARVIS helper on this Mac. JARVIS runs on a PC; this Mac only runs a small agent that lets JARVIS control it, and uses a browser for the interface. Do only what is listed here and ask before anything else. Never print, log, commit or paste the contents of any token file.

The PC's address is: `<PC_ADDRESS>` (ask me if I have not filled it in).

0. **Tailscale (only if I want to use JARVIS away from home).** Ask me. If yes: check it is installed and signed in (`tailscale status`); if not, tell me to install it from tailscale.com/download and sign in with the same account as the PC, then continue. Tell me this Mac's Tailscale name and the PC's, and use the Tailscale names instead of IP addresses in steps 4 and 10.
1. **Prerequisites.** Check `node --version`. If it is missing or below 22, install it with Homebrew (`brew install node`; install Homebrew first only if I agree). Do not install Rust, Xcode tools, Tauri or anything for a desktop app: this Mac does not build anything.
2. **Unpack.** `mkdir -p ~/jarvis && cd ~/jarvis`, unzip `~/Downloads/jarvis-mac.zip` here (`unzip -q ~/Downloads/jarvis-mac.zip`), then `npm install` (it installs only `playwright`). Do not run `npx playwright install` yet: if Google Chrome is installed, the guarded browser can use it (set `JARVIS_BROWSER_CHANNEL=chrome` in the LaunchAgent); otherwise ask me before downloading Chromium (about 150 MB).
3. **Token.** Make `~/jarvis/data/tokens/`. I will put `mac.token` there myself. When it exists, run `chmod 600 ~/jarvis/data/tokens/mac.token`. Check only that the file exists and is private; never read it out.
4. **Config.** In `~/jarvis/config/server/machines.json` set `server.url` to `http://<PC_ADDRESS>:7410` (the PC's Tailscale name if we use Tailscale). Change nothing else there. Tell me this Mac's own address (Tailscale name or LAN IP, from `ifconfig`) so I can put it into the PC's configuration as `machines.mac.host`.
5. **Optional coding agent.** Ask me whether I want it. If yes: install OpenCode at exactly the version in `config/server/policy.json` (`opencode.version`), then run `node scripts/opencode-verify.js` and show me the table. If no, skip.
6. **Autostart.** Run `node scripts/install.js --os darwin` and show me the preview. If I agree, run it with `--apply`. This creates one LaunchAgent for the agent only.
7. **Permissions.** Walk me through System Settings, Privacy & Security: Accessibility, Automation and Microphone (Screen Recording only if I later enable screenshots). Only I can grant them; tell me exactly which app to enable (Terminal, or node).
8. **Check.** Run `node scripts/doctor.js --agent-only`. Every line should say PASS. For any FAIL, show the line, explain it in plain words, and fix it only if the fix is inside `~/jarvis`.
9. **Real tests, one at a time, each confirmed with me:** open an app (`node -e` is not needed: use the doctor output and ask me to try "open Notes" from the JARVIS app once connected), set the volume, lock the screen, read memory use. Do not run commands that change the system by yourself.
10. **Interface.** Tell me to open on this Mac, in Safari or Chrome, a link the PC prints with `node scripts/client-link.js` (the home link looks like `http://<PC_ADDRESS>:7410/#token=...`; with Tailscale there is also an away link, and the https one is the one that allows the microphone). Also read `docs/remote.md` with me if I want to use it away from home, and run its checks with me (Wi-Fi off, phone hotspot). Do not ask me to paste that link to you. In the app, Settings should show Connected and the PC/Mac switcher should appear.

Report back: what passed, what failed, the exact error text of anything that failed, this Mac's address, and anything I still have to do by hand.
