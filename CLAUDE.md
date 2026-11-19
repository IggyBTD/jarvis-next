# JARVIS Next

A copy of JARVIS (`C:\Users\bethe\JARVIS`) with a new front end: a clean chat-app layout (Claude / ChatGPT style) instead of the HUD. Created 2026-10-10. Same backend as JARVIS: Tauri/Rust (`src-tauri`), LM Studio client, telemetry, memory vault, agent actions with approvals and audit log, voice sidecar. The old project is untouched.

## What is new, what is inherited

- **New:** `index.html`, `src/ui/app.css` (tokens and all styling), `src/main.js`, `src/core/shell.js` (sidebar, page switching, chat list, live readout, settings, artifacts page), `src/core/whiteboard.js` (rewritten: workspace tabs), `src/core/whiteboard-mode.js` (rewritten: page router), `src/core/icons.js` (SVG line icons).
- **Inherited and edited lightly:** `chat-ui.js`, `cli-page.js`, `dock-ui.js`, `telemetry-view.js`, `model-panel.js`, `native-chrome.js`, `artifact-renderer.js` (theme-aware), UI strings made sentence case.
- **Inherited unchanged:** `llm-client`, `actions`, `action-runner`, `permissions`, `audit`, `memory-client`, `commands`, `voice*`, `markdown`, `attachments`, `sessions`, Rust, `config/`, `sidecars/voice`. `models/` is a junction to JARVIS's `models/` (about 1 GB, not copied).
- **Removed:** HUD panels, wave transition, grid, floating-panel engine (`board-layouts.js`), `system-panel.js`, and the UI checks that measured them.
- **Node mesh (back):** `src/core/node-mesh.js` + `mesh-geometry.js` are the old HUD mesh copied from the `ui-extras` branch (48 nodes on a Fibonacci sphere, drift, shockwave on click, drag spin), restyled flat: teal nodes, grey links, no glow or gradient. A big orb sits on the empty chat and a small one in the chat header once a chat has started. Both move with the reply through `mesh-state.js` (swell while streaming or speaking, breathing while thinking) plus a nudge per streamed letter (`chat-ui.js`). The header orb rests when idle and wakes on the next reply (`setWakeListener`). Reduced motion: no spin, swell or drift; a drag still turns it. The other session's `claude/nodes-redesign` branch has a different, ball-and-stick core (`src/nodes/core.js`); it was not merged here.
- The `.md Files/` folder is JARVIS's documentation and still describes the HUD; treat it as history for the backend parts (Progress sections 2 to 9) and ignore its design sections.

## Layout

Sidebar: Chat / Code (the two prominent buttons), New chat, Artifacts, System, recent chats, live CPU / GPU / RAM readout, service dots, Settings. Chat page: conversation left, workspace right. The workspace holds tabs (each artifact, and System = telemetry); every tab, System included, closes with its x; the System item in the sidebar reopens it. Code page: files and context left, the same conversation in the centre, tasks and changes right (hidden under 1280 px width); artifacts open as floating panels there. The one conversation DOM (`#chat-stack`) moves between the chat page and the code page (`shell.js`, `placeChat`).

## Design rules (this project)

Warm greys (after Claude's palette) and one teal: canvas `#faf9f5` / `#262624`, accent `#0b7f73` light and `#3fc1b0` dark. Teal is the app's voice (primary action, focus, the current item, attention and the 75 % bar threshold). Red is error and the 90 % threshold; a muted green appears only on added diff lines and a service that is up. Nothing else is coloured: no per-section hues, bars and sparklines are grey. Segoe UI Variable text, Cascadia Code for code and numbers, no web fonts. Scale 12, 13, 14, 15, 18, 24 px, 8 px grid, motion 150 to 200 ms. Light and dark follow Windows; Settings can force one. No glow, no gradients, no uppercase labels. Keep the DOM ids the inherited modules look up (`hud-chat-input`, `chat-output`, `center-workspace`, `dock-*`, `cpu-val` and the other telemetry ids, `model-info-*`, `btn-general`, `btn-code`, `btn-visual`, `btn-abliterated`, `cli-*`, `win-*`); renaming one breaks a module silently.

## UI skills

37 project skills for the UI redesign live in `.claude/skills/` (design direction, anti-slop, motion, accessibility, AI-chat UX) with 3 sub-agents in `.claude/agents/`. Sources, pinned commits, licences, what was left out and the redesign workflow are in `UI_REDESIGN_SKILLS.md` (section 10 is the manifest).

- Redesign order: `/impeccable init`, `document`, `shape`, then per surface `critique`, `audit`, `polish`. Review gates: `web-design-guidelines`, `fixing-accessibility`, `review-animations`, `break-ui`. For approvals and the model menu see `ai-governors`, `ai-tuners`, `ai-trust-builders`.
- Impeccable is the only direction skill. `frontend-design`, `frontend-design-anchors`, `no-slop` and `reality-skill` are manual-only references: do not run two direction skills on one task.
- Project rules beat any skill: sentence case (ignore Vercel's Title Case rule), no web fonts, no glow or gradients, the palette above.
- Hooks are not enabled. Impeccable's design hook runs a binary at session start and on every edit; it was left out on purpose. Read `.claude/skills/impeccable/reference/hooks.md` before enabling it.
- The first Impeccable run downloads a checksum-verified engine binary from GitHub releases (needs github.com access). Not tested yet.
- Skill text is third-party instructions. Read a skill before adding it; do not install more from roundups unread.

## Run

`npm install` once, then `npm run tauri dev` (Vite on :5174, so it can run next to JARVIS on :5173). LM Studio on :1234 with CORS, LibreHardwareMonitor on :8085, `cd sidecars/voice && npm install` for voice (the `node_modules` there is a junction to JARVIS's). Rust tests: `cd src-tauri && cargo test --lib`. Logic tests: `node --test tools/tests/*.test.mjs`. Do not run both apps' voice sidecars at once (port 8765).

## Not verified yet

Only checked in a browser pane with a scripted fake LM Studio and a stubbed telemetry event: chat streaming, markdown and code, a chart artifact in a tab, tab close and reopen, model menu, Code page layout, approval and diff cards, light and dark, settings, artifacts page. Not checked in the real Tauri window: real telemetry values, window controls and drag region, the Rust agent (files, commands, approvals), voice, session save and `/resume` from the chat list, LM Studio model swap. After a theme change an open artifact keeps its old colours until it is reopened.
