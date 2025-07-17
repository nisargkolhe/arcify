// search-provider.js - Shared search data provider for spotlight components

import { SearchResult, ResultType } from './search-types.js';

// Search Data Provider
export class SearchDataProvider {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5000;
    }

    // Main method to get spotlight suggestions
    async getSpotlightSuggestions(query, mode = 'current-tab') {
        const results = [];
        const trimmedQuery = query.trim().toLowerCase();
        
        console.log('[Spotlight] Starting search with query:', trimmedQuery, 'mode:', mode);

        if (!trimmedQuery) {
            console.log('[Spotlight] Empty query, getting default results');
            return this.getDefaultResults(mode);
        }

        try {
            console.log('[Spotlight] Fetching results from all sources...');
            
            // Get results from different sources with individual error handling
            let openTabs = [];
            let bookmarks = [];
            let history = [];
            let topSites = [];

            // Get tabs (only in new-tab mode)
            if (mode === 'new-tab') {
                try {
                    openTabs = await this.getOpenTabs(trimmedQuery);
                } catch (error) {
                    console.error('[Spotlight] Failed to get open tabs:', error);
                    openTabs = [];
                }
            }

            // Get bookmarks
            try {
                bookmarks = await this.getBookmarkSuggestions(trimmedQuery);
            } catch (error) {
                console.error('[Spotlight] Failed to get bookmarks:', error);
                bookmarks = [];
            }

            // Get history
            try {
                history = await this.getHistorySuggestions(trimmedQuery);
            } catch (error) {
                console.error('[Spotlight] Failed to get history:', error);
                history = [];
            }

            // Get top sites
            try {
                topSites = await this.getTopSites();
            } catch (error) {
                console.error('[Spotlight] Failed to get top sites:', error);
                topSites = [];
            }

            console.log('[Spotlight] Individual results:');
            console.log('  - Open tabs:', openTabs.length);
            console.log('  - Bookmarks:', bookmarks.length);
            console.log('  - History:', history.length);
            console.log('  - Top sites:', topSites.length);

            // Add URL/search suggestions
            if (this.isURL(trimmedQuery)) {
                console.log('[Spotlight] Adding URL suggestion for:', trimmedQuery);
                results.push(this.generateURLSuggestion(trimmedQuery));
            } else {
                console.log('[Spotlight] Adding search suggestion for:', trimmedQuery);
                results.push(this.generateSearchSuggestion(trimmedQuery));
            }

            // Add other results
            results.push(...openTabs, ...bookmarks, ...history);
            
            // Add top sites that match query
            const matchingTopSites = topSites.filter(site => 
                site.title.toLowerCase().includes(trimmedQuery) ||
                site.url.toLowerCase().includes(trimmedQuery)
            );
            console.log('[Spotlight] Matching top sites:', matchingTopSites.length);
            results.push(...matchingTopSites);

            console.log('[Spotlight] Total results before scoring:', results.length);
            // Score and sort results
            const finalResults = this.scoreAndSortResults(results, trimmedQuery);
            console.log('[Spotlight] Final results after scoring:', finalResults.length);
            return finalResults;
        } catch (error) {
            console.error('[Spotlight] Search error:', error);
            return [this.generateFallbackResult(trimmedQuery)];
        }
    }

    // Get default results when no query
    async getDefaultResults(mode) {
        const results = [];

        try {
            if (mode === 'new-tab') {
                // Show recent tabs for new tab mode
                const recentTabs = await this.getRecentTabs(5);
                results.push(...recentTabs);
            }

            // Show top sites as suggestions
            const topSites = await this.getTopSites();
            results.push(...topSites.slice(0, 4));
        } catch (error) {
            console.error('Error getting default results:', error);
        }

        return results;
    }

    // Chrome tabs API integration via background script
    async getOpenTabs(query = '') {
        try {
            console.log('[Spotlight] Requesting tabs with query:', query);
            const response = await chrome.runtime.sendMessage({
                action: 'searchTabs',
                query: query
            });
            
            console.log('[Spotlight] Tabs response:', response);
            if (response && response.success) {
                const results = response.tabs.map(tab => new SearchResult({
                    type: ResultType.OPEN_TAB,
                    title: tab.title,
                    url: tab.url,
                    favicon: tab.favIconUrl,
                    metadata: { tabId: tab.id, windowId: tab.windowId }
                }));
                console.log('[Spotlight] Created tab results:', results.length);
                return results;
            }
            console.log('[Spotlight] No valid tabs response');
            return [];
        } catch (error) {
            console.error('[Spotlight] Error querying tabs:', error);
            return [];
        }
    }

    // Get recent tabs by activity via background script
    async getRecentTabs(limit = 5) {
        try {
            console.log('[Spotlight] Requesting recent tabs, limit:', limit);
            const response = await chrome.runtime.sendMessage({
                action: 'getRecentTabs',
                limit: limit
            });
            
            console.log('[Spotlight] Recent tabs response:', response);
            if (response && response.success) {
                const results = response.tabs.map(tab => new SearchResult({
                    type: ResultType.OPEN_TAB,
                    title: tab.title,
                    url: tab.url,
                    favicon: tab.favIconUrl,
                    metadata: { tabId: tab.id, windowId: tab.windowId }
                }));
                console.log('[Spotlight] Created recent tab results:', results.length);
                return results;
            }
            console.log('[Spotlight] No valid recent tabs response');
            return [];
        } catch (error) {
            console.error('[Spotlight] Error getting recent tabs:', error);
            return [];
        }
    }

    // Chrome bookmarks API integration via background script
    async getBookmarkSuggestions(query) {
        try {
            console.log('[Spotlight] Requesting bookmarks with query:', query);
            const response = await chrome.runtime.sendMessage({
                action: 'searchBookmarks',
                query: query
            });
            
            console.log('[Spotlight] Bookmarks response:', response);
            if (response && response.success) {
                const results = response.bookmarks.map(bookmark => new SearchResult({
                    type: ResultType.BOOKMARK,
                    title: bookmark.title,
                    url: bookmark.url,
                    metadata: { bookmarkId: bookmark.id }
                }));
                console.log('[Spotlight] Created bookmark results:', results.length);
                return results;
            }
            console.log('[Spotlight] No valid bookmarks response');
            return [];
        } catch (error) {
            console.error('[Spotlight] Error getting bookmark suggestions:', error);
            return [];
        }
    }

    // Chrome history API integration via background script
    async getHistorySuggestions(query) {
        try {
            console.log('[Spotlight] Requesting history with query:', query);
            const response = await chrome.runtime.sendMessage({
                action: 'searchHistory',
                query: query
            });
            
            console.log('[Spotlight] History response:', response);
            if (response && response.success) {
                const results = response.history.map(item => new SearchResult({
                    type: ResultType.HISTORY,
                    title: item.title || item.url,
                    url: item.url,
                    metadata: { visitCount: item.visitCount, lastVisitTime: item.lastVisitTime }
                }));
                console.log('[Spotlight] Created history results:', results.length);
                return results;
            }
            console.log('[Spotlight] No valid history response');
            return [];
        } catch (error) {
            console.error('[Spotlight] Error getting history suggestions:', error);
            return [];
        }
    }

    // Chrome topSites API integration via background script
    async getTopSites() {
        try {
            console.log('[Spotlight] Requesting top sites');
            const response = await chrome.runtime.sendMessage({
                action: 'getTopSites'
            });
            
            console.log('[Spotlight] Top sites response:', response);
            if (response && response.success) {
                const results = response.topSites.map(site => new SearchResult({
                    type: ResultType.TOP_SITE,
                    title: site.title,
                    url: site.url
                }));
                console.log('[Spotlight] Created top sites results:', results.length);
                return results;
            }
            console.log('[Spotlight] No valid top sites response');
            return [];
        } catch (error) {
            console.error('[Spotlight] Error getting top sites:', error);
            return [];
        }
    }

    // URL detection utility
    isURL(text) {
        // Check if it's already a complete URL
        try {
            new URL(text);
            return true;
        } catch {}

        // Check for domain-like patterns
        const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
        if (domainPattern.test(text)) {
            return true;
        }

        // Check for localhost
        if (text === 'localhost' || text.startsWith('localhost:')) {
            return true;
        }

        // Check for IP addresses
        if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(text)) {
            const parts = text.split(':')[0].split('.');
            return parts.every(part => {
                const num = parseInt(part, 10);
                return num >= 0 && num <= 255;
            });
        }

        // Common URL patterns without protocol
        if (/^[a-zA-Z0-9-]+\.(com|org|net|edu|gov|mil|int|co|io|ly|me|tv|app|dev|ai)([\/\?\#].*)?$/.test(text)) {
            return true;
        }

        return false;
    }

    // Generate URL suggestion
    generateURLSuggestion(input) {
        const url = input.startsWith('http') ? input : `https://${input}`;
        return new SearchResult({
            type: ResultType.URL_SUGGESTION,
            title: `Navigate to ${url}`,
            url: url,
            score: 95
        });
    }

    // Generate search suggestion
    generateSearchSuggestion(input) {
        return new SearchResult({
            type: ResultType.SEARCH_QUERY,
            title: `Search for "${input}"`,
            url: '',  // URL not needed since we'll use chrome.search API
            score: 80,
            metadata: { query: input }
        });
    }

    // Generate fallback result for errors
    generateFallbackResult(input) {
        if (this.isURL(input)) {
            return this.generateURLSuggestion(input);
        } else {
            return this.generateSearchSuggestion(input);
        }
    }

    // Score and sort results
    scoreAndSortResults(results, query) {
        results.forEach(result => {
            result.score = this.calculateRelevanceScore(result, query);
        });

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
    }

    // Relevance scoring algorithm
    calculateRelevanceScore(result, query) {
        let baseScore = 0;

        switch (result.type) {
            case ResultType.OPEN_TAB: baseScore = 100; break;
            case ResultType.URL_SUGGESTION: baseScore = 95; break;
            case ResultType.BOOKMARK: baseScore = 85; break;
            case ResultType.SEARCH_QUERY: baseScore = 80; break;
            case ResultType.TOP_SITE: baseScore = 70; break;
            case ResultType.HISTORY: baseScore = 60; break;
        }

        const queryLower = query.toLowerCase();
        const titleLower = result.title.toLowerCase();
        const urlLower = result.url.toLowerCase();

        if (titleLower === queryLower) baseScore += 20;
        else if (titleLower.startsWith(queryLower)) baseScore += 15;
        else if (titleLower.includes(queryLower)) baseScore += 10;

        if (urlLower.includes(queryLower)) baseScore += 5;

        return Math.max(0, baseScore);
    }
}