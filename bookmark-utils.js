import { getSpaceTabs, spaceRequest } from './space-client.js';
/**
 * Bookmark Utils - Consolidated bookmark operations for Arcify Chrome Extension
 * 
 * Purpose: Centralized utilities for all bookmark-related operations to eliminate code duplication
 * Key Functions: Arcify folder management, recursive traversal, URL matching, bookmark operations
 * Architecture: Static utility class with consistent error handling and Chrome API abstraction
 * 
 * Critical Notes:
 * - Uses robust 3-method fallback approach for finding Arcify folder
 * - Provides unified recursive traversal with flexible options
 * - Centralizes URL matching logic with normalization
 * - Ensures consistent error handling across all bookmark operations
 * - Does not handle folder creation - defers to LocalStorage for that functionality
 */

import { Logger } from './logger.js';

export const BookmarkUtils = {

    /**
     * Robust method to find the Arcify folder in Chrome bookmarks
     * Uses 3-method fallback approach for maximum reliability across browsers/locales
     * @returns {Promise<Object|null>} The Arcify folder object or null if not found
     */
    async findArcifyFolder() {
        try {
            // Method 1: Try the standard search first (most common case)
            const searchResults = await chrome.bookmarks.search({ title: 'Arcify' });
            const arcifyViaSearch = searchResults?.find(result => !result.url);
            if (arcifyViaSearch) {
                Logger.log('[BookmarkUtils] Found Arcify folder via search:', arcifyViaSearch.id);
                return arcifyViaSearch;
            }

            // Method 2: Traverse the bookmark tree manually
            const rootChildren = await chrome.bookmarks.getChildren('0');
            for (const rootFolder of rootChildren) {
                try {
                    const children = await chrome.bookmarks.getChildren(rootFolder.id);
                    const arcifyFolder = children.find(child => child.title === 'Arcify' && !child.url);
                    if (arcifyFolder) {
                        Logger.log('[BookmarkUtils] Found Arcify folder in', rootFolder.title);
                        return arcifyFolder;
                    }
                } catch {
                    continue;
                }
            }

            // Method 3: Check "Other Bookmarks" specifically (handles locale variations)
            const otherBookmarksFolder = rootChildren.find(folder =>
                folder.id === '2' ||
                folder.title.toLowerCase().includes('other') ||
                folder.title.toLowerCase().includes('bookmark')
            );

            if (otherBookmarksFolder) {
                try {
                    const children = await chrome.bookmarks.getChildren(otherBookmarksFolder.id);
                    const arcifyFolder = children.find(child => child.title === 'Arcify' && !child.url);
                    if (arcifyFolder) {
                        Logger.log('[BookmarkUtils] Found Arcify folder in Other Bookmarks');
                        return arcifyFolder;
                    }
                } catch {
                    // Ignore error
                }
            }

            Logger.log('[BookmarkUtils] Arcify folder not found');
            return null;

        } catch (error) {
            Logger.error('[BookmarkUtils] Error in findArcifyFolder:', error);
            return null;
        }
    },


    /**
     * Recursively get all bookmarks from a folder and its subfolders
     * @param {string} folderId - ID of the folder to search
     * @param {Object} options - Options for filtering and processing
     * @param {boolean} options.includeTabIds - Whether to include tab IDs for matching tabs
     * @param {string} options.spaceId - Space ID to match tabs against (if includeTabIds is true)
     * @returns {Promise<Array>} Array of bookmark objects
     */
    async getBookmarksFromFolderRecursive(folderId, options = {}) {
        const { includeTabIds = false, spaceId = null } = options;
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folderId);

        // Get tabs once if needed for matching
        let tabs = [];
        if (includeTabIds && spaceId !== null) {
            tabs = await getSpaceTabs(spaceId);
        }

        for (const item of items) {
            if (item.url) {
                // This is a bookmark
                const bookmarkData = {
                    id: item.id,
                    title: item.title,
                    url: item.url
                };

                // Add tab ID if requested and found
                if (includeTabIds && tabs.length > 0) {
                    const matchingTab = tabs.find(t => t.url === item.url);
                    if (matchingTab) {
                        bookmarkData.tabId = matchingTab.id;
                    }
                }

                bookmarks.push(bookmarkData);
            } else {
                // This is a folder, recursively get bookmarks
                const subBookmarks = await this.getBookmarksFromFolderRecursive(item.id, options);
                bookmarks.push(...subBookmarks);
            }
        }

        return bookmarks;
    },

    /**
     * Open bookmark as active tab, handling all UI updates and data management
     * @param {Object} bookmarkData - Bookmark data object
     * @param {string} bookmarkData.url - Bookmark URL
     * @param {string} bookmarkData.title - Bookmark title
     * @param {string} bookmarkData.spaceName - Space name the bookmark belongs to
     * @param {string} targetSpaceId - Space ID to open the tab in
     * @param {HTMLElement} replaceElement - DOM element to replace with active tab element (optional)
     * @param {Object} context - Context object with required functions and data
     * @returns {Object} The created Chrome tab object
     */
    async openBookmarkAsTab(bookmarkData, targetSpaceId, replaceElement = null, context, isPinned) {
        const {
            spaces,
            activeSpaceId,
            currentWindow,
            saveSpaces,
            createTabElement,
            activateTabInDOM,
            Utils,
            persistSpaceTabOrder
        } = context;

        Logger.log('[BookmarkUtils] Opening bookmark as tab:', bookmarkData.url, targetSpaceId);

        // Create the bookmark tab and assign its target space
        const newTab = await chrome.tabs.create({
            url: bookmarkData.url,
            active: true,
            windowId: currentWindow.id
        });

        // If bookmark has a custom name, set tab name override
        if (bookmarkData.title && newTab.title !== bookmarkData.title) {
            await Utils.setTabNameOverride(newTab.id, bookmarkData.url, bookmarkData.title);
        }

        if (isPinned) {
            // Track pinned URL/bookmarkId for Arc-like "Back to Pinned URL" behavior.
            if (Utils && typeof Utils.setPinnedTabState === 'function') {
                await Utils.setPinnedTabState(newTab.id, {
                    pinnedUrl: bookmarkData.url,
                    bookmarkId: bookmarkData.bookmarkId || null
                });
            }
        }

        // Assign the new tab in extension storage
        await spaceRequest('assign', { tabId: newTab.id, spaceId: targetSpaceId, pinned: isPinned });
        for (const space of spaces) {
            space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== newTab.id);
            space.temporaryTabs = space.temporaryTabs.filter(id => id !== newTab.id);
        }
        if (!isPinned) {
            spaces.find(s => s.id === targetSpaceId)?.temporaryTabs.push(newTab.id);
            await saveSpaces();
        }

        if (isPinned) {
            // Update space data - add to spaceBookmarks for pinned tabs
            const space = spaces.find(s => s.id === targetSpaceId);
            if (space) {
                if (!space.spaceBookmarks.includes(newTab.id)) {
                    space.spaceBookmarks.push(newTab.id);
                }
                saveSpaces();
            }
        }

        // Persist the bookmark section order independently of the native tab strip.
        if (typeof persistSpaceTabOrder === 'function') {
            await persistSpaceTabOrder(targetSpaceId, { source: 'arcify', movedTabId: newTab.id });
        }

        // Replace bookmark-only element with active tab element if provided
        if (replaceElement && createTabElement) {
            const activeTabData = {
                id: newTab.id,
                title: bookmarkData.title,
                url: bookmarkData.url,
                favIconUrl: newTab.favIconUrl,
                spaceName: bookmarkData.spaceName,
                pinnedUrl: bookmarkData.url,
                bookmarkId: bookmarkData.bookmarkId || null
            };
            const activeTabElement = await createTabElement(activeTabData, true, false);
            activeTabElement.classList.add('active');
            replaceElement.replaceWith(activeTabElement);
        }

        // Ensure the tab is actually active
        await chrome.tabs.update(newTab.id, { active: true });

        // Visually activate the tab
        if (activateTabInDOM) {
            activateTabInDOM(newTab.id);
        }

        Logger.log('[BookmarkUtils] Successfully opened bookmark as tab:', newTab.id);
        return newTab;
    },

    /**
     * Match tabs with bookmarks in a folder and return tab IDs
     * Processes bookmark folder recursively and finds corresponding tabs
     * @param {Object} folder - Bookmark folder object
     * @param {string} spaceId - Space ID to match against
     * @param {Function} setTabNameOverride - Function to set tab name overrides
     * @param {Function} setPinnedTabState - Function to persist tab->bookmark binding
     * @param {Set} claimedTabIds - Tab IDs already bound to a bookmark in this run (shared across recursion)
     * @returns {Promise<Array>} Array of tab IDs that match bookmarks
     */
    async matchTabsWithBookmarks(folder, spaceId, setTabNameOverride = null, setPinnedTabState = null, claimedTabIds = null, getUrlKey = null, windowId = null) {
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folder.id);
        const { spaces = [] } = await chrome.storage.local.get('spaces');
        const pinnedIds = new Set(spaces.find(s => s.id === spaceId)?.spaceBookmarks || []);
        const tabs = (await getSpaceTabs(spaceId)).filter(tab => !tab.pinned && pinnedIds.has(tab.id) && (windowId === null || tab.windowId === windowId));
        const claimed = claimedTabIds || new Set();
        const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');

        for (const item of items) {
            if (item.url) {
                // This is a bookmark. Pick the first matching tab that hasn't already
                // been bound to another bookmark in this run, so URL twins don't both
                // get claimed by a single bookmark.
                const available = tabs.filter(t => !claimed.has(t.id));
                let tab = available.find(t => pinnedTabStatesById[t.id]?.bookmarkId === item.id)
                    || available.find(t => t.url === item.url && !pinnedTabStatesById[t.id]?.bookmarkId);
                // Legacy recovery is limited to already-pinned members without a binding.
                // Ordinary temporary tabs must never be promoted by a matching URL.
                if (!tab && getUrlKey) {
                    const targetKey = getUrlKey(item.url);
                    tab = available.find(t => !pinnedTabStatesById[t.id]?.bookmarkId && getUrlKey(t.url) === targetKey);
                }
                if (tab) {
                    claimed.add(tab.id);
                    bookmarks.push(tab.id);
                    // Set tab name override with the bookmark's title if needed
                    if (item.title && item.title !== tab.title && setTabNameOverride) {
                        await setTabNameOverride(tab.id, tab.url, item.title);
                        Logger.log(`[BookmarkUtils] Override set for tab ${tab.id} from bookmark: ${item.title}`);
                    }
                    // Persist tab->bookmark binding so the renderer's primary matcher
                    // (byBookmarkId) survives across sessions and isn't displaced by
                    // newly opened URL twins.
                    if (setPinnedTabState) {
                        await setPinnedTabState(tab.id, { pinnedUrl: item.url, bookmarkId: item.id });
                    }
                }
            } else {
                // This is a folder, recursively process it
                const subFolderBookmarks = await this.matchTabsWithBookmarks(item, spaceId, setTabNameOverride, setPinnedTabState, claimed, getUrlKey, windowId);
                bookmarks.push(...subFolderBookmarks);
            }
        }

        return bookmarks;
    },

    /**
     * Check if a bookmark is under the Arcify folder hierarchy
     * @param {Object} bookmark - Bookmark object
     * @param {string} arcifyFolderId - Arcify folder ID
     * @returns {boolean} True if bookmark is under Arcify folder
     */
    isUnderArcifyFolder(bookmark, arcifyFolderId) {
        // Simple heuristic: check if the bookmark's parent path includes the Arcify folder
        // This is a simplified check - for a more robust solution, we'd need to traverse up the parent chain
        return bookmark.parentId && (bookmark.parentId === arcifyFolderId ||
            bookmark.parentId.startsWith(arcifyFolderId));
    },

    /**
     * Get bookmarks data with Arcify folder exclusion
     * @param {string} query - Search query
     * @returns {Promise<Array>} Filtered bookmarks array
     */
    async getBookmarksData(query) {
        try {
            const bookmarks = await chrome.bookmarks.search(query);

            // Get Arcify folder to exclude its bookmarks from regular bookmark search
            let arcifyFolderId = null;
            try {
                const arcifyFolder = await this.findArcifyFolder();
                if (arcifyFolder) {
                    arcifyFolderId = arcifyFolder.id;
                }
            } catch (error) {
                // Ignore error if Arcify folder doesn't exist
            }

            // Filter out Arcify bookmarks and keep only bookmarks with URLs
            const filteredBookmarks = bookmarks.filter(bookmark => {
                if (!bookmark.url) return false;

                // Exclude bookmarks that are under Arcify folder
                if (arcifyFolderId && this.isUnderArcifyFolder(bookmark, arcifyFolderId)) {
                    return false;
                }

                return true;
            });

            return filteredBookmarks;
        } catch (error) {
            Logger.error('[BookmarkUtils] Error getting bookmarks:', error);
            return [];
        }
    }
};
