# JARVIS Next

A personal, mostly local AI assistant. The model and the brain run on the PC; this app (Tauri, `src/`) is a thin client that normally runs on the Mac and works unchanged on the PC. JARVIS can control either computer, chosen by a switcher that only you can move.

## What it controls

- **Both computers** through one agent per machine: apps, workspaces, volume, power, system info, files inside allowed folders, clipboard, git, and more. About 115 actions are defined in `config/server/actions.json`; only the basic set is enabled until you try a category on the real machine and switch it on.
- **A coding agent** (OpenCode) on the active computer. Every shell command it wants asks you first, except a short read-only allowlist.
- **A guarded browser** (Playwright). Private networks are blocked, passwords and payment fields are never typed into, submitting or paying needs your approval with a screenshot, CAPTCHAs pause for you.
- **A morning digest** (Calendar and Gmail, read only, plus overnight telemetry), timers and reminders, and voice (push to talk) in English, Spanish and French.

## The one rule

Every tool call goes `tool-router -> policy -> gate -> audit -> agent`. Nothing else reaches an agent (`npm run check-chokepoint` and a test enforce it). Policy is code, not prompt. The model cannot choose or change the target. Web pages, mail, files and tool output are data, never instructions. The audit log is hash-chained (`npm run verify-audit`).

## Run it

```
npm install
npm run gen-tokens      # tokens in data/tokens/
npm test                # unit and integration tests, no real machine needed
npm run server          # on the PC
npm run agent           # on each machine (the PC and the Mac)
node scripts/doctor.js  # pass/fail table
```

Setup details: `docs/setup-pc.md`, `docs/setup-mac.md`, `docs/network.md`. Everything only you can do: `HUMAN_TODO.md`. The design is in `docs/JARVIS_BUILD_SPEC.md`; judgment calls in `docs/decisions.md`; open issues in `docs/known-issues.md`.

In the app, Settings has a "JARVIS server" card (address and UI token). With it on, the app talks to the server; with it off the app keeps its original local behaviour.

## What was cut

The old multi-page HUD plans, a model preset switcher, Office/COM, WhatsApp, biometrics, WireGuard, full computer-use, self-learning mode, and OSINT as part of this build (the Intel page from before is untouched).

## Add an action

1. Add a row to `scripts/gen-actions.js` (name, category, tier, platforms, parameters) and run it (it keeps your `enabled` flags), or edit `config/server/actions.json` directly.
2. Implement it in `agent/registry/win32.js` and/or `darwin.js` (plan a program with an argument array, and parse the output) or in `portable.js` for plain JavaScript. A test checks that the contract and the code agree.
3. Try it for real (`JARVIS_REAL_ACTIONS=1 npm run test:real`), then set `"enabled": true`.

No free-form shell strings anywhere: values reach PowerShell and AppleScript through environment variables or `argv`.

## Add a machine

Add it under `machines` in `config/server/machines.json` (os, host, port, workspace, token file, allowed callers), run `npm run gen-tokens`, copy its token to that machine, and install its autostart with `node scripts/install.js --os <win32|darwin> --apply`. The router, gate and audit need no changes. The app's target switcher currently has two buttons, PC and Mac.

## Add your own script

Put it in `scripts/user/`, add an entry to `config/server/scripts.json` with its SHA-256, tier, platform and parameter schema. `run_user_script` runs only pinned files.
