// search-data-provider.js - Chrome API integration for search data

import { SearchResult, ResultType } from './search-types.js';

export class SearchDataProvider {
    constructor() {
        this.tabsCache = new Map();
        this.bookmarksCache = new Map();
        this.topSitesCache = null;
        this.cacheTimeout = 5000; // 5 second cache
    }

    // Main search method that combines all data sources
    async search(query, mode = 'current-tab') {
        const results = [];
        const trimmedQuery = query.trim().toLowerCase();

        if (!trimmedQuery) {
            return this.getDefaultResults(mode);
        }

        // Get results from different sources in parallel
        const [
            openTabs,
            bookmarks,
            history,
            topSites
        ] = await Promise.all([
            mode === 'new-tab' ? this.getOpenTabs(trimmedQuery) : Promise.resolve([]),
            this.searchBookmarks(trimmedQuery),
            this.searchHistory(trimmedQuery),
            this.getTopSites()
        ]);

        // Add URL/search suggestions
        if (this.isURL(trimmedQuery)) {
            results.push(this.generateURLSuggestion(trimmedQuery));
        } else {
            results.push(this.generateSearchSuggestion(trimmedQuery));
        }

        // Add other results
        results.push(...openTabs, ...bookmarks, ...history);
        
        // Add top sites that match query
        const matchingTopSites = topSites.filter(site => 
            site.title.toLowerCase().includes(trimmedQuery) ||
            site.url.toLowerCase().includes(trimmedQuery)
        );
        results.push(...matchingTopSites);

        // Score and sort results
        return this.scoreAndSortResults(results, trimmedQuery);
    }

    // Get default results when no query (recent tabs, top sites)
    async getDefaultResults(mode) {
        const results = [];

        if (mode === 'new-tab') {
            // Show recent tabs for new tab mode
            const recentTabs = await this.getRecentTabs(5);
            results.push(...recentTabs);
        }

        // Show top sites as suggestions
        const topSites = await this.getTopSites();
        results.push(...topSites.slice(0, 4));

        return results;
    }

    // Chrome tabs API integration
    async getOpenTabs(query = '') {
        try {
            const tabs = await chrome.tabs.query({});
            const results = [];

            for (const tab of tabs) {
                if (!tab.title || !tab.url) continue;
                
                const titleMatch = tab.title.toLowerCase().includes(query);
                const urlMatch = tab.url.toLowerCase().includes(query);
                
                if (query === '' || titleMatch || urlMatch) {
                    results.push(new SearchResult({
                        type: ResultType.OPEN_TAB,
                        title: tab.title,
                        url: tab.url,
                        favicon: tab.favIconUrl,
                        metadata: { tabId: tab.id, windowId: tab.windowId }
                    }));
                }
            }

            return results;
        } catch (error) {
            console.error('Error querying tabs:', error);
            return [];
        }
    }

    // Get recent tabs by activity (using existing background tracking)
    async getRecentTabs(limit = 5) {
        try {
            const tabs = await chrome.tabs.query({});
            const storage = await chrome.storage.local.get(['tabLastActivity']);
            const activityData = storage.tabLastActivity || {};

            // Sort tabs by last activity
            const tabsWithActivity = tabs
                .filter(tab => tab.url && tab.title)
                .map(tab => ({
                    ...tab,
                    lastActivity: activityData[tab.id] || 0
                }))
                .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                .slice(0, limit);

            return tabsWithActivity.map(tab => new SearchResult({
                type: ResultType.OPEN_TAB,
                title: tab.title,
                url: tab.url,
                favicon: tab.favIconUrl,
                metadata: { tabId: tab.id, windowId: tab.windowId }
            }));
        } catch (error) {
            console.error('Error getting recent tabs:', error);
            return [];
        }
    }

    // Chrome bookmarks API integration
    async searchBookmarks(query) {
        try {
            const bookmarks = await chrome.bookmarks.search(query);
            const results = [];

            for (const bookmark of bookmarks) {
                if (bookmark.url) { // Only actual bookmarks, not folders
                    results.push(new SearchResult({
                        type: ResultType.BOOKMARK,
                        title: bookmark.title,
                        url: bookmark.url,
                        metadata: { bookmarkId: bookmark.id }
                    }));
                }
            }

            return results;
        } catch (error) {
            console.error('Error searching bookmarks:', error);
            return [];
        }
    }

    // Chrome history API integration
    async searchHistory(query) {
        try {
            const historyItems = await chrome.history.search({
                text: query,
                maxResults: 10,
                startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
            });

            return historyItems.map(item => new SearchResult({
                type: ResultType.HISTORY,
                title: item.title || item.url,
                url: item.url,
                metadata: { visitCount: item.visitCount, lastVisitTime: item.lastVisitTime }
            }));
        } catch (error) {
            console.error('Error searching history:', error);
            return [];
        }
    }

    // Chrome topSites API integration
    async getTopSites() {
        try {
            if (this.topSitesCache) {
                return this.topSitesCache;
            }

            const topSites = await chrome.topSites.get();
            const results = topSites.map(site => new SearchResult({
                type: ResultType.TOP_SITE,
                title: site.title,
                url: site.url
            }));

            this.topSitesCache = results;
            // Cache for 5 minutes
            setTimeout(() => {
                this.topSitesCache = null;
            }, 5 * 60 * 1000);

            return results;
        } catch (error) {
            console.error('Error getting top sites:', error);
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
            score: 95 // High priority for URLs
        });
    }

    // Generate search suggestion
    generateSearchSuggestion(input) {
        return new SearchResult({
            type: ResultType.SEARCH_QUERY,
            title: `Search for "${input}"`,
            url: `https://www.google.com/search?q=${encodeURIComponent(input)}`,
            score: 80,
            metadata: { query: input }
        });
    }

    // Score and sort results based on relevance
    scoreAndSortResults(results, query) {
        // Calculate relevance scores
        results.forEach(result => {
            result.score = this.calculateRelevanceScore(result, query);
        });

        // Sort by score (highest first) and limit to 8 results
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
    }

    // Relevance scoring algorithm
    calculateRelevanceScore(result, query) {
        let baseScore = 0;

        // Base scores by type (matching plan priorities)
        switch (result.type) {
            case ResultType.OPEN_TAB: baseScore = 100; break;
            case ResultType.URL_SUGGESTION: baseScore = 95; break;
            case ResultType.BOOKMARK: baseScore = 85; break;
            case ResultType.SEARCH_QUERY: baseScore = 80; break;
            case ResultType.TOP_SITE: baseScore = 70; break;
            case ResultType.HISTORY: baseScore = 60; break;
        }

        // Boost for exact matches
        const queryLower = query.toLowerCase();
        const titleLower = result.title.toLowerCase();
        const urlLower = result.url.toLowerCase();

        if (titleLower === queryLower) baseScore += 20;
        else if (titleLower.startsWith(queryLower)) baseScore += 15;
        else if (titleLower.includes(queryLower)) baseScore += 10;

        if (urlLower.includes(queryLower)) baseScore += 5;

        // Boost recent activity for tabs and history
        if (result.type === ResultType.HISTORY && result.metadata.lastVisitTime) {
            const daysSinceVisit = (Date.now() - result.metadata.lastVisitTime) / (1000 * 60 * 60 * 24);
            if (daysSinceVisit < 1) baseScore += 10;
            else if (daysSinceVisit < 7) baseScore += 5;
        }

        return Math.max(0, baseScore);
    }
}