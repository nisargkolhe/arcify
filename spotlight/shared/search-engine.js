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
        
        // Detect if we're running in background script context
        this.isBackgroundContext = this.dataProvider.constructor.name === 'BackgroundDataProvider';
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
    async handleResultAction(result, mode, currentTabId = null) {
        try {
            switch (result.type) {
                case ResultType.OPEN_TAB:
                    if (mode === SpotlightTabMode.NEW_TAB) {
                        if (!result.metadata?.tabId) {
                            throw new Error('OPEN_TAB result missing tabId in metadata');
                        }
                        
                        if (this.isBackgroundContext) {
                            await chrome.tabs.update(result.metadata.tabId, { active: true });
                            if (result.metadata.windowId) {
                                await chrome.windows.update(result.metadata.windowId, { focused: true });
                            }
                        } else {
                            const response = await chrome.runtime.sendMessage({
                                action: 'switchToTab',
                                tabId: result.metadata.tabId,
                                windowId: result.metadata.windowId
                            });
                            if (!response?.success) {
                                throw new Error('Failed to switch tab');
                            }
                        }
                    } else {
                        if (!result.url) {
                            throw new Error('OPEN_TAB result missing URL for current tab navigation');
                        }
                        
                        if (this.isBackgroundContext) {
                            if (currentTabId) {
                                // Use provided tab ID for faster navigation
                                await chrome.tabs.update(currentTabId, { url: result.url });
                            } else {
                                // Fallback to query
                                const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
                                if (activeTab) {
                                    await chrome.tabs.update(activeTab.id, { url: result.url });
                                } else {
                                    throw new Error('No active tab found');
                                }
                            }
                        } else {
                            const response = await chrome.runtime.sendMessage({
                                action: 'navigateCurrentTab',
                                url: result.url
                            });
                            if (!response?.success) {
                                throw new Error('Failed to navigate current tab');
                            }
                        }
                    }
                    break;

                case ResultType.URL_SUGGESTION:
                case ResultType.BOOKMARK:
                case ResultType.HISTORY:
                case ResultType.TOP_SITE:
                    if (!result.url) {
                        throw new Error(`${result.type} result missing URL`);
                    }
                    
                    if (mode === SpotlightTabMode.NEW_TAB) {
                        if (this.isBackgroundContext) {
                            await chrome.tabs.create({ url: result.url });
                        } else {
                            const response = await chrome.runtime.sendMessage({
                                action: 'openNewTab',
                                url: result.url
                            });
                            if (!response?.success) {
                                throw new Error('Failed to open new tab');
                            }
                        }
                    } else {
                        if (this.isBackgroundContext) {
                            if (currentTabId) {
                                // Use provided tab ID for faster navigation
                                await chrome.tabs.update(currentTabId, { url: result.url });
                            } else {
                                // Fallback to query
                                const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
                                if (activeTab) {
                                    await chrome.tabs.update(activeTab.id, { url: result.url });
                                } else {
                                    throw new Error('No active tab found');
                                }
                            }
                        } else {
                            const response = await chrome.runtime.sendMessage({
                                action: 'navigateCurrentTab',
                                url: result.url
                            });
                            if (!response?.success) {
                                throw new Error('Failed to navigate current tab');
                            }
                        }
                    }
                    break;

                case ResultType.SEARCH_QUERY:
                    if (!result.metadata?.query) {
                        throw new Error('SEARCH_QUERY result missing query in metadata');
                    }
                    
                    if (this.isBackgroundContext) {
                        const disposition = mode === SpotlightTabMode.NEW_TAB ? 'NEW_TAB' : 'CURRENT_TAB';
                        await chrome.search.query({
                            text: result.metadata.query,
                            disposition: disposition
                        });
                    } else {
                        const response = await chrome.runtime.sendMessage({
                            action: 'performSearch',
                            query: result.metadata.query,
                            mode: mode
                        });
                        if (!response?.success) {
                            throw new Error('Failed to perform search');
                        }
                    }
                    break;

                default:
                    throw new Error(`Unknown result type: ${result.type}`);
            }
        } catch (error) {
            console.error('[SearchEngine] Error handling result action:', error);
            throw error; // Re-throw to propagate to background script
        }
    }
}