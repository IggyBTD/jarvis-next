// JARVIS Next: the front end. The logic modules in core/ are the ones JARVIS uses (LM Studio
// client, telemetry, memory, agent actions, voice); only the shell, workspace and CSS are new.
// Self-hosted fonts (Latin subset only): UI sans, serif for the assistant's prose, mono for numbers and code.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-serif/latin-400.css';
import '@fontsource/ibm-plex-serif/latin-400-italic.css';
import '@fontsource/ibm-plex-serif/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import { initTelemetry } from './core/telemetry-view.js';

initTelemetry();
import './core/chat-ui.js';
import './core/model-panel.js';
import './core/dock-ui.js';
import './core/window-controls.js';
import './core/cli-page.js';
import './core/native-chrome.js';
import './core/shortcuts.js';
import './core/sysview.js';
import './core/shell.js';
import './core/usage.js';
import './core/code-home.js';

// Dev only: Ctrl+Shift+I opens the icon switcher. Vite drops this branch from production builds.
if (import.meta.env.DEV) import('./dev/icon-switcher.js');
// Dev only: Ctrl+Shift+G draws the 4 px grid and every element's box.
if (import.meta.env.DEV) import('./dev/grid-overlay.js');
