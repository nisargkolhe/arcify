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

export const BookmarkUtils = {
    
    /**
     * Robust method to find the Arcify folder in Chrome bookmarks
     * Uses 3-method fallback approach for maximum reliability across browsers/locales
     * @returns {Promise<Object|null>} The Arcify folder object or null if not found
     */
    async findArcifyFolder() {
        console.log('[BookmarkUtils] Finding Arcify folder...');
        
        try {
            // Method 1: Try the standard search first (this should work in most cases)
            console.log('[BookmarkUtils] Method 1: Searching for Arcify folder by title...');
            const searchResults = await chrome.bookmarks.search({ title: 'Arcify' });
            
            if (searchResults && searchResults.length > 0) {
                // Verify this is actually a folder (not a bookmark)
                const arcifyFolder = searchResults.find(result => !result.url);
                if (arcifyFolder) {
                    console.log('[BookmarkUtils] Found Arcify folder via search:', arcifyFolder.id);
                    return arcifyFolder;
                }
            }
            
            console.log('[BookmarkUtils] Method 1 failed, trying Method 2: Traversing bookmark tree...');
            
            // Method 2: Traverse the bookmark tree manually
            // This is more reliable as it doesn't depend on search functionality
            const rootChildren = await chrome.bookmarks.getChildren('0');
            console.log('[BookmarkUtils] Root folders found:', rootChildren.map(child => ({ id: child.id, title: child.title })));
            
            // Check each root folder for Arcify folder
            for (const rootFolder of rootChildren) {
                console.log(`[BookmarkUtils] Checking folder: ${rootFolder.title} (ID: ${rootFolder.id})`);
                
                try {
                    const children = await chrome.bookmarks.getChildren(rootFolder.id);
                    const arcifyFolder = children.find(child => child.title === 'Arcify' && !child.url);
                    
                    if (arcifyFolder) {
                        console.log(`[BookmarkUtils] Found Arcify folder in ${rootFolder.title}:`, arcifyFolder.id);
                        return arcifyFolder;
                    }
                } catch (error) {
                    console.warn(`[BookmarkUtils] Error checking folder ${rootFolder.title}:`, error);
                    continue;
                }
            }
            
            // Method 3: Try to find by checking "Other Bookmarks" specifically
            console.log('[BookmarkUtils] Method 2 failed, trying Method 3: Check Other Bookmarks specifically...');
            
            // Find "Other Bookmarks" folder - it could have different names in different locales
            const otherBookmarksFolder = rootChildren.find(folder => 
                folder.id === '2' || // Standard ID for Other Bookmarks
                folder.title.toLowerCase().includes('other') ||
                folder.title.toLowerCase().includes('bookmark')
            );
            
            if (otherBookmarksFolder) {
                console.log(`[BookmarkUtils] Found Other Bookmarks folder: ${otherBookmarksFolder.title} (ID: ${otherBookmarksFolder.id})`);
                
                try {
                    const otherBookmarksChildren = await chrome.bookmarks.getChildren(otherBookmarksFolder.id);
                    const arcifyFolder = otherBookmarksChildren.find(child => child.title === 'Arcify' && !child.url);
                    
                    if (arcifyFolder) {
                        console.log('[BookmarkUtils] Found Arcify folder in Other Bookmarks:', arcifyFolder.id);
                        return arcifyFolder;
                    }
                } catch (error) {
                    console.warn('[BookmarkUtils] Error checking Other Bookmarks folder:', error);
                }
            }
            
            console.log('[BookmarkUtils] All methods failed - Arcify folder not found');
            return null;
            
        } catch (error) {
            console.error('[BookmarkUtils] Error in findArcifyFolder:', error);
            return null;
        }
    },


    /**
     * Recursively get all bookmarks from a folder and its subfolders
     * @param {string} folderId - ID of the folder to search
     * @param {Object} options - Options for filtering and processing
     * @param {boolean} options.includeTabIds - Whether to include tab IDs for matching tabs
     * @param {number} options.groupId - Group ID to match tabs against (if includeTabIds is true)
     * @returns {Promise<Array>} Array of bookmark objects
     */
    async getBookmarksFromFolderRecursive(folderId, options = {}) {
        const { includeTabIds = false, groupId = null } = options;
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folderId);
        
        // Get tabs once if needed for matching
        let tabs = [];
        if (includeTabIds && groupId !== null) {
            tabs = await chrome.tabs.query({ groupId: groupId });
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
     * Find a bookmark by URL in an array of bookmarks
     * @param {Array} bookmarks - Array of bookmark objects
     * @param {string} url - URL to search for
     * @returns {Object|null} The matching bookmark or null
     */
    findBookmarkByUrl(bookmarks, url) {
        if (!bookmarks || !url) return null;
        
        return bookmarks.find(b => {
            if (!b.url) return false;
            return b.url === url;
        }) || null;
    },

    /**
     * Find a tab by URL in an array of tabs
     * @param {Array} tabs - Array of tab objects
     * @param {string} url - URL to search for
     * @returns {Object|null} The matching tab or null
     */
    findTabByUrl(tabs, url) {
        if (!tabs || !url) return null;
        
        return tabs.find(t => {
            if (!t.url) return false;
            return t.url === url;
        }) || null;
    },

    /**
     * Open bookmark as active tab, handling all UI updates and data management
     * @param {Object} bookmarkData - Bookmark data object
     * @param {string} bookmarkData.url - Bookmark URL
     * @param {string} bookmarkData.title - Bookmark title
     * @param {string} bookmarkData.spaceName - Space name the bookmark belongs to
     * @param {number} targetSpaceId - Space ID to open the tab in
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
            Utils 
        } = context;

        console.log('[BookmarkUtils] Opening bookmark as tab:', bookmarkData.url, targetSpaceId);

        // Create new tab with bookmark URL in the target group
        const newTab = await chrome.tabs.create({
            url: bookmarkData.url,
            active: true,
            windowId: currentWindow.id
        });

        // If bookmark has a custom name, set tab name override
        if (bookmarkData.title && newTab.title !== bookmarkData.title) {
            await Utils.setTabNameOverride(newTab.id, bookmarkData.url, bookmarkData.title);
        }

        // Immediately group the new tab
        await chrome.tabs.group({ tabIds: [newTab.id], groupId: targetSpaceId });

        if (isPinned) {
            // Update space data - add to spaceBookmarks for pinned tabs
            const space = spaces.find(s => s.id === targetSpaceId);
            if (space) {
                space.spaceBookmarks.push(newTab.id);
                saveSpaces();
            }
        }

        // Replace bookmark-only element with active tab element if provided
        if (replaceElement && createTabElement) {
            const activeTabData = {
                id: newTab.id,
                title: bookmarkData.title,
                url: bookmarkData.url,
                favIconUrl: newTab.favIconUrl,
                spaceName: bookmarkData.spaceName
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

        console.log('[BookmarkUtils] Successfully opened bookmark as tab:', newTab.id);
        return newTab;
    },

    /**
     * Search and remove bookmark by URL from a folder structure recursively
     * @param {string} folderId - ID of the folder to search in
     * @param {string} tabUrl - URL of the bookmark to remove
     * @param {Object} options - Options for the removal operation
     * @param {boolean} options.removeTabElement - Whether to also remove the tab element from DOM
     * @param {Element} options.tabElement - The tab element to remove if removeTabElement is true
     * @param {boolean} options.logRemoval - Whether to log the removal
     * @returns {Promise<boolean>} True if bookmark was found and removed
     */
    async removeBookmarkByUrl(folderId, tabUrl, options = {}) {
        const {
            removeTabElement = false,
            tabElement = null,
            logRemoval = false
        } = options;

        const items = await chrome.bookmarks.getChildren(folderId);
        for (const item of items) {
            if (item.url === tabUrl) {
                if (logRemoval) {
                    console.log('[BookmarkUtils] Removing bookmark:', item);
                }
                await chrome.bookmarks.remove(item.id);
                
                if (removeTabElement && tabElement) {
                    tabElement.remove();
                }
                
                return true; // Bookmark found and removed
            } else if (!item.url) {
                // This is a folder, search recursively
                const found = await this.removeBookmarkByUrl(item.id, tabUrl, options);
                if (found) return true;
            }
        }
        return false; // Bookmark not found
    },

    /**
     * Match tabs with bookmarks in a folder and return tab IDs
     * Processes bookmark folder recursively and finds corresponding tabs
     * @param {Object} folder - Bookmark folder object
     * @param {number} groupId - Tab group ID to match against
     * @param {Function} setTabNameOverride - Function to set tab name overrides
     * @returns {Promise<Array>} Array of tab IDs that match bookmarks
     */
    async matchTabsWithBookmarks(folder, groupId, setTabNameOverride = null) {
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folder.id);
        const tabs = await chrome.tabs.query({ groupId: groupId });
        
        for (const item of items) {
            if (item.url) {
                // This is a bookmark
                const tab = tabs.find(t => t.url === item.url);
                if (tab) {
                    bookmarks.push(tab.id);
                    // Set tab name override with the bookmark's title if needed
                    if (item.title && item.title !== tab.title && setTabNameOverride) {
                        await setTabNameOverride(tab.id, tab.url, item.title);
                        console.log(`[BookmarkUtils] Override set for tab ${tab.id} from bookmark: ${item.title}`);
                    }
                }
            } else {
                // This is a folder, recursively process it
                const subFolderBookmarks = await this.matchTabsWithBookmarks(item, groupId, setTabNameOverride);
                bookmarks.push(...subFolderBookmarks);
            }
        }
        
        return bookmarks;
    },

    /**
     * Update bookmark title if needed (recursive search and update)
     * @param {Object} tab - Tab object
     * @param {Object} activeSpace - Active space object
     * @param {string} newTitle - New title to set
     * @returns {Promise<boolean>} True if bookmark was found and updated
     */
    async updateBookmarkTitle(tab, activeSpace, newTitle) {    
        console.log(`[BookmarkUtils] Attempting to update bookmark for tab ${tab.id} in space ${activeSpace.name} to title: ${newTitle}`);
    
        try {
            // Find the space folder - don't create it, that's LocalStorage's responsibility
            const arcifyFolder = await this.findArcifyFolder();
            if (!arcifyFolder) {
                console.error(`[BookmarkUtils] Arcify folder not found for space ${activeSpace.name}.`);
                return false;
            }
            
            const children = await chrome.bookmarks.getChildren(arcifyFolder.id);
            const spaceFolder = children.find(f => f.title === activeSpace.name && !f.url);
            
            if (!spaceFolder) {
                console.error(`[BookmarkUtils] Space folder ${activeSpace.name} not found.`);
                return false;
            }
    
            // Recursive function to find and update the bookmark
            const findAndUpdate = async (folderId) => {
                const items = await chrome.bookmarks.getChildren(folderId);
                for (const item of items) {
                    if (item.url && item.url === tab.url) {
                        // Found the bookmark
                        // Avoid unnecessary updates if title is already correct
                        if (item.title !== newTitle) {
                            console.log(`[BookmarkUtils] Found bookmark ${item.id} for URL ${tab.url}. Updating title to "${newTitle}"`);
                            await chrome.bookmarks.update(item.id, { title: newTitle });
                        } else {
                            console.log(`[BookmarkUtils] Bookmark ${item.id} title already matches "${newTitle}". Skipping update.`);
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
                console.log(`[BookmarkUtils] Bookmark for URL ${tab.url} not found in space folder ${activeSpace.name}.`);
            }
    
            return updated;
        } catch (error) {
            console.error(`[BookmarkUtils] Error updating bookmark for tab ${tab.id}:`, error);
            return false;
        }
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
            console.error('[BookmarkUtils] Error getting bookmarks:', error);
            return [];
        }
    }
};