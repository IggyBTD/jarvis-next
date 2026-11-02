// What each chat in the list is doing, from what the server has told this window. Pure, so it can be tested without a page.
//   'waiting'  an approval is asked for a coding task that belongs to the chat
//   'running'  the model is answering in it, or a coding task of it is queued or running
//   'unseen'   it finished while another chat was open
// A chat with nothing to show is not in the map. The most urgent state wins: waiting, then running, then unseen.
const ACTIVE_TASK = new Set(['queued', 'running']);

export function chatStates({ running = [], agentTasks = [], pending = [], unseen = [] }) {
  const out = new Map();
  for (const id of unseen) out.set(id, 'unseen');
  const tasks = agentTasks.filter((t) => t.convId && ACTIVE_TASK.has(t.state));
  for (const id of running) out.set(id, 'running');
  for (const t of tasks) out.set(t.convId, 'running');
  for (const p of pending) {
    const t = p.taskId && tasks.find((x) => x.taskId === p.taskId);
    if (t) out.set(t.convId, 'waiting');
  }
  return out;
}
