// search-types.js - Search result interfaces and constants for spotlight

// Result type constants matching the plan
export const ResultType = {
    URL_SUGGESTION: 'url-suggestion',    // Direct URL navigation
    SEARCH_QUERY: 'search-query',        // Google/default search
    OPEN_TAB: 'open-tab',               // Switch to existing tab  
    BOOKMARK: 'bookmark',                // Saved bookmark
    HISTORY: 'history',                  // Browser history
    TOP_SITE: 'top-site'                // Most visited site
};

// Search result interface
export class SearchResult {
    constructor({
        type,
        title,
        url,
        favicon = null,
        score = 0,
        metadata = {}
    }) {
        this.type = type;
        this.title = title;
        this.url = url;
        this.favicon = favicon;
        this.score = score;
        this.metadata = metadata; // Extra data like tab ID, bookmark ID, etc.
        this.domain = this.extractDomain(url);
    }

    extractDomain(url) {
        try {
            if (!url) return '';
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            return urlObj.hostname;
        } catch {
            return url; // Fallback for invalid URLs
        }
    }
}

// Spotlight mode constants
export const SpotlightMode = {
    CURRENT_TAB: 'current-tab',
    NEW_TAB: 'new-tab'
};