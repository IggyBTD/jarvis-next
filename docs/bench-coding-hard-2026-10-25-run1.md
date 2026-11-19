# Coding benchmark 2026-10-25

| Model | Total /100 | expression evaluator | topoSort with cycles | mapLimit (async pool) | minimal line diff | fix deepMerge (4 bugs) | tool calls | Tokens/s |
|---|---|---|---|---|---|---|---|---|
| qwen/qwen3-coder-30b | **85** | 17/18 | 7/10 | 7/10 | 7/9 | 11/11 | 5/5 | 44 |
| qwen3.8-27b | **20** | 0/18 | 0/10 | 0/10 | 0/9 | 0/11 | 5/5 | 28.6 |

Failures:
- qwen/qwen3-coder-30b, expression evaluator: failed unary vs power
- qwen/qwen3-coder-30b, topoSort with cycles: failed simple, implicit nodes, respects order
- qwen/qwen3-coder-30b, mapLimit (async pool): failed respects limit, rejects with first error, no new calls after failure
- qwen/qwen3-coder-30b, minimal line diff: failed replace, minimal edits
- qwen3.8-27b, expression evaluator: failed timed out after 300 s
- qwen3.8-27b, topoSort with cycles: failed timed out after 300 s
- qwen3.8-27b, mapLimit (async pool): failed timed out after 300 s
- qwen3.8-27b, minimal line diff: failed timed out after 300 s
- qwen3.8-27b, fix deepMerge (4 bugs): failed timed out after 300 s

Verdict: qwen/qwen3-coder-30b is clearly better (85 vs 20).
