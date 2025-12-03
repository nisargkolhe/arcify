/**
 * Autocomplete Provider - Google autocomplete suggestions integration
 * 
 * Purpose: Fetches autocomplete suggestions from Google's unofficial suggest API
 * Key Functions: HTTP request to Google suggest API, result parsing, error handling with fallbacks
 * Architecture: Standalone utility class with caching and debouncing
 * 
 * Critical Notes:
 * - Uses Google's unofficial suggest API (clients1.google.com/complete/search)
 * - Implements 30-second caching and request deduplication
 * - Graceful fallback to empty results on API failures
 * - Not tied to Chrome APIs - works in any JavaScript context
 */

import { SearchResult, ResultType } from '../search-types.js';
import { websiteNameExtractor } from '../website-name-extractor.js';
import { getAutocompleteScore } from '../scoring-constants.js';
import { SpotlightUtils } from '../ui-utilities.js';
import { Logger } from '../../../logger.js';

export class AutocompleteProvider {
    constructor() {
        this.cache = new Map();
        this.pendingRequests = new Map();
        this.CACHE_TTL = 30000; // 30 seconds
        this.REQUEST_TIMEOUT = 3000; // 3 seconds
    }

    // Main method to get autocomplete suggestions
    async getAutocompleteSuggestions(query) {
        const trimmedQuery = query.trim();
        
        if (!trimmedQuery || trimmedQuery.length < 2) {
            return [];
        }

        // Check cache first
        const cacheKey = trimmedQuery.toLowerCase();
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.results;
        }

        // Check if request is already pending to avoid duplicates
        if (this.pendingRequests.has(cacheKey)) {
            return await this.pendingRequests.get(cacheKey);
        }

        // Create new request
        const requestPromise = this.fetchAutocompleteSuggestions(trimmedQuery);
        this.pendingRequests.set(cacheKey, requestPromise);

        try {
            const results = await requestPromise;
            
            // Cache results
            this.cache.set(cacheKey, {
                results,
                timestamp: Date.now()
            });

            return results;
        } catch (error) {
            Logger.error('[AutocompleteProvider] Error fetching suggestions:', error);
            return [];
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    // Fetch suggestions from Google's suggest API
    async fetchAutocompleteSuggestions(query) {
        try {
            // Use Google's unofficial suggest API
            const url = `https://clients1.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
            
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; Arcify)'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Parse Google's response format: [query, [suggestions], [descriptions], [queryUrls]]
            if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) {
                Logger.warn('[AutocompleteProvider] Unexpected response format:', data);
                return [];
            }

            const suggestions = data[1];
            
            // Convert to SearchResult objects
            const results = suggestions
                .slice(0, 5) // Limit to 5 suggestions
                .map((suggestion, index) => {
                    const isUrl = SpotlightUtils.isURL(suggestion);
                    
                    return new SearchResult({
                        type: ResultType.AUTOCOMPLETE_SUGGESTION,
                        title: isUrl ? this.extractWebsiteName(suggestion) : suggestion,
                        url: isUrl ? this.normalizeURL(suggestion) : `https://www.google.com/search?q=${encodeURIComponent(suggestion)}`,
                        score: getAutocompleteScore(index), // Use centralized scoring function
                        favicon: null, // Will be handled by getFaviconUrl in ui-utilities
                        metadata: { 
                            query: suggestion,
                            originalQuery: query,
                            position: index,
                            isUrl: isUrl
                        }
                    });
                });

            return results;
        } catch (error) {
            if (error.name === 'AbortError') {
                Logger.warn('[AutocompleteProvider] Request timeout');
            } else {
                Logger.error('[AutocompleteProvider] Fetch error:', error);
            }
            return [];
        }
    }


    // Normalize URL (similar to SpotlightUtils.normalizeURL)
    normalizeURL(url) {
        // Return as-is if it already has a protocol (http, https, chrome, etc.)
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
            return url;
        }
        // Default to https for URLs without protocol
        return `https://${url}`;
    }

    // Extract website name from URL for better display
    extractWebsiteName(url) {
        try {
            return websiteNameExtractor.extractWebsiteName(url);
        } catch (error) {
            Logger.error('[AutocompleteProvider] Error extracting website name:', error);
            // Fallback to basic hostname parsing
            try {
                const normalizedUrl = this.normalizeURL(url);
                const urlObj = new URL(normalizedUrl);
                let hostname = urlObj.hostname;
                
                // Remove www. prefix for cleaner display
                if (hostname.startsWith('www.')) {
                    hostname = hostname.substring(4);
                }
                
                // Capitalize first letter for better presentation
                return hostname.charAt(0).toUpperCase() + hostname.slice(1);
            } catch {
                // Final fallback to original URL
                return url;
            }
        }
    }

    // Clear cache (useful for testing or settings changes)
    clearCache() {
        this.cache.clear();
        this.pendingRequests.clear();
    }

    // Get cache statistics (useful for debugging)
    getCacheStats() {
        return {
            cacheSize: this.cache.size,
            pendingRequests: this.pendingRequests.size,
            cacheEntries: Array.from(this.cache.keys())
        };
    }
}