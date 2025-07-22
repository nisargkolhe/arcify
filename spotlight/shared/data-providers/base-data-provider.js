// base-data-provider.js - Abstract base class with shared business logic

import { SearchResult, ResultType } from '../search-types.js';
import { findMatchingDomains } from '../popular-sites.js';
import { BASE_SCORES, SCORE_BONUSES, getFuzzyMatchScore } from '../scoring-constants.js';
import { SpotlightUtils } from '../ui-utilities.js';

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
    
    async getAutocompleteData(query) { 
        throw new Error('getAutocompleteData must be implemented by subclass'); 
    }

    // FULL IMPLEMENTATIONS (shared business logic)

    // Main method to get spotlight suggestions
    async getSpotlightSuggestions(query, mode = 'current-tab') {
        const results = [];
        const trimmedQuery = query.trim().toLowerCase();

        if (!trimmedQuery) {
            return this.getDefaultResults(mode);
        }

        try {
            // Get results from different sources with individual error handling
            let openTabs = [];
            let bookmarks = [];
            let history = [];
            let topSites = [];
            let autocomplete = [];

            // Get tabs (only in new-tab mode)
            if (mode === 'new-tab') {
                try {
                    openTabs = await this.getOpenTabs(trimmedQuery);
                } catch (error) {
                    console.error('[SearchProvider] Failed to get open tabs:', error);
                    openTabs = [];
                }
            }

            // Get bookmarks
            try {
                bookmarks = await this.getBookmarkSuggestions(trimmedQuery);
            } catch (error) {
                console.error('[SearchProvider] Failed to get bookmarks:', error);
                bookmarks = [];
            }

            // Get history
            try {
                history = await this.getHistorySuggestions(trimmedQuery);
            } catch (error) {
                console.error('[SearchProvider] Failed to get history:', error);
                history = [];
            }

            // Get top sites
            try {
                topSites = await this.getTopSites();
            } catch (error) {
                console.error('[SearchProvider] Failed to get top sites:', error);
                topSites = [];
            }

            // Get autocomplete suggestions
            try {
                autocomplete = await this.getAutocompleteSuggestions(trimmedQuery);
            } catch (error) {
                console.error('[SearchProvider] Failed to get autocomplete:', error);
                autocomplete = [];
            }

            // Skip URL/search suggestions - these are handled by instant suggestions in the UI
            // Collect all results first
            const allResults = [];
            allResults.push(...openTabs, ...bookmarks, ...history, ...autocomplete);
            
            // Add top sites that match query (with fuzzy domain matching)
            const matchingTopSites = this.findMatchingTopSites(topSites, trimmedQuery);
            allResults.push(...matchingTopSites);
            
            // Add fuzzy domain matches from popular sites
            const fuzzyDomainMatches = this.getFuzzyDomainMatches(trimmedQuery);
            allResults.push(...fuzzyDomainMatches);

            // Apply comprehensive deduplication across all sources
            const deduplicatedResults = this.deduplicateResults(allResults);

            // Score and sort results
            const finalResults = this.scoreAndSortResults(deduplicatedResults, trimmedQuery);
            return finalResults;
        } catch (error) {
            console.error('[SearchProvider] Search error:', error);
            const fallback = this.generateFallbackResult(trimmedQuery);
            return [fallback];
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
            console.error('[SearchProvider] Error getting default results:', error);
        }

        // Apply deduplication to default results as well
        return this.deduplicateResults(results);
    }

    // Chrome tabs API integration
    async getOpenTabs(query = '') {
        try {
            const tabsData = await this.getOpenTabsData(query);
            
            const results = tabsData.map(tab => new SearchResult({
                type: ResultType.OPEN_TAB,
                title: tab.title,
                url: tab.url,
                favicon: tab.favIconUrl,
                metadata: { tabId: tab.id, windowId: tab.windowId }
            }));
            return results;
        } catch (error) {
            console.error('[SearchProvider-Tabs] Error querying tabs:', error);
            return [];
        }
    }

    // Get recent tabs by activity
    async getRecentTabs(limit = 5) {
        try {
            const tabsData = await this.getRecentTabsData(limit);
            
            const results = tabsData.map(tab => new SearchResult({
                type: ResultType.OPEN_TAB,
                title: tab.title,
                url: tab.url,
                favicon: tab.favIconUrl,
                metadata: { tabId: tab.id, windowId: tab.windowId }
            }));
            return results;
        } catch (error) {
            console.error('[SearchProvider-Tabs] Error getting recent tabs:', error);
            return [];
        }
    }

    // Chrome bookmarks API integration
    async getBookmarkSuggestions(query) {
        try {
            const bookmarksData = await this.getBookmarksData(query);
            
            const results = bookmarksData.map(bookmark => new SearchResult({
                type: ResultType.BOOKMARK,
                title: bookmark.title,
                url: bookmark.url,
                metadata: { bookmarkId: bookmark.id }
            }));
            return results;
        } catch (error) {
            console.error('[SearchProvider-Bookmarks] Error getting bookmark suggestions:', error);
            return [];
        }
    }

    // Chrome history API integration
    async getHistorySuggestions(query) {
        try {
            const historyData = await this.getHistoryData(query);
            
            const results = historyData.map(item => new SearchResult({
                type: ResultType.HISTORY,
                title: item.title || item.url,
                url: item.url,
                metadata: { visitCount: item.visitCount, lastVisitTime: item.lastVisitTime }
            }));
            return results;
        } catch (error) {
            console.error('[SearchProvider-History] Error getting history suggestions:', error);
            return [];
        }
    }

    // Chrome topSites API integration
    async getTopSites() {
        try {
            const topSitesData = await this.getTopSitesData();
            
            const results = topSitesData.map(site => new SearchResult({
                type: ResultType.TOP_SITE,
                title: site.title,
                url: site.url
            }));
            return results;
        } catch (error) {
            console.error('[SearchProvider-TopSites] Error getting top sites:', error);
            return [];
        }
    }

    // Autocomplete suggestions integration
    async getAutocompleteSuggestions(query) {
        try {
            const autocompleteData = await this.getAutocompleteData(query);
            return autocompleteData; // AutocompleteProvider already returns SearchResult objects
        } catch (error) {
            console.error('[SearchProvider-Autocomplete] Error getting autocomplete suggestions:', error);
            return [];
        }
    }


    // Generate URL suggestion
    generateURLSuggestion(input) {
        // Import helper from ui-utilities for URL normalization
        const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
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
        if (SpotlightUtils.isURL(input)) {
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
        
        const sorted = results
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
            
        return sorted;
    }

    // Relevance scoring algorithm
    calculateRelevanceScore(result, query) {
        // If this is a fuzzy match, use its pre-calculated score
        if (result.metadata?.fuzzyMatch) {
            return result.score;
        }
        
        let baseScore = 0;

        switch (result.type) {
            case ResultType.SEARCH_QUERY: baseScore = BASE_SCORES.SEARCH_QUERY; break;
            case ResultType.URL_SUGGESTION: baseScore = BASE_SCORES.URL_SUGGESTION; break;
            case ResultType.OPEN_TAB: baseScore = BASE_SCORES.OPEN_TAB; break;
            case ResultType.BOOKMARK: baseScore = BASE_SCORES.BOOKMARK; break;
            case ResultType.HISTORY: baseScore = BASE_SCORES.HISTORY; break;
            case ResultType.TOP_SITE: baseScore = BASE_SCORES.TOP_SITE; break;
            case ResultType.AUTOCOMPLETE_SUGGESTION: baseScore = BASE_SCORES.AUTOCOMPLETE_SUGGESTION; break;
        }

        const queryLower = query.toLowerCase();
        const titleLower = result.title.toLowerCase();
        const urlLower = result.url.toLowerCase();

        if (titleLower === queryLower) baseScore += SCORE_BONUSES.EXACT_TITLE_MATCH;
        else if (titleLower.startsWith(queryLower)) baseScore += SCORE_BONUSES.TITLE_STARTS_WITH;
        else if (titleLower.includes(queryLower)) baseScore += SCORE_BONUSES.TITLE_CONTAINS;

        if (urlLower.includes(queryLower)) baseScore += SCORE_BONUSES.URL_CONTAINS;

        return Math.max(0, baseScore);
    }

    // Enhanced top sites matching with fuzzy domain matching
    findMatchingTopSites(topSites, query) {
        const queryLower = query.toLowerCase();
        
        return topSites.filter(site => {
            const titleLower = site.title.toLowerCase();
            const urlLower = site.url.toLowerCase();
            
            // Exact matches
            if (titleLower.includes(queryLower) || urlLower.includes(queryLower)) {
                return true;
            }
            
            // Extract domain from URL for fuzzy matching
            try {
                const url = new URL(site.url);
                let hostname = url.hostname.toLowerCase();
                
                // Remove www. prefix
                if (hostname.startsWith('www.')) {
                    hostname = hostname.substring(4);
                }
                
                // Check if query matches start of domain name
                const domainParts = hostname.split('.');
                const mainDomain = domainParts[0]; // e.g., "squarespace" from "squarespace.com"
                
                // Fuzzy matching: query is start of domain name
                if (mainDomain.startsWith(queryLower)) {
                    return true;
                }
                
            } catch (error) {
                // Ignore URL parsing errors
            }
            
            return false;
        });
    }

    // Get fuzzy domain matches from popular sites
    getFuzzyDomainMatches(query) {
        const matches = findMatchingDomains(query, 5); // Limit to top 5 matches
        
        return matches.map(match => {
            // Calculate fuzzy match score using centralized scoring function
            const fuzzyScore = getFuzzyMatchScore(match.matchType, match.domain.length, query.length);
            
            return new SearchResult({
                type: ResultType.TOP_SITE,
                title: match.displayName,
                url: `https://${match.domain}`,
                score: fuzzyScore,
                metadata: { 
                    fuzzyMatch: true,
                    matchType: match.matchType,
                    originalQuery: query
                }
            });
        });
    }

    // Comprehensive deduplication across all result sources
    deduplicateResults(results) {
        const seen = new Map();
        const deduplicated = [];

        for (const result of results) {
            // Generate a deduplication key based on URL or title
            let key = '';
            if (result.url) {
                // Normalize URL for consistent deduplication
                key = this.normalizeUrlForDeduplication(result.url);
            } else if (result.type === 'search-query') {
                // For search queries, use the title as key
                key = `search:${result.title}`;
            } else {
                // Fallback to title for other types
                key = result.title || '';
            }

            if (!key) {
                // Skip results without identifiable keys
                continue;
            }

            const existing = seen.get(key);
            if (!existing) {
                // First occurrence - keep it
                seen.set(key, result);
                deduplicated.push(result);
            } else {
                // Duplicate found - keep the one with higher score/priority
                const existingPriority = this.getResultPriority(existing);
                const currentPriority = this.getResultPriority(result);
                
                if (currentPriority > existingPriority) {
                    // Replace with higher priority result
                    const index = deduplicated.indexOf(existing);
                    if (index !== -1) {
                        deduplicated[index] = result;
                        seen.set(key, result);
                    }
                }
                // Otherwise keep the existing one (no action needed)
            }
        }

        return deduplicated;
    }

    // Normalize URL for consistent deduplication
    normalizeUrlForDeduplication(url) {
        if (!url) return '';
        
        let normalizedUrl = url.toLowerCase();
        
        // Remove trailing slashes
        normalizedUrl = normalizedUrl.replace(/\/+$/, '');
        
        // Remove protocol prefixes for comparison (http/https shouldn't matter)
        normalizedUrl = normalizedUrl.replace(/^https?:\/\//, '');
        
        // Remove www. prefix for comparison
        normalizedUrl = normalizedUrl.replace(/^www\./, '');
        
        return normalizedUrl;
    }

    // Get result priority for deduplication (higher = better)
    getResultPriority(result) {
        // Use the same priority order as BASE_SCORES for consistency
        const typePriorities = {
            'open-tab': BASE_SCORES.OPEN_TAB,
            'bookmark': BASE_SCORES.BOOKMARK,
            'history': BASE_SCORES.HISTORY,
            'top-site': result.metadata?.fuzzyMatch ? 
                BASE_SCORES.FUZZY_MATCH_START : BASE_SCORES.TOP_SITE,
            'autocomplete-suggestion': BASE_SCORES.AUTOCOMPLETE_SUGGESTION,
            'search-query': BASE_SCORES.SEARCH_QUERY,
            'url-suggestion': BASE_SCORES.URL_SUGGESTION
        };

        const basePriority = typePriorities[result.type] || 0;
        
        // Add any additional score the result might have
        const additionalScore = result.score || 0;
        
        return basePriority + additionalScore;
    }
}