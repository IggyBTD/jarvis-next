# JARVIS Next: Feature Checklist

Written 2026-11-19. Ticked items are built on branch `claude/happy-davinci-9bjdd4`. Unticked items come from the feature brainstorm and are not started.

**Rating:** how much the feature would help you, out of 10.

**Size:** XS = under an hour, S = under a day, M = a few sessions, L = one to two weeks, XL = several weeks.

---

## Built (2026-11-19)

### Speed and model control

- [x] **Stable prompt prefix** - 9/10 - S
  The system message is now identical every turn, and per-turn context (memory, tasks, plan mode, voice mode) goes on the end of your latest message instead. LM Studio should then reuse its cache instead of re-reading the whole chat each turn. Still to measure on your PC.

- [x] **Prompt diet and tool gating** - 7/10 - XS
  The old HUD whiteboard and board-layout text is gone from the system prompt. Tools are only offered when they can work: file tools need `/project`, `submit_plan` needs plan mode, web tools need the internet switch.

- [x] **Think toggle with a budget** - 8/10 - S
  Off by default, because Qwen overthinks. The bulb button or `/think` turns it on. Reasoning past `think_budget` (1200 tokens) is cut off and answered from the notes so far.

- [x] **Sampling and load settings per mode** - 7/10 - XS
  `models.json` now sets Qwen3's recommended sampling for thinking on and off, and a 32K context length when a model loads.

### Chat

- [x] **Reply buttons** - 6/10 - XS
  Copy on every reply, a tokens-per-second readout, and Retry on the newest reply.

- [x] **Search across chats** - 7/10 - S
  A search box in the sidebar scans every saved chat and shows a snippet around each match.

- [x] **Rename and delete chats** - 6/10 - XS
  Shown on hover in the chat list. Delete asks a second time on the same button.

### Safety and control

- [x] **Effect classes** - 8/10 - S
  Every action is tagged read, local-write, local-mutate, publish or money, and the tag goes in the audit log. Publish and money always ask, and money never gets "Always allow".

- [x] **Careful mode (Shift+Tab)** - 6/10 - S
  Cycles normal, careful and plan. Careful mode asks before every change.

- [x] **Routines** - 8/10 - M
  Lock screen, game mode (unload the model and switch to the high-performance power plan), end game mode, and open Steam. An exact typed phrase runs with no model call. Windows only, and still to test there.

### Web

- [x] **Web search and fetch** - 9/10 - M
  Search uses DuckDuckGo, or your own SearXNG. Fetch returns a page's readable text, 6000 characters at a time. Results are marked untrusted, and the model is told to cite its sources.

- [x] **Web safety rules** - 8/10 - S
  The internet switch is enforced in Rust too. Your PC and home network are never fetched. An address that didn't come from a search result or your own message asks you first.

---

## Not built: quick wins

- [ ] **Artifact patch edits** - 8/10 - S
  An `edit_artifact(old, new)` action. Changing one line of a big page then takes seconds instead of minutes of re-generation.

- [ ] **Paste and drag-drop** - 7/10 - S
  Ctrl+V for images and drag-drop for files. Today only the file picker works.

- [ ] **Search past chats as a tool** - 5/10 - S
  A `search_chats` tool so the model can look up earlier conversations itself.

- [ ] **Incognito chat** - 4/10 - XS
  A chat that is neither saved nor used for memory recall.

- [ ] **Pinned chats and a Ctrl+K palette** - 4/10 - S
  One palette across chats, commands and artifacts.

- [ ] **Refresh the stale docs** - 5/10 - XS
  `JARVIS_Feature_Gap.md` and `JARVIS_Progress.md` still mark built features as missing.

---

## Not built: core gaps compared with Claude

- [ ] **Reliability kit** - 9/10 - M
  Four pieces: catch `<tool_call>` text that leaks into replies, retry once on bad JSON, use schema-constrained output for internal calls, and stop repeated identical calls.

- [ ] **Eval harness** - 8/10 - M
  Fixed test scenarios scored per model, quantisation and setting. It tells you whether 14B vs 27B or a prompt change actually helps.

- [ ] **Projects with local RAG** - 8/10 - L
  Pinned folders with an embedding index and a `search_knowledge` tool that returns file and line.

- [ ] **Code execution and file creation** - 8/10 - L
  A `run_python` tool in a scratch folder. Charts, CSV, xlsx and docx files it makes become artifacts.

- [ ] **Tray, global hotkeys and notifications** - 7/10 - M
  Quick-ask from anywhere, push-to-talk without the window focused, and Windows toasts when a long job finishes.

- [ ] **Vision as a tool** - 6/10 - M
  `describe_image` loads the vision model, describes the image, then switches back. Today attaching an image leaves the chat on the 8B model.

- [ ] **Memory page and custom instructions** - 6/10 - M
  Browse and edit memories, a "save this memory?" card, and style presets (concise, explanatory).

- [ ] **Background tasks** - 6/10 - M
  Long commands such as builds and test runs keep going while the chat continues, with a notice when they finish.

- [ ] **Subagents, one at a time** - 6/10 - M
  A side job runs in a fresh context and returns a short summary, keeping the main window clear.

- [ ] **Inference tuning and VRAM gauge** - 6/10 - M
  KV-cache quantisation, flash attention and draft models, a context-vs-VRAM gauge, and A/B speed runs.

- [ ] **MCP client** - 6/10 - L
  Plug in existing tool servers. Each server is off unless a skill switches it on, so the tool list stays small.

- [ ] **OCR for scanned PDFs** - 5/10 - M
  Scanned PDFs are refused today.

- [ ] **Artifact version UI** - 5/10 - M
  Diff between versions, restore an old one, and edit the source directly.

---

## Not built: big projects

- [ ] **Headless core and MacBook client** - 9/10 - XL
  Move the agent loop out of the UI into a background process on the PC, with the MacBook connecting to it. This unblocks unattended runs and scheduling.

- [ ] **Workflow engine, scheduler and approval inbox** - 9/10 - XL
  Code controls the order of steps and the model only does small ones, which is what makes a 27B dependable. The daily digest and research become templates on top of it.

- [ ] **Gmail and Calendar, read first** - 8/10 - L
  Read-only access plus drafts. Sending always shows the exact text first. A separate step turns emails into structured data so the email text can't steer actions directly.

- [ ] **Research agent that writes to Obsidian** - 8/10 - L
  A simpler first version is about M: point `/project` at your vault and add a research skill.

- [ ] **Playwright browser sidecar** - 7/10 - L
  Lets JARVIS drive a real browser, with a visible tab and a Take over button. Anything that submits or buys asks first.

- [ ] **Switchable target computer** - 7/10 - XL
  The brain stays on the PC and the actions run on whichever computer you pick. Needs the headless core first.

- [ ] **OSINT pipeline** - 5/10 - XL
  Passive sources only, a scope card, and a full audit log. Needs the workflow engine first.

- [ ] **Computer use** - 3/10 - XL
  Parked: the 8B vision model is too weak at finding where to click.
