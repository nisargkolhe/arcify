// search-engine.js - Shared search engine with caching and debouncing for spotlight components

import { ResultType, SpotlightTabMode } from './search-types.js';

// Search Engine with caching
export class SearchEngine {
    constructor(dataProvider) {
        if (!dataProvider) {
            throw new Error('SearchEngine requires a data provider');
        }
        this.dataProvider = dataProvider;
        this.cache = new Map();
        this.suggestionsTimeout = null;
        this.DEBOUNCE_DELAY = 150;
        this.CACHE_TTL = 30000;
    }

    // Main method to get spotlight suggestions with debouncing and caching
    getSpotlightSuggestionsUsingCache(query, mode = SpotlightTabMode.CURRENT_TAB) {
        return new Promise((resolve) => {
            clearTimeout(this.suggestionsTimeout);

            // Check cache first
            const cacheKey = `${query.trim()}:${mode}`;
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                resolve(cached.results);
                return;
            }

            // Debounced suggestions
            this.suggestionsTimeout = setTimeout(async () => {
                try {
                    const results = await this.getSuggestionsImpl(query, mode);
                    
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

    // Immediate suggestions without debouncing
    async getSpotlightSuggestionsImmediate(query, mode = SpotlightTabMode.CURRENT_TAB) {
        try {
            console.log('[SearchEngine] getSpotlightSuggestionsImmediate called');
            console.log('[SearchEngine] Query:', query, 'Mode:', mode);
            
            const results = await this.getSuggestionsImpl(query, mode);
            console.log('[SearchEngine] getSuggestionsImpl completed, results:', results.length);
            
            return results;
        } catch (error) {
            console.error('[SearchEngine] Immediate suggestions error:', error);
            console.error('[SearchEngine] Error stack:', error.stack);
            return [];
        }
    }

    // Internal suggestions implementation
    async getSuggestionsImpl(query, mode) {
        const trimmedQuery = query.trim();
        console.log('[SearchEngine] getSuggestionsImpl called with trimmed query:', trimmedQuery);
        
        // Delegate to data provider which has all the business logic
        console.log('[SearchEngine-DataProvider] Calling getSpotlightSuggestions on data provider');
        const results = await this.dataProvider.getSpotlightSuggestions(trimmedQuery, mode);
        console.log('[SearchEngine-DataProvider] getSpotlightSuggestions completed, results:', results.length);
        return results;
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
                subtitle: 'Search',
                action: '↵'
            },
            [ResultType.OPEN_TAB]: {
                title: result.title,
                subtitle: result.domain,
                action: mode === SpotlightTabMode.NEW_TAB ? 'Switch to Tab' : '↵'
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
            console.log('[SearchEngine] handleResultAction called');
            console.log('[SearchEngine] Result type:', result.type, 'Mode:', mode);
            console.log('[SearchEngine] Full result:', result);
            
            switch (result.type) {
                case ResultType.OPEN_TAB:
                    console.log('[SearchEngine] Handling OPEN_TAB result');
                    if (mode === SpotlightTabMode.NEW_TAB) {
                        console.log('[SearchEngine] NEW_TAB mode - sending switchToTab message');
                        // Send message to background script to switch tabs
                        chrome.runtime.sendMessage({
                            action: 'switchToTab',
                            tabId: result.metadata.tabId,
                            windowId: result.metadata.windowId
                        });
                    } else {
                        console.log('[SearchEngine] CURRENT_TAB mode - sending navigateCurrentTab message');
                        // For current-tab mode in popup, navigate current tab via background script
                        chrome.runtime.sendMessage({
                            action: 'navigateCurrentTab',
                            url: result.url
                        });
                    }
                    break;

                case ResultType.URL_SUGGESTION:
                case ResultType.BOOKMARK:
                case ResultType.HISTORY:
                case ResultType.TOP_SITE:
                    console.log('[SearchEngine] Handling URL/BOOKMARK/HISTORY/TOP_SITE result');
                    if (mode === SpotlightTabMode.NEW_TAB) {
                        console.log('[SearchEngine] NEW_TAB mode - sending openNewTab message');
                        chrome.runtime.sendMessage({
                            action: 'openNewTab',
                            url: result.url
                        });
                    } else {
                        console.log('[SearchEngine] CURRENT_TAB mode - sending navigateCurrentTab message');
                        // For current-tab mode in popup, navigate current tab via background script
                        chrome.runtime.sendMessage({
                            action: 'navigateCurrentTab',
                            url: result.url
                        });
                    }
                    break;

                case ResultType.SEARCH_QUERY:
                    console.log('[SearchEngine] Handling SEARCH_QUERY result');
                    // Use chrome.search API to search with the user's default search engine
                    chrome.runtime.sendMessage({
                        action: 'performSearch',
                        query: result.metadata.query,
                        mode: mode
                    });
                    break;

                default:
                    console.warn('[SearchEngine] Unknown result type:', result.type);
            }
            
            console.log('[SearchEngine] handleResultAction completed');
        } catch (error) {
            console.error('[SearchEngine] Error handling result action:', error);
            console.error('[SearchEngine] Error stack:', error.stack);
        }
    }
}