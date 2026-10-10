# JARVIS Spacing and Sizing System (design philosophy)

> Saved 2026-10-11 from the brief you wrote, unchanged below this note. Status: **not implemented yet**. The text says `C:\Users\bethe\JARVIS-HUD`; in practice the project is `C:\Users\bethe\JARVIS-Next`. Where it overlaps the tokens already in `src/styles/tokens.css` (spacing scale, radii, `--strip-h`), this document wins on spacing and sizing once it is applied. Note that it changes the current token names and values (for example `--s-N` stays on the 4 px base but adds `--s-0` and `--s-8`, and `--r-pill`).

Project: `C:\Users\bethe\JARVIS-HUD` (Tauri + Vite + vanilla JS). Front-end CSS only. Do not touch Rust, telemetry or LM Studio code. Work on branch `ui-spacing`, commit per section. This file supplements `JARVIS_UI_Refinement.md` and wins wherever the two conflict on spacing or sizing.

## 0. Provenance (read this first)

This is NOT an official Anthropic spec. Claude's real design tokens are not public and I have not seen them. What follows is a system inferred from how polished desktop chat apps (Claude's included) look and behave, combined with standard design-system practice. Treat the principles as the point. The exact pixel values are a sensible starting set to tune by eye.

## 1. The philosophy in one paragraph

Polished UIs feel calm because almost every measurement is a choice from a tiny menu, and elements that share a row or a region share a size. There is no "about 36px" anywhere. Heights come from three tiers, gaps come from one scale, radii come from one scale, and everything in a horizontal strip sits on a single centre line. When an app feels "weird" without an obvious bug, the cause is nearly always a small number of siblings that disagree (a toggle 4px taller than the wordmark beside it, a button 38px next to a field 36px, gaps of 100px between messages in one place and 24px in another).

## 2. The seven rules

1. **One grid.** Base unit 4px. Every margin, padding, gap, width, height and line-height is a multiple of 4. Half steps (2px) are allowed only for 1px borders and optical nudges, and each must carry a comment.
2. **Three control heights.** All interactive elements and rows use one of: `28` (compact), `32` (default), `40` (prominent). Nothing else. The exception is the title strip at 40 and large hit targets that are padded boxes, not visible controls.
3. **Shared-row rule.** Siblings in one horizontal row have the same height and the same vertical centre. If the JARVIS wordmark, the mode toggle and the sidebar toggle share a header row, they are all the same row height, and the toggle's pill is sized to that row, not the other way round.
4. **Proximity scales with relationship.** Related things sit close (4 to 8). Separate items in a group sit at 12 to 16. Separate groups sit at 24. Separate regions sit at 32 to 48. Gap size encodes meaning, so never pick a gap by feel.
5. **Padding follows radius, radius follows size.** Larger containers get larger radii and larger padding. Nested radii obey `inner = outer - padding` (so a 20px bubble with 8px padding holds a 12px control, never another 20px).
6. **One gutter per container, repeated.** Sidebar gutter 16. Pane gutter 24. Card inner padding 16. The same value is used on every side of a container. Never 16 left and 12 top unless the asymmetry is optical and commented.
7. **Content has a measure.** Reading content (chat) is capped at a fixed max width and centred. Dashboards (the System pane) use a column grid. Never let text run edge to edge.

## 3. Tokens

Replace all ad-hoc values with these in `src/styles/tokens.css`.

```css
:root {
  /* Spacing scale (4px base). Only these values may appear in margin, padding, gap. */
  --s-0: 0;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --s-7: 48px;
  --s-8: 64px;

  /* Control heights */
  --h-sm: 28px;
  --h-md: 32px;
  --h-lg: 40px;

  /* Structural heights */
  --strip-h: 40px;          /* title strip across both panes */
  --sidebar-w: 264px;       /* sidebar width, multiple of 8 */
  --measure: 720px;         /* chat column max width */
  --pane-gutter: 24px;
  --sidebar-gutter: 16px;
  --card-pad: 16px;

  /* Icons: glyph sits inside a control, never alone */
  --icon-sm: 16px;
  --icon-md: 18px;
  --icon-lg: 20px;

  /* Radii */
  --r-sm: 8px;
  --r-md: 12px;
  --r-lg: 20px;
  --r-pill: 999px;

  /* Line heights (all multiples of 4) */
  --lh-xs: 16px;   /* 11 to 12px text */
  --lh-sm: 20px;   /* 13 to 14px text */
  --lh-md: 24px;   /* 14 to 16px text */
  --lh-lg: 28px;   /* 20px text */
  --lh-prose: 28px;/* assistant prose at 16px, about 1.75 */
}
```

Type sizes remain `11, 12, 13, 14, 16, 20`. Each pairs with exactly one line-height above.

## 4. Control sizing rules

| Control | Height | Horizontal padding | Radius | Icon |
|---|---|---|---|---|
| Icon button | 32 x 32 | 0 (centred) | `--r-sm` | 18 |
| Compact icon button (tabs close, pager arrows) | 28 x 28 | 0 | `--r-sm` | 16 |
| Text button (New chat, toolbar actions) | 40 | 16 | `--r-md` | 18 |
| Select / Model switcher | 32 | 12 | `--r-md` | 16 chevron |
| Segmented toggle (chat / code) | 32 total | 2 inner pad, segments 28 | `--r-md` outer, `--r-sm` inner | 18 |
| Sidebar nav item | 40 | 12 | `--r-sm` | 18 |
| Recent chat row | 32 | 12 | `--r-sm` | none |
| Tab | 32 | 12 | `--r-sm` top, 0 bottom | 16 close |
| Input bar (idle, 1 line) | min 56 | 16 | `--r-md` | |
| Send / stop | 32 x 32 | 0 | `--r-sm` | 18 |

The segmented toggle rule is the fix for the mismatch you noticed: its outer height is exactly 32, its two segments are 28 with a 2px frame, and the header row it sits in is 40 with everything centred on the same horizontal line. The JARVIS wordmark is line-height 24 inside that 40 row, so toggle, wordmark and sidebar-collapse button all share a centre line even though their heights differ by tier. Rule 3 means centre line equality is the hard requirement, and height equality applies where elements are visually the same kind of object (for example three buttons in a row).

## 5. Region layout

### 5.1 Sidebar (264 wide)

```
 header row        40 tall, padding 0 16
 gap               8
 Model select      32 tall, margin 0 16
 gap               8
 New chat button   40 tall, margin 0 16
 gap               24
 Nav items         40 each, 0 gap between, container padding 0 8
 gap               24
 "Recent chats" label  24 line box, 12px text, padding 0 16
 Chat rows         32 each, 0 gap, container padding 0 8
 ...flex spacer...
 Resource widget   padding 16, card margin 0 16 16 16
 Status row        32 tall, padding 0 16
```

Rules:
- The nav container has 8px side padding and items have 12px inner padding, so item text aligns with the 16px sidebar gutter (8 + 12 = 20 would misalign, so use item padding 8 when the container is 8, giving text at 16). Pick one scheme and make the label, the chat rows and the nav items all share the same text left edge (16px from the sidebar edge).
- Selected row uses a fill, not extra padding, so selection never shifts layout.

### 5.2 Title strip (40 tall, both panes)

- One strip, `height: var(--strip-h)`, single bottom divider spanning both panes.
- Left pane: chat title left-aligned at 24px gutter, panel-toggle button at the right edge with 24px gutter.
- Right pane: tabs start at 16px, window controls flush right, each control 40 wide by 40 tall (or a platform-standard width) with icon 16.
- Everything centred vertically with `align-items: center` on a flex row, never with manual top padding.

### 5.3 Chat column

- Content column: `max-width: var(--measure)`, centred in the pane, side padding `--pane-gutter`.
- Turn spacing (the main thing that currently feels off): **24px between a user message and the assistant block that follows, 32px between one exchange and the next.** The very large gaps in the current screenshot (roughly 100px or more) come from stacked margins and must be removed. Use a single `gap` on a flex column instead of margins on each message, so spacing cannot compound.
- Assistant block internals: thought-disclosure line (24 line box), 8px gap, prose with `--lh-prose`, paragraphs separated by 16px.
- User bubble: padding `8px 16px`, `--r-lg`, max width 80% of the column, right-aligned.
- Inline notices (for example the VOICE error): a single block, padding 12 16, `--r-md`, 8px gap between icon and text, margin 16 above.
- Bottom of the scroll area has 24px padding above the input dock so the last message never touches it.

### 5.4 Input dock

- Dock sits in the same `--measure` column, with 24px below it to the window edge.
- Input container: padding 12 16, `--r-md`, textarea min 24px per line, auto-growing to a max of 8 lines.
- Toolbar row inside the container: 32px tall, 8px gap between icon buttons, left group (attach, mic, globe, wifi) and right group (counter, send) separated by flex space.
- Gap between textarea and toolbar row: 8.
- Anything that is not part of the container (stray hairlines, floating pills) is removed. If a level meter is needed it lives inside the container with a label.

### 5.5 System pane (dashboard)

This pane uses a 12-column grid with `gap: var(--s-4)` (16), outer padding `--pane-gutter` (24).

- Stat cards (Processor, Graphics, Memory): span 4 columns each, equal height, padding `--card-pad` (16), `--r-md`.
- Card internal rhythm: label (12px, 16 line) , 4 gap, value (20px, 28 line) , 4 gap, caption (11px, 16 line) , 12 gap, sparkline.
- Sparkline: **fills the full inner width of the card** (`width: 100%`, height 32 to 40) with 0 padding to the card's left and right inner edges and the same 16px inner padding to the bottom as everywhere else. It must not touch the card border.
- Cores grid: tiles are 40 x 40 with 8 gap, 2 columns, but the whole cores block should match the height of the neighbouring Heat panel via `align-items: stretch`, so the row looks balanced.
- Metric rows (Processor / Graphics / SSD ... inside a card): each row is 48 tall (label line 20, 8 gap, 4px bar, 16 slack), separated by 1px dividers, with the value right-aligned in mono with tabular numerals.
- Section labels ("Cores", "Memory, storage and network"): 12px, 24 line box, 24px above, 8px below.
- Model card: two-column definition grid with 16 column gap and 12 row gap, constrained so columns do not drift to opposite edges (use `grid-template-columns: repeat(2, minmax(0, 1fr))` inside a card capped at 640px, or use 3 to 4 columns on a wide pane).

## 6. Corner and padding relationships

- Card (`--r-md` 12) padding 16 holds children with radius at most `--r-sm` 8 (12 - 16 is negative, so inner elements use the next smaller step).
- Input container (`--r-md`) with padding 12 holds buttons with `--r-sm` (8).
- Bubble `--r-lg` 20 with padding 8 16 holds no nested radii.
- Pills (`--r-pill`) are only for tags and status chips with height 20 or 24.

## 7. Optical rules (small, but where "refined" comes from)

- Icons sit in a 32 box and the glyph is 18. Icon-plus-label buttons use an 8px gap between glyph and text.
- Text beside an icon is optically centred: if mono or serif text looks 1px high or low next to an icon, adjust with `transform: translateY(0.5px)` and a comment, never by changing padding.
- Numeric columns use tabular numerals so values do not jitter as they update.
- A 1px border counts toward size: use `box-sizing: border-box` globally so a 32px control stays 32px with or without a border.
- Bars and progress tracks are 4px, with a 2px radius. Sparklines use a 1.5px stroke.
- Scrollable regions reserve scrollbar space with `scrollbar-gutter: stable` so content does not shift when a scrollbar appears.

## 8. Implementation steps

1. **Inventory.** Write a small script `scripts/audit-css.mjs` that scans all CSS and inline styles for any `margin`, `padding`, `gap`, `width`, `height`, `border-radius` or `line-height` values not on the token scale, and print them with file and line. Save output to `docs/spacing-audit-before.md`.
2. **Tokens.** Add the tokens above and replace off-scale values everywhere. When a value is genuinely off-scale for a reason (a 1px border, an optical nudge), annotate it with `/* optical: reason */`.
3. **Rows first.** Fix the shared-row mismatches in this order: sidebar header (wordmark, toggle, collapse), title strip, input toolbar, tab row, resource widget rows.
4. **Region layouts.** Apply sections 5.1 to 5.5.
5. **Chat spacing.** Convert chat message margins to a single flex `gap` column per section 5.3 and delete every `margin-top` and `margin-bottom` on messages.
6. **Dashboard grid.** Apply the 12-column grid, equal card heights, and full-width sparklines per section 5.5.
7. **Lint.** Add `npm run lint:spacing` running the audit script and failing when any off-scale value is found. Run it in a pre-commit hook.

## 9. Automated verification (do this, do not eyeball it)

Add `scripts/measure-ui.mjs`, runnable in the dev webview or with Playwright against the Vite dev server. It must:

1. Find every flex or grid row container in the sidebar header, title strip, input toolbar, tab bar, status row and resource widget.
2. For each, measure the bounding boxes of its children and compute (a) each child's vertical centre and (b) each child's height.
3. Fail if any child's vertical centre differs from the row's centre by more than 0.5px.
4. Fail if any control height is not in `{28, 32, 40}` (excluding the strip, the input container and cards).
5. Fail if any gap between siblings is not a value in the spacing scale.
6. Fail if any two buttons of the same kind (icon buttons, nav items, chat rows) have different sizes.
7. Print a table of violations and write it to `docs/spacing-audit-after.md`.

Also add a dev-only overlay toggled with `Ctrl+Shift+G` that draws the 4px grid and outlines every element's box, so I can see misalignments myself. It must be stripped from production builds and use `pointer-events: none`.

## 10. Specific issues I have already spotted (verify and fix)

- The chat / code segmented toggle is taller than the JARVIS wordmark and its centre line does not match. Fix per section 4.
- The Model select (about 36 tall) and New chat button (about 38 tall) are not on a tier. Make them 32 and 40.
- Nav item pitch is about 40 but Recent chat pitch is about 39, and their text left edges differ. Unify per section 5.1.
- Gaps between chat turns are far larger than any scale value and inconsistent. Fix per section 5.3.
- Sparklines cover about a third of their cards and touch the bottom border. Fix per section 5.5.
- Cores tiles are small and their block does not match the height of the Heat panel beside it.
- The Loaded models card spreads its columns across about 1000px.
- A stray flat line sits inside the input bar and a small white pill floats under it at the bottom right. Remove or contain both.

## 11. Acceptance checklist

- [ ] `lint:spacing` passes with zero off-scale values (or each exception is annotated).
- [ ] `measure-ui` reports zero centre-line violations and zero off-tier control heights.
- [ ] Toggle, wordmark and sidebar-collapse button share one centre line.
- [ ] Message turns use a single flex gap, with no stacked margins.
- [ ] Sparklines span their card's inner width with proper padding.
- [ ] Text left edges in the sidebar (nav, labels, chat rows, status) are identical.
- [ ] Before and after screenshots saved to `docs/ui-shots/`, same screen as before.
- [ ] Window dragging still works and overlays use `pointer-events: none`.

## 12. Reporting

Work in the order of section 8. After step 3 and again after step 6, post a short summary and the current `measure-ui` output. At the end, list any value you could not fit to the scale and why.
