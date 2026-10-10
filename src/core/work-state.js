// What the agent is working on: the task checklist and plan mode. Pure state, no DOM, so node can
// test it. The UI (cli-page.js, chat-ui.js) subscribes; the model changes it through the
// set_tasks and submit_plan actions (actions.js); the user through /plan and /tasks.
const STATUSES = ['todo', 'doing', 'done'];
const MAX_TASKS = 30;
const MAX_TEXT = 160;

let tasks = [];
let planMode = false;
const taskListeners = new Set();
const planListeners = new Set();

export const getTasks = () => tasks.map((t) => ({ ...t }));
export const onTasks = (cb) => { taskListeners.add(cb); return () => taskListeners.delete(cb); };
export const isPlanMode = () => planMode;
export const onPlanMode = (cb) => { planListeners.add(cb); return () => planListeners.delete(cb); };

// Accepts what a small model sends: strings, or { text, status }. Returns { tasks } or { error }.
export function parseTasks(list) {
  if (!Array.isArray(list)) return { error: 'tasks must be a list' };
  if (list.length > MAX_TASKS) return { error: `at most ${MAX_TASKS} tasks` };
  const out = [];
  for (const item of list) {
    const raw = typeof item === 'string' ? { text: item } : item;
    const text = String(raw?.text ?? raw?.task ?? '').trim().slice(0, MAX_TEXT);
    if (!text) return { error: 'every task needs text' };
    const status = String(raw?.status ?? 'todo').toLowerCase().replace('in_progress', 'doing').replace('pending', 'todo').replace('complete', 'done').replace('completed', 'done');
    if (!STATUSES.includes(status)) return { error: `status must be one of ${STATUSES.join(', ')}` };
    out.push({ text, status });
  }
  if (out.filter((t) => t.status === 'doing').length > 1) return { error: 'only one task can be doing at a time' };
  return { tasks: out };
}

export function setTasks(list) {
  const r = parseTasks(list);
  if (r.error) return r;
  tasks = r.tasks;
  taskListeners.forEach((cb) => cb(getTasks()));
  return { count: tasks.length };
}

export const clearTasks = () => setTasks([]);

const MARK = { todo: '[ ]', doing: '[~]', done: '[x]' };
export const formatTasks = (list = tasks) => list.map((t, i) => `${i + 1}. ${MARK[t.status]} ${t.text}`).join('\n');
export const taskSummary = (list = tasks) => `${list.filter((t) => t.status === 'done').length} of ${list.length} done`;

export function setPlanMode(on) {
  if (planMode === on) return;
  planMode = on;
  planListeners.forEach((cb) => cb(on));
}

// Actions that change things; refused while plan mode is on. Reads, searches and the plan itself pass.
export const PLAN_BLOCKED = ['edit_file', 'write_file', 'run_command'];
export const planRefusal = (actionName) => (planMode && PLAN_BLOCKED.includes(actionName)
  ? 'Plan mode is on: you may read and search, but not change anything. Finish your research, then call submit_plan with the steps; the user will approve it'
  : null);

// Extra system-prompt text for this turn: the task list (so it survives compaction) and plan mode.
export function workContext() {
  const parts = [];
  if (planMode) {
    parts.push('<plan-mode>\nPlan mode is ON. Do not change anything. Read and search to understand the task, then call submit_plan once with a short summary and the ordered steps (each step one concrete action). Do not start the work until the user approves the plan.\n</plan-mode>');
  }
  if (tasks.length) parts.push(`<tasks>\nYour current task list (change it with set_tasks; keep exactly one task doing while you work):\n${formatTasks()}\n</tasks>`);
  return parts.join('\n\n');
}
