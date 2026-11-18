STATUS: IN PROGRESS, FINAL re-check (stages A, B, C and D done). Resume job: 43a3da9b.



# Security fix run: progress

Run doc: docs/security/fix-run.md. Branch ui-extras. Resume job (CronCreate, session-only): 43a3da9b (recreated after the owner paused the run; the first job was 883971bf), every 30 min at :13 and :43.

Baseline before stage A: commit f0cf131 (49f77c2 after another session rewrote history: the commit right before stage A), `npm test` 192 of 192 pass, `npm run check-chokepoint` passes.

Pre-run commits (not security fixes): 31fce55 (desktop UI, icons, mesh, steps), f0cf131 (iPhone app).

## Findings

| ID | Stage | Status | Commit | Notes |
|----|-------|--------|--------|-------|
| F1-1 | A | DONE | 08e5d49 | bridge through policy.decide; Auto asks for non-allowlisted; T3 for interpreters and destructive anywhere; agent_task asks after a tool result (temporary flag); Claude backend Auto no longer allows all Bash |
| F1-2 | A | DONE | 6675ce6 | parsed allowlist (shared/command-scope.js), paths resolved inside the workspace, T3 for variables and outside paths, Manual and Plan ask; git --output now unverified at runtime only |
| F1-3 | A | DONE | f6550db | JARVIS folder and Temp untrusted; root and data folder T3 and armed in every mode (edits, folders, reads, commands); agent reports its own folders in /info; Claude deny rules; arming list extended; non-http webfetch T3 |
| F4-2 | A | DONE | b47a30d | system action resolve_paths on the agent (links, junctions, short names, trailing dots); bridge checks edits, folders and command words against real paths; no answer is outside |
| F4-1 | A | DONE | 78a5d31 | shared route and method allowlist (shared/proxy-routes.js) enforced by server and agent on the raw address; no % at all; permission answers only once or reject; opencode-manager takes the checked body. %2573hell reaching OpenCode was not run against real OpenCode (it is refused before forwarding now) |
| F2-1 | B | DONE | a1e7730 | markdown sanitiser keeps only data:/blob: sources; CSP on server pages and in Tauri; artifact CSP at offset 0; browser tests sec-exfil and sec-csp-pages. Tauri window itself unverified |
| F2-2 | B | DONE | 0a3b4e3, 598e837 | tainted-chat rule (server/core/taint.js, Fable) wired into orchestrator, router, policy, conversations and task notes; navigate after outside content asks with the full address, in every later turn of that chat |
| F2-4 | B | DONE | 37001ba | wrapUntrusted escapes tool_call, think, function, tool and <| markup; inline tool calls off once the backend used structured calls; echoed inline calls dropped. How often the real model echoes injections is unverified |
| F2-5 | B | DONE | 0a3b4e3, 825b153 | remember asks in a tainted chat; new notes broadcast and shown whole with Undo on desktop and phone; removals broadcast; notes wrapped in the prompt |
| F2-3 | B | DONE | c1deae8 | task note: summary, each changed file on one line and the reason inside one untrusted block |
| F2-7 | B | DONE | 628154d | Claude Code reply stored as shown, marked origin claude-code, sent to the local model wrapped with a short line of its own |
| F1-7 | B | DONE | f58ff18 | router refuses a tool the chat loop did not offer in that request |
| F3-1 | C | DONE | 1d842af, 4a07a91 | per-device tokens (server/core/devices.js, Fable), scopes on every WS message and REST route, T3 and admin need the desktop on the PC or the PIN, tier from the gate, revoked or rotated sockets closed, starter checks the same store, scripts/devices.js |
| F3-4 | C | DONE | 1d842af, fed87c7 | pairing codes typed in the phone app, launcher, desktop page and open-mac.js; no token in links, argv or the Mac zip; old #token links still work once and are stripped; PIN fields on T3 cards |
| F4-5 | C | PARTIAL | b0e2d77, cb163a4 | clean child environments for every program the agent starts (shared/child-env.js, Fable); OpenCode keeps only its own variables; tripwire on outside permission answers; T3 for env dumps, port 4096, DPAPI and Keychain calls; jarvis.ps1 no key on argv. Not done: secret store (shared/secret-store.js) written and tested but not wired, because the server never starts programs; OpenCode as its own OS user needs an administrator (HUMAN_TODO section 12) |
| F3-2 | C | DONE | 96405e4 | starter binds the Tailscale address (loopback if down, never LAN or 0.0.0.0), tailnet callers only, no loopback exemption, wrong-key limiter |
| F3-3 | C | DONE | 8931a27 | agents take calls from the PC tailnet address only (private ranges ignored even in old configs); agent and server bind mode tailscale, never LAN |
| F3-5 | C | DONE | 6b87dfd | phone sheet shows who asked, summary, the whole request uncut with hidden characters revealed, dry run and screenshot; Approve waits until the end has been on screen; audit argsHash of the whole arguments |
| F1-4 | C | DONE | 2c954fe, fe363e2 | capabilities().call system actions only; Code-page Claude task via router.invoke; check scans scripts/, forbids .capabilities( outside a named list, catches shell options and Function(, reads code lines whole |
| F1-5 | C | DONE | 3b20844 | HMAC chain with data/tokens/audit.key, tagged head and an outside mark (cut, hand-fixed head and deleted folder fail verify), anchors on the Mac checked nightly, torn-line cut written into the log, T2/T3 fail closed on audit write failure (router, gate, bridge) |
| F1-6 | C | DONE | e5c6ee5 | queued approvals signed with the audit key (unsigned entries ignored) and re-rated from contract and policy on approval |
| F2-6 | D | DONE | b517e02 | random 16-hex id per untrusted block on both tags; base and digest prompts say a block ends only at its own closer; spaced look-alikes still neutralised |
| F3-6 | D | DONE | 81bc86c | client-link prints Tailscale names only; no raw-address "At home" link |
| F3-7 | D | DONE | 655d42a | Host allowlist by kind (IP literal, localhost, *.localhost, *.ts.net) in front of every server request and upgrade, and the starter; 421 otherwise |
| F3-8 | D | DONE | f4b3b83 | audit strips query strings and search-like values; Mac telemetry skips actions that are off (battery_status was the refusals) |
| F4-3 | D | DONE | bb113d9, b47fdec | separate browser contexts for the model and the person (Intel view shows the person's own page), Enter and Space ask on any focused control, WebSockets checked like every request, DNS pinned by a local proxy |
| F4-4 | D | DONE | 35d9e56 | writablePath: write_file data and document types only, copy and move keep the source type, zip only .zip, no profile or startup folders, no hidden names or streams |
| F5-1 | D | DONE | 3ff0960 | one tool runs at most 20 times per message (models.maxCallsPerTool), whatever its arguments; the owner's 100/200 guard left as set |
| F5-2 | D | DONE | cc096d8 | model proxy: 2 requests in flight per token, output capped at 8192 tokens |
| F5-3 | D | DONE | f60eff6 | reportBack logs one line when it gives up; the note stays in the chat |

## Stage summaries

Stage A (coding agent), commits 08e5d49 to 4aedc2f, tests 192 -> 210, all green, chokepoint check green. The permission bridge now goes through policy.decide; Auto runs only a parsed read-only allowlist whose paths must resolve inside the workspace (lexically on the server and for real on the machine); Manual asks for everything and Plan runs nothing by itself; interpreters, installs, variables and outside paths are T3; the JARVIS folder and data folder are T3 and armed in every mode; the agent forwards only the server's own sidecar routes. Closes CH-1 (agent_task after untrusted content asks; any non-allowlisted command asks), CH-2 (token files are under the protected data folder; reads, folder requests and commands that reach them are T3 in every mode), CH-3 (dist/** is armed and the JARVIS folder is protected) and CH-5 (git --output is not allowlisted; Manual and Plan never auto-run). The tainted flag for agent_task is temporary until stage B.

Stage B (exfiltration and injection), commits a1e7730 to c007c48, tests 210 -> 229 unit and integration plus 3 new browser files. Remote content cannot load from replies, digests or artifacts; a chat that has read outside content asks before anything that can carry data out, store text or start work, with the whole request on the card, and stays marked; tool-call markup in quoted content never runs; notes are seen and undoable; task notes and Claude replies reach the model wrapped; unoffered tools are refused. Closes CH-4 (mail then image or navigate) and CH-6 (planted note or file name acted on later). Replaces the stage A flag.

Browser tests after stage B, one file at a time: ui-server 19/19, mobile 17/17, browser-guard 5/5, ui-layout 12/12, sec-exfil 2/2, sec-csp-pages 1/1, sec-memory-undo 2/2, ui-shell 12/13. The ui-shell failure ("the plus opens a menu ... Accounts", the Google accounts card never shows its button) fails the same way on the pre-run baseline f0cf131, so it is not from this run.

Note (2026-11-18): history was rewritten by another session after 2026-11-17. Every hash in this file is the current one (mapped by commit message). That session also committed part of F1-4 inside 2c954fe and its own feature work as 6aceed0.

Stage C (tokens and the remote path), tests 229 -> 274. Per-device pairing with scopes and a PIN step-up, no token in links, argv or zips, clean child environments with an OpenCode tripwire, the starter and agents on the tailnet only, whole requests on the phone, a narrowed chokepoint with a stronger check, a keyed audit chain with off-box anchors and fail-closed writes, signed and re-rated queued approvals. F4-5 is partial (secret store not wired; OpenCode as its own user is the owner's step). Commits 1d842af to e5c6ee5.

Stage D (the low findings and the browser guard), commits b517e02 to 7072166, tests 274 -> 285 unit and integration, plus tests/browser/sec-browser-guard.test.js (4). Untrusted blocks carry a random id, client-link prints Tailscale names only, a Host allowlist sits in front of the server and the starter, the audit keeps no query strings or search terms and the Mac telemetry no longer writes refusals, write_file makes data files only, one tool runs at most 20 times a message, the model proxy limits each token, reportBack logs when it gives up, and the browser guard keeps the person's and the model's contexts apart, asks for Enter and Space on any focused control, checks WebSockets and pins DNS through its own proxy.

Browser tests after stage D, one file at a time: browser-guard 5/5, mobile 17/17, sec-approval-phone 1/1, sec-browser-guard 4/4, sec-csp-pages 1/1, sec-exfil 2/2, sec-memory-undo 2/2, sec-pairing 3/3, ui-layout 12/12, ui-server 20/20, ui-shell 13/13 (80 of 80; run on the working tree, which also holds another session's uncommitted work).

## Unverified (runtime checks that settle them)

- F1-5: npm run verify-audit on the real log after the server has run once with this change (the first signed lines and the mark appear then); the Mac keeps anchors only after its agent is updated.

- F4-5: whether OpenCode 1.19.1 passes OPENCODE_SERVER_PASSWORD to the commands it runs, and whether it can get its password any other way. Check: in an approved task run Get-ChildItem env: (it now asks as T3; approve it once in a scratch session) and opencode serve --help. Also one real run each of git, npm and code through registry actions under the clean environment (apps opened by actions lose user variables such as JAVA_HOME).

- F3-1, F3-4 on real devices: pairing the iPhone launcher and app (two codes, two storages), the home-screen icon starting the server with the launcher's own token, open-mac.js --pair and the starter ring on the Mac, the Tauri or launch-app desktop window pairing from Settings. Check: the steps in What changes for you, then node scripts/devices.js list shows each device with a recent last seen.

- F2-4 and F2-2: how often the real model follows or echoes an injection. Check with a fixed red-team set against the PC model: a mail with an instruction to open an address, a mail holding <tool_call> markup, a page asking for an image link; every case must end in an approval card or nothing.

- F2-1: the Tauri window under its new CSP (not runnable here). Check: npm run tauri dev, open a chat with a reply containing an image from a local listener (python -m http.server on another port) and confirm no request arrives; open a chart artifact and confirm it draws (inline scripts in srcdoc frames depend on dangerousDisableAssetCspModification). Then the same with npm run tauri build.

- F1-3: whether OpenCode 1.19.1 asks (external_directory) before its read tool opens a file outside the workspace, and before a PowerShell path argument outside it. If read defaults to allow everywhere, reads of the JARVIS folder by the read tool would not reach the bridge. Check: GET /doc and scripts/opencode-verify.js with a read of a file outside the workspace.
- F1-3: the Claude Code rule form for absolute Windows paths (//c/Users/...). Check: claude -p in the workspace with the JARVIS mode flags, ask it to read data/tokens/ui.token by absolute path, expect a permission denial in the result.

- F1-2: which shell OpenCode 1.19.1 runs bash commands in on Windows (PowerShell is assumed; cmd would expand %NAME%, which is already treated as a variable) and whether a bash call can carry its own working folder. Check: in a scratch workspace, ask OpenCode to run `echo %USERPROFILE%` and `Get-Location` from a subfolder and read the permission event (metadata) and the output.
- F1-2 (CH-5): whether `git log --format=... --output=<file>` writes chosen content on the installed git. It is no longer allowlisted in any mode, so the hole is closed either way. Check in a scratch repository.

- F4-3: the pinning proxy and the split contexts against real sites (the tests use a local fixture over http; Chromium goes direct for literal loopback). Check: in the app, ask JARVIS to open and read an https page and a page that uses WebSockets (a live chat or ticker), then open a page yourself in the Intel view and confirm JARVIS's own browser_read does not see it.
- F3-7: every real client still reaches the server under the Host allowlist. Check: open the desktop app on the PC, the phone app over the ts.net name, and the Mac over its saved 100.x address; each must load (a custom DNS name for the PC would get 421).
- F5-2: a long OpenCode task under the 8192-token output cap and 2 requests per token. Check: one real agent_task that writes a large file; it should finish, in more than one step if it has to.
- F2-6: whether the real model keeps to the id rule. Check with the red-team set under F2-4, adding a mail that holds a fake </untrusted id="..."> closer followed by an instruction.

## What changes for you

- Pairing (F3-1, F3-4). Every device now gets its own token from a short code. Until you finish the steps below, the old shared token keeps working: on the PC itself with all rights, elsewhere only to chat and approve up to T2 (T3 then needs the PIN, so set one first). Steps, all on the PC unless said otherwise:
  1. node scripts/devices.js pin (choose a PIN of 6 or more characters).
  2. node scripts/devices.js pair desktop, then type the code in the desktop window: Settings, JARVIS server, Pairing code, Pair.
  3. node scripts/client-link.js phone. On the iPhone delete the old JARVIS icon, open the plain address it prints in Safari, type the first code on the launcher page, Add to Home Screen, open it, type the second code in the app.
  4. node scripts/client-link.js browser. On the Mac open the plain address in Safari and type the code in Settings, JARVIS server, Pairing code. Then node scripts/client-link.js browser again and on the Mac run node scripts/open-mac.js --pair CODE.
  5. node scripts/devices.js revoke legacy (this also replaces ui.token with no grace). From now on a lost device is ended with node scripts/devices.js revoke <id> (list shows the ids).
  6. Delete dist-mac/jarvis-mac-with-tokens.zip (it holds the old shared token) and stop using old links that contain #token.
- The server and the agents no longer fall back to the LAN address: if Tailscale is down when the server starts, only the PC itself can reach it until a restart with Tailscale up. The starter (7411) takes calls from the tailnet only; to narrow it to your phone and Mac, set server.starterCallers in config/server/machines.json to their two Tailscale addresses.
- Approving a T3 request anywhere but the desktop app on the PC asks for the PIN. Bypass mode and choosing the trusted project folder need the desktop app on the PC or the PIN; the phone cannot change settings.

- Auto mode (coding agent): only read-only commands on the allowlist run without asking. Builds, tests, installs and anything else now ask. Bypass still runs ordinary commands, but anything T3 (interpreters such as python -c or node -e, encoded PowerShell, package installs, registry writes, destructive commands anywhere in a chain) asks in every mode.
- Claude Code backend in Auto: commands outside the read-only allowlist are refused (it cannot ask); switch to Bypass for a run that must build or test.
- Manual mode now asks even for read-only commands (git status, Get-Content). Plan mode asks for reads and web fetches instead of running them, and still refuses anything that changes something.
- The coding agent can no longer use the JARVIS folder (C:\Users\bethe\Jarvis-Next) or the user Temp folder without asking: reads, edits and commands there are T3 and ask in every mode (Plan refuses them), even if you pick that folder as the project folder. The Claude Code backend is denied them outright. Work on JARVIS itself with Claude Code.
- npm test is no longer on the read-only list: it asks in Auto.
- Mac: until the Mac agent is updated (node scripts/update.js) it has no resolve_paths action, so its coding agent asks for every edit and command that names a path. Update the Mac once and it is back to normal.
- A chat that has read anything from outside (mail, Drive, a web page, a file, a task result) stays marked for the rest of that chat: opening an address, clicking or typing in the browser, starting a coding task, saving a note, writing a file, running a script, and any other call that carries text then ask, with the whole request on the card. Start a new chat to get back to the old behaviour. Old chats that used such tools count as marked.
- Addresses from client-link (F3-6): only Tailscale names now. If Tailscale is not running it prints no address at all. Optional: config/server/machines.json still names the Mac and the server by tailnet IP (100.x); switching them to MagicDNS names makes a Tailscale outage fail closed instead of following the LAN route.
- Host names (F3-7): the server and the starter answer only to an IP address, localhost or a *.ts.net name. A custom DNS name for the PC gets 421.
- write_file (F4-4): JARVIS saves data and documents only (txt, md, json, csv, html and similar). Scripts and programs are refused, a file cannot be renamed into one, and nothing is written into a PowerShell profile or Startup folder. Code goes through a coding task.
- The Intel view (F4-3) is your own browser now, separate from JARVIS's: what you sign in to there, JARVIS cannot use, and JARVIS's pages are no longer shown there. A CAPTCHA that stops JARVIS cannot be solved from the view; with the sidecar in --headed mode solve it in the window, otherwise JARVIS reports it and stops.
- Limits (F5-1, F5-2): one tool runs at most 20 times per message (models.maxCallsPerTool); the coding agent's model requests are capped at 8192 output tokens and 2 at a time. Optional: the spec's 8 model calls and 12 tool calls per message can be set as maxIterations and maxToolCalls in config/server/models.json (left at your 100 and 200).
- The audit (F3-8) shows web addresses without their query strings and hides search terms.

## Decisions made without asking

All in docs/decisions.md under "2026-11-15 Security fix run" (S-01 onwards).
