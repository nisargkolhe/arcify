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
        console.log('[SearchEngine] Context detected:', this.isBackgroundContext ? 'Background' : 'Content Script');
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
            console.log('[SearchEngine] ===== HANDLE RESULT ACTION START =====');
            console.log('[SearchEngine] handleResultAction called');
            console.log('[SearchEngine] Result type:', result.type);
            console.log('[SearchEngine] Mode:', mode);
            console.log('[SearchEngine] Result URL:', result.url);
            console.log('[SearchEngine] Result title:', result.title);
            console.log('[SearchEngine] Result metadata:', result.metadata);
            console.log('[SearchEngine] Full result object:', JSON.stringify(result, null, 2));
            
            switch (result.type) {
                case ResultType.OPEN_TAB:
                    console.log('[SearchEngine] ===== HANDLING OPEN_TAB RESULT =====');
                    if (mode === SpotlightTabMode.NEW_TAB) {
                        console.log('[SearchEngine] NEW_TAB mode - will switch to existing tab');
                        console.log('[SearchEngine] Tab ID:', result.metadata?.tabId);
                        console.log('[SearchEngine] Window ID:', result.metadata?.windowId);
                        
                        if (!result.metadata?.tabId) {
                            throw new Error('OPEN_TAB result missing tabId in metadata');
                        }
                        
                        if (this.isBackgroundContext) {
                            console.log('[SearchEngine] Background context - switching tabs directly');
                            await chrome.tabs.update(result.metadata.tabId, { active: true });
                            if (result.metadata.windowId) {
                                await chrome.windows.update(result.metadata.windowId, { focused: true });
                            }
                            console.log('[SearchEngine] ✅ Tab switched successfully');
                        } else {
                            const message = {
                                action: 'switchToTab',
                                tabId: result.metadata.tabId,
                                windowId: result.metadata.windowId
                            };
                            console.log('[SearchEngine] Sending switchToTab message:', JSON.stringify(message));
                            
                            // Send message to background script to switch tabs
                            const response = await chrome.runtime.sendMessage(message);
                            console.log('[SearchEngine] switchToTab response:', response);
                        }
                    } else {
                        console.log('[SearchEngine] CURRENT_TAB mode - will navigate current tab to:', result.url);
                        
                        if (!result.url) {
                            throw new Error('OPEN_TAB result missing URL for current tab navigation');
                        }
                        
                        if (this.isBackgroundContext) {
                            console.log('[SearchEngine] Background context - navigating current tab directly');
                            const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
                            if (activeTab) {
                                await chrome.tabs.update(activeTab.id, { url: result.url });
                                console.log('[SearchEngine] ✅ Current tab navigated successfully');
                            } else {
                                throw new Error('No active tab found');
                            }
                        } else {
                            const message = {
                                action: 'navigateCurrentTab',
                                url: result.url
                            };
                            console.log('[SearchEngine] Sending navigateCurrentTab message:', JSON.stringify(message));
                            
                            // For current-tab mode in popup, navigate current tab via background script
                            const response = await chrome.runtime.sendMessage(message);
                            console.log('[SearchEngine] navigateCurrentTab response:', response);
                        }
                    }
                    break;

                case ResultType.URL_SUGGESTION:
                case ResultType.BOOKMARK:
                case ResultType.HISTORY:
                case ResultType.TOP_SITE:
                    console.log('[SearchEngine] ===== HANDLING URL/BOOKMARK/HISTORY/TOP_SITE RESULT =====');
                    console.log('[SearchEngine] Result type:', result.type);
                    console.log('[SearchEngine] URL to navigate to:', result.url);
                    
                    if (!result.url) {
                        throw new Error(`${result.type} result missing URL`);
                    }
                    
                    if (mode === SpotlightTabMode.NEW_TAB) {
                        console.log('[SearchEngine] NEW_TAB mode - will open new tab');
                        
                        if (this.isBackgroundContext) {
                            console.log('[SearchEngine] Background context - creating new tab directly');
                            await chrome.tabs.create({ url: result.url });
                            console.log('[SearchEngine] ✅ New tab created successfully');
                        } else {
                            const message = {
                                action: 'openNewTab',
                                url: result.url
                            };
                            console.log('[SearchEngine] Sending openNewTab message:', JSON.stringify(message));
                            
                            const response = await chrome.runtime.sendMessage(message);
                            console.log('[SearchEngine] openNewTab response:', response);
                        }
                    } else {
                        console.log('[SearchEngine] CURRENT_TAB mode - will navigate current tab');
                        
                        if (this.isBackgroundContext) {
                            console.log('[SearchEngine] Background context - navigating current tab directly');
                            const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
                            if (activeTab) {
                                await chrome.tabs.update(activeTab.id, { url: result.url });
                                console.log('[SearchEngine] ✅ Current tab navigated successfully');
                            } else {
                                throw new Error('No active tab found');
                            }
                        } else {
                            const message = {
                                action: 'navigateCurrentTab',
                                url: result.url
                            };
                            console.log('[SearchEngine] Sending navigateCurrentTab message:', JSON.stringify(message));
                            
                            // For current-tab mode in popup, navigate current tab via background script
                            const response = await chrome.runtime.sendMessage(message);
                            console.log('[SearchEngine] navigateCurrentTab response:', response);
                        }
                    }
                    break;

                case ResultType.SEARCH_QUERY:
                    console.log('[SearchEngine] ===== HANDLING SEARCH_QUERY RESULT =====');
                    console.log('[SearchEngine] Search query:', result.metadata?.query);
                    
                    if (!result.metadata?.query) {
                        throw new Error('SEARCH_QUERY result missing query in metadata');
                    }
                    
                    if (this.isBackgroundContext) {
                        console.log('[SearchEngine] Background context - performing search directly');
                        const disposition = mode === SpotlightTabMode.NEW_TAB ? 'NEW_TAB' : 'CURRENT_TAB';
                        
                        await chrome.search.query({
                            text: result.metadata.query,
                            disposition: disposition
                        });
                        console.log('[SearchEngine] ✅ Search performed successfully');
                    } else {
                        const message = {
                            action: 'performSearch',
                            query: result.metadata.query,
                            mode: mode
                        };
                        console.log('[SearchEngine] Sending performSearch message:', JSON.stringify(message));
                        
                        // Use chrome.search API to search with the user's default search engine
                        const response = await chrome.runtime.sendMessage(message);
                        console.log('[SearchEngine] performSearch response:', response);
                    }
                    break;

                default:
                    console.error('[SearchEngine] ❌ Unknown result type:', result.type);
                    throw new Error(`Unknown result type: ${result.type}`);
            }
            
            console.log('[SearchEngine] ✅ handleResultAction completed successfully');
            console.log('[SearchEngine] ===== HANDLE RESULT ACTION END =====');
        } catch (error) {
            console.error('[SearchEngine] ❌ Error handling result action:', error);
            console.error('[SearchEngine] Error name:', error.name);
            console.error('[SearchEngine] Error message:', error.message);
            console.error('[SearchEngine] Error stack:', error.stack);
            console.log('[SearchEngine] ===== HANDLE RESULT ACTION ERROR =====');
            throw error; // Re-throw to propagate to background script
        }
    }
}