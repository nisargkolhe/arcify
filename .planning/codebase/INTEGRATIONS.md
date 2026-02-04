# External Integrations

**Analysis Date:** 2026-02-03

## APIs & External Services

**arcify.io Website:**
- URL: `https://arcify.io`
- What it's used for: Marketing/landing page redirect on completion of onboarding
- Implementation: `installation-onboarding.js` redirects to arcify.io with optional query parameters on final step completion
- Auth: None (public website)

---

## Data Storage

**Chrome Bookmarks API:**
- Type: Native browser bookmarks storage
- Purpose: Persistent storage for pinned tabs and space bookmarks
- Client: chrome.bookmarks API
- Structure: Hierarchical folder structure under "Arcify" root folder
- Usage: `bookmark-utils.js`, `localstorage.js`, `utils.js`

**Chrome Storage API (Sync):**
- Storage: chrome.storage.sync
- Syncs across: All Chrome devices signed into same Google Account
- Data stored:
  - User settings: `defaultSpaceName`, `autoArchiveEnabled`, `autoArchiveIdleMinutes`, `useArcLikePositioning`, `invertTabOrder`, `showAllOpenTabsInCollapsedFolders`, `debugLoggingEnabled`
  - Color overrides: Custom color hex values
  - Onboarding completion state: `onboardingCompleted`
- Accessed by: `utils.js` (getSettings, setSettings), `logger.js`, `options.js`

**Chrome Storage API (Local):**
- Storage: chrome.storage.local
- Syncs: Device-local only (not cross-device)
- Data stored:
  - Spaces and tab data: `spaces` array with space metadata, tab lists
  - Tab name overrides: `tabNameOverridesById` - custom display names for tabs
  - Pinned tab states: `pinnedTabStatesById` - which tabs are pinned
  - Archived tabs: `archivedTabs` - closed tabs for restoration
  - Tab activity tracking: `tabLastActivity` - timestamps for auto-archive
- Accessed by: `utils.js`, `sidebar.js`, `background.js`

---

## Tab Management

**Chrome Tabs API:**
- Purpose: Query, create, update, close tabs; manage tab metadata
- Usage: Query active tabs, create new tabs, update URL/title, manage tab groups
- Implementation: Core functionality in `sidebar.js`, `utils.js`, `background.js`

**Chrome Tab Groups API:**
- Purpose: Create, update, query tab groups (Chrome's native grouping feature)
- Usage: Map spaces to Chrome tab groups, query group properties
- Implementation: `utils.js` (tabGroups.query, tabGroups.get), `sidebar.js` (tab group management)

**Chrome Favicons API:**
- Purpose: Fetch favicons for display in sidebar
- URL pattern: `chrome-extension://[id]/_favicon/?pageUrl=<URL>&size=16`
- Implementation: `utils.js` (getFaviconUrl method)

---

## Extension Lifecycle & Commands

**Chrome Runtime API:**
- Purpose: Message passing, extension lifecycle management
- Features used:
  - `chrome.runtime.onInstalled` - Detect install/update events in `background.js`
  - `chrome.runtime.onMessage` - Listen for messages from content scripts and UI pages
  - `chrome.runtime.sendMessage` - Send messages between extension contexts
- Implementation: `background.js`, `sidebar.js`, `domManager.js`, `installation-onboarding.js`

**Chrome Commands API:**
- Purpose: Keyboard shortcuts and command handling
- Shortcuts defined in manifest.json:
  - `_execute_action` (Alt+S) - Toggle sidebar
  - `quickPinToggle` (Alt+D) - Quick pin/unpin current tab
  - `NextTabInSpace` - Navigate to next tab in space
  - `PrevTabInSpace` - Navigate to previous tab in space
  - `copyCurrentUrl` - Copy current tab URL to clipboard
- Implementation: `background.js` (command listener), `options.js` (display shortcuts in settings)

---

## Side Panel & UI

**Chrome Side Panel API:**
- Purpose: Render sidebar UI as Chrome's native side panel
- Configuration: `sidebar.html` in manifest.json
- Behavior: Set to open on action click via `chrome.sidePanel.setPanelBehavior()`
- Implementation: `background.js` (initialize), `sidebar.js` (UI logic)

**Chrome Context Menus API:**
- Purpose: Add context menu items to extension action
- Menu item: "Arcify" - Opens side panel when clicked
- Implementation: `background.js` (onInstalled listener creates menu)

---

## Clipboard

**Chrome Clipboard API:**
- Purpose: Copy text to system clipboard
- Permission: `clipboardWrite`
- Usage: Copy current tab URL via keyboard shortcut (Alt+C)
- Fallback method: Script injection if Clipboard API fails
- Implementation: `background.js` (copyCurrentTabUrlWithFallback function)

---

## Content Scripts & Page Injection

**Chrome Scripting API:**
- Purpose: Inject and execute scripts in page contexts
- Usage: URL copying via script injection (fallback when Clipboard API unavailable)
- Implementation: `background.js`

---

## System Integration

**Chrome Alarms API:**
- Purpose: Schedule periodic background tasks
- Usage: Auto-archive inactive tabs on configurable interval
- Alarm name: `autoArchiveTabsAlarm`
- Implementation: `background.js` (alarm scheduling and handling)

---

## Browser History & Top Sites

**Permissions in manifest.json (not actively used):**
- `search` - Reserved but not utilized
- `topSites` - Reserved but not utilized
- `history` - Reserved but not utilized

---

## Environment Configuration

**Runtime Settings (no env vars):**
- All configuration through UI: chrome.storage.sync
- No API keys required
- No external service credentials needed
- All data is first-party (user's local Chrome storage and bookmarks)

**Secrets location:**
- Not applicable - no third-party API integrations
- All storage is user's own data in Chrome profile

---

## Webhooks & Callbacks

**Incoming:**
- Context menu click callback - Opens sidebar
- Command callbacks - Keyboard shortcuts trigger actions
- Storage change listeners - React to setting updates
- Tab event listeners - Detect tab activity for auto-archive
- Message listeners - Handle cross-context communication

**Outgoing:**
- Website redirect - arcify.io on onboarding completion (HTTP GET to landing page)

---

## Data Flow

**Sidebar → Background → Bookmarks/Storage:**
1. User action in sidebar.html triggers sidebar.js event handler
2. Data stored in chrome.storage.local (spaces, tabs)
3. Pinned tabs also stored in chrome.bookmarks (Arcify folder hierarchy)
4. Settings stored in chrome.storage.sync (cross-device)

**Background → Content Script:**
1. Command triggered (keyboard shortcut)
2. Background service worker receives chrome.commands.onCommand event
3. Routes to appropriate handler or sends chrome.runtime.sendMessage to sidebar

**Tab Activity Tracking:**
1. chrome.tabs.onActivated - Fired when user switches tabs
2. Background.js tracks timestamp in chrome.storage.local (`tabLastActivity`)
3. Auto-archive alarm checks idle time and archives inactive tabs
4. Uses chrome.tabs.create to restore archived tabs

---

## Browser APIs Used

From manifest.json permissions:
- **tabs** - Query, create, update, remove tabs
- **tabGroups** - Create, query, update tab groups
- **sidePanel** - Manage side panel UI
- **storage** - Persistent storage (sync + local)
- **bookmarks** - Access user bookmarks for pinned tabs
- **alarms** - Schedule auto-archive tasks
- **commands** - Handle keyboard shortcuts
- **favicon** - Fetch favicons for display
- **scripting** - Inject scripts for clipboard fallback
- **clipboardWrite** - Copy text to clipboard

---

*Integration audit: 2026-02-03*
