# Onboarding validation

Validated in Google Chrome's Arcify Onboarding QA profile using the production `dist` extension, ID `mjkcdkhinedbafmndhnbfdbbfbplmnhm`.

## Current setup and handoff

- Setup shows the existing Chrome settings GIF, sidebar-placement instructions, and recommended/current shortcut assignments.
- Appearance and Customize shortcuts buttons open the correct Chrome settings pages.
- Starting the tutorial replaces setup with “Continue the tutorial in your sidebar.” No second guide or sidebar preview remains on the page.
- Reopening the page during an active tour keeps the handoff; Reopen sidebar restores the actual side panel and current tip.
- Skipping and reloading allows a fresh setup/run.
- The coach and highlight inherit the active space palette. The later contrast adjustment was reverted at the user's request.

## Practice tabs

- Advancing to pinning, folders, and Favorites creates distinct local practice pages without changing the active browser tab.
- Pinning via the context menu is detected and advances the tour. Add to Favorites on its practice tab is detected and advances to Archive.
- A new run uses unique URLs. A regression test protects against the general bookmark URL matcher combining lesson/run fragments.
- Reopening reuses a matching practice tab; closed/navigated tabs can be replaced without touching the user's navigated page.
- Archive practice is created automatically; Archive Tab closes it and the archive entry restores the same practice page.
- Folder progress now requires the practice tab inside a folder, rather than just creating a folder.

Native computer-use drag calls did not reliably complete HTML drag-and-drop, so a manual end-to-end folder-drop pass remains unconfirmed. Do not interpret the menu-action checks as validation of drag-and-drop. Tab activation now occurs on click, and the tab drag supplies a move payload while disabling the favicon's independent image drag.

## Automated checks

`npm run test:unit`: 35 tests pass, including first-install/update behavior, stale and competing tour events, practice-tab reuse, inactive creation, stale request rejection, exact practice URL admission, preserving navigated tabs, and distinct practice bookmark matching.

`npm run build`: passes, including the local practice page. Existing legacy onboarding-script.js non-module bundling warning remains.

## Highlight, motion, and space-color update

- Highlight alone now uses a moving gradient band with solid light/dark outlines; coach colors remain unchanged.
- Step text exits left while fading out and enters from the right while fading in. Reduced-motion bypasses the transition and stops the gradient; hidden documents pause motion.
- Manually verified in Chrome: creating “Color tour QA” preselected blue, the first unused color; creation advanced to the new second step; Options highlighted the swatch palette; choosing red showed saved feedback and advanced to pinning. Back and Next settled on the expected text and controls.
- Color preselection is recalculated each time the form opens using the current spaces. Unit tests cover duplicate colors, a freed color, palette order, and fallback to grey after all eight colors are used.
- Legacy saved progress is migrated by step identity so the added lesson does not change a resumed tour's meaning.
- Latest build and all 38 unit tests pass. Impeccable's detector reported no findings on the tutorial stylesheet.
