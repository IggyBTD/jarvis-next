// JARVIS Next: the front end. The logic modules in core/ are the ones JARVIS uses (LM Studio
// client, telemetry, memory, agent actions, voice); only the shell, workspace and CSS are new.
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
