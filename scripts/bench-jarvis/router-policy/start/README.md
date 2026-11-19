# router

The tool router: every tool call from the model goes through here (server/core/tool-router.js in JARVIS). Order for each call: policy, then approval gate, then agent, then audit. Every call is audited exactly once, whatever the outcome.

## Tiers and policy (src/policy.js)

`TOOLS`: `files.read` T0, `web.search` T1, `files.write` T2, `shell.run` T3, `mail.send` T3. Any other tool is unknown.

- `tierOf(tool)` returns `'T0'` to `'T3'`, or `null` for an unknown tool.
- `decide({ tool, args, source })` returns `{ verdict, reason }`, where verdict is `'allow'`, `'ask'` or `'deny'`. Rules, in this order:
  1. Unknown tool: deny, reason `'unknown tool'`.
  2. A `files.*` tool whose `args.path` is absolute (starts with `/` or `\`, or with a drive letter such as `C:`) or has a `..` segment (split on `/` or `\`): deny, reason `'path outside workspace'`.
  3. `source` is `'schedule'` and the tier is T3: deny, reason `'scheduled jobs never run T3'`.
  4. Tier T2 or T3: ask, reason `'T2 needs approval'` or `'T3 needs approval'`.
  5. Otherwise: allow, reason `''`.

## Router (src/router.js)

`route(call, ctx, deps)`: `call` is `{ tool, args }`, `ctx` is `{ source, target }`, `deps` is `{ gate, agent, audit }`.

- The target is `ctx.target`, and `'pc'` when the context has none. `args.target` is ignored everywhere. The agent always receives `{ tool, args, target }`.
- Deny: return `{ ok: false, error: reason }`. The agent and the gate are not called.
- Ask: `await deps.gate.ask({ tool, target, args })`. If it resolves to a falsy value, return `{ ok: false, error: 'not approved' }`.
- Run: `await deps.agent.run({ tool, args, target })`. If it throws, return `{ ok: false, error: e.message }`.
- Success: return `{ ok: true, output }` where `output` is `<untrusted source="TOOL">TEXT</untrusted>`. TEXT is the agent's result as it is when it is a string, and `JSON.stringify(result)` otherwise. Inside TEXT every `</untrusted` is written as `&lt;/untrusted`, so the output cannot close the wrapper early.
- Audit: call `deps.audit.push(record)` exactly once per call, with `record = { tool, target, args, outcome }`, plus `reason` for denied and error. `outcome` is `'denied'`, `'not-approved'`, `'error'` or `'ok'`. `args` in the record is a copy where every key whose name contains `token`, `secret`, `password` or `key` (any letter case) has the value `'[redacted]'`. The agent still gets the real args.
