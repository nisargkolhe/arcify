# Architecture

**Analysis Date:** 2026-02-03

## Pattern Overview

**Overall:** Chrome Extension (Manifest V3) with Multi-Context Message-Passing Architecture

**Key Characteristics:**
- Service worker handles all Chrome API calls and serves as central message router
- Side panel provides rich UI for space/tab management using chrome.storage and bookmarks API
- Dormant content script pattern for performance (pre-injected but activated on-demand)
- Separation of concerns: UI logic (sidebar.js) vs. chrome API (background.js) vs. DOM utilities (domManager.js)
- State synchronized via chrome.storage.sync (settings) and chrome.storage.local (spaces/tabs data)

## Layers

**Service Worker (background.js):**
- Purpose: Extension lifecycle, Chrome API gateway, tab activity tracking, message routing
- Location: `/Users/nisargkolhe/arcsidebar/background.js`
- Contains: onInstalled listeners, onMessage handlers, keyboard command handlers, auto-archive scheduling, tab activity timestamps
- Depends on: Utils.js (for settings/helpers), Logger.js
- Used by: Side panel, content scripts, command system

**UI/Sidebar Layer (sidebar.js + sidebar.html + styles.css):**
- Purpose: Main user interface - space/tab management, drag-drop, archived tabs, settings sync
- Location: `/Users/nisargkolhe/arcsidebar/sidebar.js`, `/Users/nisargkolhe/arcsidebar/sidebar.html`, `/Users/nisargkolhe/arcsidebar/styles.css`
- Contains: Global spaces array, active space tracking, tab lifecycle handlers, message listeners for service worker commands
- Depends on: domManager.js, bookmark-utils.js, localstorage.js, utils.js, logger.js, icons.js
- Used by: Browser tab group system, bookmark API, chrome storage

**DOM Utilities Layer (domManager.js):**
- Purpose: Separate DOM creation/manipulation from business logic to avoid tight coupling
- Location: `/Users/nisargkolhe/arcsidebar/domManager.js`
- Contains: DOM element creation functions, context menu rendering, input dialogs, archived tabs popup, drag-drop visual feedback
- Depends on: Utils.js, Logger.js, icons.js
- Used by: sidebar.js for all DOM operations

**Bookmark Storage Layer (bookmark-utils.js + localstorage.js):**
- Purpose: Centralized bookmark operations and chrome bookmark API abstraction
- Location: `/Users/nisargkolhe/arcsidebar/bookmark-utils.js`, `/Users/nisargkolhe/arcsidebar/localstorage.js`
- Contains: Arcify folder management, recursive bookmark traversal, URL matching, space folder CRUD
- Depends on: Logger.js
- Used by: sidebar.js for persisting pinned tabs, utils.js for bookmark lookups

**Utilities Layer (utils.js + chromeHelper.js):**
- Purpose: Shared business logic - settings management, storage operations, UUID/favicon generation
- Location: `/Users/nisargkolhe/arcsidebar/utils.js`, `/Users/nisargkolhe/arcsidebar/chromeHelper.js`
- Contains: Settings CRUD (getSettings, setSetting), archived tabs operations, tab name overrides, UUID generation, favicon URL builder
- Depends on: bookmark-utils.js, logger.js
- Used by: background.js, sidebar.js, options.js, all DOM handlers

**Options/Settings (options.js + options.html):**
- Purpose: User-facing settings UI for extension behavior and appearance
- Location: `/Users/nisargkolhe/arcsidebar/options.js`, `/Users/nisargkolhe/arcsidebar/options.html`
- Contains: Auto-archive configuration, default space name, debug logging toggle, color customization
- Depends on: Utils.js, LocalStorage.js, Logger.js
- Used by: Browser settings page, triggers background.js alarm updates

**Onboarding Layer (installation-onboarding.js + installation-onboarding.html):**
- Purpose: First-run setup experience for new users
- Location: `/Users/nisargkolhe/arcsidebar/installation-onboarding.js`, `/Users/nisargkolhe/arcsidebar/installation-onboarding.html`
- Contains: Welcome screens, feature introduction, setup completion marker
- Depends on: Utils.js
- Used by: background.js on extension install/update

## Data Flow

**Tab Creation/Organization Flow:**

1. User clicks "New Tab" button in sidebar
2. `sidebar.js` → `chrome.tabs.create()` via `domManager.js`
3. Browser creates tab, triggers `chrome.tabs.onCreated` listener
4. Listener fetches all tabs, updates `spaces` array in memory
5. `sidebar.js` calls `renderSpaces()` to reflect in DOM
6. Chrome storage synced automatically for persistence

**Pinned Tab Persistence Flow:**

1. User drags tab to pinned section
2. `sidebar.js` creates bookmark in Arcify folder via `BookmarkUtils`
3. `LocalStorage.getOrCreateSpaceFolder(spaceName)` creates folder hierarchy if needed
4. `chrome.bookmarks.create()` stores bookmark with URL + title
5. `Utils.setPinnedTabState()` saves tabId → bookmarkId mapping to storage
6. On reload: `sidebar.js` reads bookmarks via `BookmarkUtils.findBookmarkInFolderRecursive()`

**Settings Synchronization Flow:**

1. User changes setting in options.html
2. `options.js` calls `chrome.storage.sync.set()`
3. All extension contexts receive `chrome.storage.onChanged` event
4. `sidebar.js` reads new settings, updates UI/behavior
5. `background.js` updates alarm timing if auto-archive setting changed
6. Settings automatically sync across user's Chrome devices (sync-enabled)

**Space Activation Flow:**

1. User clicks space in switcher
2. `sidebar.js` sets `activeSpaceId` in memory
3. Calls `activateSpaceInDOM()` from domManager
4. Fetches tabs for that space group via `chrome.tabs.query({ groupId })`
5. Filters to show active/pinned tabs based on `showAllOpenTabsInCollapsedFolders` setting
6. DOM reflects active space styling and tab list

**Auto-Archive Background Flow:**

1. `background.js` sets alarm with `chrome.alarms.create()` using `autoArchiveIdleMinutes` from settings
2. On every tab change, `background.js` updates timestamp in `chrome.storage.local` under `tabLastActivity`
3. When alarm fires: `background.js` checks tab timestamps, moves idle tabs to archived list
4. `sidebar.js` displays archived tabs in popup without removing them from browser

**State Management:**

- **Global `spaces` array** (sidebar.js): Each space object contains:
  ```
  {
    id: <Chrome tab group ID>,
    uuid: <unique identifier>,
    name: <space name>,
    color: <color name>,
    spaceBookmarks: [<tab IDs of pinned tabs>],
    temporaryTabs: [<tab IDs of temporary tabs>]
  }
  ```
- **chrome.storage.sync**: User settings (defaultSpaceName, autoArchiveEnabled, debugLoggingEnabled, colorOverrides)
- **chrome.storage.local**: Spaces array, tab states, archived tabs list, tab activity timestamps, tab name overrides
- **Chrome Bookmarks API**: Pinned tabs stored under "Arcify" folder → space folder → bookmarks (for durability across sessions)

## Key Abstractions

**Spaces/Tab Groups:**
- Purpose: Group-oriented tab management mimicking Arc browser
- Examples: `sidebar.js` (space creation, activation), `utils.js` (space CRUD helpers)
- Pattern: Maps Chrome's native `tabGroups` API to logical "spaces" with custom metadata (uuid, bookmarks)

**Archived Tabs:**
- Purpose: Defer cleanup of idle tabs without losing them
- Examples: `utils.js` (getArchivedTabs, addArchivedTab, removeArchivedTab)
- Pattern: Stored as array in chrome.storage.local, displayed via popup UI in domManager

**Bookmark Hierarchy:**
- Purpose: Persist pinned tabs durably across browser sessions
- Examples: `bookmark-utils.js` (recursive traversal), `localstorage.js` (folder creation)
- Pattern: "Arcify" → space folder → bookmarks. 3-method fallback for finding folder handles browser variations

**Settings/Preferences:**
- Purpose: Centralize configuration with sync support
- Examples: `utils.js` (getSettings, setSetting), `options.js` (UI)
- Pattern: Split between chrome.storage.sync (user preferences) and chrome.storage.local (runtime data)

**Tab Name Override:**
- Purpose: Allow custom display titles independent of page title
- Examples: `utils.js` (setTabNameOverride, getTabNameOverride)
- Pattern: Maps tabId → { baseUrl, overrideTitle } in chrome.storage.local for persistence

**Favicon Caching:**
- Purpose: Prevent repeated favicon fetches for performance
- Examples: `utils.js` (getFaviconUrl)
- Pattern: Uses chrome's built-in favicon endpoint with caching via URL parameters

## Entry Points

**Installation Entry Point:**
- Location: `background.js` (chrome.runtime.onInstalled)
- Triggers: Extension install or update
- Responsibilities: Create onboarding tab if first-time user, set context menu

**Sidebar Entry Point:**
- Location: `sidebar.html` + `sidebar.js`
- Triggers: User clicks extension icon or Alt+S keyboard shortcut
- Responsibilities: Load spaces, render UI, sync with chrome tab groups, handle all user interactions

**Options Entry Point:**
- Location: `options.html` + `options.js`
- Triggers: User opens extension options page
- Responsibilities: Load/save settings, update color customization, toggle auto-archive

**Command Handlers Entry Point:**
- Location: `background.js` (chrome.commands.onCommand)
- Triggers: Keyboard shortcuts (Alt+S, Alt+D, Alt+L, Alt+T, etc.)
- Responsibilities: Toggle sidebar, quick pin, spotlight search, tab navigation

**Background Service Worker Entry Point:**
- Location: `background.js` (module initialization)
- Triggers: Extension loads
- Responsibilities: Set up Chrome API listeners, schedule auto-archive alarm, manage message routing

## Error Handling

**Strategy:** Distributed logging with centralized Logger utility

**Patterns:**

1. **Try-Catch with Logger:**
   ```javascript
   try {
     const folder = await chrome.bookmarks.search({ title: 'Arcify' });
   } catch (e) {
     Logger.error('[BookmarkUtils] Search failed:', e);
     // Fall back to Method 2
   }
   ```
   Used in `bookmark-utils.js`, `utils.js`, `sidebar.js`

2. **Fallback Chains:**
   - Bookmark finding uses 3-method fallback (search → tree traversal → Other Bookmarks)
   - Favicon loading falls back from chrome endpoint → favIconUrl → default icon
   - Tab URL preference: live tab.url → tabElement.dataset.url → stored pinnedUrl

3. **Chrome Runtime Error Checking:**
   ```javascript
   if (chrome.runtime.lastError) {
     Logger.error(chrome.runtime.lastError);
   }
   ```
   Used in `chromeHelper.js` for promise-based wrappers

4. **Silent Degradation:**
   - If pinned tab state lookup fails, continues with null checks
   - If favicon fetch fails, uses fallback
   - If archive operation fails, logs but doesn't block UI

## Cross-Cutting Concerns

**Logging:**
- Tool: Custom Logger utility in `logger.js`
- Behavior: Respects `debugLoggingEnabled` setting, checks cached value for performance
- Usage: All modules use `Logger.log()`, `Logger.error()`, `Logger.warn()` with prefix tags like `[BookmarkUtils]`, `[URLCopy]`

**Validation:**
- Tab ID existence checked before operations: `if (!tab?.id) return`
- URL validation in `getPinnedUrlKey()` with try-catch for non-standard URLs
- Settings have sensible defaults (e.g., `autoArchiveIdleMinutes` defaults to 360)

**Authentication:**
- Not applicable - extension operates within user's Chrome context only
- All Chrome APIs require manifest permissions (checked in manifest.json)

**Data Persistence:**
- **Sync**: `chrome.storage.sync` for user settings (defaultSpaceName, colorOverrides, debugLoggingEnabled)
- **Local**: `chrome.storage.local` for session-specific data (spaces array, archived tabs, tab activity)
- **Bookmarks**: Chrome Bookmarks API for pinned tabs (survives reinstall/export)
- **In-Memory**: Global `spaces` array in sidebar for fast access, synced to storage on changes

