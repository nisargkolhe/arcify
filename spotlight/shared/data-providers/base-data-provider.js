// base-data-provider.js - Abstract base class with shared business logic

import { SearchResult, ResultType } from '../search-types.js';

export class BaseDataProvider {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5000;
    }

    // ABSTRACT DATA FETCHERS (must be implemented by subclasses)
    async getOpenTabsData(query = '') { 
        throw new Error('getOpenTabsData must be implemented by subclass'); 
    }
    
    async getRecentTabsData(limit = 5) { 
        throw new Error('getRecentTabsData must be implemented by subclass'); 
    }
    
    async getBookmarksData(query) { 
        throw new Error('getBookmarksData must be implemented by subclass'); 
    }
    
    async getHistoryData(query) { 
        throw new Error('getHistoryData must be implemented by subclass'); 
    }
    
    async getTopSitesData() { 
        throw new Error('getTopSitesData must be implemented by subclass'); 
    }

    // FULL IMPLEMENTATIONS (shared business logic)

    // Main method to get spotlight suggestions
    async getSpotlightSuggestions(query, mode = 'current-tab') {
        const results = [];
        const trimmedQuery = query.trim().toLowerCase();
        
        console.log('[SearchProvider] Starting search with query:', trimmedQuery, 'mode:', mode);

        if (!trimmedQuery) {
            console.log('[SearchProvider] Empty query, getting default results');
            return this.getDefaultResults(mode);
        }

        try {
            console.log('[SearchProvider] Fetching results from all sources...');
            
            // Get results from different sources with individual error handling
            let openTabs = [];
            let bookmarks = [];
            let history = [];
            let topSites = [];

            // Get tabs (only in new-tab mode)
            if (mode === 'new-tab') {
                try {
                    console.log('[SearchProvider] Mode is new-tab, fetching open tabs');
                    openTabs = await this.getOpenTabs(trimmedQuery);
                    console.log('[SearchProvider] Open tabs fetched:', openTabs.length);
                } catch (error) {
                    console.error('[SearchProvider] Failed to get open tabs:', error);
                    openTabs = [];
                }
            } else {
                console.log('[SearchProvider] Mode is current-tab, skipping open tabs');
            }

            // Get bookmarks
            try {
                console.log('[SearchProvider] Fetching bookmarks');
                bookmarks = await this.getBookmarkSuggestions(trimmedQuery);
                console.log('[SearchProvider] Bookmarks fetched:', bookmarks.length);
            } catch (error) {
                console.error('[SearchProvider] Failed to get bookmarks:', error);
                bookmarks = [];
            }

            // Get history
            try {
                console.log('[SearchProvider] Fetching history');
                history = await this.getHistorySuggestions(trimmedQuery);
                console.log('[SearchProvider] History fetched:', history.length);
            } catch (error) {
                console.error('[SearchProvider] Failed to get history:', error);
                history = [];
            }

            // Get top sites
            try {
                console.log('[SearchProvider] Fetching top sites');
                topSites = await this.getTopSites();
                console.log('[SearchProvider] Top sites fetched:', topSites.length);
            } catch (error) {
                console.error('[SearchProvider] Failed to get top sites:', error);
                topSites = [];
            }

            console.log('[SearchProvider] Individual results summary:');
            console.log('[SearchProvider]   - Open tabs:', openTabs.length);
            console.log('[SearchProvider]   - Bookmarks:', bookmarks.length);
            console.log('[SearchProvider]   - History:', history.length);
            console.log('[SearchProvider]   - Top sites:', topSites.length);

            // Skip URL/search suggestions - these are handled by instant suggestions in the UI
            console.log('[SearchProvider] Skipping URL/search suggestions (handled by instant suggestions)');

            // Add other results
            console.log('[SearchProvider] Adding results to final array');
            results.push(...openTabs, ...bookmarks, ...history);
            
            // Add top sites that match query
            const matchingTopSites = topSites.filter(site => 
                site.title.toLowerCase().includes(trimmedQuery) ||
                site.url.toLowerCase().includes(trimmedQuery)
            );
            console.log('[SearchProvider] Matching top sites:', matchingTopSites.length);
            results.push(...matchingTopSites);

            console.log('[SearchProvider-Results] Total results before scoring:', results.length);
            // Score and sort results
            const finalResults = this.scoreAndSortResults(results, trimmedQuery);
            console.log('[SearchProvider-Results] Final results after scoring:', finalResults.length);
            console.log('[SearchProvider-Results] First few final results:', finalResults.slice(0, 3).map(r => ({ type: r.type, title: r.title, url: r.url })));
            return finalResults;
        } catch (error) {
            console.error('[SearchProvider] Search error:', error);
            console.error('[SearchProvider] Error stack:', error.stack);
            const fallback = this.generateFallbackResult(trimmedQuery);
            console.log('[SearchProvider] Returning fallback result:', fallback);
            return [fallback];
        }
    }

    // Get default results when no query
    async getDefaultResults(mode) {
        console.log('[SearchProvider] Getting default results for mode:', mode);
        const results = [];

        try {
            if (mode === 'new-tab') {
                console.log('[SearchProvider] New tab mode - fetching recent tabs');
                // Show recent tabs for new tab mode
                const recentTabs = await this.getRecentTabs(5);
                console.log('[SearchProvider] Recent tabs for default results:', recentTabs.length);
                results.push(...recentTabs);
            }

            // Show top sites as suggestions
            console.log('[SearchProvider] Fetching top sites for default results');
            const topSites = await this.getTopSites();
            console.log('[SearchProvider] Top sites for default results:', topSites.length);
            results.push(...topSites.slice(0, 4));
            
            console.log('[SearchProvider] Default results total:', results.length);
        } catch (error) {
            console.error('[SearchProvider] Error getting default results:', error);
        }

        return results;
    }

    // Chrome tabs API integration
    async getOpenTabs(query = '') {
        try {
            console.log('[SearchProvider-Tabs] Requesting tabs with query:', query);
            const tabsData = await this.getOpenTabsData(query);
            console.log('[SearchProvider-Tabs] Raw tabs received:', tabsData.length);
            
            const results = tabsData.map(tab => new SearchResult({
                type: ResultType.OPEN_TAB,
                title: tab.title,
                url: tab.url,
                favicon: tab.favIconUrl,
                metadata: { tabId: tab.id, windowId: tab.windowId }
            }));
            console.log('[SearchProvider-Tabs] Created tab results:', results.length);
            return results;
        } catch (error) {
            console.error('[SearchProvider-Tabs] Error querying tabs:', error);
            return [];
        }
    }

    // Get recent tabs by activity
    async getRecentTabs(limit = 5) {
        try {
            console.log('[SearchProvider-Tabs] Requesting recent tabs, limit:', limit);
            const tabsData = await this.getRecentTabsData(limit);
            console.log('[SearchProvider-Tabs] Raw recent tabs received:', tabsData.length);
            
            const results = tabsData.map(tab => new SearchResult({
                type: ResultType.OPEN_TAB,
                title: tab.title,
                url: tab.url,
                favicon: tab.favIconUrl,
                metadata: { tabId: tab.id, windowId: tab.windowId }
            }));
            console.log('[SearchProvider-Tabs] Created recent tab results:', results.length);
            return results;
        } catch (error) {
            console.error('[SearchProvider-Tabs] Error getting recent tabs:', error);
            return [];
        }
    }

    // Chrome bookmarks API integration
    async getBookmarkSuggestions(query) {
        try {
            console.log('[SearchProvider-Bookmarks] Requesting bookmarks with query:', query);
            const bookmarksData = await this.getBookmarksData(query);
            console.log('[SearchProvider-Bookmarks] Raw bookmarks received:', bookmarksData.length);
            
            const results = bookmarksData.map(bookmark => new SearchResult({
                type: ResultType.BOOKMARK,
                title: bookmark.title,
                url: bookmark.url,
                metadata: { bookmarkId: bookmark.id }
            }));
            console.log('[SearchProvider-Bookmarks] Created bookmark results:', results.length);
            return results;
        } catch (error) {
            console.error('[SearchProvider-Bookmarks] Error getting bookmark suggestions:', error);
            return [];
        }
    }

    // Chrome history API integration
    async getHistorySuggestions(query) {
        try {
            console.log('[SearchProvider-History] Requesting history with query:', query);
            const historyData = await this.getHistoryData(query);
            console.log('[SearchProvider-History] Raw history received:', historyData.length);
            
            const results = historyData.map(item => new SearchResult({
                type: ResultType.HISTORY,
                title: item.title || item.url,
                url: item.url,
                metadata: { visitCount: item.visitCount, lastVisitTime: item.lastVisitTime }
            }));
            console.log('[SearchProvider-History] Created history results:', results.length);
            return results;
        } catch (error) {
            console.error('[SearchProvider-History] Error getting history suggestions:', error);
            return [];
        }
    }

    // Chrome topSites API integration
    async getTopSites() {
        try {
            console.log('[SearchProvider-TopSites] Requesting top sites');
            const topSitesData = await this.getTopSitesData();
            console.log('[SearchProvider-TopSites] Raw top sites received:', topSitesData.length);
            
            const results = topSitesData.map(site => new SearchResult({
                type: ResultType.TOP_SITE,
                title: site.title,
                url: site.url
            }));
            console.log('[SearchProvider-TopSites] Created top sites results:', results.length);
            return results;
        } catch (error) {
            console.error('[SearchProvider-TopSites] Error getting top sites:', error);
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
        console.log('[SearchProvider-Results] Scoring and sorting results');
        results.forEach(result => {
            result.score = this.calculateRelevanceScore(result, query);
        });

        console.log('[SearchProvider-Results] Results with scores:', results.map(r => ({ type: r.type, title: r.title, score: r.score })));
        
        const sorted = results
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
            
        console.log('[SearchProvider-Results] Final sorted results:', sorted.map(r => ({ type: r.type, title: r.title, score: r.score })));
        return sorted;
    }

    // Relevance scoring algorithm
    calculateRelevanceScore(result, query) {
        let baseScore = 0;

        switch (result.type) {
            case ResultType.SEARCH_QUERY: baseScore = 100; break;  // Search query now has highest priority
            case ResultType.URL_SUGGESTION: baseScore = 95; break;
            case ResultType.OPEN_TAB: baseScore = 90; break;       // Open tabs moved down
            case ResultType.BOOKMARK: baseScore = 85; break;
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