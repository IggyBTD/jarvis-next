# Benchmarking Qwen3.8-27B against Qwen3-Coder-30B: handoff for a new session

Written 2026-10-27 for a Claude session that has no memory of the work. Read this first, then the result files named below. Style rule for this repo: direct text, no filler, no em dashes.

## The question

JARVIS Next codes with one local model on the PC through LM Studio. Two candidates were compared for coding and agent (OpenCode) work:

- **Qwen3.8-27B**, `unsloth/qwen3.8-27b`, UD Q3_K_XL (dense, about 14 GB). Fast with MTP speculative decoding, but it thinks for a very long time by default.
- **Qwen3-Coder-30B-A3B**, `qwen/qwen3-coder-30b`, Q4_K_M (MoE, about 18 GB). Does not fit in 16 GB of video memory, so some expert layers run on the CPU.

Machine: Ryzen 7 7800X3D, RX 9070 with 16 GB, 32 GB RAM, Windows 11, LM Studio with llama.cpp ROCm 2.64.0. LM Studio listens on :1234.

## Outcome (already applied)

The 27B with thinking off and MTP (2 draft tokens) won. Numbers and the full tables are in `docs/bench-results-2026-10-25.md`. In short:

- Real OpenCode runs on 4 small repos: 27B 100 percent, 8 of 8, 43 s per task. Best Coder setup 98.6 percent, 7 of 8, 150 s per task.
- Single-shot hard coding suite: 27B about 94 on average (97.5 with a one-line syntax reminder), Coder 91 to 93. The 27B loses a whole task in roughly 4 runs of 10 because the file does not load; the Coder keeps failing the same topoSort cases.
- Speed: 27B with MTP 2 writes 47 to 51 tokens/s at 32k to 64k context. Coder with 10 expert layers on CPU writes 50 to 52 tokens/s but needs about 1 GB of RAM margin.
- `config/server/models.json` points at the 27B with `reasoning_effort: "none"` (all uses off), temperature 0.3, top_p 0.95, top_k 20, context 65536, MTP on. LM Studio's remembered settings for the 27B hold the load settings. The chosen model is persisted in `data/active-model.json`.

## What was run, and how

Everything lives in `scripts/`. The runs were done one model at a time with everything else unloaded, because two models compete for VRAM and give false speed numbers.

| Script | What it does |
|---|---|
| `bench-coding.js` | Single-shot suite. For each model: unload all, load it through LM Studio's native API, run 3 code tasks (the reply's code is executed against hidden test cases in a child process with a time limit) and 1 tool-call task (valid calls, names, arguments). 25 points per task. Speed is reported next to the score, never mixed in. Reloads the previous models at the end. |
| `bench-hard-tasks.js` | The harder suite used by `bench-coding.js` and `bench-tune.js`: precedence parsing, graph cycles, async concurrency, minimal diff, a four-bug fix. `REFERENCE` holds known-correct solutions, used only by grading tests. |
| `bench-tune.js` | Varies only what each request sends (reasoning effort, a brevity line, sampling, output cap) on the hard suite. Load settings are LM Studio's. |
| `probe-thinking.js`, `probe-think-limit.js` | Find which request field really shortens the 27B's thinking, and how long it thinks before answering (cut off after a cap). |
| `bench-agent.js`, `bench-agent-tasks.js` | Agent benchmark. The real OpenCode CLI works on small repos against the model, through a logging proxy that applies each variant's request settings. Score per run = visible plus hidden tests passed / total. Hidden tests are written after the agent stops. Tasks: fix-cart, implement-slugify, rename-format, fix-lru. `tests/unit/p13-bench-agent.test.js` proves each reference fix passes and each start state fails. |
| `bench-speed.js` | Loads a model with given context, KV cache type, MoE expert layers on CPU, batch size and MTP, then measures generation and prompt tokens/s and memory. |
| `bench-model.js` | Time to first token and tokens/s through `llm-client` (the path the server uses). |

Variants and settings tried: thinking off, effort low and medium, thinking budgets of 500, 1000 and 2000 tokens, temperature 0.3 to 0.7, the 27B with and without a syntax-reminder line, Coder with 10 and 14 expert layers on CPU, batch 512 and 1024, KV cache q8_0 against q4_0, context 32k, 64k and 128k, MTP off, 2 and 3.

## Findings worth knowing before you repeat any of it

- **Thinking control on LM Studio.** Only a top-level `reasoning_effort: "none"` turned thinking off. `chat_template_kwargs.enable_thinking: false` (what JARVIS sent before) did nothing. Low and medium effort, `reasoning_budget` and a "think briefly" line did not shorten it: 20 out of 100 on the hard suite, every task timed out. A thinking budget set in the model's default settings does work (it is the same as the UI checkbox), but on tasks this size thinking bought nothing and cost 4 times the time.
- **The 27B's failure mode** is a whole broken file in single-shot answers. An agent loop that runs the code repairs it, which is why the agent benchmark scored 100.
- **The score of 83** seen once for the 27B was an outlier of this kind, not a trend. It was tested by adding a one-line syntax reminder; the six reminder runs scored 93 to 100.
- **KV cache q4_0** gave the 27B no speed and slowed the Coder. q8_0 stays.
- **128k context** leaves only 1.6 GB of RAM free on this machine. 64k is the limit.
- **MTP** is a load setting in LM Studio, not a request field. `mtp.enabled` in `models.json` is documentation only.
- Differences of a few points are noise (2 repeats, 4 small tasks). The time gap (43 s against 150 s) is not.

## Gotchas when running benchmarks here

- **Keep the PC awake.** A sleeping PC crashed the ROCm backend mid-run. After a wake the fix was to run again; if ROCm keeps failing, Vulkan was the fallback.
- **`bench-speed.js` edits LM Studio's remembered per-model config** (KV type, expert layers, batch) so that a load picks it up. Originals are in `docs/lmstudio-settings-backup-2026-10-25/`. Restore with `node scripts/bench-speed.js --model <key> --restore`. A sweep once left test flags loaded; reload the model with its saved config afterwards.
- **Do not run the benchmark while the app is switching models.** The app no longer switches models by itself (removed 2026-10-26), but picking a model in the menu still unloads the others.
- **Tests pin their own thinking policy** (`tests/helpers.js`, p2-model, p7-digest), so they do not depend on which model `models.json` names. The fake model in `tests/mocks/fake-model.js` implements LM Studio's native API.
- Long runs go in the background; do not poll them. A full agent run takes 5 to 10 minutes per variant.
- OpenCode reads `~/.claude/CLAUDE.md` and skills into its system prompt unless `OPENCODE_DISABLE_CLAUDE_CODE=1` is set (it is set in the agent's launch environment now). With them it cost about 21k tokens of fixed prompt; without, about 10k.

## Where the evidence is

- `docs/bench-results-2026-10-25.md`: the verdict, all tables and the recommended settings.
- `docs/bench-agent-2026-10-25.md`, `docs/bench-agent-2026-10-25-strict.md`: per-run agent results, loose and strict grading.
- `docs/bench-coding-2026-10-24.md`, `bench-coding-hard-2026-10-24.md`, `bench-coding-hard-2026-10-25*.md`: single-shot runs.
- `docs/tune-27b-2026-10-25-medium_nonebrief_nonetemp03.md`, `docs/tune-coder-2026-10-25.md`: tuning runs.
- `docs/MODEL_TUNING_PLAN.md`: the plan the work started from.
- `docs/decisions.md`: why `models.json` looks the way it does.

## Not covered

Larger real projects, long multi-file sessions, the Coder with a separate draft model, and any comparison with the Claude Code backend added on 2026-10-27 (`docs/decisions.md`). If you extend this, add a `claude` variant to `bench-agent.js` that runs the same four repos through `agent/sidecars/claude-manager.js`, and keep the grading identical.
