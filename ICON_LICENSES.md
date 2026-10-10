# Icon and motion assets

| Asset | Source | Licence | Used for |
|---|---|---|---|
| Iconoir "regular" icons (chat bubble, code brackets, box, cpu, settings, sidebar, plus, arrow-up, xmark, chevrons, attachment, microphone, globe, wifi, copy, floppy disk, check) | https://github.com/iconoir-icons/iconoir (paths copied from `icons/regular/*.svg`) | MIT, Copyright (c) 2021 Luca Burgio | every icon in `src/core/icons.js` |
| Core-and-ring mark, stop square, globe-off slash, artifact cube edges | drawn for this project | project's own | brand mark, thinking indicator, stop button |
| Icon motion (`src/ui/icons.css`) | written for this project, plain CSS | project's own | hover, press and state animation |

## Considered and not used

| Asset | Why not |
|---|---|
| lucide-animated (https://lucide-animated.com, MIT) | React + Motion + shadcn components. This app is plain JavaScript with no React, no Tailwind and no shadcn, and its icons are Iconoir, not Lucide. |
| lucide-motion | Same, React based. |
| SVG Spinners (n3r4zzurr0, MIT) | Generic spinner look; the project's own mark replaces it. |
| useAnimations, LottieFiles, Flaticon, IconKing | Need a Lottie runtime or have attribution/download limits; a different drawing style from the line icons. |
| Spline, IconScout 3D, 3dicons.co | Phase 2 (3D) was not started; see the decisions listed in the hand-over message. |
