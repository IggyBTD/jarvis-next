# JARVIS Next: UI skills for a full redesign

Researched 2026-11-19. Sections 1 to 9 are the research as written (when it was written nothing was installed). Section 10 records what was then installed into `.claude/skills/` so any Claude session on this repo can use it.

---

## 1. The prompt, improved and run

**Original:** "go online and find all of the ui skills that i could use for a full redesign of the jarvis ui, use antislop skills, design skills, telling the ui design techniques"

**Problems with it:** no scope (which JARVIS UI), no stack constraint (vanilla JS + CSS, no React or Tailwind), "all" has no stopping rule, no output format, no fit test against the project's own design rules, no safety check on third-party installs.

**Improved version (what was run):**

> Scope: the front end of `jarvis-next` (Tauri + Vite + vanilla JS, `src/ui/app.css`, `index.html`, `src/core/*.js`). Find agent skills, plugins and written guidelines for a full UI redesign, in four groups: design direction, anti-slop (AI-default detection), UI design techniques (typography, colour, spacing, motion, accessibility, AI-chat patterns), and review/audit tools.
> For each: source repo, exact install command taken from its README, what it adds, fit for this stack (high / medium / low) and the reason, conflicts with `CLAUDE.md` design rules (sentence case, no web fonts, no glow or gradients, teal accent), and security notes.
> Rules: primary sources first (repo READMEs, SKILL.md files), roundup blogs only to find leads; say what was read versus only seen; do not rank by stars (counts conflict between sources); mark React/Tailwind-only skills as low fit; extract the concrete techniques, not just the names; end with a minimal install order and a redesign workflow. Do not install anything.

---

## 2. Findings about the current UI (measured, not opinion)

Counted in `src/ui/app.css` and `index.html`:

| Check | Result |
|---|---|
| gradients, `backdrop-filter`, `transition: all` | 0 |
| `box-shadow` | 14 uses |
| radii | tokenised in three tiers (`--r-1`, `--r-2`, `--r-3`) plus pills and circles |
| `outline: none` | 5, all paired with a replacement focus style (line 264 `.chat-input` relies on the composer, not verified) |
| `prefers-reduced-motion` | handled globally |
| `text-wrap: balance / pretty` | 0 (gap) |
| `tabular-nums` | 2 (check every telemetry number uses it) |

**The honest read:** hygiene is already good. The anti-slop rules most skills enforce are in `CLAUDE.md` already. The weak point is identity. Anthropic's own `frontend-design` skill lists "warm cream background plus a warm accent" and "the SaaS-card kit" as the two most common AI-design clusters. The canvas `#faf9f5` / `#262624` is "after Claude's palette" and the layout is a Claude/ChatGPT clone, so the app currently looks like a competent default, not like JARVIS. The teal accent and mono numerals are the only distinctive choices. A full redesign should start by deciding what makes this look like JARVIS, not by polishing.

Not checked: the rendered UI. This is from CSS and `CLAUDE.md` only.

---

## 3. Skills and tools

Fit is judged for vanilla JS + CSS in a Tauri window, not a marketing site.

### Design direction and anti-slop

| Skill | Source | Install (from its README) | Fit | Notes |
|---|---|---|---|---|
| **Impeccable** | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `npx impeccable install`, then `/impeccable init` | **High** | 24 commands: `shape`, `critique`, `audit`, `polish`, `distill`, `typeset`, `layout`, `animate`, `harden`, `live` and more. 62 deterministic slop rules (`npx impeccable detect <dir or url>`), no LLM. Writes `PRODUCT.md` and `DESIGN.md`. README says it is strongest on interfaces that already exist, which matches here. |
| **frontend-design** (official) | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md) | via `/plugin` (exact command not verified) | Medium | Read once even if not installed: it holds the clearest list of AI-default tells and a plan-then-critique process. Impeccable descends from it, so installing both is redundant. |
| **zero-slop** (`no-slop`, `perfect-design`, `perfect-ux`, `reality-skill`, `truth-serum`) | [Eid0lon/zero-slop](https://github.com/Eid0lon/zero-slop) | `npx skills add Eid0lon/zero-slop` | Medium | `reality-skill` finds dead buttons, stub handlers and decorative-only panels, which matches the "not verified yet" list in `CLAUDE.md`. README says early public. |
| **ux-skill** | [Laith0003/ux-skill](https://github.com/Laith0003/ux-skill) | `/plugin` or pip or npx (README) | Medium-low | 171-rule linter, 160 brand `DESIGN.md` specs (Linear, Raycast, Cursor, Claude, Vercel are the app-like ones worth reading), 57 motion presets. The comparison table in its README is the author's own and shows 14 stars, so treat claims as unproven. The [anti-slop ban list wiki](https://github.com/Laith0003/ux-skill/wiki/Anti-AI-slop-ban-list) is useful on its own. |
| **frontend-design (Ilm-Alan)** | [Ilm-Alan/frontend-design](https://github.com/Ilm-Alan/frontend-design) | `git clone ... ~/.claude/skills/frontend-design` | Low-medium | Eight "aesthetic anchors" with locked tokens. The **Industrial** anchor (pitch black, mono throughout, one signal colour, flat) is the nearest to a JARVIS identity. Use as a reference for tokens. |
| **UI UX Pro Max** | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` then `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill` | Low-medium | Searchable database of styles, palettes, font pairings. Stacks listed include HTML+Tailwind but not vanilla or Tauri. Good for palette and type ideas, weak for this stack. |
| **Hallmark** | [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | `npx skills add nutlope/hallmark -g` | Low | Built for websites (50 page themes, photos, sign-up forms). Its `audit` and `redesign` commands help only on web pages. |
| **Taste Skill** | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` | **Low** | README says it builds company marketing sites. Deals Google Fonts, which breaks the "no web fonts" rule. Needs Node 22+ and Chrome. Skip. |

Only one direction skill should be active at a time. A roundup I could not open recommended picking one style engine, and two competing design skills will fight over the same decisions.

### Interaction, motion and craft

| Skill | Source | Install | Fit | Notes |
|---|---|---|---|---|
| **Emil Kowalski skills** | [emilkowalski/skills](https://github.com/emilkowalski/skills) | `npx skills@latest add emilkowalski/skills` | **High** | **Already installed:** `apple-design`, `emil-design-eng`, `prototype` (in `.agents/skills`, pinned in `skills-lock.json`). Not yet installed and useful here: `review-animations`, `improve-animations`, `find-animation-opportunities`, `remove-animations`, `choreograph`, `animation-performance`, `break-ui` (worst-case data), `learn-taste` (turns your corrections into `DESIGN.md` rules), `ask-emil` (router). Skip `animate-expo`, `mobile-native`, `gestures`, `pick-ui-library` for this stack. |
| **design-motion-principles** | [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles) | `npx skills add kylezantos/design-motion-principles` | Medium | Audit mode finds UI that should animate but does not, and flags AI motion tells (pulsing indicators, hover-scale everywhere, stagger spam). Weights three lenses; Emil's "should this animate at all" fits a productivity tool. |

### Review, accessibility, guidelines

| Skill | Source | Install | Fit | Notes |
|---|---|---|---|---|
| **Web Interface Guidelines** | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), skill in [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `npx skills add vercel-labs/agent-skills` (check the skill name) | **High** | Framework-agnostic checklist output as `file:line`. Covers focus, forms, animation, `tabular-nums`, `color-scheme`, `overscroll-behavior`, empty states. Fetches the rule file from GitHub on every run. One rule conflicts with this project: it asks for Title Case, `CLAUDE.md` says sentence case. Ignore that rule. |
| **ui-skills** | [ibelick/ui-skills](https://github.com/ibelick/ui-skills) | `npx skills add ibelick/ui-skills` | Medium | Take `fixing-accessibility` and `fixing-motion-performance`. **Skip `baseline-ui`**: it requires Tailwind and `motion/react`. A third-party Snyk listing rated fixing-accessibility medium risk; I did not verify why. |
| **awesome-ux-skills** | [tommyjepsen/awesome-ux-skills](https://github.com/tommyjepsen/awesome-ux-skills) | `git clone` then `./install.sh` | **High for the AI group** | `ai-governors` (action plans, verification, undo, cost), `ai-trust-builders`, `ai-tuners` (model switching, modes), `ai-wayfinders` (empty-state prompts). These map directly onto approvals, the audit log, the model menu and the empty chat. Also `craft`, `ux-heuristics-review`, `accessibility`, `dieter-rams-principles`. Cherry-pick, do not install all. |
| **web-quality-skills** | [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) | `npx add-skill addyosmani/web-quality-skills` | Low | Core Web Vitals and SEO. Mostly irrelevant to a desktop app. |

### Tokens and theming (technique more than tool)

- Single-hue OKLCH token systems (`--brand-hue`, derive the rest) and three-tier tokens (primitive, semantic, component). Tools exist (phrazzld `design-tokens`, `design-system-architect`) but output Tailwind `@theme`, so copy the idea into `app.css` by hand. Seen in a roundup, not read.
- `DESIGN.md` as the persistent record: Impeccable `document`, Google Labs `design-md` (Stitch), Emil `learn-taste`. Pick one.

### Eyes on the result

- Playwright (preinstalled in this cloud container) can screenshot the Vite dev server for review passes.
- Playwright MCP and Chrome DevTools MCP are the standard options on your PC.
- Neither can check the real Tauri window. `CLAUDE.md` already lists what is unverified there.

### Seen only in roundups, not checked

`huashu-design`, `open-design` (nexu-io), `nothing-design-skill`, `material-3-skill`, Bencium UX Designer, freshtechbro animation skills (GSAP, Three.js), wondelai UX skills, Jeffallan skills, Google Labs Stitch skills, Figma MCP. Low relevance or unverified; revisit only if a gap appears.

---

## 4. Techniques extracted (with where each comes from)

### Process

1. **Write the plan before code**: 4 to 6 named hex colours, type roles, a layout concept with ASCII wireframes, 3 to 5 principles. Then test it: "would I get this for any similar app?" If yes, revise. (frontend-design)
2. **Capture context in files**: `PRODUCT.md` (who, job, constraints) and `DESIGN.md` (tokens and rules) so later sessions stay on-brand. (Impeccable)
3. **Review loop per surface**: critique, fix, audit, polish. A single component reviewed closely beats a whole page at a glance. (Impeccable)
4. **Take a screenshot and critique it** during the build. (frontend-design)
5. **Spend boldness in one place.** One memorable element, everything else quiet. (frontend-design)
6. **Log your corrections** at the end of a session as rules with reasons. (Emil `learn-taste`)

### Anti-slop (the tells to remove or avoid)

- Gradient washes, glow on everything, glassmorphism on every panel (max one glass element), rainbow gradient text.
- One border radius on everything. Vary by role (inputs small, cards medium, modals large). JARVIS already tokenises three tiers; check each is used by role, not by habit.
- The SaaS-card kit: identical rounded cards with the same soft shadow. Use cards only where they mean "group"; use whitespace as the divider; no cards in cards.
- Tracked ALL-CAPS eyebrow labels, one coloured or italic word in a heading, `A · B · C` meta strings, `→` appended to buttons, numbered markers when the content is not a sequence, a monospace face for every small label.
- Near-black `#0B0B0B` as a stand-in for black, warm cream plus terracotta, near-black plus one acid accent: all listed as common defaults. Legitimate only as a deliberate choice.
- Copy: no throat-clearing, no "empower / leverage / unlock", specific button labels ("Save changes", not "Submit"), the same verb through the flow (Publish, then "Published"), errors say what failed and how to fix it, no apology.
- Mock data: real-looking names and numbers, never `John Doe` or round figures.

### Typography and data

- Line length under 80 characters for prose. Serif body gets slightly more line-height.
- `font-variant-numeric: tabular-nums` on every changing number (telemetry, token counts, timers).
- `text-wrap: balance` on headings, `pretty` on paragraphs. Gap in the current CSS.
- Truncation: flex children need `min-width: 0`; use `text-overflow` or `line-clamp`.
- Use `…` and non-breaking spaces in units (`10 MB`).

### Colour and theming

- Contrast 4.5:1 for body text, 3:1 for large text. Accent used as text on light needs checking: `#0b7f73` on `#faf9f5` should be measured.
- `color-scheme: light dark` on the root, so scrollbars and native inputs follow the theme. Native `<select>` needs explicit colours for Windows dark mode (already a known gap in Vercel's list).
- Semantic tokens only in components; no raw hex in rules.
- Tint neutrals toward the brand hue instead of pure grey.

### Motion

- Animate `transform` and `opacity` only. Never `transition: all`. Never animate width, height, margin.
- Enter with `ease-out`; routine feedback 100 to 150 ms, never over 200 ms; significant transitions 200 to 300 ms. JARVIS tokens (150 and 200 ms, `cubic-bezier(0.22, 1, 0.36, 1)`) already fit.
- Motion must show a state change. No pulsing dots, no hover-scale on every card, no stagger on lists, no fade-up on every section.
- Ask "should this animate at all?" for high-frequency actions (keyboard shortcuts, tab switches, streaming tokens).
- Animations must be interruptible; honour `prefers-reduced-motion` (already global).
- Never animate large blur or `backdrop-filter` surfaces.

### Interaction and accessibility

- `:focus-visible` rings, never bare `outline: none`. Icon-only buttons get `aria-label`. `<button>` for actions, `<a>` for navigation.
- `aria-live="polite"` for streamed text, toasts and validation.
- Destructive actions get confirm or undo, never immediate.
- Every gesture or drag has a click and keyboard alternative (the panel splitters).
- `overscroll-behavior: contain` in panels and menus.
- Missing states are a defect: rest, hover, focus, active, disabled, loading, empty, error.
- Test worst-case data: very long names, empty lists, huge counts, one-letter names. (Emil `break-ui`)

### AI-chat specific (from awesome-ux-skills and chat-UI guides)

- Explicit states for generating, delayed, uncertain and interrupted. A visible stop control.
- Approvals: show the plan before acting, then verification, undo, and cost where relevant. This is the pattern JARVIS's approval and diff cards need.
- Trust signals: caveats where confidence is low, citations, a visible footprint of what the agent did (the audit log).
- Tuners: model switching, modes and parameters belong in one predictable place.
- Empty chat is an invitation: example prompts, not a blank page.
- Chat is good for discovery and synthesis, weak for execution. Hand off to structured UI (the Code page, tabs, diff cards) when the task is to do something. A side "context drawer" showing what influences the answer is one agency's pattern, not a standard.

---

## 5. Conflicts with `CLAUDE.md`

| Skill advice | Project rule | Resolution |
|---|---|---|
| Title Case headings and buttons (Vercel) | Sentence case | Keep sentence case |
| Deal Google Fonts pairs (Taste, Hallmark) | Segoe UI Variable and Cascadia Code, no web fonts | Skip those skills, or ask for local fonts only |
| `baseline-ui`: Tailwind and `motion/react` required | Vanilla JS and `app.css` | Skip it |
| Warm cream plus accent is a tell (frontend-design) | Canvas `#faf9f5` / `#262624` is the chosen palette | Decide deliberately in the redesign plan; it is a design decision, not a bug |
| "Never add animation unless requested" (baseline-ui) | Motion 150 to 200 ms already used | Follow Emil's rule instead (animate to show change) |

---

## 6. Security notes

You care about this, so before any install:

- `npx skills add ...`, `npx impeccable install` and `git clone ... ./install.sh` all run third-party code. Read the install script and `SKILL.md` first. Prefer project scope (`.agents/skills`, already used here) over global, and let `skills-lock.json` pin hashes.
- **Impeccable live mode:** per its README, "Apply" can launch the `codex` or `claude` CLI with approvals and sandbox off when no chat agent is polling. Set `IMPECCABLE_LIVE_COPY_AGENT=chat` before using it. It also runs an optional `impeccable:manual-edit-validate` script from `package.json`. Do not use live mode on a deployed build.
- Impeccable offers an edit-time **design hook**. Hooks run on every edit; read what it installs before accepting.
- Vercel's skill downloads its rules from GitHub on each run. Fine, but it is network input to the model; pin a commit if you want it frozen.
- Skill content is instructions to the model. A hostile or careless skill can steer edits. Install few, from authors you can inspect.

---

## 7. Recommended install order (minimal)

1. **Keep** the three installed Emil skills.
2. **Add Impeccable** (project scope). Direction, critique, audit, polish, detector.
3. **Add Vercel Web Interface Guidelines** and ibelick `fixing-accessibility`: review gates only.
4. **Add Emil's** `review-animations`, `break-ui`, `learn-taste`.
5. **Cherry-pick** the four `ai-*` skills from awesome-ux-skills for the approvals and model-menu UX.
6. **Run once, then remove if redundant:** `design-motion-principles` audit.
7. **Do not install:** Taste, Hallmark, baseline-ui, Tailwind and shadcn kits.

A caution from one roundup (a Medium comparison I could only see in a search summary): a plain model with no skill scored close to these skills in one test. The skills mostly make the process repeatable and give you a detector; they do not replace a clear brief. Treat that as one data point.

## 8. Redesign workflow

1. Baseline: `npx impeccable detect src/ index.html`, then against `http://localhost:5174` for rendered rules (contrast, small text). Save the output.
2. `/impeccable init` (PRODUCT.md), `/impeccable document` (DESIGN.md from the current `app.css` tokens).
3. `/impeccable shape` the redesign: identity decision first (what makes this JARVIS), token plan, ASCII wireframes for chat, code, system and artifacts pages. Review it against "would I get this for any chat app".
4. Rebuild tokens in `app.css` first, then one surface at a time (sidebar, composer, message list, workspace tabs, approval cards, code page).
5. Per surface: `critique`, fix, `audit`, `polish`, then Emil `review-animations`.
6. Whole app: Vercel guidelines, `fixing-accessibility`, `break-ui`, then re-run `detect` and compare with the baseline.
7. End: `learn-taste` to write rules into `DESIGN.md`. Check in the real Tauri window on your PC; this container cannot.

---

## 9. What was read versus only seen

**Read in full or in part (primary source):** Impeccable README, Taste Skill README, zero-slop README, Hallmark README (intro and install), UI UX Pro Max README (stacks and install), Emil Kowalski README, design-motion-principles README, Anthropic `frontend-design` SKILL.md, Vercel `web-interface-guidelines` command.md and the `web-design-guidelines` SKILL.md, ibelick `baseline-ui` and `fixing-accessibility`, Ilm-Alan README, awesome-ux-skills README, the ux-skill anti-slop ban list, and the wilwaldon toolkit README.

**Seen only in search summaries or roundups:** star counts (they conflict between sources, so none are used), the Snyk risk rating, the Medium and UX Planet comparisons, and everything under "seen only in roundups".

**Could not open:** a Pasquale Pillitteri guide (host blocked by the session proxy). The Medium, Snyk and UX Planet roundups were not fetched either.

---

## 10. Installed in this repo (manifest, 2026-11-19)

37 skills in `.claude/skills/` (24 auto-invocable, 13 manual-only), 3 sub-agents in `.claude/agents/`, licences in `.claude/third-party-licenses/`. Every file was cloned fresh, read for hooks, `allowed-tools`, shell pipes, encoded blobs and injection phrases (none found; the only hits are Emil's own defensive notes), then copied. YAML frontmatter and cross-skill references were validated.

| Source @ commit | Skills installed | Mode |
|---|---|---|
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) @ `b49177d`, skill 4.10.0, engine 0.1.27 | `impeccable` (63 files); agents `impeccable-documenter`, `-finish-reviewer`, `-motion-reviewer` | auto |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) @ `64eb3de` | `animate`, `animation-performance`, `animation-vocabulary`, `break-ui`, `choreograph`, `find-animation-opportunities`, `improve-animations`, `remove-animations`, `gestures` | auto |
| same | `ask-emil`, `learn-taste`, `pick-ui-library`, `review-animations` (manual in the author's own frontmatter); `animate-expo`, `mobile-native`, `write-swift`, `ask-sonner` (marked manual here: React Native, Swift and Sonner are off-stack) | manual |
| Emil, **pinned copies from `.agents/skills/`**, older than `64eb3de` | `apple-design`, `emil-design-eng` (auto), `prototype` (manual) | as pinned in `skills-lock.json` |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) @ `1a2c79d` | `web-design-guidelines` (fetches its rules from GitHub on every run) | auto |
| [ibelick/ui-skills](https://github.com/ibelick/ui-skills) @ `347d318` | `fixing-accessibility`, `fixing-motion-performance` | auto |
| [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles) @ `4a9ca87` | `design-motion-principles` | auto |
| [tommyjepsen/awesome-ux-skills](https://github.com/tommyjepsen/awesome-ux-skills) @ `4e5d092` | `ai-governors`, `ai-trust-builders`, `ai-tuners`, `ai-wayfinders`, `craft`, `ux-heuristics-review`, `accessibility`, `dieter-rams-principles` | auto |
| [Eid0lon/zero-slop](https://github.com/Eid0lon/zero-slop) @ `1479c72` | `no-slop`, `reality-skill` | manual |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) `plugins/frontend-design`, main on 2026-11-19 | `frontend-design` | manual |
| [Ilm-Alan/frontend-design](https://github.com/Ilm-Alan/frontend-design) @ `f8966e6` | `frontend-design-anchors` (renamed from `frontend-design` to avoid a name clash) | manual |

**Manual** means `disable-model-invocation: true`: it runs only when invoked by name, so competing design skills do not trigger together and fight. A Claude can still read any of them with the Read tool.

### Changes made to third-party files

- Added `disable-model-invocation: true` to `no-slop`, `reality-skill`, `frontend-design`, `frontend-design-anchors`, `animate-expo`, `mobile-native`, `write-swift`, `ask-sonner`.
- Renamed Ilm-Alan's skill to `frontend-design-anchors`.
- Rewrote the `description` of `ai-trust-builders`, `ai-tuners` and `ai-wayfinders` as folded YAML blocks. The originals contained unquoted colons and were invalid YAML, which a strict loader could reject. Text is unchanged.
- Everything else is byte-for-byte from the source.

### Deliberately not installed

| Skill | Reason |
|---|---|
| Taste Skill | 40 MB of assets, builds marketing sites, deals Google Fonts (breaks "no web fonts") |
| Hallmark | 7 MB, marketing-site builder with 50 page themes, competes with Impeccable |
| UI UX Pro Max | 11 MB of data and Python, stack list has no vanilla JS or Tauri |
| ux-skill (Laith0003) | An engine with 18 commands, agents and a CLI, not a plain skill; 14 stars by its own table |
| `baseline-ui` and the canvas skills in ibelick | Tailwind and `motion/react` required, or unrelated |
| Impeccable `settings.json` hooks | Run a binary at session start and on every edit. Enable only after reading `.claude/skills/impeccable/reference/hooks.md` |
| Impeccable agents `asset-producer`, `manual-edit-applier` | Image generation and live mode; Impeccable has fallbacks when they are absent |
| Roundup-only items | Never read; see section 3 |

Install commands for all of these are in section 3 if you change your mind.

### Not verified

- Skills load at session start, so this was **not** tested in a fresh session. The next Claude session should show them in its skill list; if it does not, check `.claude/skills/` first.
- The Impeccable launcher (`scripts/impeccable`) was **not run**. On first use it downloads a platform binary from `github.com/pbakaus/impeccable/releases` and checks it against `scripts/engine-checksums.txt`. The checksum file ships in the same repo, so it proves the download matches the repo, not that the binary is safe. Windows uses `impeccable.cmd`.
- `disable-model-invocation` is used by Emil's own skills, but I did not confirm its behaviour against the Claude Code docs.
- `awesome-ux-skills` has no licence. It is copied here for private use; confirm terms before making the repo public. See `.claude/third-party-licenses/awesome-ux-skills.NOTE`.
- `skills-lock.json` still lists only the three Emil skills and was not updated. It does not know about the rest.

---

## Sources

- [Claude Code Frontend Design Toolkit (wilwaldon)](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit)
- [Impeccable](https://github.com/pbakaus/impeccable)
- [Anthropic frontend-design SKILL.md](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md)
- [Taste Skill](https://github.com/Leonxlnx/taste-skill)
- [Hallmark](https://github.com/Nutlope/hallmark)
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [zero-slop](https://github.com/Eid0lon/zero-slop)
- [ux-skill and its anti-slop ban list](https://github.com/Laith0003/ux-skill/wiki/Anti-AI-slop-ban-list)
- [Ilm-Alan/frontend-design](https://github.com/Ilm-Alan/frontend-design)
- [Emil Kowalski skills](https://github.com/emilkowalski/skills)
- [design-motion-principles](https://github.com/kylezantos/design-motion-principles)
- [Vercel web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines)
- [ibelick/ui-skills](https://github.com/ibelick/ui-skills)
- [awesome-ux-skills](https://github.com/tommyjepsen/awesome-ux-skills)
- [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills)
- Search roundups used for leads: [9 Best UI Skills for Claude Code in 2026 (Medium)](https://medium.com/@hii_mohit/9-best-ui-skills-for-claude-code-in-2026-i-tested-them-all-58fe42809376), [Top 8 Claude Skills for UI/UX Engineers (Snyk)](https://snyk.io/articles/top-claude-skills-ui-ux-engineers/), [Best UI/UX Skills for Claude Code (claudeskills.info)](https://claudeskills.info/best/ui-ux-skills/), [Must-Have UX/UI Design Skills (UX Planet)](https://uxplanet.org/must-have-ux-ui-design-skills-for-claude-code-364e93e3a614)
- AI chat UI guides: [NN/g AI chatbot design guidelines](https://nngroup.com/articles/ai-chatbots-design-guidelines), [setproduct anatomy and patterns](https://www.setproduct.com/blog/ai-chat-interface-ui-design), [UXPin chat UI design](https://www.uxpin.com/studio/blog/chat-user-interface-design/)
