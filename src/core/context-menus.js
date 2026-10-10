// What a right-click offers on a message, a workspace tab, the sidebar and the message field.
// (Chats in the sidebar are in chat-list.js; the generic window items stay in native-chrome.js.)
import { registerContext } from './native-chrome.js';
import { closePanelById, openPanelIds } from './whiteboard.js';
import { setPage } from './whiteboard-mode.js';
import { run } from './chat-list.js';

const copy = (text) => navigator.clipboard.writeText(text).catch(() => {});
const selected = () => String(window.getSelection() || '').trim();
const lastOf = (line) => { const all = [...document.querySelectorAll('#chat-output .chat-line.assistant')]; return all[all.length - 1] === line; };

// a message: copy what was picked or the whole text; the last answer can be redone, your own message edited
registerContext('#chat-output .chat-line.user, #chat-output .chat-line.assistant', (line) => {
  const text = line.querySelector('.chat-text')?.innerText.trim() ?? '';
  const items = [];
  if (selected()) items.push(['Copy selection', () => copy(selected()), true]);
  items.push(['Copy message', () => copy(text), !!text]);
  if (line.classList.contains('user')) {
    const edit = line.querySelector('.chat-edit');
    if (edit) items.push(['Edit and resend', () => edit.click(), true]);
  } else if (lastOf(line)) items.push('sep', ['Regenerate answer', () => run('/retry'), true]);
  return items;
});

// a workspace tab
registerContext('.ws-tab', (tab) => {
  const id = tab.dataset.id;
  if (!id) return [];
  const others = openPanelIds().filter((x) => x !== id);
  return [
    ['Close tab', () => closePanelById(id), true],
    ['Close other tabs', () => others.forEach(closePanelById), others.length > 0],
    ['Close all tabs', () => openPanelIds().forEach(closePanelById), true],
  ];
});

// empty space in the sidebar
registerContext('#sidebar', (_, target) => {
  if (target.closest('button, input, #mini-sys')) return [];
  return [
    ['New chat', () => document.getElementById('new-chat').click(), true],
    ['New project', () => { setPage('projects'); document.dispatchEvent(new CustomEvent('jarvis:new-project')); }, true],
    ['Search chats', () => document.dispatchEvent(new CustomEvent('jarvis:search-chats')), true],
    'sep',
    ['Settings', () => setPage('settings'), true],
  ];
});
