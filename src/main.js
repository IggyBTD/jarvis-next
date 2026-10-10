// JARVIS Next: the front end. The logic modules in core/ are the ones JARVIS uses (LM Studio
// client, telemetry, memory, agent actions, voice); only the shell, workspace and CSS are new.
// Self-hosted fonts (Latin subset only): UI sans, serif for the assistant's prose, mono for numbers and code.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/source-serif-4/latin-400.css';
import '@fontsource/source-serif-4/latin-400-italic.css';
import '@fontsource/source-serif-4/latin-600.css';
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
