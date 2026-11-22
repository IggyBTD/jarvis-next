# Icon sources for the picker

`icons/candidates.json` holds up to 8 candidate drawings for each of the 49 names in `icons/icon-map.json` (388 in total), for the click-to-select page. Regenerate with `npm run icons:candidates` (`scripts/build-candidates.mjs`; edit the `PICKS` table there to change what is offered). It reads `icons/icon-map.json` and `icons/custom/` and writes only `icons/candidates.json`. The first entry of every name is the current `ref` from the map.

All drawings come from `@iconify-json/*` packages, so every body is in one format. Normalisation: colours become `currentColor`, no ids or classes, any icon that needs a mask or clip path is skipped. Stroke drawings are wrapped in `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="W">`, with W = 1.75 on a 24 grid (the reference weight, `docs/icon-style-reference.md`) and scaled for other grids (charm 16, system-uicons 21, so the viewBox is stated per entry). Fill drawings (outlines drawn as shapes, so their weight is fixed) are wrapped in `<g fill="currentColor" stroke="none">`. Every body renders alone in `<svg viewBox="...">`; all 388 were rasterised and none is blank.

## Sets

New sets (13, all permissive):

| id | package | version | licence | style |
|---|---|---|---|---|
| hugeicons | `@iconify-json/hugeicons` | 1.2.36 | MIT (per Iconify metadata) | stroke 1.5, free stroke-rounded set, has gpu, fan, ram |
| mage | `@iconify-json/mage` | 1.2.4 | Apache-2.0 | stroke 1.5, soft |
| heroicons | `@iconify-json/heroicons` | 1.2.3 | MIT | stroke 1.5, neutral |
| proicons | `@iconify-json/proicons` | 1.2.21 | MIT | stroke 1.5, has window-restore |
| mynaui | `@iconify-json/mynaui` | 1.2.20 | MIT | stroke 1.5, rounded bodies |
| meteor-icons | `@iconify-json/meteor-icons` | 1.2.10 | MIT | stroke 2, Lucide-like |
| humbleicons | `@iconify-json/humbleicons` | 1.2.20 | MIT | stroke 2, simple |
| akar-icons | `@iconify-json/akar-icons` | 1.2.7 | MIT | stroke 2, large live area |
| system-uicons | `@iconify-json/system-uicons` | 1.2.4 | Unlicense (public domain dedication) | very thin, 21 grid |
| charm | `@iconify-json/charm` | 1.2.3 | MIT | stroke 1.5, 16 grid, angular |
| f7 | `@iconify-json/f7` | 1.2.2 | MIT | SF Symbols look, filled outlines, 56 grid |
| uil | `@iconify-json/uil` | 1.2.3 | Apache-2.0 | Unicons line, filled outlines, dense |
| octicon | `@iconify-json/octicon` | 1.2.41 | MIT | GitHub style, filled outlines |

Coverage is uneven on purpose: hugeicons, heroicons, f7, charm and system-uicons supply most of the new drawings. uil (2), octicon (3) and meteor-icons (3) are only there where they add a distinct drawing (processor, plug, diff, pin, pencil, sparkle). Drop them from `PICKS` and uninstall them if they are not wanted.

Sets already in the project, now also read from their iconify copies (same drawings as the packages the build uses): tabler `@iconify-json/tabler` 1.2.46 (MIT), lucide `@iconify-json/lucide` 1.2.158 (ISC), phosphor `@iconify-json/ph` 1.2.2 (MIT, regular weight), iconoir `@iconify-json/iconoir` 1.2.12 (MIT), remix `@iconify-json/ri` 1.2.10 (Apache-2.0, line), solar `@iconify-json/solar` 1.2.13 (see below). The `custom` set is `icons/custom/sidebar.svg`.

Licence flag: Iconify lists Solar as CC-BY-4.0, which needs attribution. It was already a dependency. Eleven candidates come from it (plus-circle, stop, chevron arrows, tuning, checklist, add-folder, folder-open, menu-dots, pin); do not pick them unless attribution is added, or remove `solar:` from `PICKS`.

## Rejected

- Licence: Basil, Iconamoon, Pepicons, Lets-icons, Streamline (all variants), Font Awesome, NRK (CC-BY); Typicons, Arcticons (CC-BY-SA); Gala (GPL); Circum (MPL-2.0); mdi-light, Zondicons, Picon (OFL); Material Design Icons (Android look anyway).
- Style: Radix and Teenyicons (15 grid, 1 px hairlines), Fluent and Carbon (double outlines, detail inside glyphs), Ionicons outline (heavy 32/512 strokes), Pixelarticons (pixel), icon-park-outline (inner detail in mic, plug), Majesticons (the line variants are filled outlines at weight 2 and render blobby or heavy for cog, trash, paper-clip, copy), Eva, Jam, Bootstrap Icons, Clarity, Ant Design, Element Plus, TDesign (heavy, squarish or detailed), Line MD (animated, Material-like).
- Redundant or thin: Lucide Lab (extras only), Sidekickicons (Heroicons clone), Stash, Lineicons, Simple Line Icons, Flowbite, Quill, Lsicon, Si (no folder or settings), Fe, Mono Icons, Prime, Cuida, Gravity UI (16 grid, few hardware names).
- One icon rejected inside an accepted set: `mage:x` is the X (Twitter) logo, not a cross.
