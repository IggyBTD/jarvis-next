# CLAUDE.md — JARVIS-HUD

Project instructions for Claude Code. This file loads every session — keep it
accurate as the project evolves rather than letting drift build up.

## Current status

Updated 2026-10-04 (session 3: voice). Full detail is in `JARVIS_Progress.md` (read it first); this is the summary.

- **Working:** telemetry (Rust poll of LibreHardwareMonitor, N/A when unavailable), LM Studio chat with four model presets and strict one-model-at-a-time loading, streaming with metrics, markdown/LaTeX/code rendering, sandboxed artifacts, memory vault and habits with slash commands, privacy switches (internet, network link, microphone), attachments, frameless window with custom buttons, header and notch design, node mesh with speech animation and click/drag interaction, design system applied to the whole HUD.
- **Whiteboard:** a full-window mode of the main window (not a second OS window) that is empty by design: only the half-square-edged grid plus the header, notch and the bottom dock (same position as on the HUD). JARVIS places floating panels on it (one per artifact, plus a table type) and arranges them with a `<jarvis-board layout panels>` tag; the user can drag, resize, maximise and close panels. Its only fixed chrome is the dock and the same input field as on the HUD (identical position and style) (user's decisions: no toolbar, no empty-state text). The conversation appears there as a SESSION panel taking at least 65% of the width with code written out, live previews beside it. Leave with Esc or the Library button. Built session 2; web panels (Playwright sidecar) not yet. A temporary Library button in the header also toggles it.
- **System panel:** on-demand whiteboard panel with model health (GPU memory, load, temperature, generation speed, context); open from the right-click menu or a `system` entry in a board tag.
- **Attachments:** text, PDF, docx, pptx, xlsx and images reach the model (`attachments.js`, `file-extract.js`).
- **Tests:** `node --test tools/tests/*.test.mjs` (whiteboard parser and layouts, attachment extraction), `cargo test --lib` (Rust), `tools/ui-checks/` (real Chrome). Playwright is a root devDependency.
- **Voice (session 3):** the microphone switch starts a spoken conversation. Listening is Nemotron 3.5 ASR Streaming 0.6B (int8, 160 ms chunks), speaking is Kokoro 82M v1.0, both through sherpa-onnx in a Node sidecar (`sidecars/voice`, localhost 8765) that the Rust side starts (`src-tauri/src/voice.rs`). Recognised words appear in the message field, a finished sentence is sent, the reply is spoken sentence by sentence while it streams, half duplex (the recognizer hears nothing while JARVIS works or talks). Models live in `models/voice` (git-ignored, about 1 GB). Slash commands `/voice /voices /speak /speed /lang`. Details and the real-window checklist: `JARVIS_Progress.md` ("Voice" in section 2, section 6).
- **Coding agent (session 4):** the model calls tools (`config/actions.json`, `src/core/actions.js`): switch model, open or close the whiteboard, open or close panels, and with a project folder set (`/project`) list, read, search, edit and write files and run commands. Files and shell run in Rust (`src-tauri/src/agent.rs`) inside that folder. Every call goes through `action-runner.js` (validate, `config/permissions.json` + the user's `data/agent/permissions.local.json` + `config/blocked-commands.json`, approval card, hash-chained audit in `audit.js` and `data/agent/audit.jsonl`). Edits show as diff cards with UNDO; risky commands show an approval card. Never add a path to the app that bypasses `action-runner.js`, and keep `agent.rs` the second lock. Built in a cloud container: see Progress section 6 for what to check on the PC. Next: Progress section 9, item 0.
- **Session 5 UI pass:** on the whiteboard the message field sits inside the session panel (it fills the board when nothing else is open), a stop button appears right of the dock while a reply runs, diff cards start collapsed, scrolling up is never overridden by the stream, and Ctrl shortcuts exist (`shortcuts.js`, `/keys`). Details: Progress section 10, session 5.
- **Not built:** auto router, terminal page, skills system, browser automation (the action registry, approval card and audit log now exist for the coding agent), Gmail, anything from phases 3 onward (see roadmap). The ECC design notes (`JARVIS_ECC_Design_Notes.md`) sections 3 to 10 are design only.
- **The earlier rebuild plan** (freeze HUD, isolate telemetry, one fixed model, `core/llm-client.js`, verify independently) is done except that four presets exist instead of one, by the user's decision.

## Project overview

JARVIS is a Tauri desktop app: a hardware telemetry HUD with an Iron-Man-style
interface, expanding into a full local AI assistant (chat, coding agent,
browser automation, financial analysis, and more — see Roadmap below).

- **Project folder:** `C:\Users\bethe\JARVIS` (not `JARVIS-HUD`). Git repository on branch `main` (initialised 2026-10-03; repo-local identity set).
- **Frontend:** Vite + vanilla JS, entry point `index.html`
- **Backend:** Tauri (Rust)
- **Telemetry source:** LibreHardwareMonitor's local HTTP server (polled, not embedded)
- **LLM backend:** LM Studio, OpenAI-compatible local API
- **Models (decided by the user):** four presets in `config/models.json`: general `qwen/qwen3-14b` (default), coding / finance `qwen/qwen3.8-27b` (Q4_K_M), visual `qwen/qwen3-vl-8b`, abliterated `huihui-ai_qwen3-14b-abliterated`. Only one chat model is loaded at a time (unload confirmed before load). The old gpt-oss / Ollama setup is not used.

## Architecture

Structure the project by **stability**, not just by feature — proven telemetry
code and new/experimental agent code must never be able to take each other down.

Actual layout today (the original plan below it is the target; the HUD is one `index.html` plus modules in `src/core/`, there is no `pages/` split yet):

```
JARVIS/
├── index.html                 # all markup and CSS (tokens, HUD, chat, markdown, dock, whiteboard)
├── src/
│   ├── main.js                # node mesh renderer + interaction; imports every module
│   ├── core/                  # llm-client, chat-ui, commands, memory-client, markdown, tool-router,
│   │                          # artifacts, artifact-renderer, whiteboard, whiteboard-mode, wb-grid,
│   │                          # telemetry-view, model-panel, mesh-state, switches, dock-ui, attachments,
│   │                          # window-controls, page-nav (header page buttons),
│   │                          # voice, voice-client, pcm-worklet, speech-text
│   └── pages/{hud,terminal,whiteboard}/   # empty directories from the plan
├── src-tauri/src/             # lib.rs, telemetry.rs, memory.rs, instincts.rs, voice.rs, os_actions/ (placeholder)
├── sidecars/voice/            # speech sidecar: server.mjs, util.mjs, voices.mjs (own package.json, `npm install` in there)
├── models/voice/              # downloaded speech models (git-ignored)
├── config/                    # models.json, system-prompt.md, memory.json, actions.json ([] placeholder)
├── memory/                    # created at runtime by the memory vault (git-ignored by its own .gitignore)
├── skills/                    # empty (JARVIS runtime skills not built)
├── tools/ui-checks/           # Playwright scripts for measuring the UI (see its README)
└── .md Files/                 # CLAUDE.md, Progress, Roadmap, ECC design notes, proof screenshots
```

Original target structure (kept as the plan):

```
JARVIS-HUD/
├── src/
│   ├── pages/
│   │   ├── hud/                # telemetry HUD (stable, don't touch lightly)
│   │   ├── terminal/            # Coder-model chat page
│   │   └── whiteboard/          # visualization/artifact pane
│   ├── core/
│   │   ├── llm-client.js        # LM Studio integration, model switching
│   │   ├── tool-router.js       # decides which surface a response renders to
│   │   └── event-bus.js         # cross-window messaging (Tauri events)
│   └── index.html
├── src-tauri/
│   └── src/
│       ├── telemetry.rs         # LibreHardwareMonitor polling — isolated
│       ├── windows.rs           # multi-window spawn/position/close (generic, built once)
│       ├── os_actions/          # cross-platform action registry — see OS control below
│       │   ├── mod.rs           # trait defining the fixed action list (OS-agnostic)
│       │   ├── windows_os.rs    # Windows implementation of the trait
│       │   └── macos_os.rs      # macOS implementation of the same trait
│       ├── commands.rs          # Tauri commands exposed to frontend
│       └── main.rs
├── skills/                      # plain files, NOT bundled into src — see Skills below
└── config/
    ├── models.json
    └── actions.json              # shared, OS-agnostic action names/descriptions — the model-facing contract that never changes between platforms
```

**Rules that follow from this:**
- Never let `telemetry.rs` or `pages/hud/` depend on anything from the agent/browser/whiteboard code paths. A panic in an experimental feature must not take down the temperature readout.
- `windows.rs` and `tool-router.js` are shared infrastructure — extend them, don't duplicate their logic inside individual features.
- Every external data source (LM Studio, LibreHardwareMonitor, future email/calendar/financial APIs) gets its own client module under `core/`, following the same pattern.
- **Keep Tauri thin; push heavy/dependency-laden features into sidecar processes.** Browser automation (Playwright) needs a real Node.js runtime and can't run inside Rust or a webview — bundle it as a Tauri sidecar executable, not compiled into the Rust binary. Microsoft Office COM automation is the same story with Python (`pywin32`). Each sidecar exposes a small local HTTP API; `core/` gets a client module for it (`core/browser-client.js`, `core/office-client.js`) following the same pattern as `llm-client.js`. This is the stability-isolation principle applied one level further — some features get their own process, not just their own file.

## Skills

`skills/` at the project root is a Claude-Code-style skills folder: each skill
is `skills/<name>/SKILL.md` with YAML frontmatter (`description` at minimum)
and markdown instructions. Keep skills as loose, user-editable files — not
compiled into `src/`, so adding a skill is "drop in a folder," not a rebuild.

## System prompt / conventions

JARVIS's own responses (and Claude Code's work in this repo) should match:
direct, no preamble, no filler, prose-first, no bullet walls, no em dashes,
no sycophancy. Theology/philosophy/apologetics topics get the same analytical
rigour as technical ones — no special softening.

## UI design

Iron Man HUD-style depth layers, 3D Y-axis rotating node-mesh centrepiece,
cyan/teal primary with red used only for structural accents, four-layer
Z-depth system. `JARVIS_UI_Design_Brief.md` and `JARVIS_full_brief.md` are referenced by the
original notes but do not exist in `.md Files/` (ask the user for them or ignore the references).

**What is true today (2026-10-03):**
- Tokens live in `:root` of `index.html` (colours, 8 px spacing scale, type scale 12 to 28 px with a compact 11 to 24 px fallback for small windows, panel and control sizes `--panel-w`, `--core-h`, `--mode-h`, motion
  150 / 200 / 250 ms with ease-out and ease-in-out). Use them; do not add raw colours, odd spacing
  values or ad hoc durations. Details in `JARVIS_Progress.md` section 2.
- The palette is neon cyan on #01080e with red only for errors, the close hover and the "off" ring of
  dock toggles. That outranks generic design skills (Impeccable flags "cyan on dark" and glows; this
  is deliberate). Global rules for any design work are in `~/.claude/CLAUDE.md` ("Design and motion
  rules": skill precedence, motion budget, discipline, process, accessibility).
- Process the user expects: look for a visual reference, build, screenshot and critique, run the
  Impeccable detector (`~/.claude/skills/impeccable/scripts/impeccable detect index.html src`).
- The header is ONE continuous 1 px line from edge to edge with a 220 x 24 px notch (no text) hanging
  from it at the centre; keep the stroke colour and width identical on both so it stays one line.
- Whiteboard panels use the same tokens (built in session 2); they were checked in real Chrome only.

## Browser automation modes

Two distinct browser modes, not one — decide per task which is used, default to neither being engaged automatically:

- **Sandboxed/Cowork-style** — Playwright launches a clean browser context, no logins, no real sessions. Safe default for lookups, testing flows, anything that doesn't need to act as you.
- **Claude-in-Chrome-style** — acts inside your real, already-logged-in sessions. Two implementation paths, decision intentionally left open until it's built:
  - **(a) CDP-attach** — Chrome launched with `--remote-debugging-port`, Playwright connects via `connectOverCDP`, reuses the same tool functions (`navigate`/`click`/`type`/`read_page`) as the sandboxed core. Fastest to build. Detectable by sites running strict anti-bot protection (ticket vendors, banking) and the debug port is a real security exposure if ever reachable beyond localhost.
  - **(b) Personal Chrome extension** — content script + background service worker + local bridge (websocket or native messaging) to JARVIS. Stays private via Developer Mode "load unpacked" — never published to the Web Store, so no review process applies. More build time than CDP (content script logic, manifest permissions, bridge plumbing), but looks like a normal browser to sites that specifically check for automation, and gets real on-page presence (toolbar icon, side panel).
- Both modes need the confirm-before-submit guardrail before any purchase/submit action, and a manual-CAPTCHA-handoff path (pause and let you solve it in the visible window) rather than trying to push past one.

## Apps & OS integration

**Core principle: read broadly, act narrowly.** Being a fully local model means nothing leaves the machine, so broad *read* access (Gmail, files) is low-risk. Every *write/action* capability (Office, OS control, browser purchases) carries the same real-world consequence whether the model is local or not — never relax the action-registry/confirm-before-submit gate just because a feature is "just local."

- **OS control** — never let the model write or run arbitrary shell/PowerShell code. All system control goes through the **action registry**: a fixed set of named functions (`enable_game_mode()`, `set_power_plan()`, etc.) implemented in `os_actions/`. The trait in `mod.rs` is the OS-agnostic contract; `windows_os.rs` and `macos_os.rs` each satisfy it their own way, selected at compile time via `#[cfg(target_os = ...)]`. `config/actions.json` holds the action names/descriptions exposed to the model — this file never changes between platforms, so porting to Mac means writing `macos_os.rs`, not touching the registry or the tool-calling code.
- **Microsoft Office** — COM automation (Rust/Python bridge) driving installed Office apps directly, rather than the sandboxed Office.js add-in route — more powerful since it can read/write live open documents. Destructive actions (save-over, delete, send) go through the same confirm-before-submit gate as browser actions.
- **Gmail** — official Gmail API via OAuth, read-only scope. Correct tool for the job; don't scrape. Foundational for Phase 5 email triage.
- **WhatsApp — explicitly deferred, not currently planned.** No official personal-use API exists. The only routes (automating WhatsApp Web, or an unofficial wrapper library) both risk account bans since WhatsApp's terms prohibit unofficial automated clients — a real-world risk category, not just a technical one. Do not add WhatsApp integration without revisiting this tradeoff first.
- **Audit logging** — log every action JARVIS takes, not just destructive ones (what it read, what it decided, what it changed). Build this alongside the action registry from the start; retrofitting it onto several integrations at once later is much worse than building it once now.

## Modularity hardening (planned, final stage)

**Status: future plan, not part of the current rebuild.** Scheduled for the last stage, alongside Phase 8 hardened infrastructure. Until then the only requirement is boundary discipline (see rules below). Do not build abstraction layers ahead of need.

**Goal:** models, hardware, and OS are each swappable by changing config or adding one adapter, without touching the model-facing tool contract (`config/actions.json`) or the pages.

**The three seams:**
- **Models:** define interfaces by capability (chat, tool-calling, transcribe, synthesize, OCR, vision), not by provider. One adapter per inference backend (LM Studio, Ollama, llama.cpp) behind `core/llm-client.js`, all using the OpenAI-compatible API as the common contract. `config/models.json` becomes the registry: role, provider, model, residency policy.
- **Hardware:** a `config/hardware.json` profile holds the VRAM budget, RAM budget and inference backend (ROCm, Vulkan, CUDA, Metal), which decides which models stay resident and which quantisation to pick. GPU telemetry goes behind a provider interface in `telemetry.rs`, since LibreHardwareMonitor is Windows-only and other platforms need a different source.
- **OS:** extends the existing `os_actions/` trait. Platform-specific areas to cover: app and window control, the shell used by terminal tools (PowerShell, zsh, bash), paths, autostart/service (Windows service, launchd, systemd), audio devices, and macOS accessibility permissions. Supported targets: Windows, macOS, Linux only.

**Rules:**
- Boundary discipline from day one: no LM Studio calls outside `core/llm-client.js`, no OS-specific calls outside `os_actions/`.
- Write a formal interface only when a second real implementation exists (LM Studio plus Ollama, Windows plus macOS). Before that, any interface is a guess.
- Every adapter and platform implementation passes through the same action-registry, confirm-before-submit and audit-logging chokepoint. Modularity must never create a path around the gate.
- Acceptance test: run the same task suite after swapping each seam (backend, hardware profile, OS). The security inspector pass used for Phase 8 covers this stage too.

## Known gotchas

- **Window drag region blocked:** a canvas overlay was intercepting pointer events over the draggable title bar. Fix: `pointer-events: none` on overlay canvases that sit above drag regions.
- **Rust/`main.rs` fixes already applied:** corrected WMI API usage, added missing Tauri commands, removed a call to a non-existent disk method, replaced a `tokio` dependency with `std::thread` + `mpsc` channel, and fixed a `MutexGuard` held across an `.await` point. Don't reintroduce async-across-mutex patterns.
- **Voice sidecar:** `cd sidecars/voice && npm install` once after a fresh clone; models are not in git (download list in `JARVIS_Progress.md`). The app starts the sidecar on first use of the microphone (`voice_start`); in a plain browser run `npm run voice`. Log: `sidecars/voice/voice.log`. Nemotron drops the first word if speech starts the instant audio begins, so `voice-client.js` sends 0.3 s of silence whenever it starts or resumes feeding it; keep that. The sidecar only accepts local origins (`originAllowed` in `sidecars/voice/util.mjs`); a new origin (a packaged build) must be added there.
- **Restart `npm run tauri dev` after `npm install` or Cargo changes**; a webview opened before that shows raw markdown and failed imports. Closing the app window stops the dev server.
- **Vite `?t=` module duplicates:** after edits Vite serves modules with a `?t=` URL, so a console `import()` of a module can be a second instance with separate state. Take the exact URL from `performance.getEntriesByType('resource')`.
- **Scrollbars:** never set `scrollbar-width` or `scrollbar-color` (Chromium then ignores `::-webkit-scrollbar`); one global rule draws every scrollbar as a 1 px rectangular neon line.
- **No browser defaults (user rule):** nothing may appear in the webview's own style. `src/core/native-chrome.js` owns the right-click menu and tooltips (`title` attributes are converted automatically) and blocks browser shortcuts; new UI must not introduce native controls (select, alert, default buttons) without styling them.
- **`white-space: pre-wrap` on a container adds blank lines between rendered block elements.** Only plain text lines use it.
- **Keep `content-visibility: auto` on `.chat-line`**; without it long transcripts make layout changes cost 60 to 100 ms.
- **LM Studio needs CORS enabled** (Developer tab) or the webview's fetch fails.
- **Tauri `invoke` args are camelCase** versions of the Rust parameter names.
- **The browser pane cannot measure animation smoothness and has no Tauri backend**; use `tools/ui-checks/` (real Chrome through Playwright) and stub `window.__TAURI_INTERNALS__` for module tests.
- **Sandboxed artifacts:** `sandbox="allow-scripts"` only, never add `allow-same-origin`; libraries are inlined because a parent-origin `blob:` URL does not load in an opaque-origin iframe; Chart.js animation is off on purpose.
- **n8n + LM Studio (if used for orchestration):** "Use Responses API" must be OFF in the OpenAI Chat Model node — LM Studio serves `/v1/chat/completions`, not the Responses API. Base URL must be `http://host.docker.internal:1234/v1`, not `localhost`, since n8n runs in Docker.
- **n8n + Google:** Calendar integration works natively; Google Drive needs an HTTP Request node workaround since the Drive node lacks native Search/List. Microsoft services are deferred (Azure tenant issues).

## Coding model / Claude Code cost setup

- Default coding model: DeepSeek V4 Pro (SWE-bench 80.6%).
- Fable 5 used as security inspector specifically for Phase 4 (OS control) and Phase 8 (hardened infra) work.
- `free-claude-code` proxy (by Alishahryar1) routes Claude Code CLI through OpenRouter for cost savings. Confirmed working free slug: `open_router/google/gemini-2.5-flash-lite`.

## Roadmap

Full difficulty-ordered feature list with build order lives in
`JARVIS_Full_Roadmap.md` — treat it as the source of truth for sequencing.
Summary of the original 8 phases (difficulty out of 10):

1. Fix telemetry (3)
2. LM Studio integration (4) — model switcher deferred; running a single consolidated model for now
3. Voice chat, STT/TTS (5)
4. OS control / agent actions (6)
5. Email triage + calendar (7)
6. Financial analysis engine (7)
7. Biometrics / BLE smartband (8)
8. Hardened infrastructure — WireGuard, Docker sandboxing, OSINT (9), followed by modularity hardening as the final stage (see Modularity hardening above)

Layered on top of these (see `JARVIS_Full_Roadmap.md` for full detail and
exact ordering): a Claude-Code-style skills system and terminal page for the
Coder model, a Cowork-style sandboxed/planning-first mode with parallel
sub-tasks, headless-first browser automation (Playwright/Puppeteer, vision
fallback only for canvas/CAPTCHA) plus a separate Claude-in-Chrome-style mode
for acting in real logged-in sessions (see Browser automation modes above), a
whiteboard/visualization pane shared across features, "alive" multi-surface
behavior (autonomous window management, reactive HUD states, spatial memory
for window placement), and the apps/OS integration layer above (action
registry, Microsoft Office, Gmail, audit logging — WhatsApp deferred).

## What Claude Code should do here

- Read the root `CLAUDE.md`, this file, `JARVIS_Progress.md` (start with its section 1 and section 5 "Open items") and the status block of `JARVIS_Full_Roadmap.md` before starting work on any phase.
- At the end of every session, update `JARVIS_Progress.md` (current state, open items, unverified list, next steps, changelog line) and the status blocks here and in the roadmap, so a fresh session needs nothing from chat history. Write down the non-obvious decisions and why.
- Report honestly what was verified and where: the user sees the real Tauri window; the assistant usually only sees the browser pane or headless Chrome. Say what was not tested in the real window.
- Style rules for everything written here and in the app: direct, no preamble, no em dashes, no emoji, no sycophancy. Use subagents only when the user asks; give them disjoint file ownership (worktrees are possible now that a git repo exists, but disjoint ownership is still the rule) and verify their work yourself.
- Do not touch Rust dependencies for design work; the project is Tauri (see "Rust UI stack").
- Git exists. Commit before large refactors; commit only when the user asks.
- Keep new features inside their designated folder (`pages/`, `core/`, `skills/`) rather than growing `main.rs` or `index.html` into a monolith.
- Flag before touching `telemetry.rs` (stable, has a unit test); the JS side of telemetry now lives in `src/core/telemetry-view.js`.
- When a change affects the folder structure or a documented gotcha, update this file in the same session rather than letting it drift out of date.
- Keep backend-specific and OS-specific code behind its designated module (`core/llm-client.js`, `os_actions/`), but do not build generic adapter layers before the modularity hardening stage unless a second real implementation is being added.
## Rust UI stack

- **Framework:** Tauri 2 (Rust backend, `src-tauri/`) with a Vite + vanilla JS web frontend (`index.html`, `src/`). Nothing was scaffolded or added to `Cargo.toml` for design work. All web design skills apply fully, because the UI is HTML, CSS and canvas in a webview.
- **Animation:** no animation crate or JS library. Use CSS transitions and keyframes, the Web Animations API, and canvas (the node mesh, `src/main.js`). Add a library only if CSS or WAAPI cannot express the effect. Motion budget and springs rule: see the global "Design and motion rules" in `~/.claude/CLAUDE.md`. Gesture physics already in use: the critically damped springs in `src/main.js` (sphere spin and tilt), which fits "springs only for gestures and direct manipulation".
- **Project design rules win over generic skills.** JARVIS is a neon HUD: cyan (#00d9ff, #79e0f2, #55b3cc) on #01080e, with red only for structural accents. That is deliberately not Apple-HIG-looking and not the "one accent colour" default; the HUD palette decides, and the skills are used for hierarchy, spacing, accessibility and motion craft, not to restyle it.
- **Screenshots:**
  - The web UI over HTTP: start `npm run tauri dev` (Vite serves http://localhost:5173), then use the Playwright MCP server (`browser_navigate`, `browser_take_screenshot`; user-scope server `playwright`, isolated Chrome) or the Claude desktop Browser pane. Set the viewport to 1600x900 first; the HUD is laid out for large screens.
  - In a plain browser there is no Tauri backend: `window.__TAURI_INTERNALS__` is missing, so telemetry, memory and window buttons do nothing. Stub `__TAURI_INTERNALS__.invoke` in the page when a flow needs them.
  - The real Tauri window (WebView2, frameless: `decorations: false`) cannot be captured by Playwright. Treat browser screenshots as close but not identical, and check window chrome, drag region and resize edges by hand.
  - Reduced motion: `prefers-reduced-motion` can be emulated in Playwright to check the cross-fade paths.
