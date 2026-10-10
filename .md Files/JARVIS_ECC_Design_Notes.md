# JARVIS: Design Notes from the ECC Review

Date: 2026-10-03. Source: a read-through of `affaan-m/ECC` (formerly everything-claude-code, MIT), cloned at `C:\Users\bethe\everything-claude-code`. Nothing from it was installed or run.

This file holds only what is **new**. Anything the roadmap or CLAUDE.md already plans (skills system, project memory, auto-memory, confirm-before-submit, audit logging, action registry, parallel sub-tasks, sidecars) is not repeated as an item; it appears here only where ECC adds a concrete design that those entries lack. Each section says which roadmap item it plugs into.

How sure each part is: sections 1 to 8 were checked against the source files named in them. Section 9 onward leans partly on subagent summaries, and those spots are marked "unverified".

**Status (2026-10-03):** sections 1 (memory vault), 2 (instincts) and 11 (HUD unavailable state) are built, see `JARVIS_Progress.md`. Sections 3 to 10 are still design only. Differences from this text as built: the memory scopes are `project` and `user` only; habits start at confidence 0.7 and are created only with `/habit`; the vault root defaults to `<project>/memory`.

## 0. What was deliberately left out

ECC is built for Claude Code, a very large model with a large context. JARVIS runs 14B to 27B local models with 32K contexts, so most of ECC's content is too heavy to load as is. Not adopted: the 293 skills (about 100 are per-language duplicates), the 68 agent prompts (each repeats a 1 KB injection-defence block), the installer and its hooks (it rewrites `~/.claude/settings.json`), the observer that feeds tool activity to a model every five minutes, the auto-updater that runs pulled code, the mandatory 80% coverage rule, and the sponsor and paid-tier material. Its own cost-saving figures (for example "Sonnet handles about 80% of tasks") cite no source and are not used here.

## 1. Memory vault

Plugs into: roadmap "Project memory file" and "Auto-memory equivalent". Source: `docs/design/ecc-memory-vault.md`, `scripts/lib/memory-vault-format.js`, `skills/unified-memory/`.

The roadmap says memory should exist but not what a memory is. ECC's design is the best part of the repo, and it fits a local app well because it needs no database, network or embeddings.

**Rules to adopt**

1. **Markdown files are the source of truth.** Any index (SQLite, embeddings) is rebuildable and never the only copy. A person can open the folder and read or fix everything.
2. **A memory is context, never an instruction.** Recalled text is wrapped and labelled as untrusted data before it reaches the model, and it can never authorise an action. This is the single most important rule for a model that will also read email and web pages.
3. **Create-only writes.** A memory id is never overwritten. A correction is a new file that links to the old one, and the old one is marked superseded. This gives history for free and removes a whole class of corruption.
4. **Secret scan before write.** Known credential shapes and private keys are rejected before a file is created. It is a backstop, not a classifier, and the docs say so.
5. **Bounded everything.** Body size cap (ECC: 64 KB), file count cap (5,000), bounded lexical search, bounded injection (below).
6. **Never auto-promote.** A memory cannot turn itself into a rule, skill or policy. Promotion is a human decision into the governed files (CLAUDE.md, `skills/`, `config/`).
7. **Incomplete scans fail loudly.** If a scan was truncated or hit a malformed file, "not found" and "no duplicates" are not claimed. The tool returns an "incomplete" error and no partial content. A malformed file is reported and never deleted or rewritten.
8. **No symlink following** in the vault, and the vault root is writable only by the user.

**Proposed file format for JARVIS** (adapted from `ecc.memory.v1`, frontmatter kept strict and small):

```markdown
---
schema: jarvis.memory.v1
id: mem_20261003_ab12
title: Prefers LM Studio JIT loading off
kind: preference        # context | decision | fact | handoff | lesson | note | preference | runbook
scope: user             # project | user   (a team scope is not needed for a single-user app)
status: active          # active | superseded | rejected
source: chat            # chat | skill | manual | import
tags: [lmstudio, models]
links: [mem_20260920_cd34]   # supersedes / relates to
created_at: 2026-10-03T14:00:00Z
---
Body text, plain markdown, under 4 KB for JARVIS (small contexts).
```

**Layout:** `memory/project/<kind>/` and `memory/user/<kind>/`, next to `skills/`, loose files, git-ignorable. User-scope memories are recalled only when the user asks or the task clearly needs them (ECC's rule: user scope is explicit-only).

**Injection to the model:** at session start inject at most a small, fixed budget (ECC defaults to 8,000 characters and has a switch to turn it off). For JARVIS, start with 2,000 characters, ranked by project match, then tags, then recency, behind a config flag. Always inside a block labelled as recalled data.

**Where to build it:** file operations and path safety in Rust (`src-tauri/src/memory.rs`, with root-boundary and symlink checks, the pattern in ECC's `lib/path-safety.js`), exposed as Tauri commands, with a thin `core/memory-client.js` in the frontend following the existing client pattern.

## 2. Instincts (the auto-memory part)

Plugs into: "Auto-memory equivalent". Source: `skills/continuous-learning-v2/SKILL.md`.

ECC separates two things the roadmap lumps together. **Memories** are facts and context. **Instincts** are small learned behaviours with a trigger and a confidence. The instinct record:

```yaml
id: prefer-short-answers
trigger: "when answering a casual question"
action: "keep the reply under 5 sentences"
confidence: 0.7        # 0.3 tentative, 0.9 near certain
domain: style          # style | coding | finance | workflow | ...
scope: project         # project or global
evidence: [mem_..., "user corrected length twice on 2026-10-02"]
```

Rules worth keeping: one trigger and one action per instinct; confidence rises when the user confirms and falls when contradicted; project scope is the default so habits from one project do not leak into another; promotion to global needs the same instinct in several projects at average confidence 0.8 or higher, and a human approves it; inject only a handful (ECC: at most 6, confidence 0.7 or higher, ranked by project and stack relevance).

For JARVIS: store each instinct as one short line or tiny file, load the top few by confidence and scope into the system prompt, and make creation an explicit, visible step ("save this as a habit?") before any background learning exists. Skip ECC's observer (a model reading every tool event); it adds cost and exposes raw tool input and output, redacted only by regex.

## 3. Skills tuned for small models

Plugs into: "Skills system core". Sources: `docs/design/context-profiles.md`, `skills/context-budget/SKILL.md`.

The roadmap says "description-based routing, content injection". ECC supplies the measurements and a cheap router shape:

- **Two layers.** A small always-loaded **index** (name plus one-line description per skill) and **bodies loaded on demand**. ECC's lean profile keeps three skills eager and routes the rest.
- **Budget the index.** ECC estimates metadata cost as UTF-8 bytes divided by 4 per entry, summed, and rejects over 8,000. For JARVIS pick a lower figure (start at 1,500 tokens) and fail the build if the index exceeds it. ECC itself calls this a regression gate, not a tokenizer, so measure real token counts with LM Studio as well.
- **Size limits.** Description at most 30 words (ECC's own bloat threshold), written as "Use when ... Skip if ..." so the model can decide cheaply. SKILL.md body under about 1.5K tokens (ECC's median is about 2K and it flags files over 400 lines). Longer material goes in `references/` and is read only when the skill asks.
- **Token arithmetic to reuse:** words times 1.3 for prose, characters divided by 4 for code, and about 500 tokens of overhead per tool schema (so a tool-calling surface costs real context; keep the exposed tool list short).
- **Explicit dependencies only.** ECC records skill dependencies in one declared field and refuses to infer them from prose. A skill that needs a file declares it as a required resource, and the loader checks it exists.
- **Provenance.** Hash the skill body and resources (sha256) and record it, so an edited skill is detectable and a log entry can say exactly which version ran.
- **Router evaluation.** Do not trust a router by feel. ECC's evaluation design: about 30 tasks with hidden graders, each run in a fresh workspace, with the order of conditions rotated across runs. Use the same shape to test whether the router picks the right skill on the Qwen models, and compare against loading nothing.

## 4. Effect classes for the action registry

Plugs into: "OS control / agent actions" and the confirm gate. Source: `docs/architecture/eval-harness-frameworks.md`.

CLAUDE.md says every action goes through a fixed registry and confirm gate but does not grade actions by consequence. ECC grades every tool declaration:

| ECC | JARVIS name | Meaning | Gate |
|---|---|---|---|
| SE0 | read | Read-only, no side effects | Allowed, logged |
| SE1 | local-write | Reversible writes inside JARVIS's own work folder | Allowed, logged |
| SE2 | local-mutate | Changes files, processes or settings outside the work folder | Confirm |
| SE3 | publish | Sends or posts something outward (email, message, upload) | Confirm with exact content shown |
| SE4 | money-or-secrets | Payments, trades, credentials, anything touching a counterparty | Always confirm, never automatable, disabled in dry-run |

Rules: every entry in `config/actions.json` carries a class; **a declaration is not a permission** (the registry in Rust enforces it, and the model's claim about an action's class is ignored); a dry-run or replay mode refuses SE3 and above regardless of what else is configured; and the class is written into every audit entry. Classes only ever go up when an action is composed from smaller ones (the maximum wins).

## 5. Approval bound to the exact content

Plugs into: confirm-before-submit, email triage, Office save-over. Source: `skills/operator-approval-loop/SKILL.md` and `references/approval-ledger.sql`.

A plain "yes" is not enough once drafts can be edited or two workers exist. ECC's contract, adapted:

1. When the model drafts an outbound action, store the exact text and its **sha256**. The approval panel shows the hash prefix and the exact text.
2. Each draft has an **epoch** (a version counter). An approval records the epoch it was given against. Editing the draft advances the epoch, so an old approval can never release the new text.
3. Approving writes an **immutable snapshot** (text, hash, epoch, destination). Dispatch uses only the snapshot, never a re-read of the editable draft, and never regenerated text.
4. A **claim** with a random token reserves the send. At most one active claim per approved action. Dispatch moves claimed to dispatching to delivered.
5. If the process dies mid-send or the result is unknown, the claim becomes **unknown** and stays blocked. It is never retried automatically. A person reconciles it with evidence. "No receipt" is not proof that nothing was sent.
6. The guarantee is **one automatic attempt per approval**, not exactly-once delivery. That is the honest guarantee for email, and JARVIS should state it that way.
7. Internal notices (filing, approval status, hashes) never go to counterparty-visible channels.
8. **A gate that cannot check must say so.** If a check was unavailable, the draft is stamped as such and the panel shows it. A failing guard never silently turns off.

For JARVIS this is a small SQLite table plus a Rust module, built with the action registry rather than retrofitted.

## 6. Audit log

Plugs into: "Audit logging for every action". Sources: `docs/architecture/eval-harness-frameworks.md`, and (unverified, from a subagent summary) `scripts/hooks/governance-capture.js` and `ecc2/src/observability/mod.rs`.

- **Append-only NDJSON**, one JSON object per line, each entry carrying the **sha256 of the previous entry** so tampering is detectable. A `verify` command re-walks the chain and reports the exact entry where it breaks. Cheap, human-readable, no database needed.
- Entry fields: time, actor (user, model, skill), action name, effect class (section 4), input summary, files touched, approval id, result, risk score. Entries record what was **read** as well as what was changed, as the roadmap requires.
- **Never log raw bodies or secrets.** Log a summary and a content hash. Redact known secret shapes before writing.
- **Risk score** per action (ECC2 computes one per tool call and keeps thresholds). For JARVIS a simple table is enough: base score from the effect class, plus bumps for paths outside the work folder, wildcard deletes, or external recipients.
- The log is itself protected: the model has no tool that can write to it, edit it or delete it.

## 7. Declarative policy file

Plugs into: action registry and confirm gate. Sources: `skills/hookify-rules/SKILL.md`, `skills/safety-guard/SKILL.md`.

Beyond the fixed registry, a **policy file** of small rules that warn or block, edited without recompiling. ECC's format is markdown files with frontmatter: `name`, `enabled`, `event` (bash, file, prompt, stop), `action` (warn or block), and a `pattern` or a list of `conditions` (`field`, `operator` such as regex_match, contains, starts_with, `pattern`), with all conditions required. The body is the message shown to the model.

Useful for JARVIS: rules like "block any write outside the work folder", "warn on paths matching `.env` or `.ssh`", "block shell-like strings in action arguments". Three **modes** from safety-guard are worth copying: **careful** (confirm destructive patterns), **freeze** (writes allowed only inside one directory), and **guard** (both, with read-everywhere allowed). Rules are enforced in Rust before an action runs and fail closed; the model never sees a way to disable them. ECC logs every blocked action to a log file, which maps onto section 6.

## 8. Fact-forcing check before risky actions

Plugs into: planning-first execution and the Coder model. Source: `skills/gateguard/SKILL.md`.

Idea: self-review ("are you sure?") does not work on language models, but a demand for concrete facts does. Before the first edit of a file, the first new file, or a destructive command, the gate **denies**, **names the facts to present** (what imports this file, what public functions change, the data fields touched, the user's current instruction quoted verbatim), then **allows a retry** once they appear.

Caveat: the reported gain (+2.25 points on a 10-point scale) comes from the author's own A/B test with two tasks. Treat it as a hypothesis, and test it on the Qwen coder model with the evaluation shape from section 3 before relying on it.

## 9. Rules for agents and loops (parallel sub-tasks)

Plugs into: "Parallel sub-task dispatch" and "Planning-first execution". Sources: `rules/common/agents.md` (read directly); the rest from subagent summaries (unverified details).

- **Delegation completion contract** (verified): a sub-task's final message is its deliverable; a parent that spawns children owns collecting their results and must not end its turn while they run; only split work that cannot fit one context. ECC added this after children were orphaned.
- **Loop stop conditions** (unverified): stop on no progress across two checkpoints, on the same failure repeating, or on budget drift; roll back to the last checkpoint.
- **Reviewer prompts** (unverified): require each finding to cite a line and name the failure mode, justify severity, and treat "zero findings" as a valid answer. This cuts noise from small models. Keep the evaluator separate from the generator and have it return PASS or FAIL as JSON.
- **Plan with confirmation:** restate the task, assess risk, then wait for explicit confirmation before touching anything. ECC makes this the only confirm gate it has, so JARVIS should extend it to the effect classes in section 4.
- **Plans and handoffs as files:** each phase writes a markdown file the next step reads, so a fresh session resumes from a path, not from chat history. A session summary has three headings: what worked (with evidence), what failed, and what remains.
- **Side questions:** answer a quick question without changing task state, then resume.
- **Recursion guard:** any code that asks a model to summarise a transcript needs a flag so the summary call cannot trigger itself.

## 10. Runtime hygiene (unverified, from the subagent report on `scripts/` and `src/llm/`)

- A tool executor returns a **generic error to the model** and keeps the raw exception only in the log, so errors cannot leak paths or secrets into the prompt.
- Read **bounded input** and fail closed when it is truncated.
- Sidecar HTTP servers bind to **127.0.0.1 only** and have a read-only flag; add a loopback guard that rejects any other origin.
- A **profile switch** for how strict the safety layer is (ECC: minimal, standard, strict) plus a disable list, kept out of the model's reach.
- Path safety: resolve and compare against a root, refuse symlinks, before any read or write.

## 11. A finding about JARVIS itself

ECC's HUD status design says: **missing data renders as "unavailable", never as a healthy default** (`docs/architecture/hud-status-session-control.md`, from a subagent summary). The JARVIS HUD breaks this today: when LibreHardwareMonitor is not running, the panels show `0.0%`, `00°C` and `0.0 GB`, which look like real readings. Change: track "no data for N seconds" in `src/main.js`, show N/A and grey the bars, and show the same state for the model panel. This is small, independent of the rest, and worth doing first.

## 12. Where each item goes in the build order

| Item | Roadmap step it extends | Order suggestion |
|---|---|---|
| 11 HUD "unavailable" state | 1 (telemetry) | Now, a few lines |
| 1 Memory vault, 2 Instincts | 2 (project memory), 19 (auto-memory) | After skills, before voice |
| 3 Skills for small models | 8 (skills core) | With step 8 |
| 4 Effect classes, 5 Approval binding, 6 Audit log, 7 Policy file | 3, 17, 31 | Build together with the action registry, as one chokepoint |
| 8 Fact-forcing check | 4 (planning-first), 10 (Coder tools) | After tool calling works |
| 9 Agent and loop rules | 33 (parallel dispatch) | With step 33 |
| 10 Runtime hygiene | 11 (sidecar decision) | With the first sidecar |

## 13. Open questions and unverified points

- Reads of the ECC hooks and installer were partial (one agent skipped the installer body and read about 10% of the README), so the safety conclusion "no data sent anywhere" rests on searches plus partial reads.
- ECC's quoted benefits (gate quality gain, token savings, "50% fewer tokens") are the author's own or unsourced; none was re-measured here.
- Whether a 14B local model can reliably follow the fact-forcing gate and the confirmation loop is untested. Build the evaluation from section 3 first.
- Where the vault and instincts live relative to git (ECC auto-writes a fail-closed `.gitignore` for project scope) is undecided for JARVIS.
- Whether to expose memory to the model as a tool (search and read only, no write) or inject it automatically. ECC's first release keeps recall explicit and exposes no review or promotion tool; start there.
