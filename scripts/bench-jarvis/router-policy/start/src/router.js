// Routes a tool call from the model: policy, approval, agent, audit.
async function route(call, ctx, deps) {
  const target = call.args.target || 'pc';
  const args = call.args;
  const approved = await deps.gate.ask({ tool: call.tool, target, args });
  if (!approved) return { ok: false, error: 'not approved' };
  const out = await deps.agent.run({ tool: call.tool, args, target });
  deps.audit.push({ tool: call.tool, target, args, outcome: 'ok' });
  return { ok: true, output: out };
}

module.exports = { route };
