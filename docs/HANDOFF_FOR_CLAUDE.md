# Handoff for Claude: what was built, how, and what to watch for

Read this first, then JARVIS_BUILD_SPEC.md (the original instructions). Source: branch jarvis-build of https://github.com/IggyBTD/JARVIS, folder next/.

---


The instruction set is saved in this repo as `docs/JARVIS_BUILD_SPEC.md` (596 lines, the copy made at the start of the build). This file compares it with what was delivered and says what a local Claude chat should know before porting it into the existing JARVIS app (the one that runs on the user's PC, folder `C:\Users\bethe\Jarvis-Next`).

## 1. Delivered against the spec

| Spec section | Status |
|---|---|
| 0 How to work | Followed: one commit per step with green tests, no questions asked, decisions in `docs/decisions.md`, human steps in `HUMAN_TODO.md`. Branch `jarvis-build`. |
| 1 Goal and decisions | Built as specified: one model (alias `local`), PC server, agent per machine, thin client, user-only target switch. |
| 2 Topology, ports | As specified (7410, 7421, 7422, OpenCode 4096, browser sidecar 4001, model 1234). |
| 4.1 Config | All config files schema-checked at start. `bind: auto` implemented. |
| 4.2 Network and auth | Tokens (ui, machine, plus a derived `model` token for OpenCode), constant-time compare, rotation, origin check, rate limits, caller allowlist. Firewall commands are printed, not run. |
| 4.3 Gate, policy, audit | Done, with a static test that fails if anything reaches an agent outside `tool-router`. |
| 4.4 LLM client, proxy, queue | Done (SSE edge cases, think folding, priority queue, `/v1` proxy for OpenCode). |
| 4.5 Target and prompts | Done, plus a per-turn local clock added after review. |
| 4.6 Orchestrator, router | Done (8 iterations, 12 tool calls, abort, persistence). |
| 4.7 Agent, registry | Done. About 97 actions, all disabled except the MVP and `run_script`. |
| 4.8 OpenCode | Done and run against the real 1.19.1 binary with a fake model. Not run with the real Qwen model. |
| 4.9 Browser | Done with real Chromium tests. Submit, password and CAPTCHA rules enforced in the sidecar. |
| 4.10 Digest, scheduler | Done against a fake Google. Real Google sign-in is a human step. |
| 4.11 Voice | Done against fake engines (see deviations). Not tested with a real microphone. |
| 4.12 Frontend | Done and tested in headless Chromium. See "HUD" below. |
| 4.13 Telemetry | Done. Mac numbers come from agent actions. |
| 4.14 Installers, doctor | Done as data-driven plans, tested without installing. Never run on Windows or macOS. |
| 5 Action library | All implemented as plan-plus-parser, none enabled. None tried on a real machine. |
| 9 Scans | Four rounds by independent reviewers. All critical and high findings fixed. |
| 11 Definition of done | Tests green. Not met: `doctor` on both machines, the Mac-runs-on-Mac check, a day of unattended digest. These need the user's machines. |

## 2. Where I deviated from the spec (and why)

1. **Folder.** The spec says a project folder `JARVIS next`. It did not exist, so the build is in `next/` inside the existing repo, branch `jarvis-build`, nothing outside `next/` touched.
2. **Node 22**, not 20 (the test glob needs it).
3. **Voice engines are external servers** (OpenAI-compatible `/v1/audio/transcriptions` and `/v1/audio/speech`) instead of bundled Silero, Whisper and Kokoro. VAD is an energy detector and turn detection is a silence timeout; both sit behind `vad.js` and `turn.js` so Silero and Smart Turn v3 can replace them. Wake-word mode says "not available yet". The user's existing app already has a sherpa-onnx voice sidecar (Nemotron ASR plus Kokoro) that should be preferred and wrapped to the same two endpoints.
4. **Scheduler** is custom (no `node-cron`), DST-safe.
5. **User scripts manifest** is `config/scripts.json` with SHA-256 pins, not `scripts/user/manifest.json`.
6. **Scan reports** are `docs/scan/roundN-*.md`, not `docs/bug-report-N.md`. `scan-loop` was not built; the scans were run as separate review sessions. `scripts/scan-prompt.md` and `fix-prompt.md` exist.
7. **Stricter than the spec** after review: web fetch in OpenCode asks, edits of files that arm programs ask, formatters and LSP are off, typing into a web page asks once per site, odd or long addresses ask, repos whose git config defines a program are refused.
8. **Timers are whole minutes**; the spec did not say, but seconds are not supported.

## 3. HUD: read this before porting

The spec said to reuse the existing HUD as is. `app/src/hud/` (node mesh, telemetry view) was ported from the old files, but the rest of `app/` (chat, gate popup, panels, settings, voice) is new and small. The user's existing app (repo root `src/`, `src-tauri/`, `index.html`) is a much larger program: whiteboard, pages, command palette, memory, artifacts, a CLI page, its own `llm-client.js`, `agent-client.js`, `audit.js` and a voice sidecar. The spec calls most of that obsolete, so I did not build on it. Merging is therefore **mapping, not copying**:

- The new server and agents are standalone and can run next to the old app. Safest first step: run them side by side and point the old HUD's chat at the new WebSocket (protocol in spec Appendix A and `server/api/protocol.js`).
- Keep the old app's look, whiteboard and pages; take from the new build the safety core (`server/core/{auth,policy,gate,audit-log,tool-router}.js`), the agent and registry, the OpenCode bridge, the browser sidecar and the scheduler/digest.
- Do not run two different action runners that can both reach a machine: pick `tool-router` as the only path and route the old `action-runner.js` through it.

## 4. Not verified anywhere

Real Windows and macOS actions, installers, the Tauri desktop build, voice with real audio, OpenCode with the real model, Google sign-in, Mac memory numbers, wake-on-LAN, and OpenCode with formatters off on a machine that has formatters installed. All are listed in `HUMAN_TODO.md` and `TODO_FOR_YOU.md`.

## 5. Tips for a local chat doing the port

- Read in this order: `PROGRESS.md`, `docs/decisions.md`, `docs/PORTING_NOTES.md`, this file, `docs/known-issues.md`, then the spec.
- Run `npm test` in `next/` first (655 tests, about a minute); it must stay green. Run browser test files one at a time.
- Rules that must survive the port: the single chokepoint, policy as code, target never from the model, untrusted content wrapped, audit chain, no `always` to OpenCode, no `/session/:id/shell`, secrets never logged.
- The old repo's `CLAUDE.md` says commit only when asked and the spec says one commit per step; the user's instruction in this chat was to work unattended on a branch, so follow the spec inside `next/`.

---


Branch `jarvis-build`, folder `next/`, 65 commits, about 35,000 lines, 655 tests. Everything is additive: nothing outside `next/` was changed. Source of truth for behaviour: `docs/JARVIS_BUILD_SPEC.md`. Judgment calls: `docs/decisions.md`. Open items: `docs/known-issues.md`. Review reports: `docs/scan/`.

## Shape
Node 22 ESM, zero-dependency tests (`node:test`), `ws`, Vite vanilla-JS HUD, playwright-core, Tauri 2 shell. One server on the PC (:7410), one agent per machine (PC :7421, Mac :7422), a HUD client with no authority. The user picks the target (`pc` or `mac`); the model cannot.

## The one rule
Every tool call goes `tool-router -> policy -> gate -> audit -> agent`. Nothing else reaches an agent (`scripts/check-chokepoint.js` and a test enforce it; do not name a helper `exec`, use `runProgram`). Only `llm-client.js` talks to the model.

## Features and where they are
| Feature | Files | How |
|---|---|---|
| Config | `server/core/config.js`, `config-schemas.js`, `config/*.json` | Strict schemas (own JSON-Schema subset in `shared/schema.js`, uses `Object.hasOwn`), server refuses to start on a bad file |
| Auth | `server/core/auth.js` | Tokens per role (`ui`, `machine`, `model`), constant-time compare, `failuresOnly` rate limiter that never blocks a valid token, origin check; `modelToken()` is derived from the machine token and opens only `/v1` |
| Policy and gate | `policy.js`, `gate.js` | Tiers T0..T3, policy is code. T2/T3 ask in the HUD; scheduled sources are denied or queued (`queueable` only for tier defaults); internal tools are never queued; timeout denies |
| Audit | `audit-log.js` | Hash-chained JSONL per day, head anchor, redaction by key meaning (camelCase split), args bounded (depth 6, 40 keys, 4 KB), `repairBenign` only fixes a torn last line or an anchor one entry off; never writes to an older day file |
| Target | `target-state.js` | Persisted, set only by UI or confirmed voice, bindings frozen per turn, set is all-or-nothing |
| Router | `tool-router.js`, `agent-client.js` | Validate, bind, policy, gate, audit, agent. `target`/`host`/`machine` args refused. Tool names sanitised before logging. Proxy paths reject dot segments, control chars, encoded separators. `ctx.escalate` lets an internal tool ask mid-call |
| Model | `llm-client.js`, `llm-queue.js`, `llm-proxy.js` | Streaming SSE (handles U+2028), think-tag folding, inline `<tool_call>` only when tools were offered, retry before first byte, priority queue with aging, `/v1` proxy for OpenCode that frees its slot on client leave |
| Orchestrator | `orchestrator.js`, `conversations.js`, `prompt-builder.js` | Tool loop with limits, malformed-call retry, abort, context fitting, system prompt from live agent facts plus a per-turn clock in the schedule timezone |
| Machine agents | `agent/`, `agent/registry/**` | `GET /info`, `/actions`, `POST /action/:name`, SSE `/events`; actions are plan-plus-parser (`action({plan, parse})`), args via `execFile` arrays, paths via `safePath`/`dirPath` confined to `config/files.json`, dry run, per-OS impls (`win32.js`, `darwin.js`). About 97 actions, all disabled except the MVP and `run_script` |
| Telemetry | `server/telemetry/*` | LibreHardwareMonitor provider, Mac provider via actions (GiB, `vm_stat` for available memory), isolated polling, rolling log |
| Server API | `server/api/*`, `server/index.js` | HTTP plus one WebSocket (`hello`, state snapshot with stream resume, broadcast); bad request targets get 400; missed reminders delivered on hello |
| HUD | `app/src/**` | Reused old HUD; chat with streaming markdown (DOMPurify, no ids/classes/background/for), target switcher, approval popup (hidden characters shown as codes), settings in OS keychain (Tauri) or localStorage (browser), reminder toast with beep |
| OpenCode | `agent/sidecars/opencode-*.js`, `server/core/opencode-bridge.js`, `agent-tasks.js` | Pinned 1.19.1, config in `OPENCODE_CONFIG_CONTENT`, project config disabled, formatters and LSP off, permissions via globs (edit of git/config/package/profile files asks, webfetch asks), env cleaned, permission bridge classifies shell commands (allowlist, destructive list, length cap) and replies only `once`/`reject`; never `always`, never `/session/:id/shell`; tasks take a git snapshot first |
| Git safety | `agent/registry/git.js` | Hardened `-c` flags; refuses any repo whose repository-scope `git config --list` has filter/fsmonitor/textconv/hooks/pager/etc.; fails closed |
| Browser | `sidecars/browser/*`, `agent/sidecars/browser-*.js`, `server/core/browser-tools.js` | Playwright sidecar behind a guard proxy (DNS pinning, private networks blocked, IPv6 aliases handled); never fills password/payment fields (checked via page script and Playwright handle API); submit-like click/Enter needs a single-use token bound to element and URL with a screenshot; CAPTCHA pauses; typing is text only and asks once per site; data-carrying addresses ask (size/shape/budget) |
| Digest | `server/digest/*`, `scripts/google-auth.js` | Read-only Google Calendar and Gmail, AES-GCM token file, reauth banner, calendar rows and telemetry summary computed in code, model call with tools off and mail wrapped as untrusted, retry on transient failure |
| Scheduler | `server/core/scheduler.js` | Daily jobs DST-safe, catch-up window, job timeout keeps its slot, state write failures survive, failed daily jobs retry twice 10 min apart |
| Reminders and timers | `reminders.js`, `time-tools.js` | Server side, persisted, missed ones queued for the next client |
| Voice | `server/voice/*`, `app/src/voice/*`, `shared/voice-frames.js` | OpenAI-compatible STT/TTS clients, energy VAD, silence turn detector, state machine with epoch cancel, binary frames `0x01` mic and `0x02` TTS, push to talk default, EN/ES/FR target-switch matcher with spoken confirmation |
| Tool exposure | `tool-select.js` | At most 15 registry tools chosen by category keywords (EN/ES/FR, plurals included), `list_action_categories` unlocks per conversation |
| User scripts | `config/scripts.json`, `script-tools.js`, `agent/registry/scripts.js` | One `run_user_script` tool, tier per entry, SHA-256 pinned |
| Ops | `scripts/doctor.js`, `install.js` (+ `.ps1`/`.sh`), `backup-data.js`, `restore-data.js`, `shared/*` | Pure-data install plans (Task Scheduler XML, LaunchAgent plist), backup with verified audit copy and retention (always keeps the newest), restore only known names |

## How to implement it elsewhere
1. Start from the spec and `docs/decisions.md`, then copy `shared/`, `server/core/`, `agent/` and `sidecars/` as they are; they have no hidden coupling beyond `config/`.
2. Build in this order (each step was committed only with a green `npm test`): config, auth, audit, policy+gate, chokepoint scanner, llm-client/queue/proxy, agent skeleton+registry, router, orchestrator, API, HUD, OpenCode, browser, digest/scheduler, voice, action library, installers.
3. Test with fakes in `tests/mocks/` (`fake-model`, `fake-agent`, `fake-google`, `fake-opencode`, `fake-lhm`) and real Chromium and real git where it matters. Use `npm test` (it sets `--test-force-exit` and a timeout so a leaked server cannot hang the run); run one browser test file at a time.
4. Patterns that mattered: entry guards use `shared/entry.js isMain` (the naive `import.meta.url === file://argv1` fails on Windows and paths with spaces); process guards in `shared/guards.js`; never trust a model, page, mail or file as instructions (wrap with `untrusted.js`); every file write that matters is atomic (tmp then rename) and a failed write must not crash a timer; every await in a long flow re-checks whether the task was aborted.
5. Security lessons from four scan rounds (reports in `docs/scan/`): classification done inside a page can be lied to; globs for OpenCode match workspace-relative paths so list both `x` and `**/x`; anything that can run a program from a workspace file (git config, formatter config, package scripts, `.opencode/`) must ask or be disabled; keep unattended leak channels (addresses, typing, webfetch) behind the gate.
6. Nothing here was run on a real Windows or macOS machine. Those checks are in `HUMAN_TODO.md` and `TODO_FOR_YOU.md`.
