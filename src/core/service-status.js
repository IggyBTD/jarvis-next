// The service stack in the header notch: one mark per service JARVIS depends on, so a failure
// shows WHERE it comes from. No text in the notch: the state is the shape (filled circle = ok,
// diamond = error, hollow ring = not in use or still waiting) plus colour, and the tooltip names
// the service and says why. Sources call reportService(); the list is the SERVICES array.
const SERVICES = [
  ['lmstudio', 'LM Studio'],
  ['sensors', 'Sensors'],
  ['voice', 'Voice'],
  ['server', 'JARVIS server'],
];

const root = document.getElementById('notch-status');
const status = new Map(SERVICES.map(([id, label]) => [id, { label, state: 'idle', detail: 'waiting' }]));
const marks = new Map();

for (const [id, label] of SERVICES) {
  const el = document.createElement('span');
  el.className = 'svc';
  el.setAttribute('role', 'listitem');
  root?.append(el);
  marks.set(id, el);
  paint(id);
}

function paint(id) {
  const { label, state, detail } = status.get(id);
  const el = marks.get(id);
  if (!el) return;
  el.dataset.state = state;
  const text = `${label}: ${state === 'ok' ? 'ok' : state === 'error' ? 'error' : 'idle'}${detail ? `, ${detail}` : ''}`;
  el.title = text;
  el.setAttribute('aria-label', text);
}

// state: 'ok' | 'error' | 'idle' (not in use, or no answer yet). detail is a few plain words.
export function reportService(id, state, detail = '') {
  const s = status.get(id);
  if (!s || (s.state === state && s.detail === detail)) return;
  s.state = state;
  s.detail = detail;
  paint(id);
}

export const getServices = () => [...status].map(([id, s]) => ({ id, ...s }));
