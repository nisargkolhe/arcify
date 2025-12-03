// background-data-provider.js - Direct Chrome API implementation for background scripts

import { BaseDataProvider } from './base-data-provider.js';
import { AutocompleteProvider } from './autocomplete-provider.js';
import { BookmarkUtils } from '../../../bookmark-utils.js';
import { Logger } from '../../../logger.js';
import { PerformanceLogger } from '../../../performance-logger.js';

const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity';

export class BackgroundDataProvider extends BaseDataProvider {
    constructor() {
        super();
        this.autocompleteProvider = new AutocompleteProvider();
        // Mark this as a background provider for reliable detection in minified builds
        this.isBackgroundProvider = true;
        // Cache for pinned tabs data (30s TTL)
        this.pinnedTabsCache = null;
        this.pinnedTabsCacheTime = 0;
        this.PINNED_TABS_CACHE_TTL = 30000; // 30 seconds
    }
    
    // Only implement the small data fetchers using direct Chrome APIs
    
    async getOpenTabsData(query = '') {
        return await PerformanceLogger.measureAsync('dataProvider.getOpenTabsData', async () => {
            try {
                const tabs = await PerformanceLogger.measureAsync('dataProvider.tabs.query.all', () => 
                    chrome.tabs.query({}));
                
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
        }, { query });
    }

    async getRecentTabsData(limit = 5) {
        return await PerformanceLogger.measureAsync('dataProvider.getRecentTabsData', async () => {
            try {
                const [tabs, storage] = await Promise.all([
                    PerformanceLogger.measureAsync('dataProvider.tabs.query.recent', () => chrome.tabs.query({})),
                    PerformanceLogger.measureAsync('dataProvider.storage.local.get.activity', () => 
                        chrome.storage.local.get([TAB_ACTIVITY_STORAGE_KEY]))
                ]);
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
        }, { limit });
    }

    async getBookmarksData(query) {
        return await PerformanceLogger.measureAsync('dataProvider.getBookmarksData', () => 
            BookmarkUtils.getBookmarksData(query), { query });
    }

    isUnderArcifyFolder(bookmark, arcifyFolderId) {
        // Simple heuristic: check if the bookmark's parent path includes the Arcify folder
        // This is a simplified check - for a more robust solution, we'd need to traverse up the parent chain
        return bookmark.parentId && (bookmark.parentId === arcifyFolderId || 
               bookmark.parentId.startsWith(arcifyFolderId));
    }

    async getHistoryData(query) {
        return await PerformanceLogger.measureAsync('dataProvider.getHistoryData', async () => {
            try {
                const historyItems = await PerformanceLogger.measureAsync('dataProvider.history.search', () => 
                    chrome.history.search({
                        text: query,
                        maxResults: 10,
                        startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
                    }));
                return historyItems;
            } catch (error) {
                Logger.error('[BackgroundDataProvider] Error getting history:', error);
                return [];
            }
        }, { query });
    }

    async getTopSitesData() {
        return await PerformanceLogger.measureAsync('dataProvider.getTopSitesData', async () => {
            try {
                const topSites = await PerformanceLogger.measureAsync('dataProvider.topSites.get', () => 
                    chrome.topSites.get());
                return topSites;
            } catch (error) {
                Logger.error('[BackgroundDataProvider] Error getting top sites:', error);
                return [];
            }
        });
    }

    async getAutocompleteData(query) {
        return await PerformanceLogger.measureAsync('dataProvider.getAutocompleteData', async () => {
            try {
                return await this.autocompleteProvider.getAutocompleteSuggestions(query);
            } catch (error) {
                Logger.error('[BackgroundDataProvider] Error getting autocomplete data:', error);
                return [];
            }
        }, { query });
    }

    async getPinnedTabsData(query = '') {
        Logger.log('[BackgroundDataProvider] getPinnedTabsData called with query:', query);
        
        // Check cache first (only if query is empty, as cache is for default results)
        if (!query && this.pinnedTabsCache && (Date.now() - this.pinnedTabsCacheTime) < this.PINNED_TABS_CACHE_TTL) {
            Logger.log('[BackgroundDataProvider] Returning cached pinned tabs');
            return this.pinnedTabsCache;
        }
        
        return await PerformanceLogger.measureAsync('dataProvider.getPinnedTabsData', async () => {
            try {
                // Parallelize independent operations
                const [storageResult, tabs, arcifyFolder] = await Promise.all([
                    PerformanceLogger.measureAsync('dataProvider.storage.local.get.spaces', () => 
                        chrome.storage.local.get('spaces')),
                    PerformanceLogger.measureAsync('dataProvider.tabs.query.pinned', () => 
                        chrome.tabs.query({})),
                    PerformanceLogger.measureAsync('dataProvider.findArcifyFolder', () => 
                        BookmarkUtils.findArcifyFolder())
                ]);
                
                const spaces = storageResult.spaces || [];
                Logger.log('[BackgroundDataProvider] Found spaces:', spaces.length, spaces.map(s => s.name));
                Logger.log('[BackgroundDataProvider] Found tabs:', tabs.length);
                
                if (!arcifyFolder) {
                    Logger.log('[BackgroundDataProvider] No Arcify folder found');
                    return [];
                }
                Logger.log('[BackgroundDataProvider] Found Arcify folder:', arcifyFolder.id);

                const spaceFolders = await PerformanceLogger.measureAsync('dataProvider.bookmarks.getChildren.arcify', () => 
                    chrome.bookmarks.getChildren(arcifyFolder.id));
                Logger.log('[BackgroundDataProvider] Found space folders:', spaceFolders.length, spaceFolders.map(f => f.title));

                // Process each space folder in parallel
                const spacePromises = spaceFolders.map(async (spaceFolder) => {
                    const space = spaces.find(s => s.name === spaceFolder.title);
                    Logger.log('[BackgroundDataProvider] Processing space folder:', spaceFolder.title, 'found space:', !!space);
                    if (!space) return [];

                    // Get all bookmarks in this space folder (recursively)
                    const bookmarks = await PerformanceLogger.measureAsync(`dataProvider.getBookmarksFromFolderRecursive.${spaceFolder.id}`, () => 
                        BookmarkUtils.getBookmarksFromFolderRecursive(spaceFolder.id));
                    Logger.log('[BackgroundDataProvider] Found bookmarks in', spaceFolder.title, ':', bookmarks.length);
                    
                    const spacePinnedTabs = [];
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
                        spacePinnedTabs.push(pinnedTab);
                    }
                    return spacePinnedTabs;
                });
                
                const spaceResults = await Promise.all(spacePromises);
                const pinnedTabs = spaceResults.flat();

                // Cache result if query is empty
                if (!query) {
                    this.pinnedTabsCache = pinnedTabs;
                    this.pinnedTabsCacheTime = Date.now();
                }

                Logger.log('[BackgroundDataProvider] Returning', pinnedTabs.length, 'pinned tabs');
                return pinnedTabs;
            } catch (error) {
                Logger.error('[BackgroundDataProvider] Error getting pinned tabs data:', error);
                return [];
            }
        }, { query });
    }


}