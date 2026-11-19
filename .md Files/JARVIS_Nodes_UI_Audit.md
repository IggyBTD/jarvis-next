# JARVIS nodes interface: UI audit

Written 2026-11-19 with Impeccable's `audit` playbook, on branch `claude/nodes-redesign`. Nothing below has been applied: it is the list of what could change next.

**Evidence:** Chromium in a Linux container with a fake LM Studio and stubbed Tauri calls. The in-repo checker (`tools/ui-checks/ui-audit/audit.cjs`) ran over 15 screens at 1440x900, 1100x760, 960x640 and 900x700, in light and dark. It reports no findings: contrast, the 12 px text floor, 24 px targets, clipping, sideways scroll and unnamed buttons all pass. Impeccable's detector ran on the source and on the rendered page, and its first-viewport check passed 10 of 10. Frame rate, tab order and focus contrast were measured with Playwright.

**Not checked:** the real Tauri window (WebView2), Segoe UI Variable and Cascadia Code (the container falls back to other fonts), real telemetry, screens wider than 1440 px, Windows text scaling, and touch.

---

## Health score

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | Composer focus ring is 2.46:1; service states differ by colour only |
| 2 | Performance | 3 | The idle core draws 60 frames a second forever on the empty page |
| 3 | Theming | 3 | Open artifacts keep the old theme after a switch |
| 4 | Responsive design | 3 | 900 to 1440 px all pass; wider screens and text scaling untested |
| 5 | Implementation integrity | 3 | Coherent system; Code page and System carry little of it |
| **Total** | | **15/20** | **Good** |

## Integrity verdict

**Pass.** The interface expresses one product-specific system. The core, the bonded step chain, the service molecule, the element tiles and the carbon rail all come from the same model-kit world, and none of them could be moved to an unrelated chat app unchanged.

The detector raised two warnings, both judged false positives:

- **cramped-padding** on `.panel-head`: a 40 px row with centred text.
- **nested-cards**, with no selector reported: the only card-in-card candidates are the popovers anchored inside the composer.

## Summary

- **Issues:** 0 P0, 2 P1, 8 P2, 3 P3.
- **Most important:**
  1. The composer's focus ring is too faint.
  2. "Service up" and "service down" differ only by colour.
  3. The core animates forever on a machine whose GPU also runs the model.
  4. Reduced motion switches off all feedback, not just movement.

---

## Findings

### P1: fix before relying on it daily

**[P1] Composer focus ring too faint**

- **Location:** `src/nodes/nodes.css`, `#composer:focus-within`
- **Category:** Accessibility
- **Impact:** When the message box has keyboard focus, its border changes from `--line-strong` to `--rod`. That is 2.46:1 on white in light mode and 2.40:1 in dark. The caret is the only other sign of focus.
- **Standard:** WCAG 1.4.11 (non-text contrast, at least 3:1).
- **Fix:** On focus, make the border `--teal` at 1.5 px (4.25:1).
- **Command:** `/impeccable harden`

**[P1] Service states differ only by colour, and screen readers get no state**

- **Location:** `#svc-open` and `#mini-services .svc` (`index.html`, `nodes.css`)
- **Category:** Accessibility
- **Impact:** An up service is a teal disc and a failed one is a red disc of the same shape. The button's accessible name is just "LM Studio Sensors Voice". The state is in each child's `title`, which is not exposed inside a button.
- **Standard:** WCAG 1.4.1 (use of colour) and 4.1.2 (name, role, value).
- **Fix:**
  - Give the error atom a different shape, for example a diamond as in the old HUD notch, or a cut-out cross.
  - Set the button's `aria-label` from the states, for example "Services: LM Studio up, sensors up, voice off. Open System."
- **Command:** `/impeccable harden`

### P2: next pass

**[P2] Reduced motion removes feedback as well as movement**

- **Location:** `nodes.css`, the `prefers-reduced-motion` block
- **Category:** Accessibility
- **Impact:** The global 0.01 ms rule also kills fades that show state changes: an approval card arriving, a bond appearing, the mode chip.
- **Fix:** Keep opacity fades and colour changes; drop only scale and translate.
- **Command:** `/impeccable animate`

**[P2] The idle core never stops drawing**

- **Location:** `src/nodes/core.js`, the `tick` loop
- **Category:** Performance
- **Measured:** 60 frames a second on the empty chat page, indefinitely. It drops to 0 on other pages and with reduced motion.
- **Impact:** It is cheap per frame, but it runs on the same GPU that serves the model.
- **Fix:** Stop the idle spin after about 20 s, or drop to 30 fps when idle. Resume on pointer movement, typing or speech.
- **Command:** `/impeccable optimize`

**[P2] Reopening a chat replays every arrival animation**

- **Location:** `nodes.css`, the `atom-in`, `bond-in` and `rise-in` rules on `.chat-line`
- **Category:** Performance and motion
- **Impact:** `/resume` of a long chat starts hundreds of animations at once.
- **Fix:** Mark the transcript while a session is redrawn (for example a class on `#chat-output`) and skip animations then.
- **Command:** `/impeccable animate`

**[P2] Page-level `:has()` selectors are unmeasured on long chats**

- **Location:** `nodes.css`, 12 uses: `body:has(.ws-empty…)`, `#page-chat:has(…)`, `#chat-stack:has(.chat-line)`, and the per-line `:has(+ …)` that draws bonds
- **Category:** Performance
- **Impact:** Style invalidation during streaming was not measured with a 300-line chat.
- **Fix:** Measure it. If it is costly, replace the page-level ones with classes set in `ui.js`.
- **Command:** `/impeccable optimize`

**[P2] The first-message flight thins out mid-air**

- **Location:** `src/nodes/ui.js`, `coreToAtom`
- **Category:** Motion (partial in the finish review)
- **Impact:** The core is flown as a scaled bitmap. Between 150 and 300 ms it shrinks to a faint speckle before the live core fades in, so it reads as "vanishes, then something appears".
- **Fix:** Fly a live core drawn at the interpolated size each frame, or start the live core's fade-in at 30 % of the flight.
- **Command:** `/impeccable animate`

**[P2] Model menu says "menu" but has no menu keys**

- **Location:** `src/core/shell.js` (shared), `#model-menu`
- **Category:** Accessibility
- **Impact:** It has `role="menu"`, but the arrow keys, Home and End do nothing, and focus does not move into it when it opens. Only Escape works.
- **Standard:** ARIA APG menu pattern.
- **Fix:** Either add the keys and initial focus, or drop the menu roles and keep plain buttons.
- **Command:** `/impeccable harden`

**[P2] Streaming replies can over-announce**

- **Location:** `src/core/chat-ui.js` (shared): the whole reply is redrawn each frame inside `role="log" aria-live="polite"`
- **Category:** Accessibility
- **Impact:** A screen reader may announce partial text repeatedly.
- **Fix:** Set `aria-busy="true"` on the line while it streams and clear it at the end.
- **Command:** `/impeccable harden`

**[P2] Artifacts do not follow a theme switch**

- **Location:** `src/core/artifact-renderer.js` (shared) and `--art-sel` in `nodes.css`
- **Category:** Theming
- **Impact:** An artifact open during a switch keeps its old colours until it is reopened (already known). `--art-sel` uses the light-theme teal in both themes.
- **Fix:** Rebuild open artifact frames on `jarvis:theme`. Add a dark `--art-sel`.
- **Command:** `/impeccable polish`

### P3: polish

**[P3] Dead space in Artifacts tiles**

- **Location:** `.art-tile`, `min-height: 96px` (a regression from the correction round)
- **Fix:** Remove the min-height.
- **Command:** `/impeccable polish`

**[P3] Meta line reads as "A · B · C"**

- **Location:** the stamp in `chat-ui.js` (shared): time · model · speed
- **Impact:** Middle-dot strings are a known generic tell.
- **Fix:** Show the time on hover and the model and speed as separate muted fields.
- **Command:** `/impeccable clarify`

**[P3] A few colours outside the tokens**

- **Location:** `nodes.css`:
  - `#8e2f27` (failed-service rim);
  - `rgba(255,255,255,…)` highlights in the rail;
  - `#c42b1c` (Windows close hover; this one is intentional).
- **Fix:** Add `--rail-danger-rim` and `--rail-shine` tokens.
- **Command:** `/impeccable polish`

---

## Patterns

- **Shared modules are the main source of accessibility debt.** Menu keys, live-region chatter and the artifact theme lag all come from inherited code, so fixing them helps both interfaces.
- **Motion has one grammar but no lifecycle.** "Atom arrives, bond draws in" is right for new lines, but nothing tells it apart from a redraw or a reduced-motion user.

## What works

- **Text contrast:** every text colour passes 4.5:1 on every surface, measured in both themes and at all four sizes.
- **Targets and the narrow layout:** every target is at least 24 px, and the narrow-window sheet has a scrim, closes on Escape and closes on a click outside.
- **Signature pieces:** the core and the step chain are product-specific, and they carry real state: a pending approval is a hollow ring, a failure is a red atom, the reply in progress has the live core.
- **Responsive composer:** a container query drops the token count first, then shortens the model name.
- **Classic UI intact:** the classic page still passes the same checks with no errors.

## Design opportunities (from the finish review, not defects)

- **Code page:** draw the file tree's guides as rods on the grid, with file atoms. Show tasks as atoms that fill when done.
- **System tab:** make the 8 cores an 8-atom ring whose fill steps with load, instead of 8 bars.
- **Tool steps:** give each step type an element symbol (Rd, Ed, Rn), like the artifact tiles.
- **Atom highlight:** draw it one way everywhere. The canvas uses an inner arc; the CSS atoms use an edge crescent.

## What Claude has that this UI does not yet

These are functional gaps against the brief ("resemble Claude in functionality"), not audit defects.

1. A "jump to latest" button when you scroll up during a reply.
2. Recents grouped by date (Today, Yesterday, Previous 7 days), plus pinned chats.
3. Projects in the rail: the `/project` folder as a visible item with its own chats.
4. Paste and drag-drop of images and files onto the composer (also on the feature checklist).
5. Artifact panel: expand to full width, and choose versions from a list rather than arrows.
6. One "+" menu in the composer for attachments and tools. Internet and network-link stay visible as chips while they are switched on.
7. An offline state on the empty page when LM Studio is down (today only the red service atom shows it).
8. A Ctrl+K palette across chats, commands and artifacts (on the feature checklist).

---

## Recommended order

1. **[P1] `/impeccable harden`:** the composer focus ring, service-state shapes and labels, model-menu keys, and streaming announcements.
2. **[P2] `/impeccable optimize`:** pause the idle core, and measure the `:has()` cost on a long chat.
3. **[P2] `/impeccable animate`:** a reduced-motion alternative, no animation on a redraw, and a cleaner first-message flight.
4. **[P2] `/impeccable polish`:** the artifact theme refresh, `--art-sel` in dark, Artifacts tile spacing and colour tokens.
5. **Optional, `/impeccable bolder`:** bring the Code page and the System tab into the model-kit world.
6. **`/impeccable polish`:** a final pass.
