# Testing Patterns

**Analysis Date:** 2026-02-03

## Test Framework

**Status:** No automated testing framework configured

**Current State:**
- No test runner installed (Jest, Vitest, Jasmine not in package.json)
- No test files in codebase (no *.test.js or *.spec.js files at repo level)
- No test configuration files present
- Testing is manual/ad-hoc or occurs outside this repository

**Run Commands:**
```bash
# No test commands configured in package.json
npm run dev              # Development build with watch (for manual testing)
npm run build            # Production build (for manual testing)
```

**Development Setup for Manual Testing:**
- Load extension in Chrome: `chrome://extensions/` → Enable Developer Mode → Load unpacked → Select `dist-dev/`
- Watch mode available: `npm run dev` outputs to `dist-dev/` with file watching
- Manual testing of extension features required before release

## Test File Organization

**Location:** Not applicable - no test files present

**Naming Convention:** Not applicable - no test files

**Structure:** Not applicable - no tests

## Testing Strategy (Observed Practices)

### What IS Being Tested

**Manual testing approach:**
1. **Chrome Extension Context Testing** - Extension functionality tested directly in Chrome browser:
   - Load unpacked extension from dist-dev/
   - Manually interact with sidebar UI
   - Test tab management, space creation, drag-drop
   - Test keyboard shortcuts (Alt+S, Alt+D, Alt+L, Alt+T)
   - Test context menus and right-click interactions

2. **Storage/API Testing** - Integration with Chrome APIs:
   - Manual verification of chrome.storage.sync/local persistence
   - Bookmark CRUD operations tested via manual UI interaction
   - Tab group operations verified through Chrome UI and extension UI sync

3. **Build Pipeline Testing**:
   - Vite build process validates module syntax and bundling
   - Manual zip creation for Chrome Web Store submission (`npm run build:zip`)
   - Release script validates versioning and git tagging

### What is NOT Being Tested

**Unit Testing:** No isolated function testing
**Integration Testing:** No programmatic API testing
**E2E Testing:** No automated browser automation testing
**Component Testing:** No DOM component testing frameworks
**Coverage Tracking:** No coverage reports generated

## Error Handling Verification

**Manual approach:**
- Logger provides debug output for error tracking: `Logger.error('[Context]:', error)`
- try-catch blocks throughout codebase catch exceptions
- Error responses in message handlers: `sendResponse({ success: false, error: error.message })`
- Fallback mechanisms tested manually:
  - Three-method Arcify folder finding verified
  - Script injection with sidebar fallback for URL copying
  - Storage access error handling in Logger

**Example error paths in code:**
```javascript
// From background.js - async message handling with error response
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
    return true;
}

// From bookmark-utils.js - graceful degradation with fallback
try {
    // Method 1: search
    const searchResults = await chrome.bookmarks.search({ title: 'Arcify' });
    if (arcifyViaSearch) return arcifyViaSearch;

    // Method 2: traverse
    // Method 3: other bookmarks
} catch (error) {
    Logger.error('[BookmarkUtils] Error in findArcifyFolder:', error);
    return null;
}
```

## Debugging Utilities

**Logger Module:** `logger.js`
- Provides consistent logging interface: `Logger.log()`, `Logger.error()`, `Logger.warn()`, `Logger.info()`, `Logger.debug()`
- All methods respect `debugLoggingEnabled` setting from chrome.storage.sync
- Context-prefixed logging: `[Background]`, `[Arcify]`, `[BookmarkUtils]`, `[URLCopy]`
- Used for tracing Chrome API calls, state changes, and error conditions

**Debug Setting:**
- `debugLoggingEnabled` boolean in chrome.storage.sync controls all logging output
- Cached in Logger module to avoid storage reads on every call
- Storage listener updates cache when setting changes
- Enables/disables logging without code changes

## Build-Time Testing

**Vite Build Process:**
- Module bundling validates syntax and import/export correctness
- ES6 module resolution ensures all paths resolve correctly
- Bundle output used for manual testing in extension

**Manifest Validation:**
- manifest.json required by Chrome extension specs
- Permissions and entry points declared
- Service worker configuration in manifest.json

## Code Review & Validation Patterns

**What developers can verify manually:**

1. **State Synchronization:**
   - Open DevTools → Storage tab → View chrome.storage.sync and chrome.storage.local
   - Verify spaces array matches bookmark structure
   - Verify tab state persists across extension reload

2. **Message Passing:**
   - DevTools → Extensions → inspect background service worker
   - Send test messages via `chrome.runtime.sendMessage()`
   - Verify response handling and error states

3. **DOM Consistency:**
   - DevTools → Elements tab for sidebar DOM
   - Verify DOM structure matches stored state
   - Check drag-drop visual feedback

4. **Chrome API Calls:**
   - DevTools console in sidebar/background contexts
   - Monitor chrome.tabs.*, chrome.tabGroups.*, chrome.bookmarks.* calls
   - Verify callbacks and error handling

## Testing Patterns in Code

**Promise/Async Patterns:**
All Chrome API calls use async/await pattern with try-catch:
```javascript
try {
    const result = await chrome.storage.sync.get(defaultSettings);
    return result;
} catch (error) {
    Logger.error('Context:', error);
    // fallback behavior
}
```

**Message Passing Testing:**
Sidebar can test background communication:
```javascript
chrome.runtime.sendMessage({ command: "toggleSpacePin", tabId: request.tabId });

// Background listeners handle and respond
chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    if (request.command === "toggleSpacePin") {
        // Handle and send response with { success, ...data }
    }
});
```

**Storage Change Listeners (reactive testing):**
Manual testing can verify storage listeners trigger appropriately:
```javascript
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.debugLoggingEnabled) {
        // Logger updates cache
        Logger.log('Logging enabled changed');
    }
});
```

## No Test Coverage Requirements

- No coverage percentage targets
- No enforced test writing rules
- No pre-commit test hooks
- Testing approach is entirely manual/exploratory

## Future Testing Recommendations

**If testing were to be added, consider:**

1. **Unit Testing Framework:**
   - Jest or Vitest for utility functions
   - Test files: `src/*.test.js` or `__tests__/` directory
   - Focus on pure functions: UUID generation, URL normalization, storage operations

2. **Chrome API Mocking:**
   - Mock chrome.storage.*, chrome.tabs.*, chrome.bookmarks.*
   - Test message passing and listener patterns
   - Test error handling paths

3. **DOM Testing:**
   - jsdom for DOM manipulation testing in domManager.js
   - Test UI state transitions (active tabs, collapsed folders, etc.)
   - Test drag-drop visual feedback

4. **Integration Testing:**
   - Extension context testing with Playwright or Puppeteer
   - Test sidebar-background communication flows
   - Test storage persistence across reload

5. **Test File Structure:**
   - Co-locate tests with source: `sidebar.test.js` next to `sidebar.js`
   - Test directory matching src structure: `__tests__/utils.test.js`
   - Config files next to test files: `vitest.config.js`

---

*Testing analysis: 2026-02-03*
