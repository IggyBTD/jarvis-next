# Coding benchmark 2026-10-24

| Model | Total /100 | expression evaluator | topoSort with cycles | mapLimit (async pool) | minimal line diff | fix deepMerge (4 bugs) | tool calls | Tokens/s |
|---|---|---|---|---|---|---|---|---|
| qwen3.8-27b | **20** | 0/18 | 0/10 | 0/10 | 0/9 | 0/11 | 5/5 | 62.2 |
| qwen/qwen3-coder-30b | **92** | 15/18 | 7/10 | 10/10 | 9/9 | 11/11 | 5/5 | 47.2 |

Failures:
- qwen3.8-27b, expression evaluator: failed timed out after 150 s
- qwen3.8-27b, topoSort with cycles: failed timed out after 150 s
- qwen3.8-27b, mapLimit (async pool): failed timed out after 150 s
- qwen3.8-27b, minimal line diff: failed timed out after 150 s
- qwen3.8-27b, fix deepMerge (4 bugs): failed timed out after 150 s
- qwen/qwen3-coder-30b, expression evaluator: failed right assoc power, unary vs power, double minus: Incomplete expression
- qwen/qwen3-coder-30b, topoSort with cycles: failed simple, implicit nodes, respects order

Verdict: qwen/qwen3-coder-30b is clearly better (92 vs 20).
