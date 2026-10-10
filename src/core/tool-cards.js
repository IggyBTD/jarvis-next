// Transcript cards for the agent's actions: what it read, searched, changed and ran, and the
// approval card for anything that needs the user's say. All text goes in through textContent, never
// innerHTML, because file contents and command output are untrusted. Styles: index.html (.tool-card).
import { lineDiff } from './diff.js';

const MAX_ROWS = 400;     // diff rows drawn per card; the rest is summarised
const MAX_BODY_CHARS = 20000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, title) {
  const b = el('button', `tc-btn ${className ?? ''}`.trim(), label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

function head(tag, type, title, state) {
  const h = el(tag, 'tc-head');
  h.append(el('span', 'tc-type', type), el('span', 'tc-title', title), el('span', 'tc-state', state ?? ''));
  return h;
}

const clip = (text) => (text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n...[${text.length - MAX_BODY_CHARS} more characters]` : text);

export function diffBody(display) {
  const { hunks, added, removed } = lineDiff(display.before ?? '', display.after ?? '');
  const body = el('div', 'tc-diff');
  let rows = 0;
  for (const [i, hunk] of hunks.entries()) {
    if (i > 0) body.append(el('div', 'tc-gap', '...'));
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const line of hunk.lines) {
      if (rows++ >= MAX_ROWS) {
        body.append(el('div', 'tc-gap', `... ${hunks.length - i} more change block(s) not shown`));
        return { body, added, removed };
      }
      const row = el('div', `tc-row ${line.t}`);
      const no = line.t === 'del' ? oldNo : newNo;
      row.append(el('span', 'tc-no', String(no)), el('span', 'tc-sign', line.t === 'add' ? '+' : line.t === 'del' ? '-' : ' '), el('span', 'tc-code', line.text));
      body.append(row);
      if (line.t !== 'add') oldNo++;
      if (line.t !== 'del') newNo++;
    }
  }
  if (!hunks.length) body.append(el('div', 'tc-gap', 'no visible change'));
  return { body, added, removed };
}

// A finished action as a card. display comes from the action handler (actions.js); onUndo(undoInfo)
// restores the file and rejects if it has changed since.
export function actionCard(display, { onUndo } = {}) {
  const line = el('div', 'chat-line tool');
  const card = el('details', 'tool-card');
  line.append(card);

  if (display.kind === 'diff') {
    const { body, added, removed } = diffBody(display);
    // collapsed: the header says which file and how many lines changed, a click shows the lines
    card.append(head('summary', display.created ? 'New' : 'Edit', display.path, `+${added} -${removed}`));
    card.append(body);
    const bar = el('div', 'tc-bar');
    const undo = button('Undo', '', 'Put the file back the way it was');
    const status = el('span', 'tc-note');
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      try {
        await onUndo(display.undo);
        status.textContent = display.created ? 'File removed.' : 'Change undone.';
        card.classList.add('undone');
        undo.remove();
      } catch (e) {
        status.textContent = String(e?.message ?? e);
        undo.disabled = false;
      }
    });
    bar.append(undo, status);
    card.append(bar);
  } else if (display.kind === 'command') {
    card.open = !display.ok;
    if (!display.ok) card.classList.add('bad');
    card.append(head('summary', 'Run', display.command, display.status));
    card.append(el('pre', 'tc-output', clip(display.output || '(no output)')));
  } else {
    card.append(head('summary', display.title.split('  ')[0], display.title.split('  ').slice(1).join('  '), display.meta));
    card.append(el('pre', 'tc-output', clip(display.body || '(nothing)')));
  }
  return line;
}

// What the approval card says about a call.
function describe(request) {
  const a = request.args;
  switch (request.name) {
    case 'run_command': return { type: 'RUN', title: a.command };
    case 'write_file': return { type: 'Write', title: a.path };
    case 'edit_file': return { type: 'Edit', title: a.path };
    case 'read_file': return { type: 'Read', title: a.path };
    default: return { type: request.name.replace(/_/g, ' '), title: request.primary ?? '' };
  }
}

// Asks the user. Returns { el, answer: Promise<'once'|'always'|'deny'>, cancel() }.
export function approvalCard(request) {
  const line = el('div', 'chat-line tool');
  const card = el('div', 'tool-card approval');
  line.append(card);
  const { type, title } = describe(request);
  card.append(head('div', type, title, 'Needs approval'));
  const detail = request.name === 'edit_file' ? `Replace:\n${request.args.old_text}\n\nWith:\n${request.args.new_text}`
    : request.name === 'write_file' ? clip(request.args.content ?? '') : null;
  if (detail) card.append(el('pre', 'tc-output', detail.slice(0, 4000)));
  card.append(el('div', 'tc-note', request.reason ? `${request.reason}.` : ''));

  const bar = el('div', 'tc-bar');
  const once = button('Allow once', '');
  const always = button('Always allow', '', `Adds the rule ${request.suggestedRule} to your permission list`);
  const deny = button('Deny', 'deny');
  bar.append(once, always, deny, el('span', 'tc-rule', request.suggestedRule));
  card.append(bar);

  return answerable(line, card, bar, [[once, 'once', 'Allowed this time.'], [always, 'always', `Always allowed: ${request.suggestedRule}`], [deny, 'deny', 'Denied.']], 'deny');
}

// Makes an approval card answerable. choices: [[button, value, text shown afterwards]]; refusal is
// the value that means "no" (also used when the card is cancelled). Returns { el, answer, cancel }.
function answerable(line, card, bar, choices, refusal) {
  let settle;
  const answer = new Promise((resolve) => { settle = resolve; });
  const decide = (value, text) => {
    if (!card.isConnected && value !== refusal) return;
    settle(value);
    bar.replaceChildren(el('span', 'tc-note', text));
    card.classList.add(value === refusal ? 'denied' : 'approved');
    card.querySelector('.tc-state').textContent = value === refusal ? 'Denied' : 'Approved';
  };
  for (const [btn, value, text] of choices) btn.addEventListener('click', () => decide(value, text));
  return { el: line, answer, cancel: () => decide(refusal, 'Cancelled.') };
}

// Plan mode: the plan the model proposes. Resolves 'approve' | 'reject'.
export function planCard({ summary, steps }) {
  const line = el('div', 'chat-line tool');
  const card = el('div', 'tool-card approval');
  line.append(card);
  card.append(head('div', 'Plan', summary, 'Needs approval'));
  card.append(el('pre', 'tc-output', steps.map((s, i) => `${i + 1}. ${s}`).join('\n')));
  card.append(el('div', 'tc-note', 'Nothing is changed until you approve. If you reject, tell JARVIS what to change.'));
  const bar = el('div', 'tc-bar');
  const approve = button('Approve plan', '', 'Leave plan mode and start on step 1');
  const reject = button('Reject', 'deny', 'Stay in plan mode; the model is told');
  bar.append(approve, reject);
  card.append(bar);
  return answerable(line, card, bar, [[approve, 'approve', 'Plan approved.'], [reject, 'reject', 'Plan rejected.']], 'reject');
}
