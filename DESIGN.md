---
name: JARVIS
description: A local AI assistant drawn as a molecular model kit; every reply, step and service is an atom bonded into the conversation.
colors:
  bg: "#F2F5F4"
  surface-1: "#E9EEEC"
  surface-2: "#FFFFFF"
  surface-3: "#E3E9E7"
  surface-4: "#D6DFDC"
  border: "#DBE2E0"
  border-strong: "#BFCAC8"
  text: "#131819"
  text-2: "#3B4648"
  text-3: "#566365"
  accent: "#087567"
  accent-mid: "#0A8A7C"
  accent-dim: "#6FA69F"
  accent-wash: "rgba(10, 138, 124, 0.12)"
  on-accent: "#FFFFFF"
  warm: "#076B60"
  atom-rim: "#06594F"
  atom-shine: "rgba(255, 255, 255, 0.6)"
  danger: "#B3302A"
  danger-wash: "rgba(179, 48, 42, 0.12)"
  on-danger: "#FFFFFF"
  ok: "#2F7A4C"
  ok-wash: "rgba(47, 122, 76, 0.12)"
  rod: "#9AA8A6"
  rod-atom: "#B5C0BE"
  rod-rim: "#7F8E8C"
  bubble: "#E2E9E7"
  scrim: "rgba(19, 24, 25, 0.28)"
  core-back: "#B9C4C2"
  core-rod: "#8F9E9C"
  rail: "#151B1C"
  rail-hover: "#202829"
  rail-active: "#263032"
  rail-line: "#2A3436"
  rail-ink-1: "#E9EFED"
  rail-ink-2: "#A9B8B6"
  rail-ink-3: "#8A9A98"
  rail-teal: "#5FD6C6"
  rail-atom: "#3FC1B0"
  rail-atom-rim: "#1F7D71"
  rail-rod: "#4A5856"
  rail-danger: "#F07A6E"
  rail-danger-rim: "#8E2F27"
  rail-on-atom: "#06201C"
  bg-dark: "#121718"
  surface-1-dark: "#161C1D"
  surface-2-dark: "#1A2122"
  surface-3-dark: "#222A2C"
  surface-4-dark: "#2A3436"
  border-dark: "#273133"
  border-strong-dark: "#364244"
  text-dark: "#E9EFED"
  text-2-dark: "#B3C0BE"
  text-3-dark: "#94A3A1"
  accent-dark: "#5FD6C6"
  accent-mid-dark: "#3FC1B0"
  accent-dim-dark: "#2A7F75"
  accent-wash-dark: "rgba(63, 193, 176, 0.14)"
  on-accent-dark: "#06201C"
  atom-rim-dark: "#2A8F82"
  danger-dark: "#F07A6E"
  on-danger-dark: "#1A0A08"
  ok-dark: "#7FC596"
  rod-dark: "#4F5E5C"
  rod-atom-dark: "#56645F"
  rod-rim-dark: "#6D7D7A"
  bubble-dark: "#222A2C"
  core-back-dark: "#33403F"
  scrim-dark: "rgba(0, 0, 0, 0.5)"
  rail-dark: "#0B0F10"
  rail-hover-dark: "#161C1D"
  rail-active-dark: "#1D2526"
  rail-line-dark: "#1F2729"
typography:
  display:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  body-reply:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "27px"
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono-data:
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    fontFeature: "tnum"
  mono-figure:
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  mono-symbol:
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
  brand:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
    letterSpacing: "0.04em"
rounded:
  rod: "1px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  tail: "6px"
  pill: "999px"
  atom: "50%"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
components:
  button-send:
    backgroundColor: "{colors.accent-mid}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.atom}"
    size: "32px"
  button-send-hover:
    backgroundColor: "{colors.accent}"
  button-stop:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.atom}"
    size: "32px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 24px"
  button-primary-hover:
    backgroundColor: "{colors.accent-mid}"
  button-card:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 12px"
    typography: "{typography.caption}"
  button-card-hover:
    backgroundColor: "{colors.surface-3}"
  tool-button:
    textColor: "{colors.text-3}"
    rounded: "{rounded.sm}"
    size: "32px"
  tool-button-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-2}"
  tool-button-on:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
  starter:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "32px"
    padding: "0 14px"
  starter-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  composer:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "12px"
  bubble-user:
    backgroundColor: "{colors.bubble}"
    textColor: "{colors.text}"
    typography: "{typography.body-reply}"
    padding: "8px 16px"
  card-tool:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
  card-approval:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  card-artifact:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 16px 8px 8px"
  element-tile:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
    typography: "{typography.mono-symbol}"
    rounded: "{rounded.sm}"
    size: "40px"
  dialog-gate:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "24px"
    width: "min(560px, calc(100vw - 32px))"
  menu:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "4px"
    width: "320px"
  nav-item:
    textColor: "{colors.rail-ink-2}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 8px"
  nav-item-hover:
    backgroundColor: "{colors.rail-hover}"
    textColor: "{colors.rail-ink-1}"
  nav-item-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.rail-ink-1}"
  input-search-rail:
    backgroundColor: "{colors.rail-hover}"
    textColor: "{colors.rail-ink-1}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  target-switch-on:
    backgroundColor: "{colors.rail-atom}"
    textColor: "{colors.rail-on-atom}"
    rounded: "{rounded.sm}"
  tab:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "32px"
  tab-selected:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
  button-close:
    textColor: "{colors.text-3}"
    rounded: "{rounded.sm}"
    size: "28px"
  button-close-hover:
    backgroundColor: "{colors.surface-4}"
    textColor: "{colors.text}"
  machine-fact:
    textColor: "{colors.text-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    height: "24px"
    padding: "0 12px"
---

# Design System: JARVIS

## Overview

**Creative North Star: "The Molecular Model Kit"**

JARVIS's work is a structure being assembled in front of its owner. The ground is lab-white with a cool teal cast, the sidebar rail is carbon in both themes, JARVIS itself is teal plastic, and everything that connects one thing to another is a pale grey rod. The signature object is the node mesh in kit mode: 48 atoms on a Fibonacci sphere, each bonded to its three nearest neighbours, drawn as flat discs and round-capped rods. It is the hero on the empty chat, the brand mark in the rail, and the small atom that sits on the newest reply and spins while a reply or a step runs. The kit also has a periodic table: each artifact type is an element tile with a two-letter symbol. The same vocabulary carries into the conversation: every reply, step row, action and error of a turn is an atom, and consecutive ones are bonded by a vertical rod into a step chain. Services at the foot of the rail are atoms on one horizontal bond.

The system is calm and dense the way a desktop tool is dense: 14 px interface text, 16 px reading text, quiet 1 px lines, flat surfaces, one colour that means "JARVIS" and one that means "wrong". Depth comes from tone (ground, the four surface steps) rather than from shadows; only things that float over content cast one. Atoms are flat discs, never shaded spheres: a fill, a darker rim and a small white crescent on the upper left.

The nodes design is a skin over a shared component layer: its own token values (`src/nodes/tokens.css`) under the same names the shared styles read (`src/ui/*.css`), then one layer (`src/nodes/nodes.css`) that adds the kit's parts and removes what the kit refuses. The phone app (`mobile.html`) uses the same tokens. It rejects the grey chat column with a logo on top, and the cyan hologram on black that the old HUD used.

**Key Characteristics:**
- Lab-white ground (light) or deep carbon-teal ground (dark); the rail is carbon in both.
- One voice colour, teal, in three steps, for JARVIS's atoms, the primary action, focus, the current item and the busy level.
- Red only for errors, denials, a service that is down and the high load level.
- Flat atoms (fill, rim, crescent) and round-capped grey rods as the recurring motif.
- Segoe UI Variable for text, Cascadia Code for every number, path, model id and element symbol.
- Motion is "arrive and bond": a scale-in for the atom, a draw-in for its rod. On the empty page only the mesh moves.

## Colors

A cool, near-neutral lab palette with teal plastic for JARVIS and red plastic for faults; everything else is grey.

### Primary
- **Teal ink** (accent / accent-dark): the step that carries small teal text (5.1:1 on the ground): links, the element symbol, the pressed tool button's icon, the selected nav or tab mark in shared styles, the focus outline, the filled primary button in the approval dialog and the phone app. In dark it brightens to the lightest teal.
- **Model-kit teal** (accent-mid / accent-mid-dark): the plastic itself. Reply atoms, a finished step's atom, the hero mesh's front atoms (`--core-atom`), the send button, the inset ring of an element tile, the focused composer border, the selected tab's atom, the approval dialog border, a hovered artifact card's border, the recording mic, the context ring at the busy level, checkboxes.
- **Idle teal** (accent-dim): the track of a running chat's spinner, and idle strokes; never text.
- **Teal wash** (accent-wash): the fill of an element tile, a pressed tool button, a waiting approval card, text selection.
- **Atom rim** (atom-rim): the darker ring of every teal atom, and the hero mesh's rim (`--core-rim`).
- **Busy teal** (warm): the kit has no amber, so the shared "warm" role maps to a deeper teal: an approval card's border and "Needs approval" state, a queued step, a waiting chat, the mic while listening, bars and traces past 70 %.
- **Rail teal** (rail-teal, rail-atom, rail-atom-rim, rail-on-atom): the same plastic tuned for the carbon rail: the new-chat atom, the current chat's atom, a running or unseen chat, a service that is up, the icon of the active nav item, the pressed PC/Mac segment (with rail-on-atom ink), the rail search focus border and the rail's focus outline.

### Secondary
- **Fault red** (danger / danger-dark, danger-wash, rail-danger, rail-danger-rim): error lines and their atoms, a failed or denied step, a denied approval card's border, Deny on hover, a cut network link, a service that is down (drawn as a diamond, not only a colour), deleted diff lines, and the high load level (past 90 %).

### Tertiary
- **Done green** (ok / ok-dark, ok-wash): finished and added things only: added diff lines and their counts, new or written files, a loaded model's dot, a finished background job, an approved card's border. Muted, never a fill larger than a row tint.

### Neutral
- **Lab white** (bg): the page ground, the inside of hollow atoms, tool output wells.
- **Surface steps** (surface-1 to surface-4): surface-2 is specimen white (composer, cards, menus, dialogs); surface-1 is the sunk well (tool cards, code blocks, reasoning, blockquotes); surface-3 is hover and the selected tab; surface-4 is segmented-control tracks, inline code and badges.
- **Bubble grey** (bubble): the owner's own messages, on desktop and phone.
- **Hairline** (border, border-strong): 1 px dividers and card borders; border-strong for interactive outlines (composer, starters, card buttons, menus, artifact and tool cards).
- **Carbon ink** (text, text-2, text-3): primary, secondary and quiet text (meta, placeholders, empty states). Each reaches 4.5:1 on bg and surface-1 to surface-3.
- **Rod grey** (rod, rod-atom, rod-rim): bonds of the step chain and step lists, the grey atom of a step row or action, an idle tab's atom, the context ring at rest, a hovered starter's border; the hero mesh's back atoms and rods (`--core-back`, `--core-rod`) step from these towards the ground.
- **Carbon rail** (rail, rail-hover, rail-active, rail-line, rail-ink-1..3, rail-rod): the sidebar, in both themes; dark mode deepens it.
- **Scrim** (scrim / scrim-dark): the backdrop behind the approval dialog, and nowhere else.

### Named Rules
**The One Plastic Rule.** Teal means JARVIS, the action you are about to take, where you are, or that something is busy. It never decorates a section, a heading or a title (page titles carry no accent bar).

**The Red Atom Rule.** Red is for something that went wrong or was refused, and for the high load level. A state that is only "busy" or "waiting" is teal, not red, and never amber.

**The Grey Rod Rule.** Bonds are grey. The rail's live readout bars are grey until 70 %, teal past it and red past 90 %.

**The Carbon Rail Rule.** The rail is carbon in light and dark alike and uses its own rail-* tokens; main-area tokens are never used on the rail.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI Variable Text, Segoe UI, system-ui)
**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, -apple-system, Helvetica Neue)
**Label/Mono Font:** Cascadia Code (with Cascadia Mono, Consolas, ui-monospace, SF Mono)

**Character:** Windows' own system faces, so the window feels native and nothing is downloaded. Replies read in the interface face too (the shared serif slot is pointed at Segoe). Cascadia is the "element symbol" voice of the kit: numbers, paths, model ids, element symbols and timings, always with tabular figures.

### Hierarchy
The scale is 12, 13, 14, 16 and 20 px from the tokens, plus 32 px for the greeting and page titles; nothing is smaller than 12 px.
- **Display** (400, 32 px, 1.15, -0.015em, Display face): the greeting under the hero mesh and page titles (Artifacts, Settings, Projects and the rest).
- **Headline** (600, 20 px, 28 px): first- and second-level headings inside replies.
- **Title** (600, 16 px, 24 px): settings card heads, third-level reply headings, the phone app's bar title; 14 px at 600 for the column title, card titles and the usage card title.
- **Body reply** (400, 16 px, 27 px): assistant replies, at most 760 px wide. The owner's own messages are 16 px at 24 px.
- **Body** (400, 14 px, 20 px): the interface default: nav items, settings rows, menus.
- **Label** (400, 13 px, 20 px): starters, tabs, tool cards, step lines, explanations under settings.
- **Caption** (12 px, 16 px): meta under replies, card buttons (600), rail list heads (600), service names, readout labels.
- **Mono data** (Cascadia, 12 to 13 px, tabular): timestamps, token meters, diff and output text, code, readouts. **Mono figure** (Cascadia, 20 px, -0.02em, never wraps) for System readings and usage figures. **Mono symbol** (Cascadia 600, 15 px, line-height 1) for the two-letter symbol on an element tile.
- **Brand** (Display 600, 16 px, 0.04em): the JARVIS wordmark beside the mesh logo in the rail.

### Named Rules
**The Element Symbol Rule.** Every number, path, command, model id and element symbol is set in Cascadia Code with tabular figures; prose and controls never are. A type's readable word (Chart, Page, Document) is set in Segoe on the line under the title.

**The Sentence Case Rule.** All labels, headings and buttons are sentence case. No uppercase labels, no letter-spaced small caps; the nodes layer resets the shared styles that had them (dialog field names, usage labels, phone list heads). The JARVIS wordmark is the one name set in capitals.

## Layout

A two-column frame: a 272 px carbon rail (hidden with Ctrl+\) and a main column under a 40 px strip. The chat page splits into the conversation and an optional workspace (44 % wide by default, at least 400 px each side) separated by an 8 px drag track; the workspace stays closed until something opens in it, and under 1100 px wide it covers the conversation instead of sharing the row. The Code page reuses the same conversation, with its usage card and changes beside it.

When the conversation is empty, the hero mesh, greeting, one line about the machine, the composer, its control row, the starters and the machine facts stack in the vertical middle. Once the first message lands, the transcript fills the column (760 px measure, 32 px gutter) and the composer sits at the foot.

Spacing runs on a 4 px base (4, 8, 12, 16, 24, 32, 48, 64); control heights are 28, 32 and 40 px, and 44 px on the phone. Pages (Settings, Artifacts, Projects, Accounts, Scheduled) sit in a 760 px column; cards pad 16 px; the workspace pads 24 px.

Responsive: the composer is a size container (under 560 px it drops the context meter and the target tag, under 420 px the link and web toggles). Under 780 px tall the rail drops its live readout; under 660 px tall the services shrink to their atoms (names stay in the tooltip and for screen readers); under 640 px tall nav rows drop to 28 px. The System panel reflows from one to two to twelve columns with its container. The phone app is one fixed screen that follows the visual viewport, with 44 px targets and the composer riding the keyboard.

## Elevation & Depth

Flat by default; depth is tonal. The ground and the four surface steps do the layering, and 1 px hairlines separate regions. Shadows are soft and neutral, never coloured. The one dimming layer is the scrim behind the approval dialog.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgba(19, 24, 25, 0.05)`): the composer, at rest and while focused (focus changes its border, not its shadow).
- **Segment** (`0 1px 2px rgba(0, 0, 0, 0.15)`): the chosen segment of a segmented control on the main surface.
- **Float** (`0 2px 6px rgba(19,24,25,.06), 0 12px 32px rgba(19,24,25,.1)`; dark `0 2px 8px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.45)`): menus, the command palette, the context menu, floating code-page panels, the toast and the approval dialog.

### Named Rules
**The Float Only Rule.** A large shadow means "this is above the page": a menu, a dialog, a floating panel, a toast. Resting cards, tiles, tool steps and the rail's controls have a border or a tone and no shadow.

## Shapes

Gently rounded rectangles for containers and perfect circles for everything that is an atom. Three corner steps carry almost everything: 8 px for buttons, rows, tabs, nav items and element tiles; 12 px for cards, tool cards, code blocks, menus, the dialog and the rail search; 20 px for the composer and the owner's bubble, whose bottom-right corner is a 6 px tail. Starters, machine facts and the target pill are pills. Corners of 1 or 2 px exist only on the 2 px bond rods (and the 4 px bar tracks they echo).

The atom recipe is the recurring silhouette: a circle in the plastic colour, an inset ring 1 to 1.5 px in the darker rim colour, and an inset 1 to 1.5 px offset of translucent white on the upper left for the crescent. A hollow atom (ground fill, 2 px teal ring) means pending: an approval not yet answered, a queued or running step, a waiting chat. A grey ring on the rail's ground means a service of unknown state; a down service is a small red diamond.

Bonds are 2 px rods with round caps: vertical in the step chain (from atom centre to the next atom) and inside a step list, horizontal in the services strip. Inside the mesh, bonds follow the sphere; outside it they run straight.

### Named Rules
**The Flat Atom Rule.** Atoms are fill, rim and crescent; never a radial gradient, a drop shadow or a glow. The mesh shows depth in four flat tone steps.

**The Straight Bond Rule.** Outside the mesh, a bond is straight and axis-aligned: vertical between steps, horizontal between services.

## Components

### Buttons
Quiet, compact, and filled only when they are the next action.
- **Send:** a 32 px model-kit teal circle with a white arrow; hover deepens to teal ink; press scales to 0.94.
- **Stop:** replaces send while JARVIS works: an ink circle with a ground-coloured icon and no looping ring.
- **Primary (dialog, phone):** teal ink fill with white text, 8 px corners (12 px on the phone), 32 px tall with 24 px sides in the approval dialog; hover goes to model-kit teal.
- **Card buttons:** the approval card's Allow and Deny are equal 28 px outline buttons (specimen white, border-strong, 12 px at 600); hover fills surface-3, and Deny turns red on hover.
- **Tool buttons:** 32 px transparent squares with an 18 px line icon in text-3; hover surface-3; pressed teal wash with a teal-ink icon; a cut link turns danger wash with a red icon; the Think toggle is one of them.
- **Close:** a 28 px transparent square with the icon set's close mark in text-3; hover surface-4 and text. Never a text glyph.

### Chips
- **Starters:** pill outlines in border-strong with text-2, 32 px tall; hover lifts to specimen white with a rod border; press scales to 0.97. Hidden once the chat has lines and on the Code page.
- **Machine facts:** 24 px pill outlines in border on a transparent ground, quiet text with the value in text.
- **Model chip:** a transparent 32 px button with the model name after a small dot (green when loaded, busy teal while loading).

### Cards / Containers
- **Corner Style:** 12 px.
- **Background:** specimen white for artifact cards, settings cards, menus and the dialog; the sunk well for tool cards and code blocks.
- **Shadow Strategy:** none at rest (see The Float Only Rule).
- **Border:** 1 px border or border-strong.
- **Internal Padding:** 8 to 16 px; settings cards 16 px.
- **Artifact card and tile:** a 40 px element tile on the left spanning two lines; the title (14 px, 600) on the first, the type word in text-2 followed by the state or date in text-3 (12 px) on the second. Hover keeps specimen white and turns the border model-kit teal.

### Inputs / Fields
- **Composer:** a 20 px rounded specimen-white card with a border-strong edge and the rest shadow; on focus the border turns model-kit teal and nothing glows. The textarea itself has no outline; the focus is the card. Its control row sits under it.
- **Context meter:** a 12 px ring: rod grey at rest, model-kit teal past 70 %, red past 90 %. No conic fill.
- **Rail search:** 32 px, 12 px corners, rail-hover fill, rail-line border that turns rail teal on focus.
- **Focus outline (everywhere else):** 2 px solid teal ink, 2 px offset; rail teal on the rail.

### Navigation
- **Rail:** carbon. The top row holds the sidebar toggle, the mesh logo (24 px) with the wordmark, and a chat/code segmented switch whose pressed icon is rail teal. Nav items are 32 px rows with 18 px line icons in rail-ink-3; hover rail-hover; current rail-active with the icon in rail teal; press scales to 0.985.
- **New chat:** a nav row in rail-ink-1 at 600 whose plus sits inside a 24 px rail-teal atom.
- **PC / Mac:** a segmented switch shown with the server on; the chosen computer is a rail-teal segment with carbon ink.
- **Chats and folders:** 32 px rows in rail-ink-2; the current chat fills rail-active and carries an 8 px rail-teal atom. A running chat shows a stepped spinning ring (800 ms, eight steps), a waiting one a hollow teal ring, an unseen reply a filled atom.
- **Foot:** the live readout (CPU, GPU, RAM: 12 px names, a 4 px bar, a mono value), the services molecule, then Settings.
- **Workspace tabs:** 32 px, 8 px corners, 13 px; each carries an 8 px atom that is grey at rest and teal when selected; the selected tab fills surface-3. Each ends in a close button.

### Element tile (signature)
An artifact's type drawn as a cell of the kit's periodic table: a 40 px square with 8 px corners, teal-wash fill, a 1 px inset model-kit teal ring, and a two-letter symbol in teal ink (Ch chart, Tb table, Pg page, Dc document and so on, from `src/core/artifact-symbols.js`). The type word stays in the tile for screen readers but is visually hidden; sighted readers get it on the line under the title. A tile with no type yet shows a quiet ellipsis.

### Step chain (signature)
Every assistant reply, step row, action and error is a line with a 36 px left indent holding its atom: a 16 px teal atom for a reply, a 10 px grey one for a step row or action, red for an error or a failed or denied step, a 14 px hollow teal ring for an approval awaiting an answer or a queued step. When the next line is also part of the turn, a 2 px rod-grey bond runs from this atom down to the next one. Inside a step row, each step is an 8 px atom on its own vertical rod: grey while listed, hollow teal while running or queued, teal when done, red when failed or denied. The 24 px mesh replaces the atom of the newest reply (and of a running step row) and spins while it works, so JARVIS's mark sits on the end of the chain.

### Services molecule (signature)
At the foot of the rail, one 12 px atom per service (LM Studio, Sensors, Voice, JARVIS server) on a single 2 px horizontal rod, the name under each in 12 px: a rail-teal atom when up, a grey ring when unknown, a small red diamond with red text when down. Settings lists the same services with the main-area atoms.

### The node mesh (kit mode)
`<html data-mesh="kit">` makes `src/core/node-mesh.js` draw its shared simulation as the kit: 48 atoms on a Fibonacci sphere, each bonded to its three nearest neighbours, sorted by depth and shown in four flat tone steps; front atoms are teal with a rim and a short white highlight arc, back atoms and rods fade towards the ground in grey. Under 40 px it draws every other atom. Colours come from the `--core-*` tokens and repaint with the theme. The hero sits above the greeting at `clamp(48px, 24vh, 192px)`, turns about a tilted axis while on screen, opens with the letters typed in the composer, sends thin rod-grey rings from a click, and spins with a fling when dragged. The brand logo is a still picture of it; the reply mesh moves only while a reply or step runs, then rests as a picture.

### Approval
In the conversation, an approval is a tool card with a busy-teal border and teal-wash fill, "Needs approval" in busy teal at 600, and equal card buttons; once answered it settles to the sunk well with a green (approved) or red (denied) border. Through the server it is a 560 px dialog: specimen white, 1.5 px model-kit teal border, 12 px corners, the float shadow, the scrim behind, and a teal-ink primary button.

### System readings and usage
Panel cards are specimen-white 12 px cards with 12 px quiet heads; figures are 20 px Cascadia; traces are a 1.5 px line with no area; bars are 4 px with rounded ends on a surface-3 track. The Code page's usage card uses sentence-case labels and draws its activity map as a grid of atoms.

### Phone app
`mobile.html` with `src/ui/mobile.css` and `src/nodes/mobile.css`: the same tokens, the hero mesh on the empty chat, the bubble with its tail, a teal-ink primary, a field whose focus is a model-kit teal border, sentence-case list heads, and a single press-in (0.97) for everything pressable.

## Do's and Don'ts

### Do:
- **Do** draw every atom with the flat recipe: fill, a 1 to 1.5 px inset rim in the darker shade, and a 1 to 1.5 px white crescent on the upper left.
- **Do** use accent (teal ink), never accent-mid, for teal text; keep accent-mid for atoms, fills, borders and icons.
- **Do** make every text colour reach 4.5:1 on bg, surface-1, surface-2 and surface-3 (and on rail, rail-hover and rail-active for rail text).
- **Do** set numbers, paths, model ids and element symbols in Cascadia Code with tabular figures.
- **Do** animate an arriving atom with a 280 ms ease-out scale from 0.4, and draw its bond in after it (320 ms, 60 ms later).
- **Do** keep state changes at 150 to 200 ms on the ease-out curve (cubic-bezier(0.16, 1, 0.3, 1)) and readout bars at 600 ms; under reduced motion remove the atom and bond animations and show the mesh as a still picture.
- **Do** use inline SVG line icons from the shared icon set, including the close mark; never a text glyph.
- **Do** draw an artifact's type as an element tile with its symbol from the shared helper, and keep the type word readable to screen readers.
- **Do** keep the shared DOM ids and class names when styling the nodes design; change it through `src/nodes/tokens.css` and `src/nodes/nodes.css`, not the shared styles.

### Don't:
- **Don't** use gradients anywhere, including conic fills, radial shading on atoms or a ramp across the mesh; depth is stepped flat tones.
- **Don't** add glow, focus halos, coloured shadows, blur or looping rings; focus is a teal line.
- **Don't** colour a section, a heading or a page title: no per-section hues, no accent bar under a title.
- **Don't** use amber; the busy and warning role is teal in this kit.
- **Don't** use green except for finished and added things.
- **Don't** use uppercase labels or letter-spaced small caps; everything is sentence case.
- **Don't** load web fonts; Segoe UI Variable and Cascadia Code are system faces.
- **Don't** give resting cards, tiles or tool steps a shadow.
- **Don't** describe the classic interface (classic.html, mobile-classic.html, src/styles/tokens.css) as this system; it is a separate layout.
