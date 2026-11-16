// Client -> server messages (Appendix A of the build spec). Every message is JSON { type, id?, ... }; binary frames are used
// only for voice audio (shared/voice-frames.js). parseClientMessage() validates shape and size before anything acts on it.
import { validate } from '../../shared/schema.js';
import { EFFORTS } from '../../shared/effort.js';
import { MODES } from '../../shared/permission-modes.js';

export const MAX_FRAME = 256 * 1024;
const str = (max = 200) => ({ type: 'string', minLength: 1, maxLength: max });
const optStr = (max = 200) => ({ type: 'string', maxLength: max });
const msg = (props, required = []) => ({ type: 'object', properties: { type: str(40), id: optStr(80), ...props }, required: ['type', ...required], additionalProperties: false });

export const CLIENT_MESSAGES = {
  hello: msg({ clientId: str(80), version: optStr(40), convId: str(64) }, ['clientId']),
  ping: msg({}),
  'chat.send': msg({ convId: str(64), text: { type: 'string', minLength: 1, maxLength: 8000 }, effort: { enum: EFFORTS }, code: { type: 'boolean' } }, ['text']),
  'chat.abort': msg({ convId: str(64) }, ['convId']),
  'mode.set': msg({ mode: { enum: MODES } }, ['mode']),
  'backend.set': msg({ backend: { enum: ['local', 'claude'] } }, ['backend']),
  'target.set': msg({ target: { enum: ['pc', 'mac'] } }, ['target']),
  'gate.reply': msg({ decision: { enum: ['approve', 'deny'] } }, ['id', 'decision']),
  'agent.task': msg({ prompt: { type: 'string', minLength: 1, maxLength: 8000 }, workspace: optStr(200) }, ['prompt']),
  'agent.abort': msg({ taskId: str(80) }, ['taskId']),
  'digest.get': msg({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
  'digest.run': msg({}),
  'voice.start': msg({ mode: { enum: ['push_to_talk', 'wake_word', 'open'] } }),
  'voice.stop': msg({}),
  'voice.barge_in': msg({}),
  'action.invoke': msg({ name: str(48), args: { type: 'object' } }, ['name']),
  'wake.pc': msg({}),
  'reminder.dismiss': msg({ reminderId: str(80) }, ['reminderId']),
};

// msg.id is echoed in replies; gate.reply uses id as the request id.
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME) return { ok: false, error: 'message too large or not text' };
  let m;
  try { m = JSON.parse(raw); } catch { return { ok: false, error: 'not JSON' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return { ok: false, error: 'missing type' };
  if (!Object.hasOwn(CLIENT_MESSAGES, m.type)) return { ok: false, error: `unknown message type "${m.type.slice(0, 40)}"` };
  const bad = validate(CLIENT_MESSAGES[m.type], m);
  return bad.length ? { ok: false, error: bad[0] } : { ok: true, msg: m };
}

// Server -> client types that every client receives from the bus. Anything not listed here stays inside the server.
export const BROADCAST = new Set([
  'chat.delta', 'chat.done', 'chat.error', 'chat.title', 'chat.state', 'tool.call', 'tool.result', 'agent.step',
  'gate.request', 'gate.resolved', 'gate.queued', 'target.changed', 'telemetry', 'agent.status',
  'digest.ready', 'digest.error', 'health', 'reminder.fire', 'auth.banner', 'chat.note', 'mode', 'backend', 'memory.added', 'memory.removed',
]);
