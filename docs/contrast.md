# Contrast

WCAG 2.2 ratios computed by `scripts/contrast.mjs` from the tokens in `src/styles/tokens.css`. Re-run it after changing a colour.

## dark

| Token | On | Ratio | Needs | Result | Used for |
|---|---|---|---|---|---|
| text #E6EDF3 | bg #0A0E14 | 16.37 | 4.5 | pass | body text |
| text #E6EDF3 | surface-1 #0F141B | 15.64 | 4.5 | pass | body text |
| text #E6EDF3 | surface-2 #131A23 | 14.81 | 4.5 | pass | body text |
| text #E6EDF3 | surface-3 #1A222D | 13.56 | 4.5 | pass | body text |
| text-2 #A9B6C4 | bg #0A0E14 | 9.37 | 4.5 | pass | secondary text |
| text-2 #A9B6C4 | surface-1 #0F141B | 8.96 | 4.5 | pass | secondary text |
| text-2 #A9B6C4 | surface-2 #131A23 | 8.48 | 4.5 | pass | secondary text |
| text-2 #A9B6C4 | surface-3 #1A222D | 7.76 | 4.5 | pass | secondary text |
| text-3 #7C8A99 | bg #0A0E14 | 5.48 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| text-3 #7C8A99 | surface-1 #0F141B | 5.24 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| text-3 #7C8A99 | surface-2 #131A23 | 4.96 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| text-3 #7C8A99 | surface-3 #1A222D | 4.54 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| accent #38BDF8 | bg #0A0E14 | 9.03 | 4.5 | pass | links and active labels |
| accent #38BDF8 | surface-1 #0F141B | 8.63 | 4.5 | pass | links and active labels |
| accent #38BDF8 | surface-2 #131A23 | 8.17 | 4.5 | pass | links and active labels |
| accent-mid #2B8FBF | bg #0A0E14 | 5.33 | 3 | pass | chart line, icons, bars |
| accent-mid #2B8FBF | surface-2 #131A23 | 4.82 | 3 | pass | chart line, icons, bars |
| accent-dim #1E6F9A | bg #0A0E14 | 3.50 | 3 | pass | idle icons and strokes |
| accent-dim #1E6F9A | surface-2 #131A23 | 3.16 | 3 | pass | idle icons and strokes |
| warm #F5A524 | bg #0A0E14 | 9.48 | 3 | pass | mic active, spike highlight, warnings |
| warm #F5A524 | surface-2 #131A23 | 8.58 | 3 | pass | mic active, spike highlight, warnings |
| danger #E5484D | bg #0A0E14 | 4.94 | 3 | pass | errors, top bar level |
| danger #E5484D | surface-2 #131A23 | 4.47 | 3 | pass | errors, top bar level |
| on-accent #04121C | accent #38BDF8 | 8.84 | 4.5 | pass | text on the accent button |

## light

| Token | On | Ratio | Needs | Result | Used for |
|---|---|---|---|---|---|
| text #0E1722 | bg #F6F9FC | 17.07 | 4.5 | pass | body text |
| text #0E1722 | surface-1 #EDF2F7 | 16.01 | 4.5 | pass | body text |
| text #0E1722 | surface-2 #FFFFFF | 18.04 | 4.5 | pass | body text |
| text #0E1722 | surface-3 #E3EAF2 | 14.87 | 4.5 | pass | body text |
| text-2 #3F5062 | bg #F6F9FC | 7.84 | 4.5 | pass | secondary text |
| text-2 #3F5062 | surface-1 #EDF2F7 | 7.35 | 4.5 | pass | secondary text |
| text-2 #3F5062 | surface-2 #FFFFFF | 8.28 | 4.5 | pass | secondary text |
| text-2 #3F5062 | surface-3 #E3EAF2 | 6.83 | 4.5 | pass | secondary text |
| text-3 #566679 | bg #F6F9FC | 5.56 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| text-3 #566679 | surface-1 #EDF2F7 | 5.22 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| text-3 #566679 | surface-2 #FFFFFF | 5.88 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| text-3 #566679 | surface-3 #E3EAF2 | 4.85 | 4.5 | pass | tertiary text (timestamps, labels, token counter) |
| accent #0B6EA8 | bg #F6F9FC | 5.22 | 4.5 | pass | links and active labels |
| accent #0B6EA8 | surface-1 #EDF2F7 | 4.89 | 4.5 | pass | links and active labels |
| accent #0B6EA8 | surface-2 #FFFFFF | 5.51 | 4.5 | pass | links and active labels |
| accent-mid #2478A8 | bg #F6F9FC | 4.59 | 3 | pass | chart line, icons, bars |
| accent-mid #2478A8 | surface-2 #FFFFFF | 4.85 | 3 | pass | chart line, icons, bars |
| accent-dim #3D7FA6 | bg #F6F9FC | 4.15 | 3 | pass | idle icons and strokes |
| accent-dim #3D7FA6 | surface-2 #FFFFFF | 4.39 | 3 | pass | idle icons and strokes |
| warm #A15C00 | bg #F6F9FC | 4.91 | 3 | pass | mic active, spike highlight, warnings |
| warm #A15C00 | surface-2 #FFFFFF | 5.19 | 3 | pass | mic active, spike highlight, warnings |
| danger #C9342F | bg #F6F9FC | 4.95 | 3 | pass | errors, top bar level |
| danger #C9342F | surface-2 #FFFFFF | 5.23 | 3 | pass | errors, top bar level |
| on-accent #FFFFFF | accent #0B6EA8 | 5.51 | 4.5 | pass | text on the accent button |
