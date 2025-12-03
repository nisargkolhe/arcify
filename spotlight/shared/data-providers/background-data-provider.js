// background-data-provider.js - Direct Chrome API implementation for background scripts

import { BaseDataProvider } from './base-data-provider.js';
import { AutocompleteProvider } from './autocomplete-provider.js';
import { BookmarkUtils } from '../../../bookmark-utils.js';
import { Logger } from '../../../logger.js';

const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity';

export class BackgroundDataProvider extends BaseDataProvider {
    constructor() {
        super();
        this.autocompleteProvider = new AutocompleteProvider();
        // Mark this as a background provider for reliable detection in minified builds
        this.isBackgroundProvider = true;
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
            Logger.error('[BackgroundDataProvider] Error querying tabs:', error);
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
            Logger.error('[BackgroundDataProvider] Error getting recent tabs:', error);
            return [];
        }
    }

    async getBookmarksData(query) {
        return await BookmarkUtils.getBookmarksData(query);
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
            Logger.error('[BackgroundDataProvider] Error getting history:', error);
            return [];
        }
    }

    async getTopSitesData() {
        try {
            const topSites = await chrome.topSites.get();
            return topSites;
        } catch (error) {
            Logger.error('[BackgroundDataProvider] Error getting top sites:', error);
            return [];
        }
    }

    async getAutocompleteData(query) {
        try {
            return await this.autocompleteProvider.getAutocompleteSuggestions(query);
        } catch (error) {
            Logger.error('[BackgroundDataProvider] Error getting autocomplete data:', error);
            return [];
        }
    }

    async getPinnedTabsData(query = '') {
        Logger.log('[BackgroundDataProvider] getPinnedTabsData called with query:', query);
        try {
            // Get spaces from storage
            const storage = await chrome.storage.local.get('spaces');
            const spaces = storage.spaces || [];
            Logger.log('[BackgroundDataProvider] Found spaces:', spaces.length, spaces.map(s => s.name));
            
            // Get current tabs
            const tabs = await chrome.tabs.query({});
            Logger.log('[BackgroundDataProvider] Found tabs:', tabs.length);
            
            // Get Arcify folder structure using robust method
            const arcifyFolder = await BookmarkUtils.findArcifyFolder();
            if (!arcifyFolder) {
                Logger.log('[BackgroundDataProvider] No Arcify folder found');
                return [];
            }
            Logger.log('[BackgroundDataProvider] Found Arcify folder:', arcifyFolder.id);

            const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            Logger.log('[BackgroundDataProvider] Found space folders:', spaceFolders.length, spaceFolders.map(f => f.title));
            const pinnedTabs = [];

            // Process each space folder
            for (const spaceFolder of spaceFolders) {
                const space = spaces.find(s => s.name === spaceFolder.title);
                Logger.log('[BackgroundDataProvider] Processing space folder:', spaceFolder.title, 'found space:', !!space);
                if (!space) continue;

                // Get all bookmarks in this space folder (recursively)
                const bookmarks = await BookmarkUtils.getBookmarksFromFolderRecursive(spaceFolder.id);
                Logger.log('[BackgroundDataProvider] Found bookmarks in', spaceFolder.title, ':', bookmarks.length);
                
                for (const bookmark of bookmarks) {
                    // Check if there's a matching open tab
                    const matchingTab = BookmarkUtils.findTabByUrl(tabs, bookmark.url);
                    Logger.log('[BackgroundDataProvider] Processing bookmark:', bookmark.title, 'matching tab:', !!matchingTab);
                    
                    // Apply query filter
                    if (query) {
                        const queryLower = query.toLowerCase();
                        const titleMatch = bookmark.title.toLowerCase().includes(queryLower);
                        const urlMatch = bookmark.url.toLowerCase().includes(queryLower);
                        if (!titleMatch && !urlMatch) {
                            Logger.log('[BackgroundDataProvider] Bookmark filtered out by query:', bookmark.title);
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
                    Logger.log('[BackgroundDataProvider] Adding pinned tab:', pinnedTab);
                    pinnedTabs.push(pinnedTab);
                }
            }

            Logger.log('[BackgroundDataProvider] Returning', pinnedTabs.length, 'pinned tabs');
            return pinnedTabs;
        } catch (error) {
            Logger.error('[BackgroundDataProvider] Error getting pinned tabs data:', error);
            return [];
        }
    }


}