# 27B tuning 2026-10-25 (2 reps, hard suite, qwen3.8-27b)

| Variant | Mean /100 | Min | Max | Median s per code task | Mean tokens per task | Time-adjusted |
|---|---|---|---|---|---|---|
| medium | **20.0** | 20 | 20 | 120 | 0 | 10.0 |
| none+brief | **90.0** | 80 | 100 | 18 | 596 | 90.0 |
| none+temp0.3 | **98.0** | 97 | 99 | 13 | 521 | 98.0 |

Runs: medium [20]; none+brief [100, 80]; none+temp0.3 [97, 99]

Failures:
- medium, expression evaluator: timed out after 120 s
- medium, topoSort with cycles: timed out after 120 s
- medium, mapLimit (async pool): timed out after 120 s
- medium, minimal line diff: timed out after 120 s
- medium, fix deepMerge (4 bugs): timed out after 120 s
- none+brief, mapLimit (async pool): all
- none+brief, fix deepMerge (4 bugs): merges nested: deepMerge is not defined, no target mutation: deepMerge is not defined, no source mutation: deepMerge is not defined
- none+temp0.3, expression evaluator: unary vs power
- none+temp0.3, topoSort with cycles: cycle message
- none+temp0.3, expression evaluator: unary vs power
