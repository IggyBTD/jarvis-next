# Model tuning plan: Qwen3.8-27B (Q3_K_XL) versus Qwen3-Coder-30B-A3B (Q4_K_M)

Written 2026-10-24 for a Claude Code session that will carry it out. Read sections 0 to 3 first; sections 4 to 6 are the work; the appendices hold the benchmark itself (tasks, prompts, hidden tests, grading, code).

Project: `C:\Users\bethe\Jarvis-Next` (branch `jarvis-build`). Machine: Windows PC, Ryzen 7 7800X3D, **RX 9070 16 GB** (AMD, RDNA4), 32 GB RAM, LM Studio on `http://127.0.0.1:1234`. The owner wants the best possible coding and agent-tool-use model for JARVIS (chat plus OpenCode coding agent plus tool calls), without long silent waits.

Confidence tags used below: **[doc]** stated in vendor or tool documentation I read; **[user]** reported by users in forums or blogs; **[mine]** my inference, test it.

---

## 0. The short version

1. The first benchmark said the 30B Coder won 97 to 50, and a harder one said 92 to 20. **The second result is a latency result, not a quality result.** The 27B timed out (150 s) on every hard task because it spends thousands of tokens thinking before it writes code.
2. **Root cause found:** Qwen3.8-27B thinks at `reasoning_effort = xhigh` by default. [doc: Unsloth Qwen3.8 page, Qwen model-card threads] One user measured 22,276 reasoning tokens (21 minutes) for a task that took 137 s with thinking off. [user: zentor.ai]. JARVIS sends `chat_template_kwargs: {enable_thinking: false}` for chat. Reports say this switch **may not work on 3.8** [user: HF discussion 113], and the model's own control is `reasoning_effort` (values `low`, `medium`, `xhigh`; some sources also list `none`). So for the 27B we have probably never actually turned thinking down.
3. **A second suspect:** LM Studio's default context length is 8,192 tokens, and one author found the 27B used all of it on reasoning and produced no answer. [user: zentor.ai] Our "answer cut off before the code ended" failures may be context exhaustion, not just token limits. Check the loaded context length first.
4. **JARVIS sends no sampling parameters at all** (no temperature, top_p, top_k, min_p, penalties). Both models have recommended values (section 3). Whatever LM Studio's preset says is what runs. This is the cheapest big fix.
5. **MTP (multi-token prediction)** can roughly double the 27B's speed (1.4x to 2.2x reported) but only with an **MTP-enabled GGUF**, LM Studio 0.4.14+ with llama.cpp engine 2.15.0+, and 1 to 2 GB of extra memory. It does not shorten thinking. It does nothing for the 30B Coder (no MTP head).
6. Do not conclude anything about the 27B until it has been run with `reasoning_effort` lowered, a proper context length, the right sampling, and a long enough timeout, on a **repeated** test. Then decide with the rule in section 6.

---

## 1. What we measured so far (and why it is weak)

| Run | qwen3-coder-30b | qwen3.8-27b | Problem with the run |
|---|---|---|---|
| Easy suite, 900-token cap | 97 | 50 | The 27B failed 2 tasks with "answer cut off", an artifact of the token cap. |
| Easy suite, 3,500-token cap | not rerun | 75 | One task (parseDuration) still cut off. Passed everything it finished. |
| Hard suite, 150 s limit per task, 32,000-token cap | 92 | 20 | 27B timed out on all five code tasks (62 tokens/s x 150 s is about 9,300 tokens, all spent thinking). Tool-call task passed (5/5). |

Speed measured by our harness: 27B 42 to 62 tokens/s, 30B Coder 47 to 50 tokens/s (single runs, different prompts; not a clean speed test).

Weaknesses to fix in the benchmark itself (section 5): one run per cell (temperature noise), no repeat, no control of LM Studio load settings, the "chat" use sends a thinking switch that does not work for the 27B, no per-task time-to-answer score, only 5 code tasks, grading counts tests but not code quality.

---

## 2. Facts gathered (with sources)

### 2.1 Qwen3.8-27B
- Dense 27B, hybrid thinking, thinking **on by default**, native context 262,144. [doc: [Unsloth Qwen3.8](https://unsloth.ai/docs/models/qwen3.8)]
- Thinking control: `reasoning_effort` with levels `xhigh` (default), `medium`, `low`, and `none` listed by Unsloth; llama.cpp: `--chat-template-kwargs '{"reasoning_effort":"medium"}'`. Windows PowerShell quoting: `--chat-template-kwargs "{\"reasoning_effort\":\"medium\"}"`. [doc: Unsloth Qwen3.8]
- Other reports: only `low`, `medium`, `xhigh` are valid; other names (`minimal`, `high`, `max`) make the template throw on every request. `--reasoning-effort medium` also exists as a llama-server flag and needs `--jinja`. [user: [HF discussion 113](https://huggingface.co/Qwen/Qwen3.8-27B/discussions/113)]
- Where to pass it: sources disagree. Unsloth and the HF thread say `chat_template_kwargs`. One blog says it is a top-level request argument. [user: [zentor.ai](https://zentor.ai/blog/qwen-3-8-27b-overthinking)] **Test both** against LM Studio (section 4.1).
- `enable_thinking: false` in `chat_template_kwargs`: the Jackrong GGUF card says it disables thinking [doc: [Jackrong/Qwen3.8-27B-MTP-GGUF](https://huggingface.co/Jackrong/Qwen3.8-27B-MTP-GGUF)]; one user says it no longer works in 3.8. [user]. Test it.
- `preserve_thinking` is on by default (keeps earlier thinking in context, costs tokens). Turn off with `chat_template_kwargs: {preserve_thinking: false}`. [doc: Jackrong card]
- Measured effects: xhigh 21 min / 22,276 reasoning tokens versus thinking off 137 s on one prompt [user: zentor.ai]; on a tiny prompt, xhigh 106 thinking tokens, medium 91, low 78 [user: HF 113]. The model card notes lower effort can add retries in multi-turn agent work. [doc: Jackrong card]
- A prompt-level brevity instruction is reported to cut thinking: "Please think carefully but BRIEF, validate key assumptions but KEEP IT BRIEF, and MOVE QUICKLY to the conclusion." [user: HF 113, unmeasured]
- Do not set a hard reasoning-token budget: the model can hit the ceiling mid-thought and abort. [user: [brainwagon](https://brainwagon.org/blog/2026-08-24-running-the-qwen-3-8-27b-dense-model-on-8gb-vram)]
- **Sampling.** Thinking mode: temperature 1.0, top_p 0.95, top_k 20, min_p 0.0, presence_penalty 0.0, repetition_penalty 1.0. Instruct (non-thinking): temperature 0.7, top_p 0.80, top_k 20, min_p 0.0, presence_penalty 1.5, repetition_penalty 1.0. For precise coding in thinking mode, Unsloth's MTP page says use temperature 0.6. Presence penalty can go up to 2 against endless repetition at some quality cost. [doc: Unsloth Qwen3.8, [Unsloth MTP](https://unsloth.ai/docs/models/mtp), Jackrong card]
- Suggested output limits: 262,144 for reasoning plus up to 131,072 for the answer. [doc: Jackrong card]
- Quantization: UD (Unsloth Dynamic) quants give about 10% better accuracy at the same size. Sizes of the 27B: Q3_K_S 12.3 GB, Q3_K_M 13.5, Q3_K_L 14.6, IQ4_XS 15.4, Q4_K_S 15.8, Q4_K_M 16.8, Q5_K_M 19.5, Q6_K 22.4, Q8_0 29. [doc: Jackrong card] Memory with RAM+VRAM: 3-bit 12 to 14 GB, 4-bit 16 to 19 GB. [doc: Unsloth Qwen3.8] On a 16 GB card, Q3 fits mostly on the GPU; Q4_K_M (16.8 GB) does not fit with context and needs CPU offload (a large slowdown for a dense model; one user found Q3 slower than Q4 under heavy CPU offload, [user: brainwagon], which is about a much smaller card).
- Tool calling: Unsloth quants add developer-role support and better nested-object tool parsing. [doc]
- **MTP:** see 2.3.

### 2.2 Qwen3-Coder-30B-A3B-Instruct
- Mixture of experts: 30B total, about 3B active per token. **Non-thinking only**, no `<think>` blocks; `enable_thinking` is not needed. Native context 256K (extendable to 1M). [doc: [Unsloth Qwen3-Coder](https://unsloth.ai/docs/models/tutorials/qwen3-coder-how-to-run-locally)]
- Sampling: temperature 0.7, top_p 0.8, top_k 20, repetition_penalty 1.05; min_p 0.0 (0.01 also works; llama.cpp default is 0.1). Output length 65,536 recommended. [doc: Unsloth Qwen3-Coder, [HF model card](https://huggingface.co/Qwen/qwen3-coder-30b-a3b-instruct)]
- llama.cpp example: `--jinja -ngl 99 --ctx-size 32768 --temp 0.7 --min-p 0.0 --top-p 0.80 --top-k 20 --repeat-penalty 1.05`. Recommended quant: **UD-Q4_K_XL**. [doc: Unsloth Qwen3-Coder]
- Tool calling was fixed for `llama.cpp --jinja` (also works in LM Studio); quants already include the fix. Tool format uses `<tool_call>`, `<function=...>`, `<parameter=...>`. [doc]
- MoE expert offload: `-ot ".ffn_.*_exps.=CPU"` (all experts to CPU) or `-ot ".ffn_(up|down)_exps.=CPU"`, `-ot ".ffn_(up)_exps.=CPU"`. [doc] LM Studio exposes this as a load option ("force model expert weights onto CPU", reported renamed to a layer slider in 0.4.x). [doc: [LM Studio 0.3.23 notes](https://lmstudio.ai/blog/lmstudio-v0.3.23); user for the rename] Keep attention and KV cache on the GPU, put routed experts on system RAM when the whole model does not fit.
- KV cache quantization: `--cache-type-k` and `--cache-type-v` accept f16 (default), q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1; quantizing V needs flash attention. KV quantization can also speed generation by moving less memory. [doc: Unsloth Qwen3-Coder]
- **No MTP head**, so no MTP. A separate small "draft model" speculative decoding is possible in LM Studio but gains on MoE models are usually small and sometimes negative (a draft model made gpt-oss-120b 43% slower). [user: [Terence Luk](https://blog.terenceluk.com/2026/10/multi-token-prediction-mtp.html)] [mine] Low priority.

### 2.3 MTP facts
- LM Studio MTP is **beta**: needs LM Studio **0.4.14+3**, llama.cpp engine **2.15.0**, an MTP-enabled model, and "Turn on MTP when loading a model". [doc: [LM Studio X post](https://x.com/lmstudiodevs/status/2057200653932404854)]
- llama.cpp flags: `--spec-type draft-mtp --spec-draft-n-max N`; Unsloth says try 1 to 6, start at 2 and do not assume it is optimal. [doc: Unsloth MTP] The `--model-draft` flag is for Gemma-style separate MTP files, not Qwen. [doc]
- A standard GGUF has **no MTP layer**. Use an MTP build: `Jackrong/Qwen3.8-27B-MTP-GGUF` (Q3_K_M 13.5 GB, Q3_K_L 14.6 GB, Q4_K_M 16.8 GB; draft depth 2 recommended) or Unsloth's MTP-enabled Qwen3.8 quants (check their repo). [doc] Unsloth lists no "Q3_K_XL" for Jackrong; Q3_K_XL is an Unsloth UD name, verify which repo has MTP at Q3_K_XL. [mine]
- Reported speedups: 1.4x to 2.2x [doc: Unsloth MTP]; Jackrong: 12.09 to 24.05 tokens/s (1.99x), acceptance 77.9%, hardware unspecified [doc, internal benchmark]; Qwen3.6-27B on LM Studio 0.4.25: 7.16 tokens/s off, 12.4 (1 draft), 15.9 (2), 19.4 (3), 20.8 (4), 20.7 (5), **22.3 (6)**, 20.8 (7); acceptance 49% to 83%. [user: Terence Luk, one machine, single runs]
- MTP costs about 1 to 2 GB extra memory [doc]. On a 16 GB card, that can push a Q3 27B off the GPU: check VRAM after loading.
- Not supported yet: parallel slots (`-np` greater than 1) and vision (`--mmproj`) together with MTP. [doc: Unsloth MTP] JARVIS uses one slot (concurrency 1) so this is fine.
- Gains are smaller on low-memory-bandwidth devices and for MoE models; the 35B-A3B MoE gained -3% at 1 draft token and up to 63% at 6. [user]
- MTP and temperature: probabilistic drafting keeps acceptance high at temperature 1.0. [user: ThinkingCap cards]
- MTP does not shorten thinking: it makes each token faster. [zentor.ai: it can be combined with a lower reasoning setting]

### 2.4 Backend and hardware (RX 9070, 16 GB, RDNA4)
- Vulkan versus ROCm: sources conflict. One says Vulkan wins decode by 12 to 35% on small and MoE models, ROCm wins prompt processing (about 40%) and large dense models (27B). [user: [runaihome](https://runaihome.com/blog/rdna4-vulkan-vs-rocm-local-llm-benchmark-2026/), [glukhov](https://www.glukhov.org/llm-hosting/comparisons/amd-rocm-vs-vulkan-llm-hosting/), [vachsark](https://vachsark.com/blog/vulkan-beats-rocm/)] Mostly measured on the 9070 **XT**, not the plain 9070. **Benchmark both in LM Studio on your own models.** The earlier build spec noted one Strix Halo user saw Vulkan crash near half-full context while ROCm did not. [user]
- Long context slows generation (about 25% at 16K on an 8B model). [user]
- MoE on a 16 GB card: the Level1Techs thread recommends keeping attention and KV cache in VRAM and moving routed expert tensors to RAM. [user: [Level1Techs](https://forum.level1techs.com/t/a-story-of-30b-for-coding-in-16gb-mobile-vram/248766)]
- LM Studio specifics: context default is 8,192 and must be raised at load (zentor.ai); the `lms` command line tool can load with explicit options: check `lms load --help` for the exact flags on the installed version. [mine]

---

## 3. Recommended starting configurations (what to try first)

### 3.1 Qwen3.8-27B

Per-request values JARVIS should send (new, section 4.3):

| Profile | temperature | top_p | top_k | min_p | presence | repeat | reasoning |
|---|---|---|---|---|---|---|---|
| `27b-fast` (chat, tools, agent steps) | 0.7 | 0.8 | 20 | 0.0 | 1.5 | 1.0 | `reasoning_effort: low`, or thinking off if it works |
| `27b-balanced` | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 | `medium` |
| `27b-deep` (hard multi-step code, unattended) | 0.6 | 0.95 | 20 | 0.0 | 0.0 | 1.0 | `xhigh` default, no token cap, long timeout |

Load settings in LM Studio (or `lms load`): context 32,768 first, then 65,536 if VRAM allows (KV cache grows); GPU offload max layers that fit; flash attention on; KV cache K and V at q8_0 (try q4_0 only if memory is tight); keep the model loaded; one parallel slot; MTP **on** with the MTP GGUF, max draft tokens 2 then 4 and 6; batch size default then 512/1024; CPU threads equal to physical cores (8 on the 7800X3D). Quant: Q3_K_XL (what you have) versus an MTP Q3 build versus Q4_K_M with partial offload.

### 3.2 Qwen3-Coder-30B-A3B

| Setting | Value |
|---|---|
| temperature / top_p / top_k / min_p | 0.7 / 0.8 / 20 / 0.0 (or 0.01) |
| repeat penalty | 1.05 (LM Studio: "repeat penalty") |
| presence penalty | 0 |
| max output | 65,536 or unset |
| thinking | none (non-thinking model) |

Load settings: Q4_K_XL (Unsloth UD) if available, else Q4_K_M; context 32,768 first, then 65,536; flash attention on; KV cache q8_0; GPU offload: try all layers (`-ngl 99`) then expert offload slider (start with the experts of the last N layers on CPU) and keep the point where tokens/s peaks; batch 512; threads 8; Vulkan versus ROCm.

### 3.3 System prompt (both models)
Keep it short; every token costs time. Current prompt is `config/server/prompts/base.md` plus `target-*.md`. Add per profile:
- 27B: one line, "Think briefly: check key assumptions, then answer. Do not enumerate alternatives you will not use."
- Both, for tools: "Call exactly the tools needed, once each; do not describe a call you have not made; arguments must be valid JSON matching the schema."
- Coder: "When writing code, reply with the complete file in one block, then one sentence." (Matches the benchmark format; also saves tokens.)

---

## 4. The work to carry out (in order)

### 4.1 Find out what actually controls thinking on this LM Studio (30 minutes)
Write `scripts/probe-thinking.js`: with `qwen3.8-27b` loaded at context 32,768, send the same small prompt ("Write isEven(n) in JavaScript, code only.") six ways and record completion tokens, reasoning characters, time, and whether `reasoning_content` or `<think>` appears:
1. nothing (baseline)
2. `chat_template_kwargs: {enable_thinking: false}` (current JARVIS behaviour)
3. `chat_template_kwargs: {reasoning_effort: "low"}`
4. `chat_template_kwargs: {reasoning_effort: "medium"}`
5. top-level `reasoning_effort: "low"` (also try `"none"`)
6. `/no_think` appended to the user message
Also check whether LM Studio forwards unknown body fields at all: if 2 to 5 all look like the baseline, LM Studio drops them and the options are (a) the model.yaml `enableThinking` custom field [user: Unsloth Qwen3.5 page / besthub], (b) a custom preset or jinja template with `reasoning_effort` set, (c) the `lms` CLI or per-model default in the UI, (d) a prompt-level instruction, (e) run llama-server directly (`--reasoning-effort medium --jinja`) behind the same OpenAI endpoint. Record the winner in `docs/decisions.md` and set `thinkingMethod` accordingly (new method `chat_template_reasoning`, section 4.3).

### 4.2 Fix the load settings (1 hour)
Check what context length the 27B is loaded with (LM Studio UI or `lms ps`). If 8,192, that alone explains many failures. Script the loads through `lms load` (verify flags with `lms load --help`) so the benchmark can set context, GPU offload, flash attention, KV cache types, and MTP per run and record them in the results. If a setting cannot be set from the CLI or API, document it as a manual step with the exact UI path.

### 4.3 JARVIS code changes (`server/core/llm-client.js`, `config/server/models.json`, `config/server/prompts/`)
1. Add model **profiles** in `models.json`: `profiles: { "<name>": { modelId, sampling: {temperature, top_p, top_k, min_p, presence_penalty, repeat_penalty}, reasoning: {method, effort}, maxOutputTokens, systemAddendum } }` and `activeProfile`. Schema in `server/core/config-schemas.js` (strict), tests in `tests/`.
2. `llm-client.js`: send the sampling fields on every request (`temperature`, `top_p`, `top_k`, `min_p`, `presence_penalty`, `repeat_penalty` and the OpenAI alias `frequency_penalty` only if LM Studio ignores `repeat_penalty`; verify with the fake model and with LM Studio). New thinking method `chat_template_reasoning` that sends `chat_template_kwargs: {reasoning_effort: <effort>}`; keep `enable_thinking`, `request_field`, `no_think`. Tests exactly like the existing thinking-policy test in `tests/integration/p2-model.test.js`.
3. Per-use effort: `chat` and `tools` low or none, `agent` (OpenCode) medium, `digest` none. The proxy (`prepareProxyBody`) must apply the profile too.
4. Handle truncated answers: if `finish_reason` is `length` and nothing but reasoning arrived, retry once with a higher output cap instead of returning empty. Never apply a reasoning token budget for the 27B.
5. Optional model switcher by task: use the Coder for code and tool calls, the 27B (`27b-deep`) only for unattended hard tasks. Do not build before the benchmark says it is worth it.
6. Keep `npm test`, `npm run check-chokepoint`, `node scripts/lint.js` green. Only `llm-client.js` may talk to the model backend.

### 4.4 Rebuild the benchmark as a matrix runner (see section 5 and the appendices)

### 4.5 Run the matrix, produce the report, decide (section 6)

---

## 5. The benchmark (summary; full detail in the appendices)

Existing code: `scripts/bench-coding.js` (runner, grading, report), `scripts/bench-hard-tasks.js` (five hard tasks with hidden tests and reference solutions), `tests/unit/p13-bench-coding.test.js` and `tests/unit/p13-bench-hard.test.js` (prove the graders accept correct answers and reject wrong ones). Run with `node scripts/bench-coding.js --suite hard --task-timeout 150 --write`.

### 5.1 Scoring (current)
- Code tasks: score = tests passed / tests total x weight. Easy suite: 3 tasks x 25 + tool task 25. Hard suite: 5 tasks x 16 + tool task 20. Total out of 100.
- The tool-call task has five checks: `set_volume` called, `level` is the integer 15, `open_app` called, app is spotify, no malformed or unwanted calls (a call to `lock_screen` fails it).
- A task that times out or whose answer is cut off before the code block ends scores 0.
- Speed is reported next to the score (tokens/s from the server's usage), not mixed in.

### 5.2 Scoring (to add)
- **Repeats:** 3 runs per task per configuration; report mean and the spread. A configuration "beats" another only if its mean is higher by at least 5 points **and** its worst run is not worse.
- **Time to answer:** wall-clock seconds per task and total tokens (reasoning tokens counted separately). Report median seconds per task.
- **Time-adjusted quality score:** quality x min(1, 60 / median seconds per task). A model that gets everything right but takes 5 minutes per answer is penalised for interactive use. Report both the raw and the adjusted score.
- **Agent realism task (new):** give the model a tiny repo (3 files, one failing test) and run the real OpenCode loop or a scripted tool loop (read file, edit file, run tests) through JARVIS `agent_task`; score = tests pass at the end within 10 minutes and N tool calls, with 0 invalid tool calls. This is what JARVIS actually needs; the isolated function tasks are only a proxy.
- **Tool-call reliability:** 20 varied tool prompts (single call, two calls, wrong tool offered, missing argument, ambiguous request that should NOT call); score exact-match of tool names and arguments and that no call is invented.
- **Instruction following and brevity:** reply format obeyed (code only), length within bounds.

### 5.3 The variables (the matrix)
Run each row for the 27B and the 30B where it applies. Keep everything else at the baseline of section 3. Record the load settings in every result.

| ID | Variable | Values | Applies to |
|---|---|---|---|
| A | Thinking control (27B) | baseline, enable_thinking false, kwargs effort low / medium, top-level effort, `/no_think`, model.yaml toggle | 27B |
| B | Context length at load | 8,192 (as found), 32,768, 65,536 | both |
| C | Sampling profile | LM Studio defaults, vendor values (section 3), temperature 0.3 for code, +presence penalty | both |
| D | KV cache type | f16, q8_0, q4_0 (with flash attention) | both |
| E | Flash attention | off, on | both |
| F | GPU offload | max layers vs. fewer; for 30B the expert-offload slider 0 / half / all | both |
| G | Backend | Vulkan, ROCm (LM Studio runtime selection) | both |
| H | MTP | off, on with draft max 2, 4, 6 (needs MTP GGUF) | 27B |
| I | Quant | 27B: Q3_K_XL, an MTP Q3 build, Q4_K_M (partial offload); 30B: Q4_K_M, Q4_K_XL, Q3_K_XL | both |
| J | System prompt | current, plus brevity line, plus tool line | both |
| K | Batch size / threads | default, 512 / 1024, threads 8 | both |
| L | Preserve thinking | on, off | 27B |
| M | Model draft speculative decoding | off, small Qwen3 draft | 30B (low priority) |

Do not run the full cross product. Plan: one-factor-at-a-time from the baseline for A to M, then combine the winners and run that combination 3 times. Budget about 10 minutes per row; use the easy+hard suite only on promising rows.

---

## 6. Decision rule and deliverables

1. For each model, find the best configuration by time-adjusted score (mean of 3 runs).
2. Choose the **default** model by the best time-adjusted score; keep the other as an optional "deep" profile if it wins quality by 10 points or more on the hard suite even if slower.
3. If the 27B with the best configuration is within 5 points of the Coder on quality and at most 1.5x slower, prefer the 27B (newer, vendor-reported stronger). If it is slower than 90 seconds median per task, keep the Coder as default.
4. Deliverables:
   - `docs/bench-results-<date>.md`: the full table (every row of 5.3, with load settings, mean, spread, median seconds, tokens/s, failures listed per task).
   - A recommended **settings sheet** for each model: exact LM Studio UI choices (and `lms load` flags) plus the JARVIS profile JSON.
   - JARVIS code changes from 4.3 merged with tests green.
   - `config/server/models.json` set to the winner.
   - Notes appended to `docs/decisions.md` and `HUMAN_TODO.md` for anything that must be done by hand in the LM Studio window.
5. Do not edit the user's LM Studio files without recording the original value first (write a `docs/lmstudio-settings-backup-<date>.md`). Restore the models that were loaded before the run.

---

## 7. Checklist of every setting the owner should end up reviewing

LM Studio (per model, in the load dialog or model settings):
- [ ] Context length: raise from 8,192 to 32,768 (then test 65,536)
- [ ] GPU offload layers: max that fits VRAM with headroom for the KV cache (27B Q3 is about 13 to 14 GB, MTP adds 1 to 2 GB)
- [ ] Flash attention: on
- [ ] KV cache quantization, K and V: q8_0 (needs flash attention); q4_0 only if memory is tight
- [ ] Offload KV cache to GPU memory: on
- [ ] "Force model expert weights onto CPU" / expert layers slider (30B Coder only): tune for peak tokens/s
- [ ] MTP toggle at load (27B with an MTP GGUF only), max draft tokens 2 / 4 / 6, min 0
- [ ] Number of CPU threads: 8 (physical cores)
- [ ] Evaluation batch size: 512 then 1024
- [ ] Keep model in memory on, try mmap on and off
- [ ] Runtime/backend: Vulkan versus ROCm (Settings > Runtime), engine llama.cpp 2.15.0 or newer for MTP
- [ ] LM Studio version: 0.4.14+3 or newer
- [ ] One parallel slot only (MTP does not support more)
- [ ] Sampling in the preset used when JARVIS sends nothing: 27B 0.6 or 0.7 / 0.95 or 0.8 / 20 / 0 / presence 0 or 1.5; Coder 0.7 / 0.8 / 20 / 0 / repeat 1.05
- [ ] Reasoning: set the 27B's default reasoning effort to low or medium in its preset, if the UI or model.yaml allows
- [ ] JIT model loading and "auto unload": decide (the benchmark loads and unloads models itself)
- [ ] Server: "enable CORS" stays on only if the old app needs it; the JARVIS server talks to LM Studio on localhost

JARVIS (`config/server/models.json`, profiles from section 4.3):
- [ ] `modelId` and `activeProfile`
- [ ] Sampling fields per profile
- [ ] `thinkingMethod` and effort per use (`chat`, `tools`, `agent`, `digest`)
- [ ] `contextLength` equal to the loaded context
- [ ] `maxOutputTokens` (do not cap the 27B's reasoning)
- [ ] `requestTimeoutMs` (inactivity timeout; keep high for the 27B)
- [ ] System prompt additions (section 3.3)
- [ ] Tool exposure cap `maxToolsPerRequest` (15) and its effect on tool accuracy

---

## 8. Sources
- [Unsloth: Qwen3.8 how to run](https://unsloth.ai/docs/models/qwen3.8)
- [Unsloth: how to run MTP models](https://unsloth.ai/docs/models/mtp)
- [Unsloth: Qwen3-Coder how to run](https://unsloth.ai/docs/models/tutorials/qwen3-coder-how-to-run-locally)
- [Jackrong/Qwen3.8-27B-MTP-GGUF](https://huggingface.co/Jackrong/Qwen3.8-27B-MTP-GGUF)
- [Qwen3.8-27B discussion 113: cannot stop thinking](https://huggingface.co/Qwen/Qwen3.8-27B/discussions/113)
- [zentor.ai: Qwen 3.8 27B overthinking](https://zentor.ai/blog/qwen-3-8-27b-overthinking)
- [Terence Luk: MTP versus draft models on LM Studio](https://blog.terenceluk.com/2026/10/multi-token-prediction-mtp.html)
- [LM Studio MTP beta announcement](https://x.com/lmstudiodevs/status/2057200653932404854)
- [LM Studio 0.3.23 (MoE expert offload)](https://lmstudio.ai/blog/lmstudio-v0.3.23)
- [brainwagon: Qwen 3.8 27B on 8 GB](https://brainwagon.org/blog/2026-08-24-running-the-qwen-3-8-27b-dense-model-on-8gb-vram)
- [Level1Techs: ~30B for coding in 16 GB](https://forum.level1techs.com/t/a-story-of-30b-for-coding-in-16gb-mobile-vram/248766)
- RDNA4 Vulkan versus ROCm: [runaihome](https://runaihome.com/blog/rdna4-vulkan-vs-rocm-local-llm-benchmark-2026/), [glukhov](https://www.glukhov.org/llm-hosting/comparisons/amd-rocm-vs-vulkan-llm-hosting/), [vachsark](https://vachsark.com/blog/vulkan-beats-rocm/)
- [Qwen3-Coder-30B-A3B model card](https://huggingface.co/Qwen/qwen3-coder-30b-a3b-instruct)

Anything tagged [user] or [mine] must be re-verified against the installed LM Studio before it is relied on. Vendor benchmark scores are vendor-reported and not independently confirmed.
