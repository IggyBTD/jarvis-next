# Icon style reference

Target: the icon style of Claude's desktop app sidebar. Source: the 15 crops in `docs/icon-crops/` (menu, sidebar-toggle, back, forward, chat-search, code, new, search, artifacts, scheduled-clock, plugins, chevron-down, cloud, cloud-off, more-dots).

How the numbers below were taken: each crop is 320 px and was enlarged about 16x from a 16 to 20 px render, so a glyph's live area is about 11 to 13 px. Stroke widths are measured at the 50 percent brightness edge. Units are a 24 unit grid with the live area scaled the way Lucide scales it (about 10.2 crop px per unit). Treat every figure as plus or minus 0.5 unit.

## Construction

- Outline only. One stroke weight inside a glyph and across glyphs. No fills, no duotone, no second tone. The three dots in `more` are discs, but their diameter is about twice the stroke, so they are a stroked circle of radius 1 and not a separate shape.
- Round caps and round joins everywhere: bar ends in the menu, plus arms, chevron tips, clock hands, plug prongs, the cloud-off slash. No square or mitred ends.
- Stroke weight is about 9.5 percent of the glyph's longest side (range 8.5 to 10.5 percent across the 15 crops). On a 24 grid with a 20 unit live area that is 1.75 to 1.9, about 1.2 px at a 16 px render. Lucide and Tabler stock weight (2) is slightly heavy, the project's 1.5 slightly light. Use 1.75.
- Corners on rectangles: centre-line radius about 2 to 2.5 units (about 17 percent of the sidebar glyph's height). Rounded, not pill-shaped and not squircle-soft.
- Optical size: the glyph fills about 20 of 24 units. Chevrons are 6 by 12 units (a 90 degree corner). The dropdown chevron-down is drawn at about 65 percent of the back and forward chevrons and is dimmed. Forward is dimmed too (inactive), so state is carried by opacity and not by a different glyph.
- Density: one to four strokes per glyph. No detail inside shapes (no dots in the chat bubble, no tick marks on the clock, no letters). Plug is the most complex at four strokes.
- Single colour, `currentColor`.

## Glyph geometry

| Crop | Geometry |
|---|---|
| menu | Three left-aligned bars. Bars 1 and 2 about 16.5 units long, bar 3 about 8 units (about half). Spacing about 7 units. |
| sidebar-toggle | Landscape rounded rectangle, about 19 by 14.6 units (aspect 1.3), corner radius about 2. Inside it a short vertical pill (about 6 units long, vertically centred) inset about 4.5 units from the left edge. It is not a full-height divider and the panel is not filled or half-filled in this crop; only the outline state is in the crops. |
| back, forward | Plain 90 degree chevron, 6 by 12 units, no shaft. |
| chat-search (Chats) | Two overlapping round bubbles. The large one is upper left with a small flat, flared tail at its lower left. The smaller one sits lower right in front of it with its own tail. Nothing inside the bubbles. |
| code | Two 90 degree bracket chevrons (4 by 8 units) and a slash between them that leans right about 15 degrees and is taller than the brackets. |
| new | Plus, arms about 14 units, no container. |
| search | Ring about 14 units across the centre line (about 86 percent of the glyph), short handle (about 5.5 units) leaving the ring at 45 degrees to the lower right. |
| artifacts | Two same-size portrait rounded rectangles (about 11 by 13 units) offset diagonally, front one lower left, back one upper right, both tilted a few degrees counter-clockwise. Not a cube, not a stack of sheets. |
| scheduled-clock | Circle about 19 units across, the largest glyph in the set. Minute hand straight up from the centre, hour hand from the centre towards the lower right at about 27 degrees below horizontal (Lucide's `clock`). No ticks. |
| plugins | Plug turned 45 degrees: cord at the lower left, body a rounded shape with a flat side facing the prongs, two short prongs at the upper right. Four strokes. Not the upright power plug. |
| chevron-down | The same chevron as back, turned down, smaller and dimmed. |
| cloud | One continuous outline with a flat bottom, a large bump at the top and a smaller one at the right. No inner detail. |
| cloud-off | The cloud with one diagonal slash from upper left to lower right that runs past the cloud outline and breaks it. |
| more-dots | Three discs about 3.6 units across, centres about 6 units apart. |

## What does not match

- Material and Android-like sets: heavy rounded strokes, bubbly bodies, large corner radii, filled or tonal variants (Mingcute, Solar bold, Material Symbols).
- A 3D cube for artifacts, a bubble with three dots for chat, an upright two-prong plug or a circle-with-two-bars socket for plugins (the project's current Iconoir mapping uses all three).
- Square caps and 1 px hairlines on a 15 px grid (Radix).
- Detail inside glyphs and double outlines (Fluent, Carbon).

## Candidate in the project

`ref:outline`, "Reference match (Lucide + Tabler)", built by `npm run icons` from the `ref` column of `icons/icon-map.json`. Each entry names its source as `lucide:<icon>`, `tabler:<icon>` or `custom:<file in icons/custom/>`. Lucide supplies chevrons, clock, search, plus, ellipsis and most utility icons. Tabler supplies the diagonal plug, the tilted cards (artifacts), `code`, the flared-tail chat bubble and the pin. `icons/custom/sidebar.svg` is drawn from the measurements above. Use stroke 1.75.

Known gaps against the crops: artifacts is Tabler's cards (tilted more than the reference, two different card sizes); there is no two-bubble Chats glyph in the app's name list; the cloud and cloud-off crops have no semantic name in `icon-map.json`; the sidebar glyph has no chevron, so the hidden-sidebar flip in `src/ui/icons.css` does nothing for this set.
