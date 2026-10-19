You are running one iteration of an unattended build. Read docs/JARVIS_BUILD_SPEC.md, CLAUDE.md, PROGRESS.md, docs/decisions.md and HUMAN_TODO.md.
Follow section 8 exactly: pick the first unchecked step whose dependencies are done, implement it with tests, run npm test, tick it only if everything passes, commit, update the STATUS and LAST_ITERATION lines at the top of PROGRESS.md, then stop.
Do not ask questions. Record judgment calls in docs/decisions.md. If a step needs the user, write exact instructions in HUMAN_TODO.md, mark it [~], and continue with the next independent step.
Never touch files outside this project. Never run sudo. Never weaken the gate, policy, audit log or auth to make a test pass.
Style: direct, no filler, no em dashes.
