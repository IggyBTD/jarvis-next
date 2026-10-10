// The "/" menu above the message field. Typing "/" lists every slash command with a short
// explanation; each further letter narrows the list. Once the command name is complete and a space
// follows, the menu shrinks to that command's usage line while the arguments are typed.
//
// Keys (while the list is open): Up / Down choose, Tab or Enter complete the chosen command (Enter
// runs it when the field already holds exactly that name), Esc closes. The menu never changes what
// the command does: runCommand in commands.js still receives the finished text, as before.
import { COMMANDS, usage, searchCommands } from './commands.js';

const input = document.getElementById('hud-chat-input');
const panel = input.parentElement;

const root = document.createElement('div');
root.id = 'command-palette';
root.hidden = true;
root.innerHTML = '<ul role="listbox" id="command-list" aria-label="Commands"></ul><div class="cp-usage" aria-hidden="true"></div>';
panel.append(root);
const list = root.querySelector('ul');
const usageLine = root.querySelector('.cp-usage');

let matches = [];   // commands in view
let active = 0;     // index in matches
let hint = false;   // the name is complete: showing the usage of one command, nothing to choose
let dismissed = false; // Esc was pressed; stays shut until the next keystroke

const isOpen = () => !root.hidden;

// The slash, then the command name typed so far, and nothing else (no space, no second line).
const nameTyped = () => input.value.match(/^\/([\w+-]*)$/);
const argsTyped = () => input.value.match(/^\/([\w+-]+)\s/);

function close() {
  root.hidden = true;
  matches = [];
  input.removeAttribute('aria-activedescendant');
  input.setAttribute('aria-expanded', 'false');
}

// Sits just above the field, whichever way the field has grown or wherever the panel lives.
function place() {
  root.style.bottom = `${panel.clientHeight - input.offsetTop + 8}px`;
}

function row(c, q) {
  const li = document.createElement('li');
  li.id = `cmd-${c.name.replace(/\+/g, 'plus').replace(/-/g, 'minus')}`;
  li.setAttribute('role', 'option');
  li.dataset.name = c.name;
  const name = document.createElement('span');
  name.className = 'cp-name';
  name.append('/');
  const at = q ? c.name.indexOf(q) : -1;
  if (at >= 0) {
    const b = document.createElement('b');
    b.textContent = c.name.slice(at, at + q.length);
    name.append(c.name.slice(0, at), b, c.name.slice(at + q.length));
  } else name.append(c.name);
  const desc = document.createElement('span');
  desc.className = 'cp-desc';
  desc.textContent = c.desc;
  li.append(name, desc);
  return li;
}

function paintActive() {
  [...list.children].forEach((li, i) => {
    const on = i === active && !hint;
    li.classList.toggle('active', on);
    li.setAttribute('aria-selected', String(on));
    if (on) {
      li.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', li.id);
      usageLine.textContent = usage(matches[i]);
    }
  });
}

function refresh() {
  if (dismissed || input.value.includes('\n') || !input.value.startsWith('/')) { close(); return; }

  const name = nameTyped();
  const withArgs = argsTyped();
  let q = '';
  if (name) {
    q = name[1].toLowerCase();
    matches = searchCommands(q);
    hint = false;
  } else if (withArgs) {
    const c = COMMANDS.find((x) => x.name === withArgs[1].toLowerCase());
    if (!c) { close(); return; }
    matches = [c];
    hint = true;
  } else { close(); return; }

  list.replaceChildren();
  if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'cp-empty';
    li.setAttribute('role', 'presentation');
    li.textContent = `No command matches /${q}`;
    list.append(li);
    usageLine.textContent = '';
  } else {
    matches.forEach((c) => list.append(row(c, q)));
  }
  active = 0;
  const wasOpen = isOpen();
  root.hidden = false;
  root.classList.toggle('hint', hint);
  if (!wasOpen) { root.classList.remove('enter'); void root.offsetWidth; root.classList.add('enter'); }
  place();
  input.setAttribute('aria-controls', 'command-list');
  input.setAttribute('aria-expanded', 'true');
  if (hint) { usageLine.textContent = usage(matches[0]); input.removeAttribute('aria-activedescendant'); }
  if (matches.length) paintActive();
}

function complete(c) {
  input.value = `/${c.name}${c.args ? ' ' : ''}`;
  input.dispatchEvent(new Event('input')); // regrows the field and refreshes the menu
  input.focus();
}

// Called first by the field's keydown handler. True when the menu used the key.
export function handleCommandKey(e) {
  if (e.isComposing) return false;
  if (!isOpen()) return false;
  if (e.key === 'Escape') { dismissed = true; close(); e.preventDefault(); e.stopPropagation(); return true; }
  if (hint || !matches.length) return false; // nothing to choose: Enter sends as usual
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    paintActive();
    e.preventDefault();
    return true;
  }
  if (e.key === 'Tab' && !e.shiftKey) { complete(matches[active]); e.preventDefault(); return true; }
  if (e.key === 'Enter' && !e.shiftKey) {
    const c = matches[active];
    if (input.value.trim().toLowerCase() === `/${c.name}`) return false; // already complete: run it
    complete(c);
    e.preventDefault();
    return true;
  }
  return false;
}

input.addEventListener('input', () => { dismissed = false; refresh(); });
input.addEventListener('blur', close);
input.addEventListener('focus', () => { if (input.value.startsWith('/')) refresh(); });
window.addEventListener('resize', () => { if (isOpen()) place(); });
new ResizeObserver(() => { if (isOpen()) place(); }).observe(input);

// Mouse: the field keeps focus (mousedown is cancelled), a click completes the command.
list.addEventListener('mousedown', (e) => e.preventDefault());
list.addEventListener('mousemove', (e) => {
  const li = e.target.closest('li[data-name]');
  if (!li || hint) return;
  const i = [...list.children].indexOf(li);
  if (i !== active) { active = i; paintActive(); }
});
list.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-name]');
  const c = li && COMMANDS.find((x) => x.name === li.dataset.name);
  if (c && !hint) complete(c);
});
