// content-script-data-provider.js - Message passing implementation for content scripts

import { BaseDataProvider } from './base-data-provider.js';

export class ContentScriptDataProvider extends BaseDataProvider {
    // Only implement the small data fetchers using message passing
    
    async getOpenTabsData(query = '') {
        try {
            const message = {
                action: 'searchTabs',
                query: query
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.tabs;
            }
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error querying tabs:', error);
            return [];
        }
    }

    async getRecentTabsData(limit = 5) {
        try {
            const message = {
                action: 'getRecentTabs',
                limit: limit
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.tabs;
            }
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting recent tabs:', error);
            return [];
        }
    }

    async getBookmarksData(query) {
        try {
            const message = {
                action: 'searchBookmarks',
                query: query
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.bookmarks;
            }
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting bookmark suggestions:', error);
            return [];
        }
    }

    async getHistoryData(query) {
        try {
            const message = {
                action: 'searchHistory',
                query: query
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.history;
            }
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting history suggestions:', error);
            return [];
        }
    }

    async getTopSitesData() {
        try {
            const message = {
                action: 'getTopSites'
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.topSites;
            }
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting top sites:', error);
            return [];
        }
    }

    async getAutocompleteData(query) {
        try {
            const message = {
                action: 'getAutocomplete',
                query: query
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.suggestions;
            }
            return [];
        } catch (error) {
            console.error('[ContentScriptDataProvider] Error getting autocomplete suggestions:', error);
            return [];
        }
    }
}