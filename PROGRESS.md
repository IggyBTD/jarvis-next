STATUS: IN_PROGRESS
LAST_ITERATION: 1

Branch `jarvis-build`. Spec: `docs/JARVIS_BUILD_SPEC.md`. Judgment calls: `docs/decisions.md`. Human steps: `HUMAN_TODO.md`.
Legend: `[ ]` todo, `[x]` done and tested, `[~]` built and mock-tested, waiting on a human step, `[!]` failed three times.
Commits are per phase (see decisions.md D-01), not per step.

## P0 Bootstrap
- [x] P0.1 Inspect existing files, branch, package scripts, test runner, ignore rules, spec copied to docs/
- [x] P0.2 PROGRESS.md, HUMAN_TODO.md, docs/decisions.md, project CLAUDE.md section
- [x] P0.3 Mocks and `npm test` green

## P1 Chokepoint
- [x] P1.1 Config loader and schemas
- [x] P1.2 Auth, token generation, rotation
- [x] P1.3 Audit log with hash chain and verify-audit
- [x] P1.4 Policy and gate
- [x] P1.5 Static chokepoint test

## P2 Model path
- [x] P2.1 llm-client
- [x] P2.2 llm-queue
- [x] P2.3 llm-proxy
- [~] P2.4 bench-model harness (real numbers are a human step)

## P3 Agent and registry
- [x] P3.1 Agent skeleton
- [x] P3.2 Registry loader, run helper, app aliases, dry run
- [~] P3.3 MVP actions on win32 (mock-tested; real-machine check is a human step)
- [~] P3.4 Same on darwin (mock-tested; Mac check is a human step)
- [x] P3.5 Unsupported actions hidden per OS

## P4 Target and routing
- [x] P4.1 target-state
- [x] P4.2 prompt-builder
- [x] P4.3 tool-router and agent-client
- [x] P4.4 orchestrator

## P5 API and frontend
- [ ] P5.1 WS and HTTP API
- [ ] P5.2 Telemetry
- [ ] P5.3 Frontend integration (target switcher, gate popup, chat over the server, panels)
- [~] P5.4 Tauri packaging notes, keychain, global shortcut (config only)

## P6 OpenCode
- [ ] P6.1 Verification tests (shell-route bypass)
- [ ] P6.2 opencode-manager
- [ ] P6.3 Permission bridge
- [ ] P6.4 agent_task tool and task records
- [~] P6.5 Acceptance on the real install

## P7 Digest and scheduler
- [ ] P7.1 Scheduler
- [ ] P7.2 Calendar and Gmail clients
- [ ] P7.3 Telemetry summary
- [ ] P7.4 Digest pipeline
- [~] P7.5 Real OAuth setup

## P8 Browser
- [ ] P8.1 Sidecar and tools
- [ ] P8.2 Guardrails, gate integration, CAPTCHA handoff

## P9 Voice
- [ ] P9.1 Client capture, playback, barge-in
- [ ] P9.2 Server VAD, STT, TTS, turn detection
- [ ] P9.3 Voice target-switch matcher

## P10 Action library
- [ ] P10.1 Categories implemented (all disabled except MVP)
- [ ] P10.2 Tool exposure cap
- [ ] P10.3 User scripts

## P11 Ship
- [ ] P11.1 Installers, autostart, doctor
- [ ] P11.2 Docs
- [ ] P11.3 Expiry, rotation, backup

## P12 Scan
- [ ] P12.1 Review and fix rounds
