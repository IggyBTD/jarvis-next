# JARVIS Next

A copy of JARVIS (`C:\Users\bethe\JARVIS`) with a new front end: a clean chat-app layout (Claude / ChatGPT style) instead of the HUD. Created 2026-10-10. Same backend as JARVIS: Tauri/Rust (`src-tauri`), LM Studio client, telemetry, memory vault, agent actions with approvals and audit log, voice sidecar. The old project is untouched.

## What is new, what is inherited

- **New:** `index.html`, `src/ui/app.css` (tokens and all styling), `src/main.js`, `src/core/shell.js` (sidebar, page switching, chat list, live readout, settings, artifacts page), `src/core/whiteboard.js` (rewritten: workspace tabs), `src/core/whiteboard-mode.js` (rewritten: page router), `src/core/icons.js` (SVG line icons).
- **Inherited and edited lightly:** `chat-ui.js`, `cli-page.js`, `dock-ui.js`, `telemetry-view.js`, `model-panel.js`, `native-chrome.js`, `artifact-renderer.js` (theme-aware), UI strings made sentence case.
- **Inherited unchanged:** `llm-client`, `actions`, `action-runner`, `permissions`, `audit`, `memory-client`, `commands`, `voice*`, `markdown`, `attachments`, `sessions`, Rust, `config/`, `sidecars/voice`. `models/` is a junction to JARVIS's `models/` (about 1 GB, not copied).
- **Removed:** HUD panels, node mesh, wave transition, grid, floating-panel engine (`board-layouts.js`), `system-panel.js`, and the UI checks that measured them.
- The `.md Files/` folder is JARVIS's documentation and still describes the HUD; treat it as history for the backend parts (Progress sections 2 to 9) and ignore its design sections.

## Layout

Sidebar: Chat / Code (the two prominent buttons), New chat, Artifacts, System, recent chats, live CPU / GPU / RAM readout, service dots, Settings. Chat page: conversation left, workspace right. The workspace holds tabs (each artifact, and System = telemetry); every tab, System included, closes with its x; the System item in the sidebar reopens it. Code page: files and context left, the same conversation in the centre, tasks and changes right (hidden under 1280 px width); artifacts open as floating panels there. The one conversation DOM (`#chat-stack`) moves between the chat page and the code page (`shell.js`, `placeChat`).

## Design rules (this project)

Warm greys (after Claude's palette) and one teal: canvas `#faf9f5` / `#262624`, accent `#0b7f73` light and `#3fc1b0` dark. Teal is the app's voice (primary action, focus, the current item, attention and the 75 % bar threshold). Small teal text uses `--accent-text` (`#096b61` light, `#5fd6c6` dark) so it reaches 4.5:1; `--accent` stays for fills, focus rings and icons. Every text colour must reach 4.5:1 on canvas, sidebar, card, hover and active (UI audit 2026-11-19). Under 1024 px the sidebar starts hidden and opens as a sheet over the content. Red is error and the 90 % threshold; a muted green appears only on added diff lines and a service that is up. Nothing else is coloured: no per-section hues, bars and sparklines are grey. Segoe UI Variable text, Cascadia Code for code and numbers, no web fonts. Scale 12, 13, 14, 15, 18, 24 px, 8 px grid, motion 150 to 200 ms. Light and dark follow Windows; Settings can force one. No glow, no gradients, no uppercase labels. Keep the DOM ids the inherited modules look up (`hud-chat-input`, `chat-output`, `center-workspace`, `dock-*`, `cpu-val` and the other telemetry ids, `model-info-*`, `btn-general`, `btn-code`, `btn-visual`, `btn-abliterated`, `cli-*`, `win-*`); renaming one breaks a module silently.

## Run

`npm install` once, then `npm run tauri dev` (Vite on :5174, so it can run next to JARVIS on :5173). LM Studio on :1234 with CORS, LibreHardwareMonitor on :8085, `cd sidecars/voice && npm install` for voice (the `node_modules` there is a junction to JARVIS's). Rust tests: `cd src-tauri && cargo test --lib`. Logic tests: `node --test tools/tests/*.test.mjs`. Do not run both apps' voice sidecars at once (port 8765).

## Added 2026-11-19 (branch claude/happy-davinci-9bjdd4)

- Prompt cache: the system message is now identical every turn; per-turn context (recalled memory, habits, tasks, plan mode, voice mode, `/think` or `/no_think`) rides on the newest user message (`context-manager.js` `withReminder`). Tools are offered only when usable (file tools need `/project`, `submit_plan` needs plan mode, web tools need the internet switch).
- Think: off by default; the bulb in the composer or `/think` turns it on. Reasoning past `think_budget` (models.json) is cut and answered from the notes with thinking off. models.json also holds `sampling` (Qwen3's recommended values) and `load.context_length`.
- Replies: Copy, a t/s readout, Retry on the newest. Sidebar: chat search (Rust `session_search`), Rename, Delete.
- Effect classes on every action (`effect` in actions.json, audited); publish and money always ask. Shift+Tab in the composer cycles normal, careful (asks before every change), plan.
- Routines (`config/routines.json`, `os_actions/mod.rs`): an exact phrase ("lock screen", "game mode") runs without the model; the model's `run_routine` asks first. Windows only.
- Web (`web.rs`, `config/web.json`): `web_search` (DuckDuckGo HTML or SearXNG) and `web_fetch`. Rust refuses until the window reports the internet switch on, and never fetches local or private addresses. Addresses not from a search result or your message ask first.

## Not verified yet

New on 2026-11-19, checked only in a browser with a fake LM Studio and stubbed Tauri calls (Rust unit tests pass on Linux): whether LM Studio actually reuses its prompt cache now (compare time to first token on turn 1 and turn 8); whether your Qwen build honours `/no_think` and `chat_template_kwargs`; the `load` and `sampling` fields against your LM Studio version; the routine steps on Windows (lock, powercfg, explorer, taskkill); DuckDuckGo's live page (this container's network blocked it, so the parser is tested against a hand-written sample only).

Older:

Only checked in a browser pane with a scripted fake LM Studio and a stubbed telemetry event: chat streaming, markdown and code, a chart artifact in a tab, tab close and reopen, model menu, Code page layout, approval and diff cards, light and dark, settings, artifacts page. Not checked in the real Tauri window: real telemetry values, window controls and drag region, the Rust agent (files, commands, approvals), voice, session save and `/resume` from the chat list, LM Studio model swap. After a theme change an open artifact keeps its old colours until it is reopened.
