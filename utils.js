import { LocalStorage } from './localstorage.js';

const Utils = {
    // Helper function to generate UUID (If you want to move this too)
    generateUUID: function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // Helper function to fetch favicon
    getFaviconUrl: function(u, size = "16") {
        const url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", u);
        url.searchParams.set("size", size);
        return url.toString();
    },

    getSettings: function() {
        return new Promise((resolve) => {
            chrome.storage.local.get({ defaultSpaceName: 'Home' }, (items) => {
                resolve(items.defaultSpaceName); // Resolve with the value
            });
        });
    },

    // Get all overrides (keyed by tabId)
    getTabNameOverrides: async function() {
        const result = await chrome.storage.local.get('tabNameOverridesById'); // Changed key
        return result.tabNameOverridesById || {}; // Changed key
    },

    // Save all overrides (keyed by tabId)
    saveTabNameOverrides: async function (overrides) {
        await chrome.storage.local.set({ tabNameOverridesById: overrides }); // Changed key
    },

    // Set or update a single override using tabId
    setTabNameOverride: async function (tabId, url, name) { // Added tabId, kept url for domain
        if (!tabId || !url || !name) return; // Basic validation

        const overrides = await this.getTabNameOverrides();
        try {
            // Still store originalDomain in case we need it later, derived from the URL at time of setting
            const originalDomain = new URL(url).hostname;
            overrides[tabId] = { name: name, originalDomain: originalDomain }; // Use tabId as key
            await this.saveTabNameOverrides(overrides);
            console.log(`Override set for tab ${tabId}: ${name}`);
        } catch (e) {
            console.error("Error setting override - invalid URL?", url, e);
        }
    },

    // Remove an override using tabId
    removeTabNameOverride: async function (tabId) { // Changed parameter to tabId
        if (!tabId) return;

        const overrides = await this.getTabNameOverrides();
        if (overrides[tabId]) { // Check using tabId
            delete overrides[tabId]; // Delete using tabId
            await this.saveTabNameOverrides(overrides);
            console.log(`Override removed for tab ${tabId}`);
        }
    },

    updateBookmarkTitleIfNeeded: async function(tab, activeSpace, newTitle) {    
        console.log(`Attempting to update bookmark for pinned tab ${tab.id} in space ${activeSpace.name} to title: ${newTitle}`);
    
        try {
            const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(activeSpace.name);
            if (!spaceFolder) {
                console.error(`Bookmark folder for space ${activeSpace.name} not found.`);
                return;
            }
    
            // Recursive function to find and update the bookmark
            const findAndUpdate = async (folderId) => {
                const items = await chrome.bookmarks.getChildren(folderId);
                for (const item of items) {
                    if (item.url && item.url === tab.url) {
                        // Found the bookmark
                        // Avoid unnecessary updates if title is already correct
                        if (item.title !== newTitle) {
                            console.log(`Found bookmark ${item.id} for URL ${tab.url}. Updating title to "${newTitle}"`);
                            await chrome.bookmarks.update(item.id, { title: newTitle });
                        } else {
                             console.log(`Bookmark ${item.id} title already matches "${newTitle}". Skipping update.`);
                        }
                        return true; // Found
                    } else if (!item.url) {
                        // It's a subfolder, search recursively
                        const found = await findAndUpdate(item.id);
                        if (found) return true; // Stop searching if found in subfolder
                    }
                }
                return false; // Not found in this folder
            };
    
            const updated = await findAndUpdate(spaceFolder.id);
            if (!updated) {
                console.log(`Bookmark for URL ${tab.url} not found in space folder ${activeSpace.name}.`);
            }
    
        } catch (error) {
            console.error(`Error updating bookmark for tab ${tab.id}:`, error);
        }
    },
}

export { Utils };