/**
 * Search Engine - Core search orchestration with caching and debouncing
 * 
 * Purpose: Orchestrates search across multiple data sources with performance optimizations
 * Key Functions: Search result aggregation, caching, debouncing, result formatting, action handling
 * Architecture: Dependency injection pattern - takes data provider in constructor for context flexibility
 * 
 * Critical Notes:
 * - Uses dependency injection to work in both background (direct API) and content script (message) contexts
 * - Implements 30-second caching and 150ms debouncing for performance
 * - Handles result actions (navigation, tab switching) with tab ID optimization
 * - Single SearchEngine instance per context, shared across overlay/popup implementations
 */

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
            const results = await this.getSuggestionsImpl(query, mode);
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
        
        // Delegate to data provider which has all the business logic
        const results = await this.dataProvider.getSpotlightSuggestions(trimmedQuery, mode);
        return results;
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

                case ResultType.PINNED_TAB:
                    console.log('[SearchEngine] Handling PINNED_TAB result:', result);
                    if (!result.metadata?.spaceId) {
                        throw new Error('PINNED_TAB result missing spaceId in metadata');
                    }
                    
                    const pinnedTabMessage = {
                        action: 'activatePinnedTab',
                        spaceId: result.metadata.spaceId,
                        spaceName: result.metadata.spaceName,
                        bookmarkUrl: result.url,
                        mode: mode
                    };
                    console.log('[SearchEngine] Sending activatePinnedTab message:', pinnedTabMessage);
                    
                    // Send message to sidebar to handle pinned tab activation
                    if (this.isBackgroundContext) {
                        // Send message to sidebar via runtime messaging
                        chrome.runtime.sendMessage(pinnedTabMessage);
                        console.log('[SearchEngine] Message sent from background context');
                    } else {
                        // From content script, send message to background which will forward to sidebar
                        const response = await chrome.runtime.sendMessage(pinnedTabMessage);
                        console.log('[SearchEngine] Message sent from content script, response:', response);
                        if (!response?.success) {
                            throw new Error('Failed to activate pinned tab');
                        }
                    }
                    break;

                case ResultType.URL_SUGGESTION:
                case ResultType.AUTOCOMPLETE_SUGGESTION:
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