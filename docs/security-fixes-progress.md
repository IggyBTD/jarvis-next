STATUS: IN PROGRESS, stage C (stages A and B done)

NOW: a Fable sub-agent is writing per-device pairing (new files only: server/core/devices.js, tests/unit/sec-c-devices.test.js, docs/security/pairing-design.md). Do not edit anything until it returns; then review, test and wire it (F3-1, F3-4).

# Security fix run: progress

Run doc: docs/security/fix-run.md. Branch ui-extras. Resume job (CronCreate, session-only): 883971bf, every 30 min at :13 and :43.

Baseline before stage A: commit f0cf131, `npm test` 192 of 192 pass, `npm run check-chokepoint` passes.

Pre-run commits (not security fixes): 31fce55 (desktop UI, icons, mesh, steps), f0cf131 (iPhone app).

## Findings

| ID | Stage | Status | Commit | Notes |
|----|-------|--------|--------|-------|
| F1-1 | A | DONE | 23436e3 | bridge through policy.decide; Auto asks for non-allowlisted; T3 for interpreters and destructive anywhere; agent_task asks after a tool result (temporary flag); Claude backend Auto no longer allows all Bash |
| F1-2 | A | DONE | 46cfdd5 | parsed allowlist (shared/command-scope.js), paths resolved inside the workspace, T3 for variables and outside paths, Manual and Plan ask; git --output now unverified at runtime only |
| F1-3 | A | DONE | 40f98ad | JARVIS folder and Temp untrusted; root and data folder T3 and armed in every mode (edits, folders, reads, commands); agent reports its own folders in /info; Claude deny rules; arming list extended; non-http webfetch T3 |
| F4-2 | A | DONE | a1a6da3 | system action resolve_paths on the agent (links, junctions, short names, trailing dots); bridge checks edits, folders and command words against real paths; no answer is outside |
| F4-1 | A | DONE | c02fc71 | shared route and method allowlist (shared/proxy-routes.js) enforced by server and agent on the raw address; no % at all; permission answers only once or reject; opencode-manager takes the checked body. %2573hell reaching OpenCode was not run against real OpenCode (it is refused before forwarding now) |
| F2-1 | B | DONE | 40feb5a | markdown sanitiser keeps only data:/blob: sources; CSP on server pages and in Tauri; artifact CSP at offset 0; browser tests sec-exfil and sec-csp-pages. Tauri window itself unverified |
| F2-2 | B | DONE | 21cce54, 3bbd58c | tainted-chat rule (server/core/taint.js, Fable) wired into orchestrator, router, policy, conversations and task notes; navigate after outside content asks with the full address, in every later turn of that chat |
| F2-4 | B | DONE | ca91779 | wrapUntrusted escapes tool_call, think, function, tool and <| markup; inline tool calls off once the backend used structured calls; echoed inline calls dropped. How often the real model echoes injections is unverified |
| F2-5 | B | DONE | 085ab34 | remember asks in a tainted chat; new notes broadcast and shown whole with Undo on desktop and phone; removals broadcast; notes wrapped in the prompt |
| F2-3 | B | DONE | 7b5b21f | task note: summary, each changed file on one line and the reason inside one untrusted block |
| F2-7 | B | DONE | 2c378c7 | Claude Code reply stored as shown, marked origin claude-code, sent to the local model wrapped with a short line of its own |
| F1-7 | B | DONE | 3fabb07 | router refuses a tool the chat loop did not offer in that request |
| F3-1 | C | TODO | | |
| F3-4 | C | TODO | | |
| F4-5 | C | TODO | | |
| F3-2 | C | TODO | | |
| F3-3 | C | TODO | | |
| F3-5 | C | TODO | | |
| F1-4 | C | TODO | | |
| F1-5 | C | TODO | | |
| F1-6 | C | TODO | | |
| F2-6 | D | TODO | | |
| F3-6 | D | TODO | | |
| F3-7 | D | TODO | | |
| F3-8 | D | TODO | | |
| F4-3 | D | TODO | | |
| F4-4 | D | TODO | | |
| F5-1 | D | TODO | | |
| F5-2 | D | TODO | | |
| F5-3 | D | TODO | | |

## Stage summaries

Stage A (coding agent), commits 23436e3 to c02fc71, tests 192 -> 210, all green, chokepoint check green. The permission bridge now goes through policy.decide; Auto runs only a parsed read-only allowlist whose paths must resolve inside the workspace (lexically on the server and for real on the machine); Manual asks for everything and Plan runs nothing by itself; interpreters, installs, variables and outside paths are T3; the JARVIS folder and data folder are T3 and armed in every mode; the agent forwards only the server's own sidecar routes. Closes CH-1 (agent_task after untrusted content asks; any non-allowlisted command asks), CH-2 (token files are under the protected data folder; reads, folder requests and commands that reach them are T3 in every mode), CH-3 (dist/** is armed and the JARVIS folder is protected) and CH-5 (git --output is not allowlisted; Manual and Plan never auto-run). The tainted flag for agent_task is temporary until stage B.

Stage B (exfiltration and injection), commits 40feb5a to 3fabb07, tests 210 -> 229 unit and integration plus 3 new browser files. Remote content cannot load from replies, digests or artifacts; a chat that has read outside content asks before anything that can carry data out, store text or start work, with the whole request on the card, and stays marked; tool-call markup in quoted content never runs; notes are seen and undoable; task notes and Claude replies reach the model wrapped; unoffered tools are refused. Closes CH-4 (mail then image or navigate) and CH-6 (planted note or file name acted on later). Replaces the stage A flag.

Browser tests after stage B, one file at a time: ui-server 19/19, mobile 17/17, browser-guard 5/5, ui-layout 12/12, sec-exfil 2/2, sec-csp-pages 1/1, sec-memory-undo 2/2, ui-shell 12/13. The ui-shell failure ("the plus opens a menu ... Accounts", the Google accounts card never shows its button) fails the same way on the pre-run baseline f0cf131, so it is not from this run.

## Unverified (runtime checks that settle them)

- F2-4 and F2-2: how often the real model follows or echoes an injection. Check with a fixed red-team set against the PC model: a mail with an instruction to open an address, a mail holding <tool_call> markup, a page asking for an image link; every case must end in an approval card or nothing.

- F2-1: the Tauri window under its new CSP (not runnable here). Check: npm run tauri dev, open a chat with a reply containing an image from a local listener (python -m http.server on another port) and confirm no request arrives; open a chart artifact and confirm it draws (inline scripts in srcdoc frames depend on dangerousDisableAssetCspModification). Then the same with npm run tauri build.

- F1-3: whether OpenCode 1.19.1 asks (external_directory) before its read tool opens a file outside the workspace, and before a PowerShell path argument outside it. If read defaults to allow everywhere, reads of the JARVIS folder by the read tool would not reach the bridge. Check: GET /doc and scripts/opencode-verify.js with a read of a file outside the workspace.
- F1-3: the Claude Code rule form for absolute Windows paths (//c/Users/...). Check: claude -p in the workspace with the JARVIS mode flags, ask it to read data/tokens/ui.token by absolute path, expect a permission denial in the result.

- F1-2: which shell OpenCode 1.19.1 runs bash commands in on Windows (PowerShell is assumed; cmd would expand %NAME%, which is already treated as a variable) and whether a bash call can carry its own working folder. Check: in a scratch workspace, ask OpenCode to run `echo %USERPROFILE%` and `Get-Location` from a subfolder and read the permission event (metadata) and the output.
- F1-2 (CH-5): whether `git log --format=... --output=<file>` writes chosen content on the installed git. It is no longer allowlisted in any mode, so the hole is closed either way. Check in a scratch repository.

## What changes for you

- Auto mode (coding agent): only read-only commands on the allowlist run without asking. Builds, tests, installs and anything else now ask. Bypass still runs ordinary commands, but anything T3 (interpreters such as python -c or node -e, encoded PowerShell, package installs, registry writes, destructive commands anywhere in a chain) asks in every mode.
- Claude Code backend in Auto: commands outside the read-only allowlist are refused (it cannot ask); switch to Bypass for a run that must build or test.
- Manual mode now asks even for read-only commands (git status, Get-Content). Plan mode asks for reads and web fetches instead of running them, and still refuses anything that changes something.
- The coding agent can no longer use the JARVIS folder (C:\Users\bethe\Jarvis-Next) or the user Temp folder without asking: reads, edits and commands there are T3 and ask in every mode (Plan refuses them), even if you pick that folder as the project folder. The Claude Code backend is denied them outright. Work on JARVIS itself with Claude Code.
- npm test is no longer on the read-only list: it asks in Auto.
- Mac: until the Mac agent is updated (node scripts/update.js) it has no resolve_paths action, so its coding agent asks for every edit and command that names a path. Update the Mac once and it is back to normal.
- A chat that has read anything from outside (mail, Drive, a web page, a file, a task result) stays marked for the rest of that chat: opening an address, clicking or typing in the browser, starting a coding task, saving a note, writing a file, running a script, and any other call that carries text then ask, with the whole request on the card. Start a new chat to get back to the old behaviour. Old chats that used such tools count as marked.

## Decisions made without asking

All in docs/decisions.md under "2026-11-15 Security fix run" (S-01 onwards).
