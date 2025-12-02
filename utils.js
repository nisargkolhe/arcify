/**
 * Utils - Shared utility functions and storage management
 * 
 * Purpose: Provides common utilities and centralized settings/storage management across the extension
 * Key Functions: Settings CRUD, archived tabs management, space data operations, default configurations
 * Architecture: Static utility class with async storage operations
 * 
 * Critical Notes:
 * - Central source of truth for extension settings and defaults
 * - Handles both chrome.storage.sync (settings) and chrome.storage.local (spaces/tabs data)
 * - Used by both background script and UI components for consistent data access
 * - Settings changes automatically sync across extension contexts
 */

import { BookmarkUtils } from './bookmark-utils.js';

const MAX_ARCHIVED_TABS = 100;
const ARCHIVED_TABS_KEY = 'archivedTabs';

const Utils = {

    processBookmarkFolder: async function (folder, groupId) {
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folder.id);
        const tabs = await chrome.tabs.query({ groupId: groupId });
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
    generateUUID: function () {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // Helper function to fetch favicon
    getFaviconUrl: function (u, size = "16") {
        const url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", u);
        url.searchParams.set("size", size);
        return url.toString();
    },

    getSettings: async function () {
        const defaultSettings = {
            defaultSpaceName: 'Home',
            autoArchiveEnabled: false, // Default: disabled
            autoArchiveIdleMinutes: 360, // Default: 30 minutes
            enableSpotlight: true, // Default: enabled
            useArcLikePositioning: false, // Default: disabled (Chrome sync is default)
            invertTabOrder: true, // Default: enabled (New tabs/High index on top)
            colorOverrides: null, // Default: no color overrides
            // ... other settings ...
        };
        const result = await chrome.storage.sync.get(defaultSettings);
        console.log("Retrieved settings:", result);
        return result;
    },

    // Get all overrides (keyed by tabId)
    getTabNameOverrides: async function () {
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

    getTabGroupColor: async function (groupName) {
        let tabGroups = await chrome.tabGroups.query({});

        const chromeTabGroupColors = [
            'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'
        ];
        const existingGroup = tabGroups.find(group => group.title === groupName);
        if (existingGroup) {
            return existingGroup.color;
        } else {
            const randomIndex = Math.floor(Math.random() * chromeTabGroupColors.length);
            return chromeTabGroupColors[randomIndex];
        }
    },

    updateBookmarkTitleIfNeeded: async function (tab, activeSpace, newTitle) {
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
    isArchivingEnabled: async function () {
        const settings = await this.getSettings();
        return settings.autoArchiveEnabled;
    },

    // Get all archived tabs
    getArchivedTabs: async function () {
        const result = await chrome.storage.local.get(ARCHIVED_TABS_KEY);
        return result[ARCHIVED_TABS_KEY] || [];
    },

    // Save all archived tabs
    saveArchivedTabs: async function (tabs) {
        await chrome.storage.local.set({ [ARCHIVED_TABS_KEY]: tabs });
    },

    // Add a tab to the archive
    addArchivedTab: async function (tabData) { // tabData = { url, name, spaceId, archivedAt }
        if (!tabData || !tabData.url || !tabData.name || !tabData.spaceId) return;

        const archivedTabs = await this.getArchivedTabs();

        // Check if URL already exists in archive (regardless of space)
        const existingTab = archivedTabs.find(t => t.url === tabData.url);
        if (existingTab) {
            console.log(`Tab with URL already archived: ${tabData.name} (${tabData.url})`);
            return; // Don't add duplicates based on URL
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
    archiveTab: async function (tabId) {
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
    removeArchivedTab: async function (url, spaceId) {
        if (!url || !spaceId) return;

        let archivedTabs = await this.getArchivedTabs();
        archivedTabs = archivedTabs.filter(tab => !(tab.url === url && tab.spaceId === spaceId));
        await this.saveArchivedTabs(archivedTabs);
        console.log(`Removed archived tab: ${url} from space ${spaceId}`);
    },

    restoreArchivedTab: async function (archivedTabData) {
        try {
            // Create the tab in the original space's group
            const newTab = await chrome.tabs.create({
                url: archivedTabData.url,
                active: true, // Make it active
                // windowId: currentWindow.id // Ensure it's in the current window
            });

            // Immediately group the new tab into the correct space (if spaceId is valid)
            if (archivedTabData.spaceId && archivedTabData.spaceId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                try {
                    // Check if the group still exists
                    await chrome.tabGroups.get(archivedTabData.spaceId);
                    // Group exists, add tab to it
                    await chrome.tabs.group({ tabIds: [newTab.id], groupId: archivedTabData.spaceId });
                } catch (e) {
                    // Group doesn't exist, create a new one or leave ungrouped
                    console.warn(`Space ${archivedTabData.spaceId} no longer exists, tab restored without grouping`);
                }
            }

            // Remove from archive storage
            await this.removeArchivedTab(archivedTabData.url, archivedTabData.spaceId);

            // Return the created tab so caller can pin it if needed
            return newTab;

        } catch (error) {
            console.error(`Error restoring archived tab ${archivedTabData.url}:`, error);
            throw error;
        }
    },

    setArchivingEnabled: async function (enabled) {
        const settings = await this.getSettings();
        settings.autoArchiveEnabled = enabled;
        await chrome.storage.sync.set({ autoArchiveEnabled: enabled });
    },

    setArchiveTime: async function (minutes) {
        const settings = await this.getSettings();
        settings.autoArchiveIdleMinutes = minutes;
        await chrome.storage.sync.set({ autoArchiveIdleMinutes: minutes });
    },

    // Get Arc-like positioning setting (when enabled, tabs append to end instead of syncing with Chrome)
    getUseArcLikePositioning: async function () {
        const settings = await this.getSettings();
        return settings.useArcLikePositioning;
    },

    // Set Arc-like positioning setting
    setUseArcLikePositioning: async function (enabled) {
        await chrome.storage.sync.set({ useArcLikePositioning: enabled });
    },

    getInvertTabOrder: async function () {
        const settings = await this.getSettings();
        return settings.invertTabOrder;
    },

    setInvertTabOrder: async function (enabled) {
        await chrome.storage.sync.set({ invertTabOrder: enabled });
    },

    // Search and remove bookmark by URL from a folder structure recursively
    searchAndRemoveBookmark: async function (folderId, tabUrl, options = {}) {
        const {
            removeTabElement = false, // Whether to also remove the tab element from DOM
            tabElement = null, // The tab element to remove if removeTabElement is true
            logRemoval = false // Whether to log the removal
        } = options;

        const items = await chrome.bookmarks.getChildren(folderId);
        for (const item of items) {
            if (item.url === tabUrl) {
                if (logRemoval) {
                    console.log("removing bookmark", item);
                }
                await chrome.bookmarks.remove(item.id);

                if (removeTabElement && tabElement) {
                    tabElement.remove();
                }

                return true; // Bookmark found and removed
            } else if (!item.url) {
                // This is a folder, search recursively
                const found = await this.searchAndRemoveBookmark(item.id, tabUrl, options);
                if (found) return true;
            }
        }
        return false; // Bookmark not found
    },
    movToNextTabInSpace: async function (tabId, sourceSpace) {
        const temporaryTabs = sourceSpace?.temporaryTabs ?? [];
        const spaceBookmarks = sourceSpace?.spaceBookmarks ?? [];

        const indexInTemporaryTabs = temporaryTabs.findIndex(id => id === tabId);
        const indexInBookmarks = spaceBookmarks.findIndex(id => id === tabId);

        if (indexInTemporaryTabs != -1) {
            if (indexInTemporaryTabs < temporaryTabs.length - 1) {
                chrome.tabs.update(temporaryTabs[indexInTemporaryTabs + 1], { active: true })
            } else if (spaceBookmarks.length > 0) {
                chrome.tabs.update(spaceBookmarks[0], { active: true })
            } else {
                chrome.tabs.update(temporaryTabs[0], { active: true })
            }
        } else if (indexInBookmarks != -1) {
            if (indexInBookmarks < spaceBookmarks.length - 1) {
                chrome.tabs.update(spaceBookmarks[indexInBookmarks + 1], { active: true })
            } else if (temporaryTabs.length > 0) {
                chrome.tabs.update(temporaryTabs[0], { active: true })
            } else {
                chrome.tabs.update(spaceBookmarks[0], { active: true })
            }
        }
    },
    movToPrevTabInSpace: async function (tabId, sourceSpace) {


        const temporaryTabs = sourceSpace?.temporaryTabs ?? [];
        const spaceBookmarks = sourceSpace?.spaceBookmarks ?? [];

        const indexInTemporaryTabs = temporaryTabs.findIndex(id => id === tabId);
        const indexInBookmarks = spaceBookmarks.findIndex(id => id === tabId);

        if (indexInTemporaryTabs != -1) {
            if (indexInTemporaryTabs > 0) {
                chrome.tabs.update(temporaryTabs[indexInTemporaryTabs - 1], { active: true })
            } else if (spaceBookmarks.length > 0) {
                chrome.tabs.update(spaceBookmarks[spaceBookmarks.length - 1], { active: true })
            } else {
                chrome.tabs.update(temporaryTabs[temporaryTabs.length - 1], { active: true })
            }
        } else if (indexInBookmarks != -1) {
            if (indexInBookmarks > 0) {
                chrome.tabs.update(spaceBookmarks[indexInBookmarks - 1], { active: true })
            } else if (temporaryTabs.length > 0) {
                chrome.tabs.update(temporaryTabs[temporaryTabs.length - 1], { active: true })
            } else {
                chrome.tabs.update(spaceBookmarks[spaceBookmarks.length - 1], { active: true })
            }
        }
    },
    findActiveSpaceAndTab: async function () {
        console.log("[TabNavigation] finding space");
        const spacesResult = await chrome.storage.local.get('spaces');
        const spaces = spacesResult.spaces || [];
        console.log("[TabNavigation] Loaded spaces from storage:", spaces);
        const foundTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (foundTabs.length === 0) {
            console.log("[TabNavigation] No active tab found!:");
            return undefined;
        }
        const foundTab = foundTabs[0];
        const spaceWithTempTab = spaces.find(space =>
            space.temporaryTabs.includes(foundTab.id)
        );
        if (spaceWithTempTab) {
            console.log(`[TabNavigation] Tab ${foundTab.id} is a temporary tab in space "${spaceWithTempTab.name}".`);
            return { space: spaceWithTempTab, tab: foundTab };
        }

        const spaceWithBookmark = spaces.find(space =>
            space.spaceBookmarks.includes(foundTab.id)
        );
        if (spaceWithBookmark) {
            console.log(`[TabNavigation] Tab ${foundTab.id} is a bookmarked tab in space "${spaceWithBookmark.name}".`);
            return { space: spaceWithBookmark, tab: foundTab };
        }

        return undefined
    },

    // Helper function to adjust menu position to keep it within viewport
    adjustMenuPosition: function (menu, x, y) {
        // Ensure menu is in DOM to get dimensions
        if (!menu.isConnected) {
            console.warn('Menu must be in DOM to adjust position');
            return;
        }

        const rect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = x;
        let top = y;

        // Check right edge
        if (left + rect.width > viewportWidth) {
            left = viewportWidth - rect.width - 5; // 5px padding
        }

        // Check bottom edge
        if (top + rect.height > viewportHeight) {
            top = viewportHeight - rect.height - 5; // 5px padding
        }

        // Check left edge (unlikely but possible)
        if (left < 0) {
            left = 5;
        }

        // Check top edge
        if (top < 0) {
            top = 5;
        }

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }
}

export { Utils };
