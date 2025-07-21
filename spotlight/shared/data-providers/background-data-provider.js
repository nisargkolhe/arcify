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
            
            const filteredBookmarks = bookmarks.filter(bookmark => bookmark.url);
            return filteredBookmarks;
        } catch (error) {
            console.error('[BackgroundDataProvider] Error getting bookmarks:', error);
            return [];
        }
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
}