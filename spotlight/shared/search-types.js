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
    PINNED_TAB: 'pinned-tab',
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
        this.type = type;
        this.title = title;
        this.url = url;
        this.favicon = favicon;
        this.score = score;
        this.metadata = metadata;
        this.domain = this.extractDomain(url);
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

