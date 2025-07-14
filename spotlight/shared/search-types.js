// search-types.js - Shared search result interfaces and constants

// Result type constants
export const ResultType = {
    URL_SUGGESTION: 'url-suggestion',
    SEARCH_QUERY: 'search-query',
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
        this.metadata = metadata;
        this.domain = this.extractDomain(url);
    }

    extractDomain(url) {
        try {
            if (!url) return '';
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }
}