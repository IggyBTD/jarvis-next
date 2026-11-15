STATUS: IN PROGRESS, stage A

# Security fix run: progress

Run doc: docs/security/fix-run.md. Branch ui-extras. Resume job (CronCreate, session-only): 883971bf, every 30 min at :13 and :43.

Baseline before stage A: commit f0cf131, `npm test` 192 of 192 pass, `npm run check-chokepoint` passes.

Pre-run commits (not security fixes): 31fce55 (desktop UI, icons, mesh, steps), f0cf131 (iPhone app).

## Findings

| ID | Stage | Status | Commit | Notes |
|----|-------|--------|--------|-------|
| F1-1 | A | DONE | 23436e3 | bridge through policy.decide; Auto asks for non-allowlisted; T3 for interpreters and destructive anywhere; agent_task asks after a tool result (temporary flag); Claude backend Auto no longer allows all Bash |
| F1-2 | A | DONE | 46cfdd5 | parsed allowlist (shared/command-scope.js), paths resolved inside the workspace, T3 for variables and outside paths, Manual and Plan ask; git --output now unverified at runtime only |
| F1-3 | A | TODO | | |
| F4-2 | A | TODO | | |
| F4-1 | A | TODO | | |
| F2-1 | B | TODO | | |
| F2-2 | B | TODO | | |
| F2-4 | B | TODO | | |
| F2-5 | B | TODO | | |
| F2-3 | B | TODO | | |
| F2-7 | B | TODO | | |
| F1-7 | B | TODO | | |
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

## Unverified (runtime checks that settle them)

- F1-2: which shell OpenCode 1.19.1 runs bash commands in on Windows (PowerShell is assumed; cmd would expand %NAME%, which is already treated as a variable) and whether a bash call can carry its own working folder. Check: in a scratch workspace, ask OpenCode to run `echo %USERPROFILE%` and `Get-Location` from a subfolder and read the permission event (metadata) and the output.
- F1-2 (CH-5): whether `git log --format=... --output=<file>` writes chosen content on the installed git. It is no longer allowlisted in any mode, so the hole is closed either way. Check in a scratch repository.

## What changes for you

- Auto mode (coding agent): only read-only commands on the allowlist run without asking. Builds, tests, installs and anything else now ask. Bypass still runs ordinary commands, but anything T3 (interpreters such as python -c or node -e, encoded PowerShell, package installs, registry writes, destructive commands anywhere in a chain) asks in every mode.
- Claude Code backend in Auto: commands outside the read-only allowlist are refused (it cannot ask); switch to Bypass for a run that must build or test.
- Manual mode now asks even for read-only commands (git status, Get-Content). Plan mode asks for reads and web fetches instead of running them, and still refuses anything that changes something.
- npm test is no longer on the read-only list: it asks in Auto.
- A chat turn that has already read something (mail, a web page, a file, any tool result) asks before starting a coding task.

## Decisions made without asking
