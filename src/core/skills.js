// Skills: loose files in skills/<name>/SKILL.md (YAML-ish frontmatter with name and description,
// then instructions). The Rust side lists the files (skills.rs); everything else is here and pure
// except loadSkills. The model sees the names and descriptions each turn and loads a body with the
// use_skill action; the user runs one with /skill <name> or /<name>.
const MAX_BODY = 12000;

// "---\nname: x\ndescription: y\n---\nbody". Returns null when there is no usable name.
export function parseSkill(text, dir = '') {
  const m = String(text).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = {};
  let body = String(text);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    body = m[2];
  }
  const name = (meta.name || dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (!name) return null;
  return { name, description: meta.description || '', body: body.trim().slice(0, MAX_BODY) };
}

let skills = [];
export const getSkills = () => skills.map(({ name, description }) => ({ name, description }));
export const findSkill = (name) => skills.find((s) => s.name === String(name).toLowerCase().replace(/^\//, ''));

export async function loadSkills() {
  if (!window.__TAURI_INTERNALS__) { skills = []; return 0; }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const files = await invoke('skills_list');
    skills = files.map((f) => parseSkill(f.text, f.dir)).filter(Boolean);
  } catch (e) {
    console.warn('[jarvis] skills unavailable:', e);
    skills = [];
  }
  return skills.length;
}

// For the system prompt: names and one-line descriptions only, so the list stays cheap.
export function skillsContext() {
  if (!skills.length) return '';
  return `<skills>\nSkills you can load with use_skill when the task matches:\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}\n</skills>`;
}

// What /skill <name> <args> sends as the user's message.
export const skillPrompt = (skill, args) => `Follow the skill "${skill.name}":\n\n${skill.body}${args ? `\n\nTask: ${args}` : ''}`;
