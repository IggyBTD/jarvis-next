// System prompt = base.md + target-<os>.md, rendered with live facts from the target agent's GET /info (refreshed at
// session start and on every switch), plus a per-turn local clock in the schedule timezone. No machine fact is hardcoded.
// An unreachable agent gives a prompt that says so instead of guessed facts.
const FIELDS = ['label', 'os', 'os_version', 'hostname', 'user', 'home', 'shell', 'path_sep', 'workspace_dir', 'package_manager', 'modifier_key', 'locale', 'timezone', 'date'];

export function createPromptBuilder({ prompts, machines, timezone, getInfo, notes = () => '' }) {
  const cache = new Map(); // machine -> { facts, reachable, at }

  async function refresh(machine) {
    const m = machines[machine];
    let facts;
    let reachable = true;
    try { facts = await getInfo(machine); } catch { reachable = false; facts = { os: m.os, hostname: m.host, workspace_dir: m.workspaceDir }; }
    // facts come from the OS (host and user names): keep them to one short plain line so they cannot carry instructions or break the template
    facts = Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)]));
    cache.set(machine, { facts, reachable, at: Date.now() });
    return cache.get(machine);
  }

  const clock = (now) => {
    const f = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...opts }).format(now);
    return `${f({ weekday: 'long' })} ${f({ year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-')} ${f({ hour: '2-digit', minute: '2-digit', hour12: false })}`;
  };

  const render = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_m, k) => {
    if (!(k in values)) throw new Error(`prompt placeholder {{${k}}} has no value`);
    return values[k];
  });

  return {
    refresh,
    facts: (machine) => cache.get(machine)?.facts ?? null,
    async build(machine, { now = new Date(), refreshFacts = false } = {}) {
      if (!machines[machine]) throw new Error(`unknown machine ${machine}`);
      const entry = refreshFacts || !cache.has(machine) ? await refresh(machine) : cache.get(machine);
      const m = machines[machine];
      const values = Object.fromEntries(FIELDS.map((k) => [k, 'unknown']));
      // Date only: a clock that changes every minute would change the first tokens of the prompt, and the model server would then re-read the whole conversation on every turn. The time goes on the latest user message (timeNote).
      Object.assign(values, entry.facts, { label: m.label, os: m.os === 'win32' ? 'Windows' : 'macOS', timezone, date: clock(now).replace(/ \d\d:\d\d$/, ''), locale: entry.facts.locale ?? 'en' });
      const base = render(prompts.base, values);
      const os = render(m.os === 'win32' ? prompts['target-pc'] : prompts['target-mac'], values);
      const note = entry.reachable ? '' : `\n\nNote: ${m.label} could not be reached when this prompt was built, so some facts above are unknown. Say so if a task depends on them.`;
      return `${base}\n\n${os}${note}${prompts.ui ? `\n\n${prompts.ui}` : ''}${notes() ? `\n\n${notes()}` : ''}`; // how to write replies and artifacts for the app's screen
    },
    timeNote: (now = new Date()) => `[Local time ${clock(now).slice(-5)}]`,
    switchNotice({ from, to, now = new Date() }) {
      const m = machines[to];
      return render(prompts['switch-notice'], { from: machines[from].label, to: m.label, os: m.os === 'win32' ? 'Windows' : 'macOS', time: clock(now) });
    },
  };
}
