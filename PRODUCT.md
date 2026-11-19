# Product

<!-- impeccable:product-schema 1 -->

Written 2026-11-19 without the init interview: the owner gave full discretion for the redesign and was away from both machines. Facts below come from the owner's own brief, `CLAUDE.md`, `.md Files/` and the code. Lines marked *(inferred)* were not confirmed by the owner.

## Platform

web

A Tauri 2 desktop window (WebView2 on Windows) running a Vite and vanilla JS front end. A MacBook client is planned.

## Users

One person: the owner, a student and builder in Madrid, who uses JARVIS at his own desk on the PC that runs the models. Sessions run from short questions between other work to long agent jobs on a code folder, often in the evening *(inferred)*. He reads English, Spanish and French and codes in Python at a beginner to intermediate level.

## Product Purpose

A personal AI assistant that runs on his own hardware. It chats, writes code in a chosen project folder, builds artifacts (pages, charts, tables, documents), searches the web when allowed, runs named routines (lock screen, game mode), speaks and listens, and shows what the machine is doing while it works. Success is an assistant he reaches for instead of a cloud chat app, because it is as capable to use and he can see and control everything it does.

## Positioning

Everything runs locally: Qwen models in LM Studio on his own GPU, telemetry from his own sensors, voice in a local sidecar. The switches for microphone, internet and network link are enforced in Rust, not just painted. Every action passes one gate with effect classes, approvals and a hash-chained audit log. A cloud chat app cannot show the GPU it runs on or let the owner cut its network.

## Operating Context

- LM Studio on port 1234 with up to four presets (General 14B, Coding and finance 27B, Visual 8B, Abliterated 14B); model swaps take seconds and are visible.
- LibreHardwareMonitor on 8085 for CPU, GPU, RAM, temperatures, VRAM.
- Voice sidecar: hold F8 to talk, F9 toggles; replies can be spoken.
- Slash commands (`/project`, `/think`, `/resume`, `/remember`, `/skills`, `/clip` and more), Shift+Tab steps the permission mode on the Code page, Ctrl+\ hides the sidebar, Ctrl+B the panel, Ctrl+K searches chats, Ctrl+L LaTeX mode.
- The JARVIS server (port 7410) on the PC, with an agent per machine (PC and Mac): with it on, the app is a thin client, the server runs the model, the tools and the approvals, and you pick which computer JARVIS controls. With it off, the app talks to LM Studio directly. An iPhone app (`mobile.html`) talks to the same server.
- Window: 1440x900 by default, 960x600 minimum, frameless with custom window buttons. Light and dark follow Windows.

## Capabilities and Constraints

- Built: chat with streaming, markdown, LaTeX and code; artifacts with versions in the panel; projects, folders and pinned chats; Code page with changes, tasks, diffs and undo; approvals (cards locally, a dialog through the server) and plan mode; effort levels and permission modes; think toggle with a budget; reply Copy and Retry; effect classes; routines; web search and fetch; a guarded Playwright browser; accounts (Google and Microsoft through the server), a morning digest and scheduled jobs; PC/Mac target; memory vault and habits; voice; telemetry; usage counts.
- Not built or not checked on real machines: much of the action library is disabled until tried on the real PC and Mac (HUMAN_TODO.md); the Obsidian research agent; OSINT beyond the classic design's Intel page. The interface must not claim them.
- Technical: vanilla JS, no framework; inherited modules look up fixed DOM ids (`hud-chat-input`, `chat-output`, `center-workspace`, `dock-*`, telemetry ids, `model-info-*`, `btn-*` presets, `cli-*`, `win-*`); renaming one breaks a module silently.
- No web fonts: Segoe UI Variable and Cascadia Code (system faces). No network assets at runtime.
- Sentence case everywhere. No glow, no gradients.

## Brand Commitments

- The name JARVIS.
- Teal (cyan on dark) is JARVIS's colour; red is reserved for errors and structural warnings.
- The node mesh: a 48-node Fibonacci sphere that swells with speech, breathes while thinking and spins when dragged. Pinned by the owner for this redesign as the staple of the design.
- Claude is the functional reference: the conversation, composer, artifacts, tool steps and sidebar should work the way Claude's do.

## Evidence on Hand

- Real feature list: `.md Files/JARVIS_Feature_Checklist.md`.
- Real hardware: Ryzen 7 7800X3D, RX 9070 16 GB, 32 GB DDR5.
- No usage metrics, benchmarks or screenshots of the real Tauri window exist yet. Do not invent speeds or counts; demo data in mocks must be labelled.

## Product Principles

1. Local and visible: show what the machine and the model are doing, in place, without a separate dashboard.
2. Ask before acting: every change is a step he can see, approve, undo or audit.
3. Fast by default: thinking is off unless asked for; nothing in the interface should add wait.
4. One conversation, many surfaces: chat, code and artifacts share a single conversation.
5. Quiet until needed: controls appear when they apply (tools gated, chips hidden in normal mode).

## Accessibility & Inclusion

Text reaches 4.5:1 on every surface, targets are at least 24 px, everything works by keyboard, and `prefers-reduced-motion` turns animation off. No specific user needs beyond that were stated.
