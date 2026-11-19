// Routines (config/routines.json): named OS actions. Pure helpers here; actions.js runs the steps.
// A message that is exactly a routine's phrase runs it without the model: deterministic, instant,
// and it still works when no model is loaded.
const FILLER = /^(?:(?:hey )?jarvis|please|ok|okay)\b\s*|\s*\b(?:please|now|thanks)$/g;
export const normalise = (text) => {
  let t = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  for (let before = ''; before !== t;) { before = t; t = t.replace(FILLER, '').trim(); }
  return t;
};

export function matchRoutine(text, routines) {
  const t = normalise(text);
  return t ? routines.find((r) => r.phrases.some((p) => normalise(p) === t)) ?? null : null;
}
