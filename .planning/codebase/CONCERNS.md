# Codebase Concerns

**Analysis Date:** 2026-02-03

## Tech Debt

**Monolithic Sidebar Module:**
- Issue: `sidebar.js` is 4,125 lines with mixed concerns - state management, event handling, DOM manipulation, Chrome API orchestration all intertwined
- Files: `src/sidebar.js` (primary), also touches `domManager.js`, `utils.js`, `bookmark-utils.js`
- Impact: Difficult to test individual features, high risk of regressions when modifying, makes onboarding new developers slow, introduces tight coupling between features
- Fix approach: Extract distinct layers - separate business logic (space/tab management), UI state (active space, dragging state), and DOM manipulation into distinct modules. Example structure:
  - `SpaceManager` - handles space CRUD, bookmark operations
  - `TabOrderManager` - manages tab ordering and Chrome group reconciliation
  - `UIStateManager` - tracks activeSpaceId, activeChromeTabId, dragging state
  - Keep `domManager.js` for DOM manipulation only (currently mixed with sidebar)

**Global State Mutation Without Transactions:**
- Issue: Global variables like `spaces`, `activeSpaceId`, `activeChromeTabId`, `currentWindow` are mutated directly without consistent patterns; no optimistic update/rollback mechanism
- Files: `sidebar.js` (lines 39-52), `background.js`
- Impact: Race conditions when multiple async operations modify state; inconsistent app state if operations fail partway through (e.g., `saveSpaces()` called after partial updates); hard to debug state corruption
- Fix approach: Implement minimal state machine pattern - wrap state changes in transaction-like operations that fail atomically. Example:
  ```javascript
  async function moveTabTransaction(tabId, fromSpace, toSpace) {
    const backup = JSON.parse(JSON.stringify(spaces));
    try {
      // All operations here
      space.temporaryTabs.push(tabId);
      await reconcileSpaceTabOrdering(...);
      saveSpaces();
    } catch (e) {
      spaces = backup; // Rollback
      throw e;
    }
  }
  ```

**Dual Storage Persistence (Chrome Storage + Bookmarks):**
- Issue: Spaces metadata stored in `chrome.storage.local`, but pinned tab references stored as bookmarks; reconciliation logic fragile and appears in multiple places
- Files: `sidebar.js` (lines 55-86, 1479-1546), `utils.js`, `bookmark-utils.js`, `localstorage.js`
- Impact: Source-of-truth unclear; bookmark-based pinning can desync from space data; complex bookmark hierarchy navigation creates maintenance burden
- Fix approach: Consolidate to single storage mechanism - prefer `chrome.storage.local` for space/tab metadata and consider moving away from bookmark-based pinning OR clearly document bookmark as canonical storage with proper versioning/migration strategy

**Async Error Handling Inconsistency:**
- Issue: Try-catch blocks exist but error recovery varies widely - some catch silently (sidebar.js line 68), some log and continue, some re-throw; some operations don't have try-catch at all despite being async
- Files: `sidebar.js` (78 catch blocks), `background.js` (20+ try-catch blocks), `bookmark-utils.js` (lines 61-90), `utils.js`
- Impact: Unpredictable behavior when Chrome APIs fail; silent failures mask real issues; debugging difficult when errors swallowed
- Fix approach: Establish error classification:
  - **Fatal errors** (re-throw): Bookmark folder missing, Chrome permission denied, invalid space ID
  - **Recoverable** (retry): Tab move blocked during user drag, transient storage access
  - **Ignorable** (log only): Stale tab reference, missing favicon fetch
  - Use consistent pattern:
    ```javascript
    try { ... } catch (e) {
      if (isRecoverable(e)) { scheduleRetry(...); return; }
      if (isIgnorable(e)) { Logger.warn(...); return; }
      Logger.error(...); throw e;
    }
    ```

## Known Bugs

**Collapsed Folder Tab Visibility Inconsistent:**
- Symptoms: Tabs shown/hidden in collapsed folders don't always match Arc browser behavior; "active tab" tracking via `collapsedFolderShownTabs` WeakMap can miss or stale
- Files: `sidebar.js` (lines 1584-1647 `syncCollapsedFolderTabs`, lines 1612-1633 WeakMap logic)
- Trigger: Collapse folder → navigate to tab in another space → collapse original folder again → tab visibility changes unexpectedly. Or: Tab closes while folder collapsed → active tab tracking breaks
- Workaround: Expand/collapse folder manually or switch spaces to refresh
- Root cause: WeakMap approach assumes folder element stays stable; actual tab existence checked via `querySelector` which fails if tab already moved/removed from DOM
- Investigation: Test with `showAllOpenTabsInCollapsedFolders=false` (Arc mode) - condition at line 1604 is complex and has multiple mutation paths

**Tab Order Reconciliation Retry Loop Fragility:**
- Symptoms: Under high user drag-drop load, reconciliation retries (lines 2048-2085) may timeout after 12 attempts (line 2067), leaving Chrome tab order misaligned with sidebar; subsequent moves may place tabs in wrong positions
- Files: `sidebar.js` (lines 2005-2104 `reconcileSpaceTabOrdering`)
- Trigger: Rapid drag-drop of multiple tabs while browser is under CPU load
- Workaround: Refresh sidebar or reload extension
- Root cause: Chrome blocks tab edits during user drag; retry backoff strategy (line 2069: `200 + nextAttempt * 100` up to 1200ms) may be too conservative for concurrent user actions
- Impact: Tab order persists incorrectly, future drag operations start from wrong baseline

**Bookmark URL Replacement Incomplete:**
- Symptoms: When pinned tab navigates to new URL, `replaceBookmarkUrlWithCurrentUrl` (lines 88-149) may fail to update bookmark, leaving stale URL in pinned section; user navigates bookmark and gets old URL
- Files: `sidebar.js` (lines 88-149)
- Trigger: Pin a tab → navigate it → click pinned bookmark → old URL opens
- Root cause: Multiple fallback mechanisms (bookmarkId lookup → URL search → pinned URL lookup) any can fail silently; error at line 140 only logs warning
- Workaround: Manually re-pin tab with new URL
- Risk: User confusion when pinned links go stale; bookmark data pollution (old URLs accumulate)

**Memory Leak in Collapsed Folder Tab Tracking:**
- Symptoms: Long-lived sessions with many tab open/close cycles may see increasing memory usage from `collapsedFolderShownTabs` WeakMap
- Files: `sidebar.js` (lines 51-52, 1612-1622, 3510-3516)
- Cause: WeakMap keys are DOM elements; cleanup only happens in `handleTabRemove` (line 3513-3516). If folder element is reused/recreated in DOM before tab is removed, the old entry never cleans up
- Trigger: Open many tabs → collapse folder → close browser tab → recreate folder in sidebar
- Impact: Cumulative memory over days/weeks (minimal per cycle but scales with user session length)
- Mitigation: Current cleanup in `handleTabRemove` is partial - only removes tab ID from Set, but doesn't clean empty Sets. Better: Add WeakMap entry cleanup in folder element removal handler

## Security Considerations

**XSS via Bookmark Title and Tab Title:**
- Risk: User-controlled data (bookmark titles, tab titles) displayed via `innerHTML` or `textContent` in some places
- Files: `domManager.js` (line 343, 352, 445 use `innerHTML` for static icons only - safe), `sidebar.js` (various title displays)
- Current mitigation: `textContent` used for user-controlled title display (sidebar.js creates elements via DOM API, not string injection)
- Recommendation: Audit all user data flows - verify no `innerHTML` with unsanitized user input. Current code appears safe but enforce rule: user data always via `textContent` or `createTextNode`, never `innerHTML`

**Bookmark Folder Access Assumptions:**
- Risk: Code assumes "Arcify" bookmark folder exists and is writable; if user/browser deletes it, operations fail
- Files: `sidebar.js` (lines 57-84), `localstorage.js` (lines 18-36), `bookmark-utils.js` (lines 25-99)
- Current mitigation: `getOrCreateArcifyFolder` creates folder if missing; 3-method fallback approach in `findArcifyFolder` handles various scenarios
- Recommendation: Add monitoring for folder access failures - if folder creation fails due to permission issues, should surface user-facing error instead of silent failure

**Storage Quota Abuse Prevention:**
- Risk: `chrome.storage.local` has quota (~10MB); archived tabs stored unbounded with only `MAX_ARCHIVED_TABS=100` limit (utils.js line 18); large tabs with long URLs could exceed quota
- Files: `utils.js` (lines 244-270, ARCHIVED_TABS_KEY storage)
- Current mitigation: Hard limit of 100 archived tabs
- Recommendation: Add total storage size check; warn user if approaching quota; implement LRU eviction instead of FIFO

## Performance Bottlenecks

**Recursive Bookmark Traversal on Every Pin/Unpin:**
- Problem: `BookmarkUtils.findBookmarkInFolderRecursive` (bookmark-utils.js) traverses entire space folder hierarchy on every tab pin operation
- Files: `sidebar.js` (lines 1479-1546), `bookmark-utils.js` (recursive search)
- Cause: No caching of bookmark structure; deeply nested folders cause exponential API calls
- Improvement path: Cache bookmark folder IDs by tab ID on load; invalidate only when bookmarks change. Use batch API calls to pre-load folder structure on space initialization

**DOM Reflow on Drag-Drop:**
- Problem: `syncCollapsedFolderTabs` (line 1584-1647) moves DOM elements between containers during drag; multiple reflows trigger re-render
- Files: `sidebar.js` (lines 1584-1647, 1995-2104)
- Cause: DOM mutations during drag events force layout recalculation
- Improvement path: Defer DOM mutations until drop completes; batch CSS class updates (use `classList.add(...multiple)` instead of sequential calls)

**Large Space Initialization:**
- Problem: `initSidebar()` (line 605) loads all tab groups and their full tab lists synchronously; with 50+ tabs per space, creates jank during extension startup
- Files: `sidebar.js` (lines 605-766 `initSidebar`, line 702 `Promise.all` on all tab groups)
- Impact: Noticeable delay on extension load with many spaces/tabs
- Improvement path: Lazy-load tab lists per space; load active space immediately, others on-demand. Use `chrome.tabs.query` incrementally with pagination

**Logger Initialization Race Condition:**
- Problem: `Logger` calls trigger async initialization on first use (logger.js lines 66-68), adding micro-latency to every log call during startup
- Files: `logger.js` (lines 25-52, 58-74)
- Impact: Negligible but adds complexity; startup logging slower than necessary
- Improvement path: Initialize logger synchronously at extension load time; accept that first few logs before sync.get completes use default (false) for debug flag

## Fragile Areas

**Bookmark Folder Identification:**
- Files: `sidebar.js` (lines 57-84), `localstorage.js` (lines 18-23), `bookmark-utils.js` (lines 25-99)
- Why fragile: Relies on folder title "Arcify" (title-based lookup prone to collisions); Method 3 fallback uses heuristics (`folder.id === '2'` for "Other Bookmarks" is non-standard)
- Safe modification: Always use `findArcifyFolder()` from BookmarkUtils; never assume folder exists without validation
- Test coverage: No explicit tests for bookmark API failures; only manual testing covers edge cases
- Needed: Unit tests for bookmark folder detection when folder is missing, inaccessible, or duplicated

**Tab Group State Synchronization:**
- Files: `sidebar.js` (lines 2005-2104 `reconcileSpaceTabOrdering`, lines 1894-1995 `syncTabOrderToChrome`)
- Why fragile: Complex bidirectional sync between Arcify space model (sidebar.js `spaces` array) and Chrome's native tab groups; retry logic (12 attempts) can still timeout; no last-write-wins conflict resolution
- Safe modification: All changes to `space.spaceBookmarks` and `space.temporaryTabs` must be followed by `reconcileSpaceTabOrdering`; never mutate Chrome tabs without updating sidebar model
- Test coverage: Tab order logic untested in automated suite; only manual testing covers complex drag scenarios
- Needed: Deterministic test harness that mocks Chrome API and verifies order consistency across operations

**Pinned Tab State Persistence:**
- Files: `sidebar.js` (lines 1479-1546 `moveTabToPinned/moveTabToTemp`), `utils.js` (pinned tab state storage)
- Why fragile: Pinned state stored as Chrome bookmarks and in `tabNameOverridesById` storage; mismatch between them causes stale data
- Safe modification: Always update both bookmark AND `Utils.setPinnedTabState()` atomically; verify bookmark exists before trusting state
- Test coverage: No tests verify bookmark-to-state consistency
- Needed: Validation function that checks all pinned tabs exist in bookmarks and vice versa; run on init to repair inconsistencies

## Scaling Limits

**Sidebar Performance with 100+ Tabs:**
- Current capacity: ~50 tabs per space before noticeable jank; ~10 spaces tested stable
- Limit: DOM manipulation scales linearly with tab count; each tab creates multiple DOM elements (favicon, title, context menu listeners); drag-drop becomes slow at 100+ tabs
- Scaling path: Virtual scrolling for large tab lists (render only visible rows); replace per-tab event listeners with event delegation; lazy-load tab details

**Storage Quota with Many Archived Tabs:**
- Current capacity: 100 archived tabs (hard limit in utils.js line 18)
- Limit: Each archived tab stores URL + name + spaceId + timestamp; at 50 chars average, 100 tabs = 5KB. But users may hit quota faster if storing large metadata
- Scaling path: Implement storage cleanup strategy (delete oldest monthly); consider moving archive to IndexedDB instead of chrome.storage for higher quota

**Concurrent Drag Operations:**
- Current capacity: Single drag-drop sequence reliably processes; multiple concurrent drags fail (no queueing)
- Limit: Chrome blocks tab moves during user drag; multiple rapid drag-drops queue unsuccessfully and can deadlock
- Scaling path: Implement drag queue with FIFO processing; serialize tab move operations to ensure Chrome doesn't reject them

## Dependencies at Risk

**Chrome Bookmarks API Reliability:**
- Risk: Bookmark operations fail silently in some browser states; no built-in retry or backup mechanism
- Impact: If bookmark folder becomes inaccessible, pinned tabs can't be moved/updated; extension becomes partially broken
- Migration plan: Consider moving bookmark data to `chrome.storage.local` as primary; bookmarks as fallback only. This eliminates single-point-of-failure on bookmark access

**Chrome Tab Groups API Instability:**
- Risk: Tab group operations blocked during user drag; no way to detect this state beforehand
- Impact: `reconcileSpaceTabOrdering` must retry 12+ times, which is slow and unreliable under load
- Migration plan: Add progress indicator for users during retries; consider debouncing user drag actions to reduce collision with internal ordering

## Missing Critical Features

**No Conflict Resolution for Multi-Device Sync:**
- Problem: `chrome.storage.sync` syncs settings across devices, but space/tab data stored in `chrome.storage.local` (not synced); users with multiple devices see inconsistent spaces
- Blocks: Using Arcify across multiple machines with unified workspace
- Recommendation: Implement optional cloud sync for space structure (via user's cloud storage account or extension backend); or document that spaces are device-local only

**No Backup/Recovery for Space Data:**
- Problem: If user clears extension data or corrupts `chrome.storage.local`, all spaces/archived tabs lost permanently
- Blocks: Users who accidentally clear data have no recovery path
- Recommendation: Add export/import feature (spaces as JSON file); offer periodic backup to user's Downloads folder

**No Audit Log for Tab/Bookmark Changes:**
- Problem: When user discovers stale bookmarks or missing tabs, no way to trace when change occurred or why
- Blocks: Debugging user-reported issues with tab organization
- Recommendation: Store change log in localStorage (limited to last 100 changes); expose via debug UI

## Test Coverage Gaps

**Tab Order Reconciliation Edge Cases:**
- What's not tested: Chrome group ordering under concurrent user drags, retry timeout behavior, edge cases where dragged tab is already in target position
- Files: `sidebar.js` (lines 2005-2104)
- Risk: Order corruption under concurrent load goes unnoticed until user complains
- Priority: High - this is core functionality
- Suggested tests: Mock Chrome tab move API with controllable delays; verify order consistency across 100+ drag sequences; verify retry backoff doesn't exceed timeout

**Bookmark Folder Access Failures:**
- What's not tested: Behavior when "Arcify" folder is deleted by user or browser; behavior when bookmark API throws permission error
- Files: `sidebar.js` (lines 57-84), `localstorage.js`, `bookmark-utils.js`
- Risk: Silent failures when pinning/unpinning tabs if bookmarks become inaccessible
- Priority: High - affects core pinning feature
- Suggested tests: Mock `chrome.bookmarks` API to throw errors; verify extension recovers gracefully

**Collapsed Folder Tab Visibility:**
- What's not tested: Tab visibility switching between spaces with collapsed folders; behavior when active tab closes while folder is collapsed
- Files: `sidebar.js` (lines 1584-1647, 3502-3599)
- Risk: Incorrect tabs shown/hidden in collapsed folders in production
- Priority: Medium - affects UX but not data integrity
- Suggested tests: Simulate tab lifecycle (create → navigate → close) with folders collapsed; verify correct tabs visible at each step

**Storage Persistence Across Reloads:**
- What's not tested: Space data consistency after extension reload; bookmark folder recovery if not found on first load
- Files: `sidebar.js` (lines 605-766), `localstorage.js`
- Risk: Data loss or corruption on reload
- Priority: High - affects user data
- Suggested tests: Save spaces → reload extension context → verify same spaces loaded; corrupt storage → verify graceful recovery

**Error Recovery in Async Operations:**
- What's not tested: Behavior when `chrome.tabs.get()` fails mid-operation; behavior when bookmarks API times out
- Files: `sidebar.js` (throughout), `background.js` (throughout)
- Risk: Partial state mutations if async operations fail halfway through
- Priority: Medium - affects stability
- Suggested tests: Mock Chrome APIs to simulate failures; verify transaction rollback behavior

---

*Concerns audit: 2026-02-03*
