// search-engine.js - Main search engine with caching and debouncing

import { SearchDataProvider } from './search-data-provider.js';
import { ResultType, SpotlightMode } from './search-types.js';

export class SearchEngine {
    constructor() {
        this.dataProvider = new SearchDataProvider();
        this.cache = new Map();
        this.searchTimeout = null;
        this.DEBOUNCE_DELAY = 150; // 150ms for responsiveness
        this.CACHE_TTL = 30000; // 30 second cache TTL
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
                    
                    // Cache the results
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

    // Immediate search without debouncing (for programmatic calls)
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

    // Format result for display (Arc-style formatting)
    formatResult(result, mode) {
        const formatters = {
            [ResultType.URL_SUGGESTION]: {
                title: result.title,
                subtitle: result.url,
                action: '↵',
                icon: '🔗'
            },
            [ResultType.SEARCH_QUERY]: {
                title: result.title,
                subtitle: 'Google Search',
                action: '↵',
                icon: '🔍'
            },
            [ResultType.OPEN_TAB]: {
                title: result.title,
                subtitle: result.domain,
                action: mode === SpotlightMode.NEW_TAB ? 'Switch to Tab' : '↵',
                icon: result.favicon || '🌐'
            },
            [ResultType.BOOKMARK]: {
                title: result.title,
                subtitle: result.domain,
                action: '↵',
                icon: result.favicon || '📖'
            },
            [ResultType.HISTORY]: {
                title: result.title,
                subtitle: result.domain,
                action: '↵',
                icon: result.favicon || '🕒'
            },
            [ResultType.TOP_SITE]: {
                title: result.title,
                subtitle: result.domain,
                action: '↵',
                icon: result.favicon || '⭐'
            }
        };

        return formatters[result.type] || {
            title: result.title,
            subtitle: result.url,
            action: '↵',
            icon: '🌐'
        };
    }

    // Handle result action (navigation, tab switching, etc.)
    async handleResultAction(result, mode) {
        try {
            switch (result.type) {
                case ResultType.OPEN_TAB:
                    if (mode === SpotlightMode.NEW_TAB) {
                        // Switch to existing tab
                        await chrome.tabs.update(result.metadata.tabId, { active: true });
                        await chrome.windows.update(result.metadata.windowId, { focused: true });
                    } else {
                        // Navigate current tab to the tab's URL
                        window.location.href = result.url;
                    }
                    break;

                case ResultType.URL_SUGGESTION:
                case ResultType.BOOKMARK:
                case ResultType.HISTORY:
                case ResultType.TOP_SITE:
                    if (mode === SpotlightMode.NEW_TAB) {
                        // Send message to background to open new tab
                        chrome.runtime.sendMessage({
                            action: 'openNewTab',
                            url: result.url
                        });
                    } else {
                        // Navigate current tab
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

    // Clear cache (useful for testing or manual refresh)
    clearCache() {
        this.cache.clear();
    }

    // Get cache statistics
    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}