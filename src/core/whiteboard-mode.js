// Page router and workspace switch. Replaces the old full-window "whiteboard mode".
// Pages: chat, code, artifacts, settings (body[data-page]). The old names are kept because chat-ui,
// actions, commands and shortcuts call them: "whiteboard mode" now means "the workspace beside
// the chat is shown" (body.ws-off when hidden).
export const PAGES = ['chat', 'code', 'intel', 'projects', 'artifacts', 'scheduled', 'customize', 'settings'];

let page = 'chat';
let wsOn = true;
try { wsOn = localStorage.getItem('jarvis.ws') !== 'off'; } catch { /* storage blocked */ }
document.body.classList.toggle('ws-off', !wsOn);

export const currentPage = () => page;

export function setPage(next) {
  if (!PAGES.includes(next) || next === page) return;
  page = next;
  document.body.dataset.page = next;
  document.dispatchEvent(new CustomEvent('jarvis:page', { detail: { page: next } }));
}

export const isWhiteboardMode = () => wsOn;
export function setWorkspaceShown(on) {
  if (on === wsOn) return;
  wsOn = on;
  document.body.classList.toggle('ws-off', !on);
  try { localStorage.setItem('jarvis.ws', on ? 'on' : 'off'); } catch { /* storage blocked */ }
  document.dispatchEvent(new CustomEvent('jarvis:workspace', { detail: { shown: on } }));
}
export const enterWhiteboardMode = () => { setWorkspaceShown(true); if (page !== 'chat' && page !== 'code') setPage('chat'); };
export const exitWhiteboardMode = () => setWorkspaceShown(false);
