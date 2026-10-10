// Keyboard shortcuts: Ctrl plus a key for the things you would otherwise reach for with the mouse.
// Chosen to avoid what a text field or the webview already does with Ctrl (A, C, V, X, Z, F, R, P).
// They work while typing in the message field. /keys lists them in the app.
import { isWhiteboardMode, enterWhiteboardMode, exitWhiteboardMode, setPage } from './whiteboard-mode.js';
import { toggleWidget, openArtifact, closePanelById, openPanelIds } from './whiteboard.js';
import { listArtifacts } from './artifacts.js';
import { zoomBy, zoomReset } from './zoom.js';

const input = document.getElementById('hud-chat-input');
const PRESETS = ['btn-general', 'btn-code', 'btn-visual', 'btn-abliterated'];

export const SHORTCUTS = [
  { keys: 'Ctrl+B', does: 'Show or hide the workspace beside the chat' },
  { keys: 'Ctrl+I', does: 'Open or close the System tab' },
  { keys: 'Ctrl+1 to 9', does: 'Open or close the tab of the 1st to 9th artifact of this session' },
  { keys: 'Ctrl+\\', does: 'Hide or show the sidebar' },
  { keys: 'Ctrl+,', does: 'Open Settings' },
  { keys: 'Ctrl+ + / Ctrl+ - / Ctrl+0', does: 'Zoom the app in, out, or back to 100% (Ctrl and the mouse wheel too)' },
  { keys: 'Ctrl+L', does: 'Jump to the message field' },
  { keys: 'Ctrl+.', does: 'Stop the reply that is running' },
  { keys: 'Ctrl+M', does: 'Microphone on or off' },
  { keys: 'F8 (hold)', does: 'Talk while held, release to send (keys are in config/voice.json)' },
  { keys: 'F9', does: 'Press to start talking, press again to send' },
  { keys: 'Ctrl+Shift+1 to 4', does: 'Mode: general, coding / finance, visual, abliterated' },
  ];

function togglePanelNumber(n) {
  const artifact = listArtifacts()[n - 1];
  if (!artifact) return;
  if (openPanelIds().includes(artifact.id)) closePanelById(artifact.id);
  else openArtifact(artifact.id);
}

// Returns true when the key was a shortcut (and has been handled).
function run(e) {
  const key = e.key.toLowerCase();
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
  if (e.shiftKey && key !== '+') {
    if (digit && Number(digit) <= PRESETS.length) document.getElementById(PRESETS[Number(digit) - 1])?.click();
    else return false;
    return true;
  }
  if (digit && key !== '0') togglePanelNumber(Number(digit));
  else if (key === 'b') (isWhiteboardMode() ? exitWhiteboardMode : enterWhiteboardMode)();
  else if (key === 'i') toggleWidget('system');
  else if (key === 'l') input.focus();
  else if (key === '\\') document.dispatchEvent(new CustomEvent('jarvis:sidebar'));
  else if (key === ',') setPage('settings');
  else if (key === '=' || key === '+') zoomBy(1);
  else if (key === '-') zoomBy(-1);
  else if (key === '0') zoomReset();
  else if (key === '.') document.dispatchEvent(new CustomEvent('jarvis:stop'));
  else if (key === 'm') document.getElementById('dock-mic')?.click();
  else return false;
  return true;
}

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
  if (e.repeat) { e.preventDefault(); return; }
  if (run(e)) e.preventDefault();
}, true);

// Ctrl and the wheel zooms too (the webview would do it by itself, but not remember it).
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
