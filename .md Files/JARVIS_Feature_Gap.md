# Claude Code features vs JARVIS (local model): what to port, in order

Written in session 5. Source: the Claude Code docs read on 2026-10-05: the full page index (about 220 pages, read as titles and one-line summaries), and in full the Tools reference, Commands, Interactive mode and CLI reference pages. Pages read only by title: settings reference, hooks reference, enterprise and admin, SDK, plugins and mods internals. Anything about those is from the one-line summary, not the page.

JARVIS facts used for the filter: one local model at a time (Qwen3 14B, 27B, VL 8B, abliterated 14B via LM Studio), about 32K context, one GPU, no Anthropic account or servers, Windows, Tauri window, the action registry plus approval card plus audit file already built.

## Removed: cannot work, or make no sense, with a local model

| Group | Features | Why |
| --- | --- | --- |
| Needs Anthropic servers or account | Cloud sessions (`--cloud`, `--teleport`, `/web-setup`, `/remote-env`), Routines and `/schedule` (cloud), `/autofix-pr`, ultrareview and `/code-review ultra`, Remote Control and mobile app, push notifications to phone, Claude Tag and Slack, Claude Security plugin, `/login`, `/logout`, `/usage`, `/cost`, `/passes`, `/upgrade`, `/usage-credits`, `/rate-limit-options`, `/privacy-settings`, `/stickers`, `/radio`, `/feedback`, `/bug`, `/insights` upload, `/team-onboarding`, plugin marketplaces | Hosted by Anthropic or tied to a claude.ai plan |
| Enterprise and admin | Managed and server-managed settings, gateways, Bedrock, Vertex, Foundry, SSO, spend limits, analytics, OpenTelemetry, HIPAA, zero data retention, self-hosted runners, communications and champion kits | You are one user on one machine |
| Needs a frontier model | Auto mode (a classifier model approves prompts), advisor tool (second stronger model), fast mode, effort levels `xhigh`, `max`, `ultracode`, extended thinking toggle, fallback model chains, 1M context | No second or stronger model fits in VRAM alongside the first; Qwen has its own `/think` switch only |
| Needs many models at once | Agent teams, `/batch` (5 to 30 parallel agents), dynamic workflows at scale, `/deep-research` fan-out, agent view of many parallel sessions, parallel subagents | One model loads at a time; parallel work would swap models and take minutes per swap |
| Hosted products | Artifacts on claude.ai and its capabilities, `/design`, `/design-sync`, `/slides`, Claude in Chrome (the extension), desktop and Linux apps, IDE and VS Code and JetBrains integrations, `/desktop`, `/ide`, `/terminal-setup`, `/tui`, terminal-only items (Shift+Enter setup, tmux, Vim mode keys, themes for a terminal) | Either Anthropic's service or terminal UI that JARVIS's own window replaces |
| Prompt caching internals | Cache TTLs, `--exclude-dynamic-system-prompt-sections`, `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` | LM Studio keeps its own KV cache; nothing to tune here |
| Not worth it | `/heapdump`, `/scroll-speed`, `/color`, `/powerup`, `/release-notes`, `/mobile`, `claude gateway`, `claude self-hosted-runner`, `claude setup-token` | No equivalent need |

## Kept, ranked by how much it would help the way you work

How you work, from this session and the memory notes: you iterate on UI with screenshots, you want honest "verified here, not there" reports, you want handoff docs so a session needs no history, you keep subagents off unless asked, you commit only when asked, and the local model is small and easily lost, so anything that keeps it on track beats anything fancy.

Status: BUILT, PART (partly there), NO (not built).

### Tier 1: do these first (they decide whether the local agent is usable)

| # | Feature (Claude Code name) | What it does for JARVIS | Status | Effort |
| --- | --- | --- | --- | --- |
| 1 | Context management: `/context`, `/compact`, auto-compact | A 32K window fills fast; nothing trims it today, so a long agent run just breaks. Summarise old tool results and turns, show the fill | PART (CONTEXT bar only) | M |
| 2 | Plan mode (`/plan`, EnterPlanMode and ExitPlanMode) | The model writes a plan, you approve it on one card, then it edits. The best defence against a small model wandering | NO | S |
| 3 | Task checklist (TaskCreate, TaskUpdate, Ctrl+T) | Visible to-do list the model updates; keeps long jobs on rails; maps to a CLI panel | NO | S |
| 4 | Checkpointing and `/rewind`, `/undo` | UNDO exists per edit; this is whole-session: roll files and conversation back to any message | PART | M |
| 5 | Session save, resume, rename, branch, export (`/resume`, `/rename`, `/branch`, `/fork`, `/export`, `--continue`) | Conversations are lost on restart today | NO | M |
| 6 | Skills (`SKILL.md` folders, `/skills`, `/reload-skills`, Skill tool) | Already planned (`skills/` is empty). Your design skills, graphify and handoff routines as plain files the local model can load on demand | NO | M |
| 7 | Hooks (before and after a tool, on stop) | Run tests or format after an edit, block a path, add context; your audit log is half of this already | NO | M |
| 8 | Project instructions auto-loaded (CLAUDE.md, rules, auto memory) | Memory vault exists; automatic project-file loading and "remember this" habit loop is the missing half | PART | S |

### Tier 2: high value once Tier 1 stands

| # | Feature | What it does for JARVIS | Status | Effort |
| --- | --- | --- | --- | --- |
| 9 | `/diff` live panel and `/focus` view | A live diff panel of the working tree (CLI page already has per-file diffs) | PART | S |
| 10 | LSP code intelligence | Type errors and go-to-definition from local language servers; fewer wrong edits | NO | M |
| 11 | MCP client (`claude mcp`, ToolSearch) | Plug in existing tool servers (Playwright, files, git) instead of writing each one | NO | M |
| 12 | Web fetch and search tools, with the Playwright sidecar | Internet switch exists; the tools and browser panel do not | NO | M |
| 13 | Shell tool upgrades: background tasks, Monitor, `Ctrl+B`, `/tasks`, `!` shell mode | Long commands (builds, `cargo test`) stay out of the way and stream back | PART | M |
| 14 | Git helpers: worktrees (`--worktree`, EnterWorktree), `/diff`, commit and PR on request | Safe experiments on a copy; you commit only when asked, so keep it request-only | NO | M |
| 15 | Subagents, run one at a time (`Agent`, `/subtask`) | Isolated context for a side job (search the repo, summarise) without filling the main window; sequential only | NO | M |
| 16 | `/goal` and `/loop` | Keep working until a condition holds; repeat a check on a timer (local timers, no cloud) | NO | S |
| 17 | Scheduled tasks and desktop notifications (CronCreate, PushNotification locally) | "Tell me when the test run finishes"; Tauri can do desktop toasts | NO | S |
| 18 | Output styles | Swap the system prompt tone per task (concise, explanatory); trivial | NO | S |
| 19 | Sandbox for the shell | The blocked-command list is a backstop only; a real sandbox on Windows needs a container or VM | NO | L |

### Tier 3: nice to have

| # | Feature | Notes |
| --- | --- | --- |
| 20 | Prompt-level conveniences: `@` file mentions, image paste, queued messages, stash prompt (`Ctrl+S`), `Ctrl+R` history search, `Esc Esc` rewind, `/copy N`, prompt suggestions, `/btw` side question, `/recap`, session recap on return | Several already exist (`/copy`, the palette, shortcuts). Do `@` mentions and `/btw` first |
| 21 | Review skills (`/code-review`, `/security-review`, `/simplify`, `/fewer-permission-prompts`) as prompts | Work as skills on a local model, but shallower than the cloud versions |
| 22 | `/doctor`, `/debug`, safe mode, `claude doctor` | A status check of LM Studio, sensors, voice and project already half exists as the notch stack and `/status` |
| 23 | Permission modes and rules (`/permissions`, `acceptEdits`, `dontAsk`, plan) | Rules and the approval card exist; add named modes you can cycle |
| 24 | Headless mode (`-p`) and an SDK-style API | Only if you want to script JARVIS from outside |
| 25 | Plugins and mods | Your skills folder plus the action registry cover most of this; revisit after skills |
| 26 | Computer use | Needs a good vision model; Qwen3-VL 8B is weak for clicking; park it |
| 27 | Voice dictation, Claude FM, themes, keybindings file, status line | Voice is built; keybindings and a status line are cosmetic |

## What exists already (so it is not rebuilt)

Agent loop with list, read, search, edit, write and run; permissions file, approval card (now also a floating panel on the CLI page), hash-chained audit; diff cards with UNDO; memory vault and habits; slash commands with a palette; keyboard shortcuts; voice in and out; attachments; whiteboard artifacts; the CLI page with docked and floating panels.

## Suggested next step

Tier 1 items 1 to 3 (context trimming, plan mode, task checklist) are small to medium, need no new dependency, and are what make a 14B to 27B model behave in a long coding job. Item 6 (skills) is the biggest multiplier after that.
