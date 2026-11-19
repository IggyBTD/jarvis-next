// Bottom dock: microphone, attach files, internet access, network link.
import { getSwitches, onSwitchChange, setMic, setInternet, setLink } from './switches.js';
import { addFile, removeAttachment, onAttachmentsChange } from './attachments.js';
import { icon } from './icons.js';
import { getThink, setThink, onEvent } from './llm-client.js';
import { getPermMode, onPermMode, isPlanMode, onPlanMode, cycleMode } from './work-state.js';

const $ = (id) => document.getElementById(id);
const micBtn = $('dock-mic');
const attachBtn = $('dock-attach');
const webBtn = $('dock-web');
const linkBtn = $('dock-link');
const fileInput = $('attach-input');
const attachRow = $('attach-row');

function paint(btn, on, glyphOn, glyphOff, titleOn, titleOff) {
  btn.classList.toggle('is-on', on);
  btn.classList.toggle('is-off', !on);
  btn.firstElementChild.innerHTML = icon(on ? glyphOn : glyphOff);
  btn.title = on ? titleOn : titleOff;
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(on));
}

function renderSwitches(s) {
  paint(micBtn, s.mic, 'mic', 'mic_off', 'Microphone on (click to turn off)', 'Microphone off (click to turn on)');
  paint(webBtn, s.internet, 'language', 'public_off', 'Internet access on (click to block)', 'Internet access blocked (click to allow)');
  paint(linkBtn, s.link, 'wifi', 'wifi_off', 'Network link on (click to cut all connections)', 'Network link cut: nothing can connect (click to restore)');
}

micBtn.addEventListener('click', async () => {
  try {
    await setMic(!getSwitches().mic);
  } catch (e) {
    console.warn('[jarvis] microphone unavailable:', e);
    micBtn.title = `Microphone unavailable: ${e.message}`;
  }
});
webBtn.addEventListener('click', () => setInternet(!getSwitches().internet));
linkBtn.addEventListener('click', () => setLink(!getSwitches().link));

// Think: off by default (Qwen overthinks); on, the reasoning is capped (models.json think_budget).
const thinkBtn = $('think-btn');
const paintThink = () => {
  thinkBtn.setAttribute('aria-pressed', String(getThink()));
  thinkBtn.title = getThink() ? 'Thinking on: JARVIS reasons first, up to a budget (click to turn off)' : 'Thinking off: fast answers (click to let JARVIS think first)';
};
thinkBtn.addEventListener('click', () => setThink(!getThink()));
onEvent((e) => { if (e.type === 'think') paintThink(); });

// Permission mode chip: hidden in normal mode; Careful or Plan otherwise. Click or Shift+Tab cycles.
const permChip = $('perm-chip');
const paintPerm = () => {
  const label = isPlanMode() ? 'Plan' : getPermMode() === 'careful' ? 'Careful' : '';
  permChip.hidden = !label;
  permChip.textContent = label;
  permChip.title = isPlanMode() ? 'Plan mode: JARVIS only reads until you approve a plan (Shift+Tab: normal)'
    : 'Careful mode: JARVIS asks before every change (Shift+Tab: plan)';
};
permChip.addEventListener('click', cycleMode);
onPermMode(paintPerm);
onPlanMode(paintPerm);
$('hud-chat-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  cycleMode();
});
paintPerm();
paintThink();

// --- attachments ---------------------------------------------------------
// Files that could not be read are shown in the attach row (in red) until clicked or until
// the next pick, so a refused file is never silent.
let attached = [];
let errors = [];
let reading = 0;

function renderRow() {
  const chips = attached.map((f, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'attach-chip';
    chip.textContent = `+ ${f.name}  x`;
    chip.title = f.kind === 'image' ? 'Image. Click to remove' : `${f.content.length.toLocaleString()} characters of text. Click to remove`;
    chip.setAttribute('aria-label', `Remove ${f.name}`);
    chip.addEventListener('click', () => removeAttachment(i));
    return chip;
  });
  if (reading) {
    const busy = document.createElement('span');
    busy.className = 'attach-chip busy';
    busy.textContent = 'Reading file...';
    chips.push(busy);
  }
  errors.forEach((message, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'attach-chip error';
    chip.textContent = `Not attached: ${message}`;
    chip.title = 'Dismiss';
    chip.addEventListener('click', () => { errors.splice(i, 1); renderRow(); });
    chips.push(chip);
  });
  attachRow.replaceChildren(...chips);
}

export async function attachFiles(fileList) {
  errors = [];
  const files = [...fileList];
  for (const file of files) {
    reading += 1;
    renderRow();
    const err = await addFile(file);
    reading -= 1;
    if (err) errors.push(err);
    renderRow();
  }
}

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const picked = [...fileInput.files];
  fileInput.value = '';
  await attachFiles(picked);
});

onAttachmentsChange((files) => {
  attached = files;
  renderRow();
  attachBtn.querySelector('.dock-badge')?.remove();
  if (files.length) {
    const badge = document.createElement('span');
    badge.className = 'dock-badge';
    badge.textContent = files.length;
    attachBtn.append(badge);
  }
});

onSwitchChange(renderSwitches);
renderSwitches(getSwitches());
