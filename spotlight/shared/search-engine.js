// search-engine.js - Shared search engine with caching and debouncing for spotlight components

import { SearchDataProvider } from './search-provider.js';
import { ResultType, SpotlightMode } from './search-types.js';

// Search Engine with caching
export class SearchEngine {
    constructor() {
        this.dataProvider = new SearchDataProvider();
        this.cache = new Map();
        this.searchTimeout = null;
        this.DEBOUNCE_DELAY = 150;
        this.CACHE_TTL = 30000;
    }

    // Main search method with debouncing
    search(query, mode = SpotlightMode.CURRENT_TAB) {
        return new Promise((resolve) => {
            clearTimeout(this.searchTimeout);

            // Check cache first
            const cacheKey = `${query.trim()}:${mode}`;
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                resolve(cached.results);
                return;
            }

            // Debounced search
            this.searchTimeout = setTimeout(async () => {
                try {
                    const results = await this.performSearch(query, mode);
                    
                    this.cache.set(cacheKey, {
                        results,
                        timestamp: Date.now()
                    });

                    resolve(results);
                } catch (error) {
                    console.error('Search error:', error);
                    resolve([]);
                }
            }, this.DEBOUNCE_DELAY);
        });
    }

    // Immediate search without debouncing
    async searchImmediate(query, mode = SpotlightMode.CURRENT_TAB) {
        try {
            return await this.performSearch(query, mode);
        } catch (error) {
            console.error('Immediate search error:', error);
            return [];
        }
    }

    // Internal search implementation
    async performSearch(query, mode) {
        const trimmedQuery = query.trim();
        
        if (!trimmedQuery) {
            return await this.dataProvider.getDefaultResults(mode);
        }

        return await this.dataProvider.search(trimmedQuery, mode);
    }

    // Format result for display
    formatResult(result, mode) {
        const formatters = {
            [ResultType.URL_SUGGESTION]: {
                title: result.title,
                subtitle: result.url,
                action: '↵'
            },
            [ResultType.SEARCH_QUERY]: {
                title: result.title,
                subtitle: 'Google Search',
                action: '↵'
            },
            [ResultType.OPEN_TAB]: {
                title: result.title,
                subtitle: result.domain,
                action: mode === SpotlightMode.NEW_TAB ? 'Switch to Tab' : '↵'
            },
            [ResultType.BOOKMARK]: {
                title: result.title,
                subtitle: result.domain,
                action: '↵'
            },
            [ResultType.HISTORY]: {
                title: result.title,
                subtitle: result.domain,
                action: '↵'
            },
            [ResultType.TOP_SITE]: {
                title: result.title,
                subtitle: result.domain,
                action: '↵'
            }
        };

        return formatters[result.type] || {
            title: result.title,
            subtitle: result.url,
            action: '↵'
        };
    }

    // Handle result action
    async handleResultAction(result, mode) {
        try {
            switch (result.type) {
                case ResultType.OPEN_TAB:
                    if (mode === SpotlightMode.NEW_TAB) {
                        // Send message to background script to switch tabs
                        chrome.runtime.sendMessage({
                            action: 'switchToTab',
                            tabId: result.metadata.tabId,
                            windowId: result.metadata.windowId
                        });
                    } else {
                        window.location.href = result.url;
                    }
                    break;

                case ResultType.URL_SUGGESTION:
                case ResultType.BOOKMARK:
                case ResultType.HISTORY:
                case ResultType.TOP_SITE:
                    if (mode === SpotlightMode.NEW_TAB) {
                        chrome.runtime.sendMessage({
                            action: 'openNewTab',
                            url: result.url
                        });
                    } else {
                        window.location.href = result.url;
                    }
                    break;

                case ResultType.SEARCH_QUERY:
                    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(result.metadata.query)}`;
                    if (mode === SpotlightMode.NEW_TAB) {
                        chrome.runtime.sendMessage({
                            action: 'openNewTab',
                            url: searchUrl
                        });
                    } else {
                        window.location.href = searchUrl;
                    }
                    break;

                default:
                    console.warn('Unknown result type:', result.type);
            }
        } catch (error) {
            console.error('Error handling result action:', error);
        }
    }
}