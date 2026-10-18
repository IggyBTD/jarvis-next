# Decisions

One line each. Newest at the bottom.

- D-01 Commits are per phase (P0..P12) on branch `jarvis-build`, not per step; each commit has a green `npm test`. A per-step history was not worth 65 commits for a single unattended pass.
- D-02 Folder: everything is built inside the existing JARVIS Next repo. The old front end in `src/` is kept (it is the HUD/chat app); the new server, agent and shared code are new top-level folders `server/`, `agent/`, `shared/`, `tests/`. The build brief's `next/` and `app/` folders do not exist here: `app/` maps to `src/` (see D-10).
- D-03 Config lives in `config/server/` because `config/` already holds files the old app imports with the same names (`models.json`, `actions.json`, `voice.json`).
- D-04 Browser sidecar is `sidecars/browser-guard/` because `sidecars/browser/` is the existing Intel-page sidecar; the existing one is untouched.
- D-05 Node 22+ (the dev machine runs 24). Test globs need it.
- D-06 Dependencies added: `ws`. `playwright` was already a dependency (the guarded sidecar uses it). Tests use `node:test` only.
- D-07 Thinking toggle: default `chat_template_kwargs: { enable_thinking: false }` in the request body, which llama-server and LM Studio pass to the Qwen3 chat template. `thinkingMethod` also supports `no_think` (appends `/no_think` to the last user message) and `request_field` (`reasoning_effort`). Verified only against the mock; confirm on the PC (HUMAN_TODO).
- D-08 Audit days are UTC dates. The chain spans days (first line of a day points at the last hash of the previous day).
- D-09 `actions.json` is generated once by `scripts/gen-actions.js` and is the contract afterwards (re-running keeps the `enabled` flags). Time tools (`set_timer`, `set_reminder`, `list_schedules`) are marked `internal`: they run on the server, not on an agent.
