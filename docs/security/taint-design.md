# The tainted-chat rule

Code: `server/core/taint.js` (pure, no imports). Tests: `tests/unit/sec-b-taint.test.js`. Closes F2-2, F2-5, CH-4 and CH-6; replaces the stage-A `ASK_WHEN_TAINTED` flag.

## Threat

Tool results reach the model wrapped as untrusted, but a mail, a Drive file, a web page or a task summary can still steer it. T0 and T1 tools run unasked, so one injection could send inbox text out in the path of an address (`browser_navigate`), plant a note in every later system prompt (`remember`), or start a coding task. The injected text stays in the chat history, so the danger does not end with the turn.

## Rule

1. A chat becomes tainted when a tool result that is not known to be clean comes in.
2. In a tainted chat, a call that can carry data out, store text for later or start something asks the person, whatever its tier, and the card shows the full arguments.
3. Taint is kept on the conversation and never clears by itself.

Both lists name what is safe. A new or unknown tool taints, and asks when it carries text.

## What taints (`taintOf`)

Everything except the `CLEAN` set: volume, display, power, the hardware readings, `open_app`, `open_workspace`, `list_action_categories`, and JARVIS's own stores (timers, reminders, notes). So `google_*`, `microsoft_*`, every `browser_*`, `agent_task`, `run_user_script`, file and folder reads, git output, clipboard, window titles and Wi-Fi names all taint.

- A failed call taints like a successful one: its error text comes from the same place as its result (a page, a script's output, a remote service).
- A call the router refused, the person denied, or that was queued does not taint: it never ran and the text is the router's own.
- The stores are clean because writing to them asks once a chat is tainted, so what they hold was typed or approved by the person.
- Task notes and coding-agent replies are appended outside the tool loop. The code that appends them must mark the chat (wiring step 4).

## What asks (`askWhenTainted`)

- Addresses: `browser_navigate`, `open_url`. They ask unless the address is `https` and its host is on `policy.json` `browser.allowDomains` (the host or a subdomain, as the browser guard matches). Default: empty, so every address asks.
- Always: `browser_click`, `browser_type`, `browser_press` (they can submit or move data on someone else's page), `agent_task`, `remember`, `write_file`, `run_user_script`.
- Everything else that carries any text argument, unless it is in the `QUIET` set: reads of the person's own Google and Microsoft accounts, local read-only file and git actions, and names checked against a config file (`open_app`, `focus_app`, `open_workspace`, `set_audio_output`). This catches, without naming them, `ping` (data in a host name), `set_reminder` and a labelled `set_timer` (text shown later), `set_clipboard`, `show_notification`, `forget`, `open_file`, `wake_on_lan`, `start_dev_server`, and anything added later.
- Stays automatic: calls with no text (`browser_read`, `browser_back`, `set_volume`, `lock_screen`) and the `QUIET` reads.

The test file holds the full list of actions that may carry text unasked; adding one is a reviewed change.

## What the person sees

`{ reason, show }`. `reason` is one line. `show` is every argument in full, never clipped; for an address the first two lines are `Address: <as given>` and `Host: <parsed host>`, so `https://bank.example@attacker.example/` cannot pass as the bank. Control and direction-changing characters are written out as `\u202e`. `show` has line breaks: the card must render them (`white-space: pre-wrap`) and must not clip.

## Persistence and reset

State is `conv.taint = { tainted, reason, at }`, saved with the conversation. `reason` and `at` record the first cause.

Taint is sticky. It is not cleared at the end of a turn, when old messages fall out of the context window, or after any number of clean turns: the model's own replies can repeat what an injection told it, so no message count proves the history is clean. A new chat starts clean. `clearTaint` exists for one caller only, a control the person presses themselves; no such control exists yet and none is needed for this run. The cost of sticky taint is extra approval cards in that chat, never a blocked feature.

## Scheduled jobs, resumed turns, digest

- Scheduled (`source: 'scheduled'`): nobody can answer, so a taint ask is a deny, not queued. A future scheduled job that runs the model with tools must keep its own state for the run, starting clean, and mark it the same way.
- Resumed turns (`source: 'agent'`): policy already asks for everything. The router still uses `reason` and `show` for the card, and the task note marks the chat tainted for the turns that follow.
- Digest: tools are off and its output goes to no conversation. Nothing to do. If digest text is ever appended to a chat, mark that chat with `markTainted`.

## Migration

`stateOf(conv)` returns the stored field; when there is none it derives the state from the stored messages (`stateFromHistory`): tainted if any message is a tool result of a non-clean tool, a system message (task notes; a machine-switch notice also counts, which only costs approvals in old chats), or unreadable. An empty chat is clean, so new chats need no special case. A malformed field counts as tainted.

## Not covered

- Clicks ask even on a trusted page: the module does not know which page is open. Passing the current page host to `askWhenTainted` would allow an exemption.
- A subdomain or a path on an allowlisted host that a stranger can read (a form endpoint, a shared document) is still a way out. Keep `allowDomains` to hosts where nobody else sees the request.
- Numbers are not counted as data. A tool that sends something with no text argument must be T2 or higher, or be added to `ALWAYS`.
- What the model writes in its reply (remote images are F2-1), and what the coding agent does inside a task (the permission bridge).
- Text the person pastes or types is theirs and does not taint.
- Old chats answered directly by Claude Code hold its reply as a plain assistant message; the migration cannot see that. New ones are marked (step 4).
- Notes saved before this fix. F2-5's wrapped block and undo cover those.

## Wiring (driver)

1. `orchestrator.js`: delete `let tainted` and the line that sets it. In the ctx of every `router.invoke` pass `tainted: isTainted(stateOf(conv))`, read fresh per call. After the call: `const why = taintOf(c.name, r); if (why) conv.taint = markTainted(stateOf(conv), why, now().toISOString());` before the tool message is appended (append saves).
2. `tool-router.js` `invoke`, after validation: `const taintAsk = ctx.tainted ? askWhenTainted(call.name, args, { allowDomains: cfg.policy.browser.allowDomains }) : null;`. Pass `taintAsk` to `policy.decide` in place of `tainted`. When set, `summary` is `` `${call.name} on ${tag(target)}. ${taintAsk.reason}\n${taintAsk.show}` `` instead of `brief(args)`. Check the config key name against the loader.
3. `policy.js` `decide`: remove `ASK_WHEN_TAINTED`. With `taintAsk` set: `source === 'scheduled'` returns `{ mode: 'deny', queueable: false, reason: 'tainted and nobody is there to approve' }` before the tier rules; in chat, `auto` becomes `ask` with `reason: taintAsk.reason`, including when `policy.json` forces `auto`. The `deny` override still wins.
4. `agent-tasks.js` `finish`: on both branches that append to a conversation (the direct reply and the note), first `conv.taint = markTainted(stateOf(conv), 'agent task note', t.endedAt)`.
5. `conversations.js` `get`: `c.taint = stateOf(c)` after loading, so old chats are migrated once. `create` needs nothing.
6. Clients: the approval card shows `summary` with line breaks and without clipping (desktop `server-ui.js`, mobile approvals sheet).
7. Callers with no conversation (`ws.js` direct calls by the person, the telemetry job) pass no `tainted` and are unaffected. Any new caller that lets the model choose the call must pass it.
