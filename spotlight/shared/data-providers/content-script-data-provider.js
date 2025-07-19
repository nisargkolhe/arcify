// content-script-data-provider.js - Message passing implementation for content scripts

import { BaseDataProvider } from './base-data-provider.js';

export class ContentScriptDataProvider extends BaseDataProvider {
    // Only implement the small data fetchers using message passing
    
    async getOpenTabsData(query = '') {
        try {
            console.log('[ContentScriptDataProvider] Requesting tabs with query:', query);
            const message = {
                action: 'searchTabs',
                query: query
            };
            console.log('[ContentScriptDataProvider] Sending message:', message);
            
            const response = await chrome.runtime.sendMessage(message);
            console.log('[ContentScriptDataProvider] Tabs response:', response);
            
            if (response && response.success) {
                console.log('[ContentScriptDataProvider] Success response - raw tabs:', response.tabs.length);
                return response.tabs;
            }
            console.log('[ContentScriptDataProvider] No valid tabs response');
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error querying tabs:', error);
            return [];
        }
    }

    async getRecentTabsData(limit = 5) {
        try {
            console.log('[ContentScriptDataProvider] Requesting recent tabs, limit:', limit);
            const message = {
                action: 'getRecentTabs',
                limit: limit
            };
            console.log('[ContentScriptDataProvider] Sending recent tabs message:', message);
            
            const response = await chrome.runtime.sendMessage(message);
            console.log('[ContentScriptDataProvider] Recent tabs response:', response);
            
            if (response && response.success) {
                console.log('[ContentScriptDataProvider] Success response - raw recent tabs:', response.tabs.length);
                return response.tabs;
            }
            console.log('[ContentScriptDataProvider] No valid recent tabs response');
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting recent tabs:', error);
            return [];
        }
    }

    async getBookmarksData(query) {
        try {
            console.log('[ContentScriptDataProvider] Requesting bookmarks with query:', query);
            const message = {
                action: 'searchBookmarks',
                query: query
            };
            console.log('[ContentScriptDataProvider] Sending message:', message);
            
            const response = await chrome.runtime.sendMessage(message);
            console.log('[ContentScriptDataProvider] Bookmarks response:', response);
            
            if (response && response.success) {
                console.log('[ContentScriptDataProvider] Success response - raw bookmarks:', response.bookmarks.length);
                return response.bookmarks;
            }
            console.log('[ContentScriptDataProvider] No valid bookmarks response');
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting bookmark suggestions:', error);
            return [];
        }
    }

    async getHistoryData(query) {
        try {
            console.log('[ContentScriptDataProvider] Requesting history with query:', query);
            const message = {
                action: 'searchHistory',
                query: query
            };
            console.log('[ContentScriptDataProvider] Sending message:', message);
            
            const response = await chrome.runtime.sendMessage(message);
            console.log('[ContentScriptDataProvider] History response:', response);
            
            if (response && response.success) {
                console.log('[ContentScriptDataProvider] Success response - raw history:', response.history.length);
                return response.history;
            }
            console.log('[ContentScriptDataProvider] No valid history response');
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting history suggestions:', error);
            return [];
        }
    }

    async getTopSitesData() {
        try {
            console.log('[ContentScriptDataProvider] Requesting top sites');
            const message = {
                action: 'getTopSites'
            };
            console.log('[ContentScriptDataProvider] Sending message:', message);
            
            const response = await chrome.runtime.sendMessage(message);
            console.log('[ContentScriptDataProvider] Top sites response:', response);
            
            if (response && response.success) {
                console.log('[ContentScriptDataProvider] Success response - raw top sites:', response.topSites.length);
                return response.topSites;
            }
            console.log('[ContentScriptDataProvider] No valid top sites response');
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting top sites:', error);
            return [];
        }
    }
}