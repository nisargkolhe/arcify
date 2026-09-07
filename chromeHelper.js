/**
 * ChromeHelper - Chrome API wrapper and utility functions
 * 
 * Purpose: Provides simplified, promise-based wrappers around Chrome extension APIs
 * Key Functions: Tab creation
 * Architecture: Static utility object with async methods for Chrome API operations
 * 
 * Critical Notes:
 * - Wraps callback-based Chrome APIs in promises for easier async/await usage
 * - Handles Chrome API error checking and reporting
 * - Used primarily by sidebar.js for tab creation
 * - Abstracts complex Chrome API interactions into simple method calls
 */

const ChromeHelper = {
    createNewTab: async function () {
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
}

export { ChromeHelper };
