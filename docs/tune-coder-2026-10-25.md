# Coder tuning 2026-10-25 (2 reps, hard suite, qwen/qwen3-coder-30b)

| Variant | Mean /100 | Min | Max | Median s per code task | Mean tokens per task | Time-adjusted |
|---|---|---|---|---|---|---|
| c-base | **95.5** | 94 | 97 | 7 | 457 | 95.5 |
| c-temp0.3 | **91.0** | 88 | 94 | 7 | 393 | 91.0 |
| c-temp0.5 | **87.5** | 77 | 98 | 6 | 400 | 87.5 |
| c-rep1.0 | **82.5** | 76 | 89 | 9 | 431 | 82.5 |
| c-check | **85.0** | 76 | 94 | 10 | 494 | 85.0 |
| c-temp0.3+check | **83.0** | 73 | 93 | 9 | 460 | 83.0 |

Runs: c-base [94, 97]; c-temp0.3 [88, 94]; c-temp0.5 [98, 77]; c-rep1.0 [76, 89]; c-check [94, 76]; c-temp0.3+check [73, 93]

Failures:
- c-base, expression evaluator: unary vs power, double minus: Invalid expression, nested: Invalid expression
- c-base, mapLimit (async pool): respects limit, no new calls after failure
- c-base, expression evaluator: unary vs power, double minus: Invalid expression
- c-base, fix deepMerge (4 bugs): arrays replaced
- c-temp0.3, expression evaluator: unary vs power
- c-temp0.3, topoSort with cycles: simple, alphabetical ties, implicit nodes, diamond, respects order
- c-temp0.3, mapLimit (async pool): respects limit, no new calls after failure
- c-temp0.3, expression evaluator: unary vs power
- c-temp0.3, topoSort with cycles: simple, implicit nodes, respects order
- c-temp0.5, expression evaluator: unary vs power
- c-temp0.5, fix deepMerge (4 bugs): arrays replaced
- c-temp0.5, expression evaluator: unary vs power, left assoc minus
- c-temp0.5, topoSort with cycles: simple, implicit nodes, respects order
- c-temp0.5, mapLimit (async pool): all
- c-rep1.0, expression evaluator: precedence: Invalid expression, parens: Unbalanced parentheses, right assoc power: Invalid expression, unary vs power: Invalid expression, mul unary: Invalid expression, division: Invalid expression, modulo: Invalid expression, spaces: Invalid expression, decimals: Invalid expression, left assoc minus: Invalid expression, nested: Unbalanced parentheses
- c-rep1.0, topoSort with cycles: simple, implicit nodes, respects order
- c-rep1.0, mapLimit (async pool): order, index passed, respects limit: Cannot read properties of undefined (reading 'error'), uses full limit: Cannot read properties of undefined (reading 'error'), limit above length
- c-rep1.0, fix deepMerge (4 bugs): arrays replaced
- c-rep1.0, expression evaluator: unary vs power, left assoc minus: Invalid expression
- c-rep1.0, topoSort with cycles: simple, implicit nodes, respects order
- c-rep1.0, mapLimit (async pool): respects limit, no new calls after failure
- c-rep1.0, fix deepMerge (4 bugs): arrays replaced
- c-check, expression evaluator: unary vs power
- c-check, mapLimit (async pool): respects limit, uses full limit, no new calls after failure
- c-check, expression evaluator: precedence, parens, unary vs power, left assoc minus: Invalid expression, nested: Unbalanced parentheses
- c-check, topoSort with cycles: simple, alphabetical ties, implicit nodes, diamond, respects order
- c-check, mapLimit (async pool): order, index passed, respects limit, limit above length, rejects with first error, no new calls after failure, sync throw rejects
- c-check, fix deepMerge (4 bugs): arrays replaced
- c-temp0.3+check, expression evaluator: unary vs power, left assoc minus
- c-temp0.3+check, topoSort with cycles: simple, alphabetical ties, implicit nodes, diamond, respects order
- c-temp0.3+check, mapLimit (async pool): order: execute is not defined, index passed: execute is not defined, respects limit: execute is not defined, uses full limit: execute is not defined, limit above length: execute is not defined, rejects with first error, no new calls after failure, sync throw rejects
- c-temp0.3+check, minimal line diff: replace, minimal edits
- c-temp0.3+check, expression evaluator: unary vs power
- c-temp0.3+check, mapLimit (async pool): order, respects limit, uses full limit, no new calls after failure
