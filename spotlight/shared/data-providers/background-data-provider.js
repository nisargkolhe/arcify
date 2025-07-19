// background-data-provider.js - Direct Chrome API implementation for background scripts

import { BaseDataProvider } from './base-data-provider.js';

const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity';

export class BackgroundDataProvider extends BaseDataProvider {
    // Only implement the small data fetchers using direct Chrome APIs
    
    async getOpenTabsData(query = '') {
        try {
            console.log('[BackgroundDataProvider] Getting tabs with query:', query);
            const tabs = await chrome.tabs.query({});
            console.log('[BackgroundDataProvider] Raw tabs received:', tabs.length);
            
            const filteredTabs = tabs.filter(tab => {
                if (!tab.title || !tab.url) return false;
                if (!query) return true;
                return tab.title.toLowerCase().includes(query.toLowerCase()) || 
                       tab.url.toLowerCase().includes(query.toLowerCase());
            });
            
            console.log('[BackgroundDataProvider] Filtered tabs:', filteredTabs.length);
            return filteredTabs;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error querying tabs:', error);
            return [];
        }
    }

    async getRecentTabsData(limit = 5) {
        try {
            console.log('[BackgroundDataProvider] Getting recent tabs, limit:', limit);
            const tabs = await chrome.tabs.query({});
            const storage = await chrome.storage.local.get([TAB_ACTIVITY_STORAGE_KEY]);
            const activityData = storage[TAB_ACTIVITY_STORAGE_KEY] || {};
            
            console.log('[BackgroundDataProvider] Raw tabs for recent:', tabs.length);
            console.log('[BackgroundDataProvider] Activity data entries:', Object.keys(activityData).length);
            
            const recentTabs = tabs
                .filter(tab => tab.url && tab.title)
                .map(tab => ({
                    ...tab,
                    lastActivity: activityData[tab.id] || 0
                }))
                .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                .slice(0, limit);
                
            console.log('[BackgroundDataProvider] Recent tabs processed:', recentTabs.length);
            return recentTabs;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting recent tabs:', error);
            return [];
        }
    }

    async getBookmarksData(query) {
        try {
            console.log('[BackgroundDataProvider] Getting bookmarks with query:', query);
            const bookmarks = await chrome.bookmarks.search(query);
            console.log('[BackgroundDataProvider] Raw bookmarks received:', bookmarks.length);
            
            const filteredBookmarks = bookmarks.filter(bookmark => bookmark.url);
            console.log('[BackgroundDataProvider] Filtered bookmarks:', filteredBookmarks.length);
            return filteredBookmarks;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting bookmarks:', error);
            return [];
        }
    }

    async getHistoryData(query) {
        try {
            console.log('[BackgroundDataProvider] Getting history with query:', query);
            const historyItems = await chrome.history.search({
                text: query,
                maxResults: 10,
                startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
            });
            console.log('[BackgroundDataProvider] History items received:', historyItems.length);
            return historyItems;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting history:', error);
            return [];
        }
    }

    async getTopSitesData() {
        try {
            console.log('[BackgroundDataProvider] Getting top sites');
            const topSites = await chrome.topSites.get();
            console.log('[BackgroundDataProvider] Top sites received:', topSites.length);
            return topSites;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting top sites:', error);
            return [];
        }
    }
}