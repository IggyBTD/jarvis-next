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

The UI token is stored in the app's local storage; moving it to the macOS keychain needs a Tauri plugin and is a known item.
