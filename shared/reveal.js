// Control, zero-width and direction-changing characters are shown as codes ([U+202E]) so a request on an approval card cannot hide
// or reorder what it does. Used by the desktop dialog and the phone sheet.
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const HIDDEN_ONE = new RegExp(HIDDEN.source);
export const revealHidden = (s) => String(s ?? '').replace(HIDDEN, (c) => `[U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
export const hasHidden = (s) => HIDDEN_ONE.test(String(s ?? ''));
