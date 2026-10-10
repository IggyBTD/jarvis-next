// Runs the model's tool calls through one chokepoint: validate the arguments, decide with the
// permission rules, ask the user when needed, run the handler, write the audit entry. Nothing the
// model can do reaches the app except through run(). No DOM and no JSON imports here, so node can
// test it; actions.js wires in the real registry, handlers and storage.
import { decide, suggestRule } from './permissions.js';
import { parseArguments } from './tool-calls.js';

// Checks args against the small JSON-schema subset the registry uses (object of typed properties,
// required, enum). Returns an error string or null.
export function validateArgs(schema, args) {
  const props = schema?.properties ?? {};
  // Small models often send numbers and booleans as strings: accept the obvious forms.
  for (const [key, value] of Object.entries(args)) {
    const type = props[key]?.type;
    if ((type === 'integer' || type === 'number') && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) args[key] = Number(value);
    if (type === 'boolean' && (value === 'true' || value === 'false')) args[key] = value === 'true';
  }
  for (const key of schema?.required ?? []) {
    if (args[key] === undefined || args[key] === '') return `missing required argument "${key}"`;
  }
  for (const [key, value] of Object.entries(args)) {
    const def = props[key];
    if (!def) return `unknown argument "${key}"`;
    if (def.type === 'string' && typeof value !== 'string') return `argument "${key}" must be a string`;
    if (def.type === 'integer' && !Number.isInteger(value)) return `argument "${key}" must be an integer`;
    if (def.type === 'number' && typeof value !== 'number') return `argument "${key}" must be a number`;
    if (def.type === 'boolean' && typeof value !== 'boolean') return `argument "${key}" must be true or false`;
    if (def.enum?.length && !def.enum.includes(value)) return `argument "${key}" must be one of: ${def.enum.join(', ')}`;
  }
  return null;
}

// actions: [{ name, description, tier, primary?, kind?, parameters }]
// handlers: { name: async (args) => string | { content, display } }; display is data for the UI card.
// getRules(): { allow, ask, deny }; blocked: compiled blocked-command patterns;
// approve({ name, args, primary, reason, suggestedRule }) resolves 'once' | 'always' | 'deny';
// onAlways(rule) stores a new allow rule; audit(record) logs; onEvent(e) tells the UI what happened.
// The audit log keeps what was asked for, not whole file bodies.
const auditArgs = (args) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}...[${v.length} chars]` : v]));

// gate(name, args) returns a reason to refuse the call (plan mode), or null. hooks.before(name, args, primary)
// returns a reason to refuse, hooks.after(name, args, primary) returns text to append to the result.
export function createActionRunner({ actions, handlers, getRules, blocked = [], approve, onAlways, audit, onEvent, gate = null, hooks = null }) {
  const byName = new Map(actions.map((a) => [a.name, a]));

  const tools = () => actions.map((a) => ({
    type: 'function',
    function: { name: a.name, description: a.description, parameters: a.parameters },
  }));

  async function finish(call, action, args, decision, ok, result, display = null) {
    try { await audit?.({ action: call.name, args: auditArgs(args), decision, ok, result: String(result).slice(0, 300) }); } catch { /* logging must not break the action */ }
    onEvent?.({ type: 'action', name: call.name, args, decision, ok, result, display });
    return { ok, content: result, decision, display };
  }

  // Resolves { ok, content, decision }; content is what the model reads back. Never throws.
  async function run(call) {
    const action = byName.get(call.name);
    if (!action || !handlers[call.name]) return finish(call, null, {}, 'deny', false, `Unknown action "${call.name}". Available: ${[...byName.keys()].join(', ')}.`);

    const parsed = parseArguments(call.arguments);
    if (!parsed.ok) return finish(call, action, {}, 'deny', false, `Bad arguments: ${parsed.error}.`);
    const args = parsed.value;
    const invalid = validateArgs(action.parameters, args);
    if (invalid) return finish(call, action, args, 'deny', false, `Bad arguments: ${invalid}.`);

    const primary = action.primary ? args[action.primary] ?? null : null;
    const refusal = gate?.(action.name, args);
    if (refusal) return finish(call, action, args, 'deny', false, `Refused: ${refusal}.`);
    const verdict = decide({ name: action.name, primary, tier: action.tier, kind: action.kind ?? null, rules: getRules(), blocked });

    if (verdict.decision === 'deny') return finish(call, action, args, 'deny', false, `Refused: ${verdict.reason}.`);

    let how = 'allow';
    if (verdict.decision === 'ask') {
      const suggestedRule = suggestRule(action.name, primary, action.kind ?? null);
      const answer = approve ? await approve({ name: action.name, args, primary, reason: verdict.reason, suggestedRule }) : 'deny';
      if (answer === 'deny') return finish(call, action, args, 'deny', false, 'The user did not approve this action.');
      how = answer === 'always' ? 'always' : 'once';
      if (answer === 'always') onAlways?.(suggestedRule);
    }

    try {
      const stopped = await hooks?.before?.(action.name, args, primary);
      if (stopped) return finish(call, action, args, 'deny', false, `Refused by a hook: ${stopped}`);
      const out = await handlers[call.name](args);
      const { content, display } = out && typeof out === 'object' ? out : { content: out, display: null };
      const extra = await hooks?.after?.(action.name, args, primary);
      return finish(call, action, args, how, true, `${content ?? 'Done.'}${extra ? `\n[hook output]\n${extra}` : ''}`, display);
    } catch (e) {
      return finish(call, action, args, how, false, `Failed: ${e?.message ?? e}`);
    }
  }

  return { tools, run, has: (name) => byName.has(name) };
}
