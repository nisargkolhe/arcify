// background-data-provider.js - Direct Chrome API implementation for background scripts

import { BaseDataProvider } from './base-data-provider.js';
import { AutocompleteProvider } from './autocomplete-provider.js';

const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity';

export class BackgroundDataProvider extends BaseDataProvider {
    constructor() {
        super();
        this.autocompleteProvider = new AutocompleteProvider();
    }
    
    // Only implement the small data fetchers using direct Chrome APIs
    
    async getOpenTabsData(query = '') {
        try {
            const tabs = await chrome.tabs.query({});
            
            const filteredTabs = tabs.filter(tab => {
                if (!tab.title || !tab.url) return false;
                if (!query) return true;
                return tab.title.toLowerCase().includes(query.toLowerCase()) || 
                       tab.url.toLowerCase().includes(query.toLowerCase());
            });
            
            return filteredTabs;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error querying tabs:', error);
            return [];
        }
    }

    async getRecentTabsData(limit = 5) {
        try {
            const tabs = await chrome.tabs.query({});
            const storage = await chrome.storage.local.get([TAB_ACTIVITY_STORAGE_KEY]);
            const activityData = storage[TAB_ACTIVITY_STORAGE_KEY] || {};
            
            const recentTabs = tabs
                .filter(tab => tab.url && tab.title)
                .map(tab => ({
                    ...tab,
                    lastActivity: activityData[tab.id] || 0
                }))
                .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                .slice(0, limit);
                
            return recentTabs;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting recent tabs:', error);
            return [];
        }
    }

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
            console.error('[BackgroundDataProvider] Error getting bookmarks:', error);
            return [];
        }
    }

    isUnderArcifyFolder(bookmark, arcifyFolderId) {
        // Simple heuristic: check if the bookmark's parent path includes the Arcify folder
        // This is a simplified check - for a more robust solution, we'd need to traverse up the parent chain
        return bookmark.parentId && (bookmark.parentId === arcifyFolderId || 
               bookmark.parentId.startsWith(arcifyFolderId));
    }

    async getHistoryData(query) {
        try {
            const historyItems = await chrome.history.search({
                text: query,
                maxResults: 10,
                startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
            });
            return historyItems;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting history:', error);
            return [];
        }
    }

    async getTopSitesData() {
        try {
            const topSites = await chrome.topSites.get();
            return topSites;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting top sites:', error);
            return [];
        }
    }

    async getAutocompleteData(query) {
        try {
            return await this.autocompleteProvider.getAutocompleteSuggestions(query);
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting autocomplete data:', error);
            return [];
        }
    }

    async getPinnedTabsData(query = '') {
        console.log('[BackgroundDataProvider] getPinnedTabsData called with query:', query);
        try {
            // Get spaces from storage
            const storage = await chrome.storage.local.get('spaces');
            const spaces = storage.spaces || [];
            console.log('[BackgroundDataProvider] Found spaces:', spaces.length, spaces.map(s => s.name));
            
            // Get current tabs
            const tabs = await chrome.tabs.query({});
            console.log('[BackgroundDataProvider] Found tabs:', tabs.length);
            
            // Get Arcify folder structure using robust method
            const arcifyFolder = await this.findArcifyFolder();
            if (!arcifyFolder) {
                console.log('[BackgroundDataProvider] No Arcify folder found');
                return [];
            }
            console.log('[BackgroundDataProvider] Found Arcify folder:', arcifyFolder.id);

            const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            console.log('[BackgroundDataProvider] Found space folders:', spaceFolders.length, spaceFolders.map(f => f.title));
            const pinnedTabs = [];

            // Process each space folder
            for (const spaceFolder of spaceFolders) {
                const space = spaces.find(s => s.name === spaceFolder.title);
                console.log('[BackgroundDataProvider] Processing space folder:', spaceFolder.title, 'found space:', !!space);
                if (!space) continue;

                // Get all bookmarks in this space folder (recursively)
                const bookmarks = await this.getBookmarksFromFolder(spaceFolder.id);
                console.log('[BackgroundDataProvider] Found bookmarks in', spaceFolder.title, ':', bookmarks.length);
                
                for (const bookmark of bookmarks) {
                    // Check if there's a matching open tab
                    const matchingTab = tabs.find(tab => tab.url === bookmark.url);
                    console.log('[BackgroundDataProvider] Processing bookmark:', bookmark.title, 'matching tab:', !!matchingTab);
                    
                    // Apply query filter
                    if (query) {
                        const queryLower = query.toLowerCase();
                        const titleMatch = bookmark.title.toLowerCase().includes(queryLower);
                        const urlMatch = bookmark.url.toLowerCase().includes(queryLower);
                        if (!titleMatch && !urlMatch) {
                            console.log('[BackgroundDataProvider] Bookmark filtered out by query:', bookmark.title);
                            continue;
                        }
                    }

                    const pinnedTab = {
                        ...bookmark,
                        spaceId: space.id,
                        spaceName: space.name,
                        spaceColor: space.color,
                        tabId: matchingTab?.id || null,
                        isActive: !!matchingTab
                    };
                    console.log('[BackgroundDataProvider] Adding pinned tab:', pinnedTab);
                    pinnedTabs.push(pinnedTab);
                }
            }

            console.log('[BackgroundDataProvider] Returning', pinnedTabs.length, 'pinned tabs');
            return pinnedTabs;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting pinned tabs data:', error);
            return [];
        }
    }

    async getBookmarksFromFolder(folderId) {
        const bookmarks = [];
        const items = await chrome.bookmarks.getChildren(folderId);
        
        for (const item of items) {
            if (item.url) {
                // This is a bookmark
                bookmarks.push({
                    id: item.id,
                    title: item.title,
                    url: item.url
                });
            } else {
                // This is a folder, recursively get bookmarks
                const subBookmarks = await this.getBookmarksFromFolder(item.id);
                bookmarks.push(...subBookmarks);
            }
        }
        
        return bookmarks;
    }

    /**
     * Robust method to find the Arcify folder in Chrome bookmarks
     * This method handles various edge cases and provides better error handling
     */
    async findArcifyFolder() {
        console.log('[BackgroundDataProvider] Finding Arcify folder...');
        
        try {
            // Method 1: Try the standard search first (this should work in most cases)
            console.log('[BackgroundDataProvider] Method 1: Searching for Arcify folder by title...');
            const searchResults = await chrome.bookmarks.search({ title: 'Arcify' });
            
            if (searchResults && searchResults.length > 0) {
                // Verify this is actually a folder (not a bookmark)
                const arcifyFolder = searchResults.find(result => !result.url);
                if (arcifyFolder) {
                    console.log('[BackgroundDataProvider] Found Arcify folder via search:', arcifyFolder.id);
                    return arcifyFolder;
                }
            }
            
            console.log('[BackgroundDataProvider] Method 1 failed, trying Method 2: Traversing bookmark tree...');
            
            // Method 2: Traverse the bookmark tree manually
            // This is more reliable as it doesn't depend on search functionality
            const rootChildren = await chrome.bookmarks.getChildren('0');
            console.log('[BackgroundDataProvider] Root folders found:', rootChildren.map(child => ({ id: child.id, title: child.title })));
            
            // Check each root folder for Arcify folder
            for (const rootFolder of rootChildren) {
                console.log(`[BackgroundDataProvider] Checking folder: ${rootFolder.title} (ID: ${rootFolder.id})`);
                
                try {
                    const children = await chrome.bookmarks.getChildren(rootFolder.id);
                    const arcifyFolder = children.find(child => child.title === 'Arcify' && !child.url);
                    
                    if (arcifyFolder) {
                        console.log(`[BackgroundDataProvider] Found Arcify folder in ${rootFolder.title}:`, arcifyFolder.id);
                        return arcifyFolder;
                    }
                } catch (error) {
                    console.warn(`[BackgroundDataProvider] Error checking folder ${rootFolder.title}:`, error);
                    continue;
                }
            }
            
            // Method 3: Try to find by checking "Other Bookmarks" specifically
            console.log('[BackgroundDataProvider] Method 2 failed, trying Method 3: Check Other Bookmarks specifically...');
            
            // Find "Other Bookmarks" folder - it could have different names in different locales
            const otherBookmarksFolder = rootChildren.find(folder => 
                folder.id === '2' || // Standard ID for Other Bookmarks
                folder.title.toLowerCase().includes('other') ||
                folder.title.toLowerCase().includes('bookmark')
            );
            
            if (otherBookmarksFolder) {
                console.log(`[BackgroundDataProvider] Found Other Bookmarks folder: ${otherBookmarksFolder.title} (ID: ${otherBookmarksFolder.id})`);
                
                try {
                    const otherBookmarksChildren = await chrome.bookmarks.getChildren(otherBookmarksFolder.id);
                    const arcifyFolder = otherBookmarksChildren.find(child => child.title === 'Arcify' && !child.url);
                    
                    if (arcifyFolder) {
                        console.log('[BackgroundDataProvider] Found Arcify folder in Other Bookmarks:', arcifyFolder.id);
                        return arcifyFolder;
                    }
                } catch (error) {
                    console.warn('[BackgroundDataProvider] Error checking Other Bookmarks folder:', error);
                }
            }
            
            console.log('[BackgroundDataProvider] All methods failed - Arcify folder not found');
            return null;
            
        } catch (error) {
            console.error('[BackgroundDataProvider] Error in findArcifyFolder:', error);
            return null;
        }
    }
}