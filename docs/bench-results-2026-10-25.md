# Qwen3.8-27B (UD Q3_K_XL) vs Qwen3-Coder-30B-A3B (Q4_K_M): results of 2026-10-25

Machine: Ryzen 7 7800X3D, RX 9070 16 GB, 32 GB RAM, LM Studio with llama.cpp ROCm 2.64.0. Scripts: `scripts/bench-coding.js`, `bench-tune.js`, `bench-agent.js`, `bench-speed.js`, `probe-*.js`. Original LM Studio settings: `docs/lmstudio-settings-backup-2026-10-25/` (put back with `node scripts/bench-speed.js --model <key> --restore`).

## Verdict (two sentences)

Pick the 27B with thinking off and MTP (2 draft tokens): in real OpenCode runs it passed 8 of 8 tasks in 43 s each, against 7 of 8 in 150 s for the best Coder setup, and it writes 47 to 50 tokens/s at 64k context. Its weakness is occasional broken files in single-shot answers (about 4 runs in 10 lose a whole task on the plain coding suite), which an agent loop that runs the code fixes, while the Coder is steadier in single-shot but about 3.5 times slower per task and holds a RAM margin of only about 1 GB.

## What controls thinking on the 27B (LM Studio)

| Method | Effect |
|---|---|
| `reasoning_effort: "none"` as a top-level request field | Works: 0 thinking tokens. Used for "thinking off". |
| `chat_template_kwargs.enable_thinking: false` (what JARVIS sent before) | No effect. |
| `reasoning_effort` low or medium, `reasoning_budget`, `thinking_budget`, `max_reasoning_tokens`, a "think briefly" line | No visible effect: still thinking after 80 s and about 4,000 tokens, same as default. |
| Thinking budget in the model's default settings (`llm.prediction.reasoning.budgetTokens`, same as the UI checkbox) | Works for API requests too: thinking ends after N tokens and the answer starts. |

Thinking budget on the plain coding suite (2 runs each): 500 tokens 91.5 (20 s per task), 1000 tokens 92.5 (30 s), 2000 tokens 99.0 (54 s), thinking off about 97 (13 s). On the OpenCode tasks every budget variant fixed every repo but took 169 to 190 s per task against 41 s with thinking off, so thinking buys nothing on tasks this size.

## Single-shot coding suite (5 hard tasks, hidden tests)

| Setup | Runs /100 | Mean | Seconds per task |
|---|---|---|---|
| 27B, thinking off, temp 0.3 | 99, 100, 83 (and 97, 99, 99, 99, 99, 84 in the tuning runs) | about 94 | 13 to 14 |
| 27B, thinking off, temp 0.3, plus the one-line syntax reminder | 99, 97, 93, 98, 98, 100 | 97.5 | 13 to 14 |
| Coder, vendor sampling | 87, 96, 90 (and 94, 97) | 91 to 93 | 6 to 7 |
| 27B, effort low or medium | 20 | timed out on every task | 120 to 300 |

The 27B loses a whole task (16 to 20 points) in about 4 runs of 10 because the file does not load (for example `module.exports = { async function ... }`) or one case hangs. The Coder keeps failing the same topoSort tests in about half its runs. Coder tuning (temperature 0.3 or 0.5, repeat penalty 1.0, an extra checking line) did not beat the vendor values.

## OpenCode agent benchmark (real OpenCode 1.19.1, 4 small repos, strict grading, 2 repeats)

| Variant | Mean score | Fully passed | Seconds per task | Requests per task |
|---|---|---|---|---|
| 27B, thinking off, MTP 2 | 100 | 8/8 | 43 | 8.9 |
| Coder, 10 expert layers on CPU, batch 1024 | 98.6 | 7/8 | 150 | 18.8 |

First pass with the looser grader (tests the agent added were counted): Coder with 14 expert layers 191 s, 27B budget 2000 169 s, 27B budget 1000 190 s, all passing every repo. Details in `bench-agent-2026-10-25.md` and `bench-agent-2026-10-25-strict.md`.

## Speed and memory (32k context unless stated)

| Setup | Generation tok/s | Prompt tok/s | VRAM / shared / RAM free |
|---|---|---|---|
| 27B, no MTP | 29.7 | 932 | 15.0 / 1.4 / 6 to 8 GB |
| 27B, MTP 2 | 51.2 | 924 | 15.3 / 2.5 / 4 to 6 GB |
| 27B, MTP 3 | 48.8 | 919 | same |
| 27B, KV q4_0 | 30.6 | 997 | no speed gain, rejected |
| 27B, MTP 2, 64k | 47.1 | 442 | 15.3 / 4.1 / 4 to 6 GB |
| 27B, MTP 2, 128k | 48.8 | 434 | 15.6 / 6.5 / 1.6 GB, too tight |
| Coder, 14 expert layers on CPU | 44.6 | 937 | 14.7 / 1.9 / 2 GB |
| Coder, batch 1024 | 46.6 | 1004 | same |
| Coder, 10 expert layers on CPU | 50 to 51 | 583 | 15.6 / 1.5 to 2.3 / 1.5 to 2.4 GB |
| Coder, KV q4_0 | 40.7 | 556 | slower, rejected |
| Coder, 10 expert layers, 64k | 52 | 631 | 15.6 / 4.0 / 1.1 GB |

KV cache q8_0 stays for both models: q4_0 gave no speed to the 27B and slowed the Coder.

## Recommended settings

27B, saved in LM Studio's remembered settings for `unsloth/qwen3.8-27b` (a plain `lms load unsloth/qwen3.8-27b -y` loads exactly this, checked):
- Context 65536, GPU offload max, flash attention on, KV cache K and V q8_0, 8 threads, batch 512, one slot.
- Speculative decoding MTP on, max draft tokens 2, min 0.
- Thinking budget off. JARVIS requests: `reasoning_effort: "none"` (the `request_field` thinking method in `models.json` with all uses false), temperature 0.3, top_p 0.95, top_k 20, min_p 0, presence 0, repeat 1.0. For code files in one shot add the line: "Before you reply, check the file is valid JavaScript that runs as written: define every function with a normal declaration before assigning module.exports, and make sure every promise settles."
- Keep 64k. 128k leaves 1.6 GB of RAM free, which is too little with other programs open.

Coder (alternative): context 32768 or 65536, KV q8_0, batch 1024, 10 of 48 layers' experts on CPU (ratio 0.2), 8 threads, experts 8; temperature 0.7, top_p 0.8, top_k 20, min_p 0, repeat 1.05, presence 0.

## Not covered

Larger real projects, long multi-file sessions, and the Coder with a separate draft model. Runs are 2 repeats on four small tasks, so differences of a few points are noise; the time gap (43 s against 150 s) is not.
