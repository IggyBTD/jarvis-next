# CLI page: design brief

Written in session 5 from the user's reference screenshot ("FORGE" mockup: scratch workspace, skills and context on the left, a task stream with a plan card in the middle, staged diff and publish on the right, prompt line at the bottom). The user asked for the same structure, much simpler, in the JARVIS HUD style.

## What the reference does, and what was kept

| Reference | Kept as | Dropped |
| --- | --- | --- |
| Three fixed columns, a wide centre | Same: files left, session centre, changes right | Nothing else in the layout |
| Corner-bracket cards, mono type, thin lines | Same (the existing `.tech-card`, `.card-header`) | Amber accent, gate counter, target and model pills in the header |
| Task stream with lanes, chips, plan card | The session transcript (the real conversation, tool cards, diff cards) | Lane chips, task numbers, a separate plan card |
| Skills list, publish card, scratch-workspace labels | Not built | All of it until the features exist |
| Staged diff with file tabs | A plain list of files changed this session | Tabs and the inline diff (diff cards already show in the session) |
| Prompt line with send button | The one input field every page already has | A second prompt, a send button |

## Principles

1. **Rigid frame, flexible edges.** The three panels are docked in fixed slots, not free-floating. Flexibility is limited to what pays for itself: drag the two splitters to resize the side columns (8 px grid), hide either side column, and the keyboard does the same.
2. **The session never moves.** It is the only panel that cannot be hidden.
3. **Only real data.** Every number on the page comes from something that already exists (project folder, context use, edit and write actions). No placeholder figures. Where there is nothing, one muted line says so.
4. **No new vocabulary.** Same tokens, same type scale, same motion budget as the other pages. One accent, red only for errors.

## Better prompt (the user's request, restated so it can be reused)

> Build the CLI page on the existing empty page shell (grid, header, notch, dock, shared input field). Use the attached mockup as the structural reference, but cut it to the minimum: three docked panels (workspace on the left, session in the centre, changes on the right), plus a small context readout under the workspace. Keep the HUD look (corner brackets, mono type, cyan on near-black, red only for errors); do not copy the mockup's amber or its extra chips. Panels are rigid: fixed slots, session always visible, side columns resizable by dragging a splitter and hideable. Show only real data (project folder and its files, context use, files edited this session). Empty states are one muted line. Say what is unfinished at the end.

What the original prompt left open, and the answer chosen: which panels stay (workspace, session, changes), what "flexible" means (resize and hide, not free dragging), whether to copy the colours (no), whether placeholder content is wanted (no), and where the prompt line goes (the shared field, unchanged).

## Not built yet (next)

(Built later in session 5: floating panels, clickable changed files opening a diff panel, floating approval requests.) Still to do: terminal output and skills panels; a task or plan strip; a file preview; remembering a different layout per project.
