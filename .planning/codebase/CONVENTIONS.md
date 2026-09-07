# Coding Conventions

**Analysis Date:** 2026-02-03

## Naming Patterns

**Files:**
- Kebab-case for multi-word files: `bookmark-utils.js`, `installation-onboarding.js`
- Single-word files in lowercase: `sidebar.js`, `background.js`, `utils.js`, `logger.js`, `options.js`
- Descriptive names reflecting module purpose and scope

**Functions:**
- camelCase for all function names: `setupDOMElements()`, `generateUUID()`, `getFaviconUrl()`, `getPinnedUrlKey()`
- Exported functions use camelCase: `showSpaceNameInput()`, `activateTabInDOM()`, `showTabContextMenu()`
- Private helper functions also use camelCase: `handleAsyncMessage()`, `copyCurrentTabUrlWithFallback()`, `updateTabLastActivity()`
- Async functions clearly indicate async nature: `async function runAutoArchiveCheck()`, `async function initializeLogger()`

**Variables:**
- camelCase for all variables and constants in code: `isCreatingSpace`, `isDraggingTab`, `activeSpaceId`, `defaultSpaceName`, `debugLoggingEnabled`
- Module-level state variables use camelCase: `let spaces = []`, `let activeSpaceId = null`, `let currentWindow = null`
- Const flags/primitives: `let showAllOpenTabsInCollapsedFolders = false`, `const MAX_ARCHIVED_TABS = 100`
- Use descriptive names for state tracking: `isOpeningBookmark`, `isCreatingSpace`, `isDraggingTab`

**Types/Constants:**
- UPPER_SNAKE_CASE for exported constant objects with semantic meaning: `CSS_CLASSES`, `SELECTORS`, `TIMING`, `MOUSE_BUTTON`, `TAB_TYPE`, `DROP_POSITION`
- Constants defined at module top: `const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm'`, `const MAX_ARCHIVED_TABS = 100`
- Data objects use UPPER_SNAKE_CASE keys within exported objects: `TAB_TYPE.PINNED`, `MOUSE_BUTTON.LEFT`, `TIMING.FOLDER_AUTO_OPEN_DELAY`

**Exported Objects:**
- Static utility objects (singleton-like patterns): `export const BookmarkUtils = { ... }`, `export const Logger = { ... }`, `const Utils = { ... }`
- Methods on objects use camelCase: `BookmarkUtils.findArcifyFolder()`, `Utils.getSettings()`, `LocalStorage.getOrCreateArcifyFolder()`

## Code Style

**Formatting:**
- No explicit formatter configured (no Prettier, ESLint config)
- Consistent 4-space indentation observed throughout codebase
- Line length approximately 100-120 characters
- Consistent spacing around operators and braces

**Module Pattern:**
- ES6 modules with explicit imports/exports: `import { X } from './file.js'`, `export const Y = { ... }`
- Imports grouped logically: utility imports, local module imports, constant imports
- All files use `type: "module"` in package.json - fully ES6 module syntax

**Object Export Pattern:**
- Utility classes exported as static object literals (not class syntax):
  ```javascript
  export const BookmarkUtils = {
    async findArcifyFolder() { ... },
    async findBookmarkInFolder() { ... }
  };
  ```
- Methods on exported objects are async when dealing with Chrome API calls

## Import Organization

**Order:**
1. External utilities (ChromeHelper, icons, utils)
2. Storage/persistence utilities (LocalStorage, BookmarkUtils)
3. DOM utilities (domManager imports)
4. Logging (Logger)
5. Constants (CSS_CLASSES, TIMING, MOUSE_BUTTON)

**Path Aliases:**
- No path aliases used - all imports are relative paths: `'./utils.js'`, `'./bookmark-utils.js'`
- Extensions always included: `'.js'` suffix required on all imports

**Example from sidebar.js:**
```javascript
import { ChromeHelper } from './chromeHelper.js';
import { FOLDER_CLOSED_ICON, FOLDER_CLOSED_DOTS_ICON, FOLDER_OPEN_ICON } from './icons.js';
import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';
import { setupDOMElements, showSpaceNameInput, activateTabInDOM, ... } from './domManager.js';
import { BookmarkUtils } from './bookmark-utils.js';
import { Logger } from './logger.js';
import { MOUSE_BUTTON, CSS_CLASSES, TIMING } from './constants.js';
```

## Error Handling

**Patterns:**
- Always use try-catch for async Chrome API calls and message passing
- Logger.error() used for caught exceptions with context: `Logger.error('[Background] Error ${errorContext}:', error)`
- Context string prefix included in all logged errors showing originating module: `[BookmarkUtils]`, `[Background]`, `[Arcify]`, `[URLCopy]`, `[Logger]`
- Silent failures with logging fallback approach in multiple error handlers:
  ```javascript
  try {
    // Primary approach
  } catch (error) {
    Logger.error('Context:', error);
    // Fallback approach or graceful degradation
  }
  ```

**Error Recovery Examples:**
- `bookmark-utils.js`: Three-method fallback for finding Arcify folder (search → traverse → "Other Bookmarks")
- `background.js`: Script injection with sidebar fallback for URL copying
- `logger.js`: Defaults to disabled logging if storage not accessible

**Message Handling:**
- Async message responses wrapped in try-catch with consistent error response format:
  ```javascript
  function handleAsyncMessage(handler, sendResponse, errorContext, defaultErrorData = {}) {
    (async () => {
      try {
        const result = await handler();
        sendResponse({ success: true, ...result });
      } catch (error) {
        Logger.error(`[Background] Error ${errorContext}:`, error);
        sendResponse({ success: false, error: error.message, ...defaultErrorData });
      }
    })();
    return true; // Indicates async response
  }
  ```

## Logging

**Framework:** console methods (console.log, console.error, console.warn, console.info, console.debug)

**Patterns:**
- Logger.log() - Primary logging method for debug information
- Logger.error() - Error conditions
- Logger.warn() - Warning conditions
- Logger.info() - Informational messages
- Logger.debug() - Debug messages (all bound to debug setting check)
- All logging methods respect `debugLoggingEnabled` setting from chrome.storage.sync
- Logger caches debug setting to avoid storage reads on every call
- Use meaningful context prefixes in log messages: `[Arcify]`, `[URLCopy]`, `[BookmarkUtils]`, `[Background]`

**Example logging:**
```javascript
Logger.log("updating bookmark", tab, bookmarkTitle);
Logger.warn('[Bookmarks] Failed updating bookmark by stored bookmarkId, falling back to URL search.', e);
Logger.error('[Background] Error handling auto-archive:', error);
Logger.log('[BookmarkUtils] Found Arcify folder via search:', arcifyViaSearch.id);
```

## Comments

**When to Comment:**
- File headers document purpose and key responsibilities (all source files have JSDoc-style header blocks)
- Complex algorithms need explanation: e.g., pinned URL matching logic ignoring query params
- State management and design decisions documented: "Arc-like behavior: track which tabs have been active in each collapsed folder"
- Non-obvious Chrome API interactions explained: "Content scripts cannot call Chrome APIs directly"

**JSDoc/TSDoc:**
- JSDoc used for public functions in utility modules:
  ```javascript
  /**
   * Robust method to find the Arcify folder in Chrome bookmarks
   * Uses 3-method fallback approach for maximum reliability
   * @returns {Promise<Object|null>} The Arcify folder object or null if not found
   */
  async findArcifyFolder() { ... }
  ```
- Parameter documentation: `@param {string} folderId - ID of the folder to search`
- Return type documentation: `@returns {Promise<Array>} Array of bookmark objects`
- Optional parameters documented: `@param {string} [searchCriteria.url] - URL to search for`
- Function descriptions explain purpose, not implementation

**File Headers:**
All major source files include 8-12 line header blocks:
```javascript
/**
 * Sidebar - Main extension UI and tab/space management
 *
 * Purpose: Implements Arc-like vertical tab organization with spaces (Chrome tab groups)
 * Key Functions: Space creation/management, tab organization, drag-and-drop, archived tabs, spotlight integration
 * Architecture: Side panel UI that syncs with Chrome's native tab groups API
 *
 * Critical Notes:
 * - Primary user interface for tab and space management
 * - Real-time sync with Chrome tab groups and active tab changes
 * - Handles drag-and-drop for tab/space reorganization
 */
```

## Function Design

**Size:**
- Most functions 15-50 lines
- Large orchestration functions in sidebar.js can reach 100-200+ lines (complex state management)
- Helper functions kept under 30 lines
- Private helper functions keep DOM logic separate from business logic

**Parameters:**
- Callback functions passed as parameters: `setupDOMElements(createNewSpace)`, `setupQuickPinListener(moveTabToSpace, moveTabToPinned, ...)`
- Context objects passed for related operations: `BookmarkUtils.openBookmarkAsTab(..., context)` with `{ Utils, reconcileSpaceTabOrdering }`
- Default parameters used sparingly: `getDragAfterElement(container, position, options = {})`
- Options objects for optional parameters: `function getDragAfterElement(container, position, options = {})`

**Return Values:**
- Promises explicitly returned from async functions: `async function runAutoArchiveCheck() { ... }`
- Null for "not found" cases: `return null` (consistent pattern in bookmark/search utilities)
- Objects for multi-value returns: `return { space, tab }` from `findActiveSpaceAndTab()`
- Arrays for collections: `return bookmarks` (array of bookmark IDs or objects)
- Void/undefined for side-effect operations

## Module Design

**Exports:**
- Each module exports a single primary export (typically static object or group of functions)
- `export const BookmarkUtils = { ... }` - single utility object
- `export { Logger }` - single class/object export
- `export function setupDOMElements() { ... }` - individual function exports for large modules
- Multiple named exports from domManager.js for UI functions: all prefixed with semantic purpose

**Barrel Files:**
- No barrel files used (no `index.js` re-exports)
- All imports reference specific files: `import { Utils } from './utils.js'` not `from './utils/'`

**File Organization:**
- Each file has a clear single responsibility:
  - `sidebar.js` - Main UI state and event handling
  - `background.js` - Service worker lifecycle and Chrome API routing
  - `domManager.js` - DOM creation and manipulation (separated from logic)
  - `utils.js` - Cross-cutting utilities and storage
  - `bookmark-utils.js` - All bookmark operations
  - `localstorage.js` - Bookmark-based persistence
  - `logger.js` - Debug logging with setting respect
  - `constants.js` - All magic strings and values

---

*Convention analysis: 2026-02-03*
