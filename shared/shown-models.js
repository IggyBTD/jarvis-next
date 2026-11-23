// The models the model switcher lists until a person ticks others in Settings, in the order they are listed. Shared by the desktop
// switcher (src/core/models-shown.js) and the phone's model sheet. LM Studio lists the 27B as "qwen3.8-27b" where the server config
// calls it "unsloth/qwen3.8-27b", so a key matches with or without its publisher.
export const DEFAULT_SHOWN = ['qwen3.8-27b', 'huihui-qwen3.8-27b-abliterated', 'qwen/qwen3-14b'];
export const sameKey = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
export const shownOrder = (key) => { const i = DEFAULT_SHOWN.findIndex((k) => sameKey(k, key)); return i < 0 ? DEFAULT_SHOWN.length : i; };
