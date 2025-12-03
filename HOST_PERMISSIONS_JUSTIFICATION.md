# Host Permissions Justification for Chrome Web Store Review

## Summary
The extension requires `host_permissions` with `<all_urls>` to support the Spotlight command bar feature, which provides a universal search interface that can be activated on any web page.

## Technical Requirements

### 1. Script Injection for Spotlight Overlay (Primary Use Case)
**Location:** `background.js` lines 220-234

The extension uses `chrome.scripting.executeScript()` as a fallback mechanism to inject the Spotlight overlay into web pages. This is required because:

- **Primary method:** The extension uses a dormant content script approach (declared in manifest) for performance
- **Fallback method:** When the content script isn't ready or fails to load, the extension falls back to programmatic script injection using `chrome.scripting.executeScript()`
- **Universal access needed:** Users can activate Spotlight from any tab on any website, so the extension must be able to inject scripts into any URL that supports content scripts

**Code reference:**
```javascript
// Fallback injection when content script messaging fails
await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['spotlight/overlay.js']
});
```

### 2. URL Copying Functionality
**Location:** `background.js` line 291

The extension provides a keyboard shortcut to copy the current tab's URL. This uses script injection to access the page's clipboard API:

```javascript
await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (url) => {
        navigator.clipboard.writeText(url);
    },
    args: [tab.url]
});
```

This must work on any tab, requiring `<all_urls>` permission.

### 3. Content Script Declaration
**Location:** `manifest.json` lines 35-45

The extension declares a content script that runs on all URLs:
```json
"content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["spotlight/overlay.js"]
}]
```

While content scripts declared in the manifest don't require `host_permissions`, the fallback script injection method does.

## Why Not More Specific Permissions?

The extension cannot use more specific host permissions because:

1. **User-initiated activation:** Spotlight can be triggered by the user from any tab via keyboard shortcut (Alt+L or Alt+T)
2. **Dynamic tab context:** The extension doesn't know in advance which URLs users will visit
3. **Fallback reliability:** The script injection fallback must work universally to ensure Spotlight is always available, even when the content script fails to load

## Privacy Considerations

- **No data collection:** The extension does not collect, store, or transmit any user data from web pages
- **Local-only operation:** All Spotlight functionality operates locally using Chrome's built-in APIs (tabs, bookmarks, history)
- **Minimal page access:** The injected scripts only create a UI overlay and do not access or modify page content
- **User control:** Spotlight is only activated when the user explicitly triggers it via keyboard shortcut

## Alternative Approaches Considered

1. **Declarative content scripts only:** Tried, but requires fallback injection for reliability when content scripts fail to load
2. **Specific URL patterns:** Not feasible because users can activate Spotlight from any website
3. **Optional permissions:** Not suitable because Spotlight is a core feature that must work universally

## Conclusion

The `<all_urls>` host permission is essential for the Spotlight feature to function reliably across all websites. The permission is used solely for:
- Injecting the Spotlight UI overlay when needed
- Copying URLs from the current tab

No user data is collected or transmitted, and all operations are performed locally within the browser.
