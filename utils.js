import { LocalStorage } from './localstorage.js';

const MAX_ARCHIVED_TABS = 100;
const ARCHIVED_TABS_KEY = 'archivedTabs';

const Utils = {

    processBookmarkFolder: async function(folder, groupId) {
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folder.id);
        const tabs = await chrome.tabs.query({groupId: groupId});
        for (const item of items) {
            if (item.url) {
                // This is a bookmark
                const tab = tabs.find(t => t.url === item.url);
                if (tab) {
                    bookmarks.push(tab.id);
                    // Set tab name override with the bookmark's title
                    if (item.title && item.title !== tab.title) { // Only override if bookmark title is present and different
                        await this.setTabNameOverride(tab.id, tab.url, item.title);
                        console.log(`Override set for tab ${tab.id} from bookmark: ${item.title}`);
                    }
                }
            } else {
                // This is a folder, recursively process it
                const subFolderBookmarks = await this.processBookmarkFolder(item, groupId);
                bookmarks.push(...subFolderBookmarks);
            }
        }
        
        return bookmarks;
    },
    
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

    getSettings: async function() {
        const defaultSettings = {
            defaultSpaceName: 'Home',
            autoArchiveEnabled: false, // Default: disabled
            autoArchiveIdleMinutes: 30, // Default: 30 minutes
            // ... other settings ...
        };
        const result = await chrome.storage.sync.get(defaultSettings);
        console.log("Retrieved settings:", result);
        return result;
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

    // Function to get if archiving is enabled
    isArchivingEnabled: async function() {
        const settings = await this.getSettings();
        return settings.autoArchiveEnabled;
    },

    // Get all archived tabs
    getArchivedTabs: async function() {
        const result = await chrome.storage.local.get(ARCHIVED_TABS_KEY);
        return result[ARCHIVED_TABS_KEY] || [];
    },

    // Save all archived tabs
    saveArchivedTabs: async function(tabs) {
        await chrome.storage.local.set({ [ARCHIVED_TABS_KEY]: tabs });
    },

    // Add a tab to the archive
    addArchivedTab: async function(tabData) { // tabData = { url, name, spaceId, archivedAt }
        if (!tabData || !tabData.url || !tabData.name || !tabData.spaceId) return;

        const archivedTabs = await this.getArchivedTabs();

        const exists = archivedTabs.some(t => t.url === tabData.url && t.spaceId === tabData.spaceId);
        if (exists) {
            console.log(`Tab already archived: ${tabData.name}`);
            return; // Don't add duplicates
        }

        // Add new tab with timestamp
        const newArchiveEntry = { ...tabData, archivedAt: Date.now() };
        archivedTabs.push(newArchiveEntry);

        // Sort by timestamp (newest first for potential slicing, though FIFO means oldest removed)
        archivedTabs.sort((a, b) => b.archivedAt - a.archivedAt);

        // Enforce limit (remove oldest if over limit - FIFO)
        if (archivedTabs.length > MAX_ARCHIVED_TABS) {
            archivedTabs.splice(MAX_ARCHIVED_TABS); // Remove items from the end (oldest)
        }

        await this.saveArchivedTabs(archivedTabs);
        console.log(`Archived tab: ${tabData.name} from space ${tabData.spaceId}`);
    },

    // Function to archive a tab (likely called from context menu)
    archiveTab: async function(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab || !activeSpaceId) return;

            const tabData = {
                url: tab.url,
                name: tab.title,
                spaceId: activeSpaceId // Archive within the current space
            };

            await this.addArchivedTab(tabData);
            await chrome.tabs.remove(tabId); // Close the original tab
            // Optionally: Refresh sidebar view if needed, though handleTabRemove should cover it

        } catch (error) {
            console.error(`Error archiving tab ${tabId}:`, error);
        }
    },

    // Remove a tab from the archive (e.g., after restoration)
    removeArchivedTab: async function(url, spaceId) {
        if (!url || !spaceId) return;

        let archivedTabs = await this.getArchivedTabs();
        archivedTabs = archivedTabs.filter(tab => !(tab.url === url && tab.spaceId === spaceId));
        await this.saveArchivedTabs(archivedTabs);
        console.log(`Removed archived tab: ${url} from space ${spaceId}`);
    },

    restoreArchivedTab: async function(archivedTabData) {
        try {
            // Create the tab in the original space's group
            const newTab = await chrome.tabs.create({
                url: archivedTabData.url,
                active: true, // Make it active
                // windowId: currentWindow.id // Ensure it's in the current window
            });

            // Immediately group the new tab into the correct space
            await chrome.tabs.group({ tabIds: [newTab.id] });

            // Remove from archive storage
            await this.removeArchivedTab(archivedTabData.url, archivedTabData.spaceId);

            // The handleTabCreated and handleTabUpdate listeners should add the tab to the UI.
            // If not, you might need to manually add it or refresh the space view.

        } catch (error) {
            console.error(`Error restoring archived tab ${archivedTabData.url}:`, error);
        }
    },
}

export { Utils };
