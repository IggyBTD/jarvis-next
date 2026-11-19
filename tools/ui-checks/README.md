# UI checks (real Chrome through Playwright)

Throwaway scripts used to measure and check the UI. The Claude desktop Browser pane cannot time
animation frames reliably (it throttles them), so use these for anything about smoothness.

Setup (once): `npm i -D playwright` in the project root (already a devDependency) (no browser download: the scripts use the
installed Chrome via `channel: 'chrome'`). `node_modules` is git-ignored. The app must be running
(`npm run tauri dev` from the project root, so Vite serves http://localhost:5173).

| Script | What it does |
|---|---|
| `profile-whiteboard-switch.cjs [label] [dpr] [cpuThrottle] [w] [h]` | Frame times and long tasks for entering and leaving whiteboard mode with a 48-message transcript. Example: `node profile-whiteboard-switch.cjs run 1 4 2560 1440` (4x CPU slowdown). Reference result after the compositor rebuild: sync cost about 1 ms unthrottled, no long tasks, frames about 4 ms. |
| `shots-whiteboard-switch.cjs` | Pauses the transition at 400 / 950 / 1500 ms (WAAPI `currentTime`) and saves PNGs next to the script. |
| `edge-cases-whiteboard-switch.cjs` | Enter/exit/enter in quick succession, reduced motion, Esc. Expects no leftover `#wb-transition` overlay. |
| `grid-layout.cjs` | Checks the whiteboard grid: counts, cell sizes and the half-square margins on all four edges at several window sizes. |
| `whiteboard-panels.cjs` | Panel engine: empty state, layouts, drag, resize, maximise, keyboard, close, leave and re-enter. |
| `attach-flow.cjs "question" file...` | Attaches files through the real input, sends the question to the real model and prints what was sent and the answer. Fixtures in `tools/tests/fixtures/`. |
| `coding-flow.cjs ["prompt"]` | Coding scenario with the real 27B model: whiteboard input, session share, live preview panel, raw stream. 2 to 3 minutes. |
| `hud-shot.cjs <name> [w] [h]` | HUD screenshot with stand-in telemetry numbers (stubs the Tauri event bridge); reports wrapped titles, clipped text and font sizes. |
| `native-chrome.cjs` | No browser defaults: tooltips, right-click menu (page, input, artifact frames), shortcut blocking, CSP errors. |
| `boot-sequence.cjs` | Dock and input boot around the wave switch: hidden during the wipe, staggered pop-up, input opening, reduced motion. |
| `input-grow.cjs` | Message field growth on the HUD and the whiteboard: widening, wrapping, line cap, Shift+Enter, shrinking after send. |
| `system-panel.cjs` | System (model health) panel: menu entry, rows, N/A after sensor silence, stacking with session and artifacts, drag/close/tag/re-enter. |
| `voice-continue.cjs` | Carrying on after a pause that only sounded like the end of a sentence: the first part is sent, taken back when the speaker continues, and one merged message is sent; one user line and one reply in the transcript. Needs a private sidecar and dev server, see the header of the script (`JARVIS_VOICE_PORT`, `APP_URL`). 5 checks. |
| `voice-wait.cjs` | Waiting feedback: a stub LM server makes the app swap models and reason for 5 s; checks the spoken loading line, the spoken thinking line, the repeating note starting and stopping, listening again at the end. Needs a private sidecar and dev server (see the script header). 7 checks. |
| `command-palette.cjs` | The `/` menu: opens on `/`, narrows while typing, Up/Down/Tab/Enter/Esc, click, usage hint, no menu for plain text, `/clear` and `/help`, every menu entry has a handler. Needs the dev server. 23 checks. |
| `session-input.cjs` | Message field inside the session panel, scrolling up while a turn runs, collapsed diff cards, stop button, Ctrl shortcuts. Needs the mock LM Studio and the dev server. 15 checks. |
| `wb-live-mesh.cjs` | Opening the whiteboard: the sphere in the old view keeps changing while the wave crosses, the mesh stops rendering once the whiteboard covers the screen and restarts on leaving; frame gaps during the wave at 1x and 4x CPU. 6 checks. |
| `cli-page.cjs` | CLI page: panels in a row, splitters (mouse and keyboard), column toggles, chat moves between pages, changes list, clickable diff panel (follows edits, drag, keyboard, close), floating approval panel (approve and deny). |
| `service-stack.cjs` | Notch service marks: count, position inside the notch, error without Tauri, state change, tooltip. |
| `voice-keys.cjs` / `voice-silent.cjs` | Talk keys end to end with a fake microphone and the real speech sidecar: hold F8, F9 toggle, waveform, silent microphone warning, key press during speech (needs the dev server and the sidecar). |
| `idle-cost.cjs` | Main-thread cost per second on each page at rest (PROFILE=1 lists the functions on the HUD). |
| `startup-cost.cjs` | Time until the page is ready, requests and bytes (median of 5 cold loads). |
| `stream-cost.cjs` / `stream-jank.cjs` | Cost of redrawing a growing reply, and stalled frames over a simulated 10 s stream. |
| `switch-cost.cjs` / `switch-jank.cjs` | Page switch: time in the click, and the worst frame in the next 700 ms (N=2000 messages by default). |
| `first-token.cjs` | Enter to first reply words with a stand-in LM Studio that answers its model list in 200 ms. |
| `sidecar-start.mjs` | Speech sidecar: time until the recognizer and the synthesizer are ready. |
| `page-nav.cjs` | Clicks each header page button and checks state, view, Esc and notch overlap (21 checks). |
| `ui-audit/audit.cjs` | Full UI audit: 15 screens (chat empty and busy, model menu, palette, System tab, agent cards and approval, Code, Artifacts, Settings, composer states, chat search, hidden sidebar or sheet, context menu, tooltip) in light and dark at 1600, 1200 and 900 px, with a Tauri stub (`stub.js`) and a scripted LM Studio (`mock.mjs`). Reports contrast, small text, small targets, clipping and overflow; saves screenshots. Result on 2026-11-19 after the fixes: no findings. |

Notes: the pages have no Tauri backend in plain Chrome (`window.__TAURI_INTERNALS__` is missing), so
the "Cannot read properties of undefined (reading 'transformCallback')" page error is expected.
Whiteboard-mode module URLs carry a Vite `?t=` suffix after edits; the scripts read the exact URL
from `performance.getEntriesByType('resource')` so they talk to the instance the app uses.

## Model comparison

`tools/model-compare/compare.cjs <out.json> <modelKey>...` runs the same five tasks on local LM Studio models (two Python functions with hidden tests, a to-do app driven in headless Chrome, a shell command, a concept explanation with a keyword rubric) and records time, tokens and tokens per second. Env: `TASKS=...`, `CTX=32768` (both models are loaded at that context; LM Studio's default cuts long thinking off), `RESTORE=<key>`. A background command is stopped after 10 minutes, so run the long Python tasks as separate commands; results merge into the output file after each task. Model-written shell commands are never executed.

## Agent actions

`agent-flow.cjs` runs the coding agent in headless Chrome: start `node tools/ui-checks/mock-lm-studio.mjs` (a scripted fake LM Studio on :1234, stop the real one first) and `npm run dev`, then `node tools/ui-checks/agent-flow.cjs`. A stand-in for the Tauri commands keeps files in memory, so this checks the cards, approval, undo, `/stop` and the round limit, not the Rust code (that is `cargo test --lib`). The `currentWindow` and `plugin:event` page errors come from the stand-in. Screenshots land next to the script; delete them.
