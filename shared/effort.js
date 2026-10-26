// Effort: how much work the model is asked to put into an answer. It is only a note on the newest user message (the system prompt
// stays the same, so the model server keeps its cache). Medium is the default and adds nothing. It does not change thinking length.
export const EFFORTS = ['low', 'medium', 'high', 'max'];
export const DEFAULT_EFFORT = 'medium';
export const EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };
export const EFFORT_HINTS = {
  low: 'Short answers, little deliberation',
  medium: 'The default',
  high: 'Researches what could use it, then checks its work',
  max: 'Researches everything, plans, then checks thoroughly',
};
const NOTES = {
  low: '[Effort: low. Answer briefly and directly, without overthinking.]',
  high: '[Effort: high. Research anything that could benefit from it, and anything that seems untrue before you rely on it. Then do the work the request needs and check it briefly.]',
  max: '[Effort: max. Research what the request is about, and research everything involved in depth. Then make a plan for the best way to carry out the request, carry it out, and check the result thoroughly afterwards.]',
};
export const effortNote = (effort) => NOTES[effort] ?? '';
