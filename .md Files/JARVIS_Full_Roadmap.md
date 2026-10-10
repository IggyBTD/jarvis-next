# JARVIS — Full Feature Roadmap (Difficulty-Ordered)

Every feature from your original 8-phase plan, plus everything we've since scoped
(Claude Code deep-dive, DIY skills system, Cowork-style mode, browser automation,
whiteboard/visualization, "alive" multi-surface presence). Ordered easiest → hardest.
Each item is tagged with where it came from so nothing gets lost.

**Status as of 2026-10-04 (session 3: voice)** (details in `JARVIS_Progress.md`; the user decided to keep four model presets instead of one, and the whiteboard is a full-window mode, not a second OS window):

| Build-order step | Status |
|---|---|
| 1 Fix telemetry | Done (Rust poll + `telemetry-view.js`; shows N/A when the sensor source is missing) |
| 2 Project memory file | Done: `.md Files/CLAUDE.md` plus the runtime memory vault and habits (`memory.rs`, `instincts.rs`, slash commands) |
| 3 Confirm-before-submit guardrail | Not started (design in `JARVIS_ECC_Design_Notes.md` sections 4 and 5) |
| 4 Planning-first execution pattern | Not started |
| 5 Bundle offline charting libraries | Done: `chart.js` and `mermaid` bundled and inlined into sandboxed artifacts |
| 6 File/deliverable skill category | Not started |
| 7 LM Studio integration | Done, with four presets and strict unload-then-load swapping |
| 8 Skills system core | Not started (`skills/` empty; design in the ECC notes section 3) |
| 9 Coder-model terminal page | Not started |
| 10 Tool/function-calling wiring | Not started |
| 11 Sidecar architecture decision | First sidecar built: voice (`sidecars/voice`, Node + sherpa-onnx, started by `voice.rs`); the Playwright and Office sidecars are not |
| 12 Browser window placement | Not started |
| 14 Artifact-detection marker convention | Done (`<jarvis-artifact>`, `tool-router.js`) |
| 15 Route other phases' output to the whiteboard | Panel engine done (floating panels, model-chosen layouts, table type); other phases do not feed it yet |
| 17 Audit logging | Not started (design in the ECC notes section 6) |
| 18 Voice (STT/TTS) | Built in session 3: Nemotron 3.5 ASR Streaming 0.6B (listening) and Kokoro 82M (speaking) through sherpa-onnx in a sidecar; mic switch = voice conversation, replies spoken, mesh follows the audio level. Checked in real Chrome with a fake microphone; NOT yet in the Tauri window (see Progress section 6) |
| 19 Auto-memory equivalent | Done in a user-controlled form (habits via `/habit`, no background observer) |
| 27 Second webview pane | Done as a whiteboard mode of the main window, now a panel workspace |
| 28 Iterative artifact updates | Done (same artifact id = new version) |
| 29 Reactive HUD states | Partly done: the mesh reacts to speech, thinking and clicks; telemetry shows unavailable states |
| 30 Spatial memory for windows | Not started |
| Everything else (21 to 26, 31 to 42) | Not started |

Session 4: the coding agent and the first real action registry are built (tool calling, self-control actions, file and shell tools in Rust scoped to a project folder, permission rules with a blocklist, approval card, diff cards with undo, hash-chained audit log); they were tested in a cloud container and still need the real-machine check in Progress section 6. This covers the Coder-model terminal page (9) in a different form (cards in the whiteboard session, no terminal) and the first part of 17/31; OS-control actions (game mode etc.) and Office/Gmail are not started. Next on the list, in the recommended order: whiteboard coding scenario and web panels, then the action registry with confirm gate and audit log (steps 3, 17, 31), then the skills system (8). Voice (18) is built, pending the real-window check.

---

## Difficulty 3

| Feature | Source |
|---|---|
| **Fix telemetry** — original Phase 1 | Original roadmap |
| **Project memory file** — persistent JARVIS conventions/architecture notes that always load into context (CLAUDE.md-equivalent) | Claude Code session |
| **Confirm-before-submit guardrail** — hard block requiring explicit approval before any browser action that purchases, submits, or pays | Browser automation |
| **Planning-first execution pattern** — model outputs a step list before acting on multi-step tasks, you approve before it runs (Cowork-style) | Cowork session |
| **Bundle offline charting libraries** — vendor Chart.js/D3 locally so the whiteboard works without internet | Whiteboard session |
| **File/deliverable-focused skill category** — write skills whose output is a document/report rather than a command | Cowork session |

## Difficulty 4

| Feature | Source |
|---|---|
| **LM Studio integration** — original Phase 2 (model switcher deferred; consolidating to a single model for the rebuild) | Original roadmap |
| **Skills system core** — folder of `SKILL.md`-style files, frontmatter parsing, description-based routing, content injection into context | Claude Code / DIY clone session |
| **Coder-model terminal page** — separate UI page from the HUD, styled like a terminal, backed by your Coder model | DIY clone session |
| **Tool/function-calling wiring for Coder model** — confirm your local model supports tool calls in LM Studio, build the interface | DIY clone session |
| **Sidecar process architecture decision** — keep the Tauri/Rust app thin (windows, telemetry, OS action registry); push heavy or dependency-laden features into separate local sidecar processes it spawns and talks to over localhost, rather than compiling them into the Rust binary. See "App structure" note below | Architecture session |
| **Headed browser mode** — visible window + `slow_mo` delay so you can watch actions happen | Browser automation |
| **Browser window placement decision** — standalone OS window (recommended) vs. embedding inside Tauri's webview | Browser automation |
| **Reuse vs. separate data-analysis sandbox** — decide if financial analysis shares the Coder execution loop or gets its own environment | Financial analysis session |
| **Artifact-detection marker convention** — the tag/format JARVIS uses to signal "this is visual output, route to whiteboard, not chat text" | Whiteboard session |
| **Route other phases' output to the whiteboard** — financial analysis, email/calendar data, etc. feed the same pane instead of each building their own display | Whiteboard session |
| **Gmail API integration** — official OAuth-based Gmail API, read-only scope, rather than scraping; foundational for Phase 5 email triage | Apps/OS-control session |
| **Audit logging for every action** — log what JARVIS read, decided, and changed (not just destructive actions); build this alongside the action registry, not retrofitted later | Apps/OS-control session |

## Difficulty 5

| Feature | Source |
|---|---|
| **Voice chat, STT/TTS** — original Phase 3 | Original roadmap |
| **Auto-memory equivalent** — JARVIS automatically saves learnings/patterns across sessions, separate from the main conventions file | Claude Code session |
| **External-tool connection layer (MCP-equivalent)** — standardized way to connect JARVIS to calendar, email, and financial data sources | Claude Code session |
| **Headless browser automation core** — Playwright/Puppeteer with DOM-based tools: `navigate`, `click`, `type`, `read_page` | Browser automation |
| **Persistent vs. fresh browser session management** — decide whether logins persist across runs or each task starts clean | Browser automation |
| **Claude-in-Chrome-style mode (diff. 5–7, path-dependent)** — JARVIS acts inside your real, already-logged-in browser sessions rather than a clean/sandboxed one. Two implementation paths, decision left open: **(a) CDP-attach** (diff. 5) — Playwright connects to your already-running Chrome via its remote-debugging port, reusing the same tool functions as the headless core; fastest to build, but detectable on sites running strict anti-bot protection (ticket vendors, banking), and the debug port is a real security exposure if ever reachable beyond localhost. **(b) Personal Chrome extension** (diff. 6–7) — content script + background worker + local bridge (websocket or native messaging) to JARVIS; stays private via Developer Mode "load unpacked," never published, so no Web Store review needed; several days more build time than CDP, but looks like a normal browser to sites that specifically check for automation, and gets real on-page presence. Should be off by default, toggled per task, not automatically engaged. | Claude-in-Chrome session |
| **Code-execution-based data analysis loop** — model writes and runs actual code against data, checks its own output, iterates | Financial analysis session |
| **Sandboxed scratch workspace** — Cowork-style staging directory separate from your real files, publish-on-approval | Cowork session |
| **Second Tauri webview pane (static)** — the whiteboard pane itself, before it's interactive | Whiteboard session |
| **Iterative artifact updates** — keep the current visualization's source in state so "make the bars blue" edits it instead of regenerating | Whiteboard session |
| **Reactive HUD states** — idle/thinking/active visual pulses on the node-mesh centerpiece | Alive-presence session |
| **Spatial memory for windows** — JARVIS remembers where you like panels placed and reopens them there across sessions | Alive-presence session |

## Difficulty 6

| Feature | Source |
|---|---|
| **OS control / agent actions** — original Phase 4. Architecture decided: a fixed **action registry** (named functions like `enable_game_mode()`, `set_power_plan()`) that the model calls by name — never arbitrary shell/PowerShell code it writes itself. Action names + descriptions live in one shared, OS-agnostic config (`config/actions.json`); each platform satisfies the same interface via its own implementation file (`os_actions/windows_os.rs`, `os_actions/macos_os.rs`), so porting to Mac later means writing one new file, not touching the model-facing registry | Original roadmap |
| **Microsoft Office integration** — COM automation (via a Rust/Python bridge) driving Office apps directly; full read/write on live documents, more powerful than the sandboxed Office.js add-in route, but destructive actions (save-over, delete, send) go through the same confirm-before-submit gate as everything else | Apps/OS-control session |
| **Parallel sub-task dispatch** — multiple concurrent model calls (e.g. researching several things at once) synthesized into one result | Cowork session |
| **Autonomous panel lifecycle tool calls** — JARVIS opens, positions, and closes windows on its own initiative via `open_panel`/`close_panel` | Alive-presence session |
| **Multi-surface routing logic** — system-prompt-level decision of chat text vs. panel vs. status indicator, per task | Alive-presence session |

## Difficulty 7

| Feature | Source |
|---|---|
| **Email triage + calendar** — original Phase 5 | Original roadmap |
| **Financial analysis engine** — original Phase 6 | Original roadmap |
| **Vision fallback for browser automation** — screenshot + click-coordinates for canvas elements or CAPTCHAs the DOM approach can't reach | Browser automation |

## Difficulty 8

| Feature | Source |
|---|---|
| **Biometrics / BLE smartband** — original Phase 7 | Original roadmap |
| **Full computer-use fallback** — screenshot-driven OS control for native apps or legacy tools with no DOM/API to hook into | Computer-use session |

## Difficulty 9

| Feature | Source |
|---|---|
| **Hardened infrastructure** — WireGuard, Docker sandboxing, OSINT — original Phase 8 | Original roadmap |
| **Modularity hardening (final stage, planned)** — make models, hardware, and OS each swappable through config or a single adapter, without touching the model-facing tool contract or the pages. Grouped with hardened infrastructure because it is last-stage work. See "Modularity hardening" section below | Modularity session |

---

## App structure: what stays in Tauri vs. what becomes a sidecar

Keep the Tauri/Rust app thin. Push heavy, dependency-laden, or fast-changing
logic into separate local processes it spawns and talks to over localhost —
don't compile everything into the Rust binary.

**Stays in Tauri (Rust):**
- Window management (`windows.rs`)
- Telemetry polling (`telemetry.rs`) — lightweight, stable
- OS action registry (`os_actions/`) — direct OS/WMI calls; this is exactly what Rust is good at, and it isn't computationally heavy
- Tauri commands / IPC glue (`commands.rs`)

**Becomes a separate sidecar process:**
- **Browser automation (Playwright)** — Playwright is a Node.js library; it can't run inside Rust or a webview, it needs an actual Node runtime driving a real browser. Bundle a small Node.js sidecar script (Tauri has a built-in "sidecar" feature for exactly this — a separate executable the app spawns and manages as a child process) and talk to it over a local HTTP or websocket API.
- **Microsoft Office COM automation** — Python (`pywin32`) is the mature, well-documented route for COM; spawn a small Python helper per task, or run it as a lightweight persistent sidecar, rather than reaching for Rust's far less mature COM tooling.
- **LM Studio** already needs no sidecar of its own — it's already a separate local server; `core/llm-client.js` just calls its HTTP API directly.

**Why split it this way:** Playwright and COM automation both drag in real runtime dependencies (Node, Python, their package ecosystems) that don't belong compiled into a Rust binary. They're also the most likely code to break or change as you iterate — isolating them means a crash in browser automation can't take down telemetry or the whole app, and a broken sidecar can be restarted without restarting JARVIS. This extends the same "isolate by stability" principle already used for telemetry vs. experimental code one level further: some features get their own *process*, not just their own file.

**Communication pattern:** each sidecar exposes a small local HTTP server (e.g. `localhost:4001` for browser automation, with routes like `/navigate`, `/click`, `/read_page`), and `core/` in the frontend gets a client module for it (`core/browser-client.js`, `core/office-client.js`), following the exact same pattern as `llm-client.js` talking to LM Studio.

---

## Modularity hardening (final stage, planned)

**Status: future plan, not part of the current rebuild.** This is last-stage work, done alongside hardened infrastructure (Phase 8). Until then the only requirement is boundary discipline. Do not build abstraction layers ahead of need.

**Goal:** models, hardware, and OS are each swappable by changing config or adding one adapter, without touching the model-facing tool contract (`config/actions.json`) or the pages.

**The three seams:**

- **Models.** Define interfaces by capability (chat, tool-calling, transcribe, synthesize, OCR, vision), not by provider. One adapter per inference backend (LM Studio, Ollama, llama.cpp) behind `core/llm-client.js`, all using the OpenAI-compatible API as the common contract. `config/models.json` becomes the registry: role, provider, model, residency policy. This is also where the deferred model switcher would plug back in.
- **Hardware.** A `config/hardware.json` profile holds the VRAM budget, RAM budget and inference backend (ROCm, Vulkan, CUDA, Metal), which decides which models stay resident and which quantisation to pick. Swapping the GPU should mean editing that file and installing the right backend build. GPU telemetry goes behind a provider interface in `telemetry.rs`, since LibreHardwareMonitor is Windows-only and other platforms need a different source.
- **OS.** Extends the existing `os_actions/` trait. Platform-specific areas to cover: app and window control, the shell used by terminal tools (PowerShell, zsh, bash), paths, autostart/service (Windows service, launchd, systemd), audio devices, and macOS accessibility permissions. Supported targets: Windows, macOS, Linux only. The MacBook-as-client plan already forces a second OS, so this work is needed regardless.

**Rules:**

1. Boundary discipline from day one: no LM Studio calls outside `core/llm-client.js`, no OS-specific calls outside `os_actions/`.
2. Write a formal interface only when a second real implementation exists (LM Studio plus Ollama, Windows plus macOS). Before that, any interface is a guess, and premature abstraction costs code and debugging time.
3. Every adapter and platform implementation passes through the same action-registry, confirm-before-submit and audit-logging chokepoint. Modularity must never create a path around the gate.
4. Acceptance test: run the same task suite after swapping each seam (backend, hardware profile, OS). The security inspector pass used for Phase 8 covers this stage too.

---

## Notes on sequencing

- The skills system (diff. 4) and project memory (diff. 3) should land early even though they're not glamorous — everything from the terminal page to the whiteboard to financial analysis leans on having a working skill/context-injection layer first.
- Browser automation is split across three difficulty tiers on purpose: headless DOM control (5) works for almost everything, headed mode (4) is a free upgrade once it exists, and vision fallback (7) / full computer-use (8) are only needed for the minority of sites and apps that resist DOM automation.
- The whiteboard and "alive" multi-surface items aren't a phase from your original list, but they're not optional extras either — treat them as a horizontal layer that phases 4 through 6 all end up writing to.
- Financial analysis (7) and email/calendar (7) both become meaningfully easier once the code-execution loop (5) and external-tool connection layer (5) exist — build those first even though they're not part of the same original phase.
- The Claude-in-Chrome-style mode is a decision, not a fixed difficulty — CDP-attach is a near-free extension of the headless browser core (5) since it reuses the same tool functions; the personal Chrome extension path (6–7) costs more build time but is the right call if detection avoidance (ticket/finance sites) matters more than speed. Both stay valid options — pick the path per how much a given site actually needs to be convinced it's a real user.
- **WhatsApp is explicitly deferred, not part of this roadmap.** No official personal-use API exists; the only routes are automating WhatsApp Web (reusing the Chrome/CDP infrastructure) or an unofficial wrapper library, and WhatsApp's terms prohibit unofficial automated clients — real risk of account bans, not just a technical failure. Revisit only if that tradeoff becomes acceptable later.
- The read/act distinction matters more as more integrations get added: being local makes broad **read** access to Gmail, files, etc. low-risk since nothing leaves the machine, but every **write/action** capability (Office, OS control, browser purchases) carries the same real-world consequence local or not — keep the action registry and confirm-before-submit gate as the chokepoint for all of them, not just browser actions.
- **Modularity hardening is the last stage, not an early task.** Keep backend-specific and OS-specific code behind its designated module from the start, but only write the generic adapter interfaces once a second real implementation exists, so the interfaces are shaped by real differences rather than guesses.

---

## Recommended build order

Difficulty-ordered by default, but re-sequenced where a feature depends on
something later in the raw numbering. Build top to bottom.

1. Fix telemetry (3)
2. Project memory file (3)
3. Confirm-before-submit guardrail (3)
4. Planning-first execution pattern (3)
5. Bundle offline charting libraries (3)
6. File/deliverable-focused skill category (3)
7. LM Studio integration, single consolidated model (4) — model switcher deferred
8. Skills system core (4)
9. Coder-model terminal page (4)
10. Tool/function-calling wiring for Coder model (4)
11. Sidecar process architecture decision (4)
12. Browser window placement decision (4)
13. Reuse vs. separate data-analysis sandbox (4)
14. Artifact-detection marker convention (4)
15. Route other phases' output to the whiteboard (4)
16. Gmail API integration (4)
17. Audit logging for every action (4)
18. Voice chat, STT/TTS (5)
19. Auto-memory equivalent (5)
20. External-tool connection layer (MCP-equivalent) (5)
21. Headless browser automation core (5)
22. Headed browser mode (4, built right after its headless core exists at 5)
23. Persistent vs. fresh browser session management (5)
24. Claude-in-Chrome-style mode (5 via CDP-attach, or 6–7 via personal Chrome extension — decision left open, see notes)
25. Code-execution-based data analysis loop (5)
26. Sandboxed scratch workspace (5)
27. Second Tauri webview pane, static (5)
28. Iterative artifact updates (5)
29. Reactive HUD states (5)
30. Spatial memory for windows (5)
31. OS control / agent actions — action registry + cross-platform config (6)
32. Microsoft Office integration (6)
33. Parallel sub-task dispatch (6)
34. Autonomous panel lifecycle tool calls (6)
35. Multi-surface routing logic (6)
36. Email triage + calendar (7)
37. Financial analysis engine (7)
38. Vision fallback for browser automation (7) — only after step 21 exists
39. Biometrics / BLE smartband (8)
40. Full computer-use fallback (8) — only after step 31 exists
41. Hardened infrastructure (9)
42. Modularity hardening: model, hardware and OS adapters (9, final stage, after 41)