# Independent spaces: manual Chrome QA

Date: 2026-09-07

Status: **Broad manual pass completed; drag-and-drop signoff pending.**

The latest browser run is connected and usable. A fresh unsigned profile named
Arcify Import QA has Home with two tabs, an expanded Drag Test Folder, and a
Drag Destination space, ready for a human drag check. The native automation's
drag action did not move either Chrome tabs or extension elements; no alternate
Chrome adapter is available. This is neither a passed drag test nor a confirmed
extension defect. Latest validation: 18 unit tests, production build, and diff
whitespace check pass.

Used headed Google Chrome for Testing 145 with a separate local profile. Loaded
`dist` using Chrome's Developer mode / Load unpacked UI and operated the actual
native side panel through mouse and keyboard actions. No browser scripting was
used for these manual checks.

## Observed passes

- Completed onboarding and opened the native side panel with Option+S.
- Existing native tab groups produced an optional Create spaces / No thanks offer.
- Accepted import: the QA Research space contained the existing group's tabs and
  retained its blue color; native groups remained intact.
- Renamed the native group to Native Only and changed it to red: the extension
  space retained its own name, color, and membership.
- Ungrouped the native group: the extension space and its tabs remained intact.
- Created an empty green QA Work space without creating a native group or tab.
- Created a tab using the side panel's New Tab control: it appeared in QA Work.
- Closed the last tab using its side panel close control: QA Work remained
  available and selecting it displayed an empty space.
- After reconnecting, a normal blank new tab appeared in QA Work with the panel
  open; navigating to example.edu retained membership.
- Explicitly closed the panel, created a tab at example.com/?qa=closed, reopened
  the panel: the tab belonged to QA Work.
- Repeated closed-panel creation with QA Research selected and a unique URL:
  membership stayed in QA Research.
- Opened Settings and verified Sync Spaces to Chrome Tab Groups was unchecked.
- Enabled synchronization and observed native groups; disabled it and observed
  that the existing native groups remained.
- Retested the multiwindow fix: a second window retained only its own tab and
  settings tab when synchronization was enabled. The native group's edit dialog
  showed Home; renaming the extension space to QA Home changed the native title.
- Toggling Invert Tab Order reversed the sidebar rows immediately; restored the
  default afterward. Returned group synchronization to off.
- Pinning a tab in QA Work and using Clean All preserved the pinned tab.
- Created and named QA Folder. Drag attempts did not produce a conclusive result.
- Enabled archiving using its sidebar switch.
- Manually archived example.net/manual-qa-archive: its native tab closed and the
  archive showed the correct URL in QA Work. Restore reopened it in QA Work and
  removed the archive entry.
- Moved that tab through Move to Space into QA Research: ownership and active
  sidebar space changed without creating a native group.
- Added the tab to global Favorites: Chrome pinned it and the favorite remained
  visible after switching to QA Work.
- Duplicate QA Work creation was rejected with an inline duplicate-name message.
- Created yellow QA Disposable, closed the panel, opened the previously used URL
  example.org: the new tab remained in QA Disposable on reopening the panel.
- Opened Learn more through Chrome's Open Link in New Tab menu: the background
  tab belonged to QA Disposable alongside its opener.
- Used Ctrl+Shift+PageUp to reorder the native IANA tab: native order changed,
  while sidebar order remained unchanged.
- Deleted QA Disposable through the confirmation dialog: its two tabs closed,
  the space disappeared, and the other spaces remained.
- The extension card showed no Errors button during the latest inspection.
- Reloaded the latest build successfully after closing the panel on a webpage.
- Clean bookmark test: pinned example.org/final-bookmark in QA Final, closed it
  through Chrome, and reopened its saved entry to the correct URL.
- Duplicate URL isolation: opened that URL in QA Home, then reopened QA Final's
  saved bookmark. Chrome created a separate tab for QA Final and retained the
  matching QA Home tab.
- Existing-space color selection changed QA Final to red in the latest build.
- With sync enabled, QA Final's native group edit dialog showed its correct name
  and red color. A native rename was subsequently corrected back to QA Final.
- Set autoarchive to one minute and observed automatic closing of idle temporary
  tabs. Pinned tabs survived. Restored Wikipedia and verified membership in QA
  Research. Returned interval to 360 minutes and disabled autoarchive afterward.
- Returned native group synchronization to off after the final metadata check.
- Folder collapse hid its empty drop placeholder.

## Latest completed manual checks

- Created Rename Probe, renamed it Renamed Once, switched away/back. Only the
  renamed folder remained; the folder duplication fix passed.
- Opened IANA-managed Reserved Domains in a second window, returned to the
  original window, and clicked its sidebar row. Chrome focused the target window.
- Fixed stale other-window titles by removing handleTabUpdate's window filter.
  Reloaded and verified a new other-window page appeared as Example Domains.
- Removed a global favorite via Chrome Unpin; the Favorites empty state returned.
- Navigated a pinned tab away, clicked Back to Pinned URL, and verified reset.
- Replaced its URL with example.org/final-replacement, closed it, and reopened
  the bookmark. The replacement URL loaded correctly.
- Fully quit Chrome through its application menu and relaunched. All four spaces,
  renamed folder, observed tab ownership, and pinned replacement URL persisted.
  Clicking the restored bookmark focused its window.
- Option+D quick pin/unpin worked in both directions. Option+S opened the native
  panel throughout testing.
- Fresh-profile decline: created Keep Native group, loaded dist, chose No thanks.
  Only Home existed in the extension; Keep Native remained unchanged. The import
  prompt stayed dismissed after closing/reopening the panel.

## Defect found and code fix

After selecting an empty space, creating a normal Chrome tab assigned it to the
previous native tab's space. Chrome can attach an incidental opener to its blank
new-tab page. The store now uses the selected space for blank new-tab pages,
while retaining opener ownership for tabs opened to a URL.

Added a regression test for a new-tab page with an opener in another space.
The follow-up checks above passed. However, the first retest navigating directly
to example.org still placed that tab in Home. That URL had been used previously
in the test session; whether restoration matching caused this remains unresolved.
The later reused-URL test in QA Disposable passed. The earlier anomaly was not
reproduced; exhaustive restart/duplicate-URL recovery remains outstanding.

Enabling synchronization exposed a second bug: group creation omitted a window
ID, allowing Chrome to move tabs into the current window. Group creation now
explicitly supplies `createProperties.windowId`. Added a regression test for
groups created in two separate windows. All 16 unit tests and the production
build pass. The multiwindow fix passed the subsequent manual check above.

Manual Archive Tab failed for an unpinned tab. Code inspection found an undefined
`activeSpaceId` reference in Utils.archiveTab. Replaced it with the stored owner
of the selected tab. A regression test verifies the recorded space and removal
of the original tab. The archive fix passed the manual archive/restore check.

Closing a pinned bookmark through Chrome and reopening its placeholder exposed
another issue: the global URL lookup reused a matching tab from another space,
and tab activation did not focus that tab's window. Restricted bookmark reuse to
the target space and added explicit window focusing for tab clicks, bookmark
reuse, and Move to Space. All 18 unit tests and the production build pass. The
bookmark-isolation and cross-window focusing fixes passed manual retesting.

Renaming a newly created folder duplicated it: the new-folder editor created a
new bookmark folder on every name change. It now keeps the created folder ID,
updates that folder on rename, serializes Enter/blur saves, and cancels Escape
without committing on blur. All 18 unit tests and the build pass. Manual retest
of this folder fix passed.

## Outstanding manual coverage

- Sidebar drag reorder, space reorder, and folder drag/drop. Native drag attempts
  also failed to move tabs, so the automation's drag behavior is inconclusive;
  the native keyboard reorder check succeeded.
- Sync ordering after a sidebar drag depends on the drag check.
- Next/previous-tab and copy-URL commands have no default bindings and were not
  configured in this manual pass.
- Restart coverage is for the observed data, not every possible duplicate-URL
  restoration permutation.

## Tool blocker

After reloading the rebuilt extension, native accessibility observations stayed
on an extensions menu (My extensions / Site permissions / Keyboard shortcuts),
even as the reported window title changed. Screenshots were unavailable. Escape,
the exposed menu Cancel action, browser reselection, switching through Finder,
and resetting the computer-use connection did not restore browser observations.
Finder remained observable. Requested a manual restart of the separate test
browser before continuing; no claim of complete manual validation is made.
The user's restarts restored control. The same issue recurred after reloading
the multiwindow fix and after disabling the extension to load the archive fix.
Closing the panel on chrome://extensions also reproduced the failure. Requested
reload of the latest build and a restart onto example.com before continuing.
Closing the panel on a normal webpage and observing the closed state before
navigating to Extensions allowed one successful reload. A later attempt that
batched panel-close and navigation reproduced the stale menu; reconnecting did
not recover it. Another browser restart was requested. Future reloads must
observe panel closure before navigating.
Subsequent reloads succeeded by observing panel closure, explicitly focusing the
address field, then navigating to Extensions. Native-menu quit/relaunch also
succeeded without user intervention.

### Nested folder creation (2026-09-07)

- Loaded updated unpacked build in Arcify Import QA using Chrome's extension Reload control.
- Sync off: right-click Drag Test Folder → New Folder → Nested QA; created an indented child. Child menu offered Delete Folder only (no third level).
- Switched to Drag Destination and back, expanded parent: Nested QA persisted. Renamed child to Nested Renamed; subsequent rendering retained the rename.
- Enabled sync in Settings: parent context menu offered Delete Folder only; expanded parent and verified Nested Renamed was preserved.
- Restored sync off after testing.
- Automated: 22 unit tests pass, including second-level creation, rejection of third-level/foreign parents, sync-on restriction and settings changes between menu opening and saving. Production build and diff whitespace check pass.
- Nested tab drag/drop remains unverified manually, consistent with the native drag-control limitation above.

### Folder expansion persistence (2026-09-07)

- Added durable local state keyed by bookmark folder ID, including nested folders and programmatic opening during drag/child creation. New folders save their initial expanded state; existing folders without saved state retain the collapsed default.
- Automated verification: 23 unit tests pass. Regression coverage includes independent parent/child state, rapid toggles, read-after-write, and restoration through a fresh module instance. Production build and whitespace check pass.
- Manual verification of this addition is pending: Chrome control returned only the stale Extensions navigation menu when opening the extension reload tab. Escape/focus recovery and quit shortcut did not restore the connection. The new build is on disk; it has not been confirmed reloaded in Chrome.

### Window scope and pinned order correction (2026-09-08)

- Sidebar live tabs, native Favorites, bookmark reuse, Clean All, pin toggles, and adjacent-tab navigation now use the sidebar/active tab's window. Cross-window attach/detach refreshes the affected panels. Bookmark binding restoration preserves other windows' pins.
- Pinned folder collapse uses position anchors to restore projected tabs at their original positions. Bookmark drag order is persisted to bookmark indices, including closed pins. Reordering visible tab IDs preserves other windows' slots. Quick pin mutations run sequentially and render the saved bookmark order afterward.
- Automated checks: 46 unit tests pass; production build and git diff whitespace check pass. New cases cover window isolation, duplicate URLs, moving tabs between windows, preserving other windows' order, and bookmark-order round trips with inversion on/off.
- Browser verification is PENDING. Computer-use reported the Mac locked and automatic unlock unsuccessful. Asked the user to unlock it. No browser pass is claimed for these changes.
- Next manual checks: reload build, use two windows with distinct temporary/native-pinned tabs and the same pinned bookmark URL, check each sidebar and Clean All isolation; verify pinned order after close/reopen, space switching, folder toggling, drag and reload in both sync modes.

### Window scope and pinned order — browser verification completed after unlock (2026-09-08)

Loaded the updated unpacked extension via Chrome's Reload button in Arcify Import QA, then used two native Chrome windows through computer-use UI controls.

- Sync off: window A retained its Example Domain temporary tab, Extensions tab and native pinned Favorite. A new window B with IANA Example Domains displayed only its own live tab and no native Favorite from A.
- Pinned IANA Example Domains, then IANA-managed Reserved Domains in B using Alt+D. With inversion enabled, the visible order was Reserved Domains → Example Domains → Drag Test Folder.
- Switched B to Drag Destination and back: pinned order unchanged. Closed Example Domains using its sidebar close button and reopened its bookmark: same position and order.
- Returned to A: B's pins appeared as closed bookmark shortcuts, not live tabs. Clicking Example Domains created another native tab in A while B retained its original tab; no cross-window focusing/reuse occurred.
- Enabled sync in A's Settings. B still contained only its two native tabs and own live pin rows. Added example.net/window-b-temporary in B and clicked Clean All: only that temporary tab closed. B's pins and A's temporary tabs/Favorite remained intact.
- Changed Show new tabs at the top off: pinned display reversed. Restored it on: original pinned display returned. Restored sync off.
- Expanded Drag Test Folder in B, closed the actual side panel, confirmed it was gone, and reopened with Alt+S. The two pins retained their order and the folder remained expanded, with its Example Domain bookmark and Nested Renamed child visible.
- Attempted native computer-use dragging of the second pin above the first; no movement or UI change occurred. Drag-reorder persistence therefore remains an explicit manual gap (automated bookmark-order round-trip coverage passes). No full drag/drop signoff is claimed.

These observations supersede the locked-Mac verification blocker immediately above. They also verify folder expansion restoration across side-panel recreation; a full Chrome restart was not repeated during this run.
