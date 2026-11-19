# Review round 1 (self review, not independent)

The spec asks for review sessions that did not write the code. None was available in this unattended run, so this is the author's own pass against the section 9 checklist, with regression tests for what it found. It does not replace an independent scan: run `scripts/scan-prompt.md` in a fresh session.

## Found and fixed
- **medium** A client that disconnected mid-utterance was still transcribed and its message run (`server/api/ws.js` called `voice.stop` on close). Now `forget()` bumps the epoch; regression test in `tests/integration/p9-voice.test.js`.
- **medium** Host and user names from the OS went into the system prompt unfiltered (injection and template risk). Now flattened to one short plain line; test in `tests/integration/p4-routing.test.js`.
- **medium** A file-clearing test touched the real temp folder. Now injected; `clear_temp_files` also defaults to a dry run.
- **low** The task state changed before the changed-file list was ready; now last.

## Checked, no finding
- No import path to an agent except through `tool-router` (scanner plus test); no string-built commands (scanner); the model cannot name a target (key scan, tested) or switch it (`target-state` insists on `ui` or `voice`).
- T3 is never automatic and scheduled jobs never run T3 whatever `policy.json` says (tested). Replies to the gate: only approve or deny; a replayed id is refused; a timeout denies.
- OpenCode: only `once` or `reject` can be built; the direct shell route has no code path (static test, proxy test, agent test); a restart voids in-flight approvals (tested).
- Audit chain: edits, removals, truncation and a torn last line are detected or repaired as specified; redaction by key meaning and by value shape.
- Auth: constant-time compare, failures-only limiter, origin check, UI token cannot use `/v1`, agent tokens cannot use `/api`, the query string is never a credential.

CRITICAL_HIGH_COUNT: 0

`npm audit --omit=dev`: 2 low (mermaid, katex) in the old app's dependencies.
