---
name: JARVIS
description: A local AI assistant drawn as a molecular model kit; every reply, step and service is an atom bonded into the conversation.
colors:
  ground: "#f2f5f4"
  surface: "#ffffff"
  sunk: "#e6ecea"
  sunk-2: "#dbe3e1"
  bubble: "#e2e9e7"
  line: "#dbe2e0"
  line-strong: "#bfcac8"
  ink-1: "#131819"
  ink-2: "#3b4648"
  ink-3: "#566365"
  rod: "#9aa8a6"
  rod-atom: "#b5c0be"
  rod-rim: "#7f8e8c"
  teal: "#0a8a7c"
  teal-strong: "#087567"
  teal-text: "#076b60"
  teal-soft: "#dcefeb"
  teal-rim: "#06594f"
  on-teal: "#ffffff"
  danger: "#b3302a"
  danger-soft: "#f7e1de"
  danger-rim: "#82221e"
  ok-soft: "#e0f0e6"
  scrim: "rgba(19, 24, 25, 0.28)"
  rail: "#151b1c"
  rail-hover: "#202829"
  rail-active: "#263032"
  rail-line: "#2a3436"
  rail-ink-1: "#e9efed"
  rail-ink-2: "#a9b8b6"
  rail-ink-3: "#8a9a98"
  rail-teal: "#5fd6c6"
  rail-atom: "#3fc1b0"
  rail-atom-rim: "#1f7d71"
  rail-rod: "#4a5856"
  rail-danger: "#f07a6e"
  ground-dark: "#121718"
  surface-dark: "#1a2122"
  sunk-dark: "#222a2c"
  sunk-2-dark: "#2a3436"
  line-dark: "#273133"
  line-strong-dark: "#364244"
  ink-1-dark: "#e9efed"
  ink-2-dark: "#b3c0be"
  ink-3-dark: "#94a3a1"
  rod-dark: "#4f5e5c"
  teal-dark: "#3fc1b0"
  teal-text-dark: "#5fd6c6"
  teal-soft-dark: "#173835"
  teal-rim-dark: "#2a8f82"
  on-teal-dark: "#06201c"
  danger-dark: "#f07a6e"
  danger-soft-dark: "#3a1f1c"
  ok-soft-dark: "#1b3325"
  rail-dark: "#0b0f10"
  scrim-dark: "rgba(0, 0, 0, 0.5)"
typography:
  display:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
  body-reply:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  caption:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  mono-data:
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "tnum"
  mono-figure:
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.2
    fontFeature: "tnum"
  mono-symbol:
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, 'SF Mono', monospace"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
  brand:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  card: "14px"
  bubble: "20px"
  composer: "22px"
  pill: "999px"
  atom: "50%"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gap: "20px"
  xl: "24px"
  2xl: "32px"
components:
  button-send:
    backgroundColor: "{colors.teal-strong}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.atom}"
    size: "34px"
  button-send-hover:
    backgroundColor: "{colors.teal-rim}"
  button-approve:
    backgroundColor: "{colors.teal-strong}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "0 12px"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "0 12px"
    typography: "{typography.label}"
  button-secondary-hover:
    backgroundColor: "{colors.sunk}"
  button-deny:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    height: "30px"
    padding: "0 12px"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 12px"
  tool-button:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.md}"
    size: "32px"
  tool-button-on:
    backgroundColor: "{colors.teal-soft}"
    textColor: "{colors.teal-text}"
  starter:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: "32px"
    padding: "0 14px"
  starter-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.composer}"
    padding: "12px 10px 8px 16px"
    width: "min(720px, calc(100% - 48px))"
  bubble-user:
    backgroundColor: "{colors.bubble}"
    textColor: "{colors.ink-1}"
    padding: "10px 16px"
  card-tool:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.lg}"
  card-approval-head:
    backgroundColor: "{colors.teal-soft}"
    textColor: "{colors.ink-1}"
    height: "40px"
  card-artifact:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.card}"
    padding: "10px 14px 10px 10px"
  element-tile:
    backgroundColor: "{colors.teal-soft}"
    textColor: "{colors.teal-text}"
    typography: "{typography.mono-symbol}"
    rounded: "{rounded.sm}"
    size: "40px"
  readout:
    textColor: "{colors.ink-1}"
    typography: "{typography.mono-figure}"
    padding: "0 16px"
  button-close:
    textColor: "{colors.ink-3}"
    rounded: "{rounded.xs}"
    size: "24px"
  button-close-hover:
    backgroundColor: "{colors.line}"
    textColor: "{colors.ink-1}"
  nav-item:
    textColor: "{colors.rail-ink-1}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 8px"
  nav-item-hover:
    backgroundColor: "{colors.rail-hover}"
  nav-item-active:
    backgroundColor: "{colors.rail-active}"
  tab:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    height: "30px"
  tab-selected:
    backgroundColor: "{colors.sunk-2}"
    textColor: "{colors.ink-1}"
  menu:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "6px"
  input-search-rail:
    backgroundColor: "{colors.rail-hover}"
    textColor: "{colors.rail-ink-1}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 10px"
---

# Design System: JARVIS

## Overview

**Creative North Star: "The Molecular Model Kit"**

JARVIS's work is a structure being assembled in front of its owner. The ground is lab-white with a cool teal cast, the sidebar rail is carbon in both themes, JARVIS itself is teal plastic, and everything that connects one thing to another is a pale grey rod. The signature object is the core: a 48-atom ball-and-stick cage on a Fibonacci sphere that turns slowly, swells with streamed speech, breathes while thinking and spins when dragged. The kit also has a periodic table: each artifact type is an element tile with a two-letter symbol. The same vocabulary carries into the conversation: every reply, action and system note of a turn is an atom, and consecutive ones are bonded by a vertical rod into a step chain. Services at the foot of the rail are atoms on one horizontal bond.

The system is calm and dense in the way a desktop tool is dense: 14 px interface text, 15 px reading text, quiet 1 px lines, flat surfaces, one colour that means "JARVIS" and one that means "wrong". Depth comes from tone (ground, surface, sunk) rather than from shadows; only things that float over content cast one. Atoms are flat discs, never shaded spheres: a fill, a darker rim and a small white crescent on the upper left.

It rejects the grey chat column with a logo on top, and the cyan hologram on black that the old HUD used.

**Key Characteristics:**
- Lab-white ground (light) or deep carbon-teal ground (dark); the rail is carbon in both.
- One voice colour, teal, for JARVIS's atoms, the primary action, focus, the current item and the middle load level.
- Red only for errors, denials and the high load level.
- Flat atoms (fill, rim, crescent) and round-capped grey rods as the recurring motif.
- Segoe UI Variable for text, Cascadia Code for every number, path, model id and element symbol.
- Motion is "arrive and bond": a scale-in for the atom, a draw-in for its rod. On the empty page only the core moves by itself; greeting, starters and machine line are still.

## Colors

A cool, near-neutral lab palette with teal plastic for JARVIS and red plastic for faults; everything else is grey.

### Primary
- **Model-kit teal** (teal / teal-dark): JARVIS's atoms in the step chain and the core's front atoms, the 1 px inset ring of an element tile, the focus ring, the selected tab's atom, the active model's atom, borders of an approval card and a hovered artifact card, the middle level (`data-level="mid"`) of bars and sparklines, the resize handle under the pointer.
- **Pressed teal** (teal-strong): filled controls that carry white text: send, approve, the recording mic, badges. On dark it equals teal-dark and takes dark ink (on-teal-dark).
- **Teal ink** (teal-text / teal-text-dark): every piece of small teal text (links, keyword highlighting, "Needs approval", task in progress, palette match, the side-question label). Reaches 4.9:1 or better on every light surface.
- **Teal wash** (teal-soft): the fill of an element tile, the pressed state of composer toggles, the approval card's head, the highlighted palette row, the permission chip, the active voice wave.
- **Teal rim** (teal-rim): the darker ring of a teal atom, and the hover state of filled teal buttons.
- **Rail teal** (rail-teal, rail-atom, rail-atom-rim): the same plastic tuned for the carbon rail: the new-chat atom, the current chat's atom, a service that is up, the icon of the active nav item, the rail search focus border.

### Secondary
- **Fault red** (danger / danger-dark, danger-soft, danger-rim, rail-danger): error lines and their atoms, a failed or denied action's atom and card border, the Deny button text, a cut network link, a service that is down, deleted diff lines (danger-soft), and the high load level.

### Neutral
- **Lab white** (ground): the page ground, the inside of hollow atoms, tool output wells, system tiles and model cards.
- **Specimen white** (surface): cards, composer, menus, the workspace, code blocks, the code page columns.
- **Bench grey** (sunk, sunk-2): hover fills, inline code, reasoning bodies, segmented-control tracks, bar tracks; sunk-2 is the selected tab.
- **Bubble grey** (bubble): the owner's own messages.
- **Hairline** (line, line-strong): 1 px dividers and card borders; line-strong for interactive outlines (composer, starters, secondary buttons, menus).
- **Carbon ink** (ink-1, ink-2, ink-3): primary text, secondary text and quiet text (meta, placeholders, empty states). ink-3 still reaches 4.78:1 on the darkest light surface.
- **Rod grey** (rod, rod-atom, rod-rim): bonds of the step chain, blockquote rules, the hovered starter border, the focused composer border, and the grey atom of a tool step.
- **Added green** (ok-soft): the background of added diff lines, and nowhere else.
- **Carbon rail** (rail, rail-hover, rail-active, rail-line, rail-ink-1..3, rail-rod): the sidebar, in both themes; dark mode deepens it to rail-dark.
- **Scrim** (scrim / scrim-dark): the dimming layer behind the rail when it opens as a sheet in a narrow window, and nowhere else.

### Named Rules
**The One Plastic Rule.** Teal means JARVIS, the action you are about to take, or where you are. It never decorates a section, a heading or a chart series that carries no state.

**The Red Atom Rule.** Red is for something that went wrong or was refused, and for the high load level. A warning that is only "busy" is teal, not red.

**The Grey Rod Rule.** Bonds, idle bars and sparklines are grey. A bar or sparkline turns teal at the middle level and red at the high level; below that it stays grey.

**The Carbon Rail Rule.** The rail is carbon in light and dark alike and uses its own rail-* tokens; main-area tokens are never used on the rail.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI Variable Text, Segoe UI, system-ui)
**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, -apple-system, Helvetica Neue)
**Label/Mono Font:** Cascadia Code (with Cascadia Mono, Consolas, ui-monospace, SF Mono)

**Character:** Windows' own system faces, so the window feels native and nothing is downloaded. Cascadia is the "element symbol" voice of the kit: numbers, paths, model ids, element symbols and timings, always with tabular figures.

### Hierarchy
- **Display** (400, 32 px, 1.15, -0.015em): the greeting under the core and page titles (Artifacts, Settings). Drops to 24 px when the window is 700 px tall or less.
- **Headline** (600, 18 px, 1.3): second-level headings inside replies; first-level reply headings are 22 px.
- **Title** (600, 15 px): settings section heads, artifact titles, the artifact viewer title; 14 px at 600 for the column title, System section heads and a settings row's label; 13 px at 600 for code page panel heads and System reading names.
- **Body reply** (400, 15 px, 1.7): assistant replies and documents, at most 760 px wide in the transcript and 72ch in documents. The owner's own messages are 15 px at 1.55.
- **Body** (400, 14 px, 1.5): the interface default: nav items, card titles, menus.
- **Label** (500, 13 px): buttons, chips, tabs, tool card heads, search, palette rows.
- **Caption** (400, 12 px): meta under replies, chat snippets, tile subtitles, the rail's "Recents" heading (600, sentence case).
- **Mono data** (Cascadia, 12 to 13 px, tabular): timestamps, token meters, diff and output text, file trees, readouts. **Mono figure** (Cascadia, 24 px, never wraps) for the three big system readings. **Mono symbol** (Cascadia 600, 15 px, line-height 1) for the two-letter symbol on an element tile.

### Named Rules
**The Element Symbol Rule.** Every number, path, command, model id and element symbol is set in Cascadia Code with tabular figures; prose and controls never are. A type's readable word (Chart, Page, Document) is set in Segoe on the line under the title.

**The Sentence Case Rule.** All labels, headings and buttons are sentence case. No uppercase labels, no letter-spaced small caps. The JARVIS wordmark is the one name set in capitals.

## Layout

A two-column frame: a 256 px carbon rail and a main column with a 48 px title bar. The chat page splits into the conversation and an optional workspace (46 % wide by default) separated by a 9 px drag handle; the workspace stays closed until something opens in it. The code page is five tracks: files (248 px), handle, the same conversation, handle, tasks and changes (304 px); the right column hides under 1280 px.

When the conversation is empty, the core, greeting, composer, starters and one machine line stack together in the vertical middle; only the core moves, and nothing in the group rises or fades in. Once the first message lands, the transcript fills the column (gap 20 px between lines, content at most 760 px wide, centred) and the composer sits at the foot, 720 px wide at most with a 24 px margin each side.

Spacing runs on a 4 px base with 2 px half steps for tight insides (2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32). Page content (Artifacts, Settings) sits in an 880 px column with 32 px padding.

Responsive: under 1024 px wide the rail starts hidden and opens as a sheet over the content with the floating shadow and the scrim behind it; a click on the scrim or Escape closes it. At 700 px tall or less the core shrinks to 120 px and the greeting to 24 px. The composer is a size container: under 520 px it drops the token meter, under 420 px it shortens the model name and drops the separator.

## Elevation & Depth

Flat by default; depth is tonal. Ground, surface and sunk do the layering, and 1 px hairlines separate regions. Two shadows exist, both soft and neutral, never coloured. The one dimming layer is the scrim behind the narrow rail sheet.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgba(19,24,25,.06)`; dark `0 1px 2px rgba(0,0,0,.4)`): the composer at rest and the selected segment of a segmented control.
- **Float** (`0 2px 6px rgba(19,24,25,.06), 0 12px 32px rgba(19,24,25,.1)`; dark `0 2px 8px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.45)`): menus, the command palette, floating code-page panels, the context menu, the rail as a sheet, and the composer while focused.

### Named Rules
**The Float Only Rule.** A shadow means "this is above the page": a menu, a sheet, a floating panel, the focused composer. Resting cards, tiles and tool steps have a border and no shadow.

## Shapes

Gently rounded rectangles for containers and perfect circles for everything that is an atom. Corners step with size: 6 px for small inline buttons, close buttons and the focus ring, 8 px for tabs, rows, action buttons and element tiles, 10 px for nav items, tool buttons and inset wells, 12 px for code blocks and tool cards, 14 px for cards, menus and tiles, 22 px for the composer. Starters, chips and badges are pills. The owner's bubble is 20 px with a 6 px tail corner at the bottom right.

The atom recipe is the recurring silhouette: a circle filled with the plastic colour, an inset ring 1.25 to 1.5 px in the darker rim colour, and an inset 1 to 1.5 px offset of translucent white on the upper left for the crescent. A hollow atom (ground fill, 2 px ring) means pending or waiting: the reply being written, an approval not yet answered, a system note, a service of unknown state.

Bonds are 2 px rods with round caps: vertical in the step chain (from atom centre to the next atom), horizontal in the services strip. Inside the core bonds follow the sphere; outside it they run straight.

### Named Rules
**The Flat Atom Rule.** Atoms are fill, rim and crescent; never a radial gradient, a drop shadow or a glow.

**The Straight Bond Rule.** Outside the core, a bond is straight and axis-aligned: vertical between steps, horizontal between services.

## Components

### Buttons
Quiet, compact, and filled only when they are the next action.
- **Shape:** 8 px corners for action buttons (30 px tall), 10 px for tool and ghost buttons, a full circle for send and stop (34 px).
- **Primary:** send and approve are pressed teal with white text (dark ink on dark); hover darkens to the teal rim; press scales to 0.92 (send) or 0.97 (approve).
- **Secondary:** specimen white with a line-strong border and ink-1 text; hover fills bench grey.
- **Deny:** the secondary button with fault-red text.
- **Ghost / tool:** transparent, ink-3 icon or ink-2 text, bench-grey hover; a toggled tool button turns teal wash with teal ink.
- **Stop:** replaces send while JARVIS works; ink-1 fill with ground-coloured icon.
- **Close:** a 24 px transparent square with 6 px corners holding the icon set's close mark at 14 px in ink-3; hover fills hairline grey and turns ink-1. Used on workspace tabs, the artifact viewer and floating panels; never a text glyph.

### Chips
- **Starters:** pill outlines in line-strong with ink-2 text; hover lifts to specimen white with a rod border.
- **Model chip:** a transparent 32 px button with the model name and a chevron that turns 180 degrees when open.
- **Permission chip:** a teal-wash pill with teal ink, shown only outside normal mode.
- **Attachment chips:** ground-filled pills with a line-strong border; red border and wash on error.

### Cards / Containers
- **Corner Style:** 12 px (tool cards, code blocks), 14 px (artifact cards, tiles, menus).
- **Background:** specimen white; system tiles and model cards use lab white so they sit on the workspace.
- **Shadow Strategy:** none at rest (see The Float Only Rule).
- **Border:** 1 px line; 1 px line-strong on the artifact card, which turns teal on hover.
- **Internal Padding:** 10 to 14 px.
- **Artifact card and tile:** a 40 px element tile on the left spanning two lines; the title (14 px card, 15 px tile, 600) on the first, the type word in ink-2 followed by the state or date in ink-3 (12 px) on the second.

### Inputs / Fields
- **Composer:** a 22 px rounded card in specimen white with a line-strong border and the rest shadow; on focus the border goes rod grey and the shadow floats. The textarea itself has no outline; the focus is the card.
- **Rail search:** 34 px, 10 px corners, rail-hover fill, rail-line border that turns rail teal on focus.
- **Focus ring (everywhere else):** 2 px solid teal, 2 px offset, 6 px corners.

### Navigation
- **Rail:** carbon, 12 px side padding. Nav items are 36 px rows with 18 px line icons in rail-ink-2; hover rail-hover, current rail-active with the icon in rail teal. Press scales to 0.985.
- **New chat:** a nav row whose plus sits inside a rail-teal atom.
- **Recents:** 32 px rows in rail-ink-2, one line each, titles ellipsized; each carries a 6 px dot on the left that becomes a rail-teal atom (scaled 1.35) for the current chat. Rename and Delete appear only on hover or focus.
- **Workspace tabs:** 30 px, 8 px corners, each with an 8 px atom that is grey at rest and teal when selected; the selected tab fills sunk-2. Each ends in a close button (see Buttons).

### Element tile (signature)
An artifact's type drawn as a cell of the kit's periodic table: a 40 px square with 8 px corners, teal-wash fill, a 1 px inset teal ring, and a two-letter symbol (Ch chart, Tb table, Pg page, Dc document, Sv image, Dg diagram, Js, Ts, Py, Rs, Jn, Cs, Sh; otherwise the type's first two letters) in teal ink. The type word stays in the tile for screen readers but is visually hidden; sighted readers get it on the line under the title. A tile with no type yet shows an ink-3 ellipsis. The symbols come from one shared helper (src/core/artifact-symbols.js) so every surface draws the same table.

### Step chain (signature)
Every assistant reply, tool step, error and system note is a line with a 36 px left indent holding its atom: 16 px teal for a reply, 10 px grey for a tool step, red for an error or a failed or denied step, hollow teal for a reply being written or an approval awaiting an answer, hollow grey for a system note. When the next line is also part of the turn, a 2 px rod-grey bond runs from this atom to the next one. While JARVIS works, a 26 px live core replaces the newest reply's atom: the same 48-atom cage as the big core with its atoms drawn 1.8 times larger, so the object that lands is the object that flew.

### Approval card
A tool card with a 1.5 px teal border and a 40 px teal-wash head showing "Needs approval" in teal ink; its first button (Allow once) is the pressed-teal primary, then a secondary, then Deny in red. Once answered it settles to a plain 1 px card.

### The core
A canvas of 48 atoms on a Fibonacci sphere, each bonded to its three nearest neighbours, drawn at 168 px (120 px in short windows) above the greeting. Depth is shown in four flat tone steps: front atoms are teal with a teal rim and a crescent, back atoms and rods fade towards the ground in grey. It turns at 0.14 rad/s. Its swell and breath come only from the shared speech and thinking level: it breathes slowly while JARVIS thinks, swells up to 16 % and wobbles with speech, and holds its size while idle. It spins with momentum when dragged, and knocks the four atoms nearest a click outward on a spring. Colours come from the --core-* custom properties so the theme owns them.

### System readouts
The three headline readings (processor, graphics, memory) sit in one unboxed row of three equal columns, divided by 1 px hairlines and closed by a hairline below; no tile, no fill. Each column is a 13 px name in ink-2, a 24 px Cascadia figure that never wraps, a 12 px subtitle in ink-3, and a 24 px trace: a 1.5 px line only, no area, ink-3 until the middle level (teal) and the high level (red). Bars are 6 px (4 px on the rail) with rounded ends on a bench-grey track, coloured by the same levels. Fills animate with a 600 ms ease-out scale. Model cards stay lab-white 14 px cards.

### Settings rows
Each setting is a row with its label block on the left and its control on the right, wrapping onto two lines when narrow. The label block is a primary label (14 px, 600, ink-1) over a one-line explanation (13 px, ink-3). Choices are segmented controls: a bench-grey track with 3 px padding, the chosen segment in specimen white with the rest shadow.

### Window controls
46 px wide Windows buttons in the title bar; the close button's hover is Windows' own red (#c42b1c) with white, the one red outside the palette, kept to match the operating system.

## Do's and Don'ts

### Do:
- **Do** draw every atom with the flat recipe: fill, a 1.25 to 1.5 px inset rim in the darker shade, and a 1 to 1.5 px white crescent on the upper left (45 to 60 % white).
- **Do** use teal-text, never teal, for teal text smaller than 18 px; keep teal for fills, rings, atoms and icons.
- **Do** make every text colour reach 4.5:1 on ground, surface, sunk, sunk-2, bubble and teal-soft (and on rail, rail-hover and rail-active for rail text).
- **Do** set numbers, paths, model ids and file types in Cascadia Code with tabular figures.
- **Do** animate an arriving atom with a 280 ms ease-out scale from 0.4, and draw its bond in after it (320 ms, 60 ms later).
- **Do** keep motion within 120 to 320 ms for state changes on the ease-out curve (cubic-bezier(0.16, 1, 0.3, 1)), and remove it entirely under reduced motion; the core then stops spinning and swelling but still turns when dragged.
- **Do** hand the core over in one piece on the first message: its snapshot flies into the first reply's atom (560 ms) while the live core fades in over the same span.
- **Do** use inline SVG line icons from the shared icon set, including the close mark at 14 px; never a text glyph.
- **Do** draw an artifact's type as an element tile with its symbol from the shared helper, and keep the type word readable to screen readers.

### Don't:
- **Don't** use gradients anywhere, including radial shading on atoms or a ramp across the core; depth is stepped flat tones.
- **Don't** add glow, coloured shadows or blur halos; the only shadows are the neutral rest and float shadows.
- **Don't** colour a section, a heading or an idle chart: no per-section hues, no teal bars below the middle level.
- **Don't** use green anywhere except the background of added diff lines.
- **Don't** use uppercase labels or letter-spaced small caps; everything is sentence case.
- **Don't** load web fonts; Segoe UI Variable and Cascadia Code are system faces.
- **Don't** give resting cards, tiles or tool steps a shadow.
- **Don't** box the System readings in tiles or fill a trace with an area; one hairline-divided row and a line are enough.
- **Don't** describe the classic warm-grey interface (classic.html) as this system; it is a separate, frozen layout.
