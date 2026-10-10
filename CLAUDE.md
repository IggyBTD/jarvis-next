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

Tokens live in `src/styles/tokens.css` and nothing else defines a colour, radius, space, type size or font: no hex values anywhere else (the artifact frames and the chart read the tokens at run time). Dark is the home theme: neutrals tinted toward the accent hue (#0A0E14 to #232E3C), arc-reactor blue accent in three steps (`--accent` only for the one active or primary thing, `--accent-mid` for chart lines, bars and icons that matter, `--accent-dim` for idle strokes), warm amber (`--warm`) for the mic while listening, warnings, the peak in a chart and bars at 70 to 90 %, red for errors and bars above 90 %, a muted green only for added diff lines and a service that is up. A light twin follows Windows. Radii are `--r-sm` 8, `--r-md` 12, `--r-lg` 20 (bubbles lg, cards and the input md, buttons and tabs sm). Spacing is 4, 8, 12, 16, 24, 32, 48. Type is 11, 12, 13, 14, 16, 20: IBM Plex Sans for the interface, Source Serif 4 for what the assistant writes, JetBrains Mono for numbers, timestamps, tick labels and code (self-hosted via `@fontsource`). Glow only on things that are on (focused input, a reply being written, a listening mic). Contrast of every token pair is in `docs/contrast.md` (`npm run contrast`). One 40 px title strip runs across both panes, with one divider.

Icons: everything goes through `src/icons/index.js` (`<span class="icon" data-icon="semantic-name">`, `hydrateIcons()`), never inline SVG in HTML. Sets are built by `npm run icons` from `icons/icon-map.json` into `src/icons/sets/`; Ctrl+Shift+I opens the dev switcher (dev only); `npm run icons:finalise` prunes everything but the chosen set (do not run it before the choice is made). Motion on icons is plain CSS in `src/ui/icons.css`; it was written for Iconoir's shapes, so another set may need its selectors adjusted.

Spacing and sizing philosophy: `docs/design-spacing-philosophy.md` (three control heights 28/32/40, one 4 px grid, shared centre lines, a measure for chat, a grid for the dashboard). It is saved as the intended direction and is **not applied yet**; where it conflicts with the current tokens on spacing or sizing, it wins once applied.

Keep the DOM ids the inherited modules look up (`hud-chat-input`, `chat-output`, `center-workspace`, `dock-*`, `cpu-val` and the other telemetry ids, `model-info-*`, `btn-general`, `btn-code`, `btn-visual`, `btn-abliterated`, `cli-*`, `win-*`); renaming one breaks a module silently. Before/after screenshots are in `docs/ui-shots/`.

## Run

`npm install` once, then `npm run tauri dev` (Vite on :5174, so it can run next to JARVIS on :5173). LM Studio on :1234 with CORS, LibreHardwareMonitor on :8085, `cd sidecars/voice && npm install` for voice (the `node_modules` there is a junction to JARVIS's). Rust tests: `cd src-tauri && cargo test --lib`. Logic tests: `node --test tools/tests/*.test.mjs`. Do not run both apps' voice sidecars at once (port 8765).

## Not verified yet

Only checked in a browser pane with a scripted fake LM Studio and a stubbed telemetry event: chat streaming, markdown and code, a chart artifact in a tab, tab close and reopen, model menu, Code page layout, approval and diff cards, light and dark, settings, artifacts page. Not checked in the real Tauri window: real telemetry values, window controls and drag region, the Rust agent (files, commands, approvals), voice, session save and `/resume` from the chat list, LM Studio model swap. After a theme change an open artifact keeps its old colours until it is reopened.
