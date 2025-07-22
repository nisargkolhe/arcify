/**
 * Search Types - Result type constants and SearchResult class definition
 * 
 * Purpose: Defines search result data structures and type constants for spotlight system
 * Key Functions: SearchResult class with domain extraction, result type enumeration
 * Architecture: Shared type definitions used across all spotlight components
 * 
 * Critical Notes:
 * - Central definition of all search result types (URL, search, tabs, bookmarks, etc.)
 * - SearchResult class handles URL normalization and domain extraction automatically
 * - Used by all data providers for consistent result structure
 * - Supports metadata for result-specific data (tab IDs, queries, etc.)
 */

// Result type constants
export const ResultType = {
    URL_SUGGESTION: 'url-suggestion',
    SEARCH_QUERY: 'search-query',
    AUTOCOMPLETE_SUGGESTION: 'autocomplete-suggestion',
    OPEN_TAB: 'open-tab',
    BOOKMARK: 'bookmark',
    HISTORY: 'history',
    TOP_SITE: 'top-site'
};

// Spotlight tab mode constants
export const SpotlightTabMode = {
    CURRENT_TAB: 'current-tab',
    NEW_TAB: 'new-tab'
};

// Search Result class
export class SearchResult {
    constructor({
        type = '',
        title = '',
        url = '',
        favicon = null,
        score = 0,
        metadata = {}
    } = {}) {
        this.initialize(type, title, url, favicon, score, metadata);
    }

    initialize(type, title, url, favicon, score, metadata) {
        this.type = type;
        this.title = title;
        this.url = url;
        this.favicon = favicon;
        this.score = score;
        this.metadata = metadata;
        this.domain = this.extractDomain(url);
    }

    reset() {
        this.type = '';
        this.title = '';
        this.url = '';
        this.favicon = null;
        this.score = 0;
        this.metadata = {};
        this.domain = '';
    }

    extractDomain(url) {
        try {
            if (!url) return '';
            // Handle URLs with existing protocols (including chrome://)
            const normalizedUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
            const urlObj = new URL(normalizedUrl);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }
}

// Search Result Pool for memory optimization
export class SearchResultPool {
    constructor(initialSize = 50) {
        this.pool = Array(initialSize).fill(null).map(() => new SearchResult());
        this.available = [...this.pool];
        this.inUse = new Set();
    }

    acquire(options) {
        let result;
        if (this.available.length > 0) {
            result = this.available.pop();
        } else {
            result = new SearchResult();
        }
        
        if (options) {
            result.initialize(
                options.type,
                options.title,
                options.url,
                options.favicon,
                options.score,
                options.metadata
            );
        }
        
        this.inUse.add(result);
        return result;
    }

    release(result) {
        if (this.inUse.has(result)) {
            result.reset();
            this.inUse.delete(result);
            this.available.push(result);
        }
    }

    releaseAll(results) {
        if (Array.isArray(results)) {
            results.forEach(result => this.release(result));
        }
    }

    getStats() {
        return {
            totalObjects: this.pool.length + (this.inUse.size - this.available.length),
            inPool: this.available.length,
            inUse: this.inUse.size
        };
    }
}

// Global pool instance for shared usage
export const globalSearchResultPool = new SearchResultPool();