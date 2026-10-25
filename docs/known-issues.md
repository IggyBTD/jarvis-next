# Known issues and limits

Medium and low findings, and things that were built and tested only against fakes.

- **Nothing was run on a real Windows or macOS machine** by the build: every action's plan is unit tested with a command-runner mock; the Windows volume code (Core Audio through `Add-Type`) and the macOS media keys are the least certain. `HUMAN_TODO.md` section 7 lists the manual checks.
- **OpenCode was not run for real.** The permission bridge, the manager and the tasks are tested against a fake that reproduces the known quirks (two reply routes, stale ids succeed, no persistence over restarts). `node scripts/opencode-verify.js` checks the real install.
- **Browser DNS**: the sidecar checks every request's address but the browser resolves the name again, so DNS rebinding could slip between check and use. A proxy that pins the address would close it (`ponytail` comment in `sidecars/browser-guard/server.js`).
- **CAPTCHA** pauses the browser and tells you, but does not switch to a visible window by itself: start the sidecar with `--headed` for sites that need it.
- **Voice** uses an energy VAD and a silence timeout, and external OpenAI-compatible speech engines; Silero VAD and Smart Turn v3 can replace the small modules in `server/voice/engines.js`. Wake word says "not available yet". The client uses `ScriptProcessor` for capture; an AudioWorklet is better. Playback assumes 24 kHz PCM. The voice client was not tried with a real microphone.
- **UI token** is in localStorage, not the OS keychain. The push-to-talk key is Ctrl+Space inside the app window, not a global shortcut.
- **Gmail** is read through snippets only, not full bodies.
- **Conversations** are stored in plain JSON under `data/conversations/`, including tool results (which can hold file contents). Treat `data/` as private.
- **File actions** resolve symlinks before checking the allowed folders but cannot close a race between the check and the use (a link swapped in that instant).
- **`transfer_file`, `set_audio_output` and `night_light`** are in the contract but not implemented on any OS (they need a second machine hop, a third-party audio module, and an undocumented registry blob).
- **Two low-severity advisories** from `npm audit` in the old app's dependencies (mermaid, katex); not part of the server.
- The app's target switcher has exactly two buttons; a third machine needs a small UI change.
- **Plan mode, skills and the Code page's file and diff panes** still belong to the original local mode. In server mode the Code page's task list shows the coding agent's tasks (OpenCode on the active computer); changes are reviewed through the approval dialogs and the Server tab.
- **The Mac shows its System readout once a minute**, the PC every second.
- **Mac OpenCode version**: the Mac must have exactly the pinned version (`npm install -g opencode-ai@1.19.1`), or the agent refuses it.
