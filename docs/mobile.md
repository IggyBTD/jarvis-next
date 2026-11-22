# JARVIS on iPhone

A second front end for the same server: `mobile.html` (served at `/mobile.html`), built from `src/mobile/` and `src/ui/mobile.css`. It is a thin client like the desktop app. The server, the model, the tools, the approvals and the audit log are the same; only the screen is new. Nothing on the phone runs a model or a tool.

## Reference

The desktop JARVIS Next design (tokens, serif replies, the node mesh, the steps row) is the look. The layout follows Claude's phone app: a round menu button top left that opens a drawer of chats, a round new-chat button top right, the greeting and the node mesh in the middle, one rounded input pill with a plus and a send button, and a floating tab bar under it with Chat, Projects, Code and Artifacts. Behaviour is Apple's iPhone conventions (HIG): 44 pt targets, safe areas, sheets for everything secondary, content that scrolls under the bar.

## What is in, what is out

| In | Out (on purpose) |
| --- | --- |
| Chat with streaming replies, markdown, code, tables | The right-hand panel, Intel globe, Scheduled, voice (dictation is the keyboard's), attachments |
| The steps row (what JARVIS did, in plain words) | Settings pages beyond the one sheet |
| Approvals as a sheet: approve or deny, with the exact request | Model switching (read-only here; pick it on the desktop) |
| Drawer: pinned and recent chats, search, "View all" (delete lives there), Settings, New chat | Folders on the chat list, export |
| Projects page: full management (rename, instructions, add or remove chats, new chat in a project, delete) | |
| Code page: the computers (tap to work on one), the coding agent's sessions, New session (the next messages go to the coding agent) | |
| Artifacts: a card in the reply opens a full-height sandboxed viewer; the tab lists artifacts found in your recent chats | Editing artifacts, charts that need the desktop's libraries |
| PC / Mac switch, effort and the approvals mode (Auto, Manual, Accept edits, Plan, Bypass), in one sheet (the title, the drawer's Settings, or the plus menu) | |
| The plus: attach text files (code, notes, CSV, JSON) to a message | Photos and PDFs (the model reads text only) |
| Approvals of every tier, as on the Mac. A T3 approval and the two admin modes ask for the owner's PIN from the phone | |
| The node mesh: empty-chat centrepiece, loading icon, the stamp under the newest reply | |

Projects live on the server (`GET` and `PUT /api/projects`, `data/projects.json`) and the desktop syncs its list there, so both show the same projects. Chats sync the same way: the server announces every change and the drawer and Projects page follow.

## Layout (portrait, 375 to 430 pt wide)

- **Bar** (44 pt plus the status bar): menu (left, opens the drawer), the chat's title with `PC · model` under it (centre, only once the chat has started; opens the chat sheet), and on the right new chat (Chat) or search (Projects, Code).
- **Conversation:** scrolls under the bar; 16 pt side margins; your messages in a bubble on the right (82% wide at most), JARVIS's replies as plain serif text across the width, steps as one quiet line.
- **Composer:** a pill above the tab bar: plus (chat options), the field (grows to five lines), send inside the pill at the right. Send becomes stop while JARVIS answers.
- **Tab bar:** a floating pill with four tabs. It disappears while the input has focus (the field then sits on the keyboard) and comes back a beat after the keyboard goes.
- **Drawer:** slides in from the left over a scrim; swipe left or tap the scrim to close. Pinned and Recents, a search button, Settings bottom left, New chat bottom right.
- **Pages:** Projects, Code and Artifacts replace the conversation; the floating New project or New session button sits bottom right above the tab bar.
- **Sheets:** slide up with the iOS drawer curve, a grabber, a close button, swipe down or tap outside to close (the approval sheet only closes with its two buttons). The Back swipe in Safari closes a sheet instead of leaving the page.

## The keyboard

The field is a plain `<textarea>`, so the iPhone's own keyboard, autocorrect, predictive text, dictation and emoji all work and nothing is replaced. Return inserts a new line (the system default); the send button sends. Font size is 16 pt so Safari never zooms. The layout follows `visualViewport`, so the composer sits on top of the keyboard and the conversation stays in view. Dragging the conversation with the keyboard open puts the keyboard away. The send button does not take focus, so sending does not close the keyboard.

## Type and space

Same scale as the desktop (11, 12, 13, 14, 16, 20 pt; Plex Sans for the interface, Plex Serif for what JARVIS writes, JetBrains Mono for code), the same 4 pt grid. Everything tappable is at least `--tap` (44 pt). Text is never under 11 pt, body and input are 16. One accent colour (the arc-reactor blue); amber only for "waiting" and red for "failed". Light and dark follow the iPhone's appearance setting. Contrast is the desktop's (`docs/contrast.md`), checked for every pair.

## Motion

Short and purposeful, none of it decorative: press feedback `scale(0.97)` in 160 ms; a new message of yours rises 8 px and fades in over 200 ms; sheets 300 ms on the drawer curve, closing faster (220 ms); the stamp glides to the new reply in 280 ms. Only `transform` and `opacity` move. No springs except dragging a sheet. With Reduce Motion everything is a fade. The node mesh never loops: it moves while something is happening, then rests as a still picture.

## Home screen

Open the phone link in Safari, then Share, Add to Home Screen. It opens full screen with its own icon. `node scripts/client-link.js` prints the link. The token is in the address after `#` (never sent to a server) and is kept there, because iOS gives a home-screen app its own storage and the address is how the token travels into it.

If the PC's server is not running, the phone link goes through the PC's starter (port 7411), which starts the server and then opens the app, the same way `JARVIS.app` does on the Mac.

## Setting it up

1. On the PC: `node scripts/client-link.js` and take the line that starts with "iPhone". Tailscale must be connected on the phone and on the PC.
2. Open that link in Safari on the iPhone. A page explains the next step: Share, then Add to Home Screen.
3. Open JARVIS from the home screen. If the server is off it is started first (a few seconds), then the app opens.

Needs iOS 16.4 or newer (the page uses `inert`, `:has()`, `color-mix` and `dvh`).

## Known limits

- Dynamic Type (the iPhone's text size setting) is not followed: web pages in Safari cannot read it. Use Safari's page zoom (aA menu) if you need larger text.
- No haptics: Safari does not give web pages the Taptic Engine.
- Tested in Chromium with an iPhone's size, touch and pixel density, not in WebKit or on a real phone. Check the keyboard and the home-screen launch on the device.
