# Coding benchmark 2026-10-25

| Model | Total /100 | expression evaluator | topoSort with cycles | mapLimit (async pool) | minimal line diff | fix deepMerge (4 bugs) | tool calls | Tokens/s |
|---|---|---|---|---|---|---|---|---|
| qwen/qwen3-coder-30b | **93** | 16/18 | 7/10 | 10/10 | 9/9 | 11/11 | 5/5 | 44.1 |
| qwen3.8-27b | **77** | 15/18 | 10/10 | 0/10 | 9/9 | 8/11 | 5/5 | 32 |

Failures:
- qwen/qwen3-coder-30b, expression evaluator: failed unary vs power, left assoc minus
- qwen/qwen3-coder-30b, topoSort with cycles: failed simple, implicit nodes, respects order
- qwen3.8-27b, expression evaluator: failed parens: Incomplete or invalid expression, unary vs power, nested: Incomplete or invalid expression
- qwen3.8-27b, mapLimit (async pool): failed all
- qwen3.8-27b, fix deepMerge (4 bugs): failed merges nested: deepMerge is not defined, no target mutation: deepMerge is not defined, no source mutation: deepMerge is not defined

Verdict: qwen/qwen3-coder-30b is clearly better (93 vs 77).
