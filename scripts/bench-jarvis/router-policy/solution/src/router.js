const { decide } = require('./policy');

const SECRET = /token|secret|password|key/i;

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '[redacted]' : redact(x)]));
  return v;
}

function wrap(tool, out) {
  const text = typeof out === 'string' ? out : JSON.stringify(out);
  return '<untrusted source="' + tool + '">' + text.replaceAll('</untrusted', '&lt;/untrusted') + '</untrusted>';
}

async function route(call, ctx, deps) {
  const target = ctx.target ?? 'pc';
  const args = call.args ?? {};
  const record = (outcome, extra = {}) => deps.audit.push({ tool: call.tool, target, args: redact(args), outcome, ...extra });
  const v = decide({ tool: call.tool, args, source: ctx.source });
  if (v.verdict === 'deny') {
    record('denied', { reason: v.reason });
    return { ok: false, error: v.reason };
  }
  if (v.verdict === 'ask' && !(await deps.gate.ask({ tool: call.tool, target, args }))) {
    record('not-approved');
    return { ok: false, error: 'not approved' };
  }
  try {
    const out = await deps.agent.run({ tool: call.tool, args, target });
    record('ok');
    return { ok: true, output: wrap(call.tool, out) };
  } catch (e) {
    record('error', { reason: e.message });
    return { ok: false, error: e.message };
  }
}

module.exports = { route };
