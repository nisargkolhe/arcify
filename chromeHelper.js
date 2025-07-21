/**
 * ChromeHelper - Chrome API wrapper and utility functions
 * 
 * Purpose: Provides simplified, promise-based wrappers around Chrome extension APIs
 * Key Functions: Tab operations, tab group management, window operations, storage helpers
 * Architecture: Static utility object with async methods for Chrome API operations
 * 
 * Critical Notes:
 * - Wraps callback-based Chrome APIs in promises for easier async/await usage
 * - Handles Chrome API error checking and reporting
 * - Used primarily by sidebar.js for tab and group management operations
 * - Abstracts complex Chrome API interactions into simple method calls
 */

const ChromeHelper = {
    createNewTab: async function() {
        const newTab = await new Promise((resolve, reject) => {
            chrome.tabs.create({ active: true }, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(tab);
                }
            });
        });
        return newTab;
    },
    createNewTabGroup: async function(newTab, spaceName, spaceColor) {
        // Create a new tab group with the new tab
        const groupId = await chrome.tabs.group({ tabIds: [newTab.id] });
        await chrome.tabGroups.update(groupId, { title: spaceName, color: spaceColor });
        return groupId;
    }
}


export { ChromeHelper };