// spotlight-overlay-fixed.js - Self-contained spotlight with embedded search
// Privacy-safe content script injected on-demand only

(function(spotlightTabMode = 'current-tab') {
    
    // Result type constants
    const ResultType = {
        URL_SUGGESTION: 'url-suggestion',
        SEARCH_QUERY: 'search-query',
        OPEN_TAB: 'open-tab',
        BOOKMARK: 'bookmark',
        HISTORY: 'history',
        TOP_SITE: 'top-site'
    };

    // Spotlight mode constants
    const SpotlightMode = {
        CURRENT_TAB: 'current-tab',
        NEW_TAB: 'new-tab'
    };

    // Enum for spotlight tab modes (declared inside IIFE to avoid redeclaration)
    const SpotlightTabMode = {
        CURRENT_TAB: 'current-tab',
        NEW_TAB: 'new-tab'
    };

    // Search Result class
    class SearchResult {
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

    // Search Data Provider
    class SearchDataProvider {
        constructor() {
            this.cache = new Map();
            this.cacheTimeout = 5000;
        }

        // Main search method
        async search(query, mode = 'current-tab') {
            const results = [];
            const trimmedQuery = query.trim().toLowerCase();
            
            console.log('[Spotlight] Starting search with query:', trimmedQuery, 'mode:', mode);

            if (!trimmedQuery) {
                console.log('[Spotlight] Empty query, getting default results');
                return this.getDefaultResults(mode);
            }

            try {
                console.log('[Spotlight] Fetching results from all sources...');
                
                // Get results from different sources with individual error handling
                let openTabs = [];
                let bookmarks = [];
                let history = [];
                let topSites = [];

                // Get tabs (only in new-tab mode)
                if (mode === 'new-tab') {
                    try {
                        openTabs = await this.getOpenTabs(trimmedQuery);
                    } catch (error) {
                        console.error('[Spotlight] Failed to get open tabs:', error);
                        openTabs = [];
                    }
                }

                // Get bookmarks
                try {
                    bookmarks = await this.searchBookmarks(trimmedQuery);
                } catch (error) {
                    console.error('[Spotlight] Failed to get bookmarks:', error);
                    bookmarks = [];
                }

                // Get history
                try {
                    history = await this.searchHistory(trimmedQuery);
                } catch (error) {
                    console.error('[Spotlight] Failed to get history:', error);
                    history = [];
                }

                // Get top sites
                try {
                    topSites = await this.getTopSites();
                } catch (error) {
                    console.error('[Spotlight] Failed to get top sites:', error);
                    topSites = [];
                }

                console.log('[Spotlight] Individual results:');
                console.log('  - Open tabs:', openTabs.length);
                console.log('  - Bookmarks:', bookmarks.length);
                console.log('  - History:', history.length);
                console.log('  - Top sites:', topSites.length);

                // Add URL/search suggestions
                if (this.isURL(trimmedQuery)) {
                    console.log('[Spotlight] Adding URL suggestion for:', trimmedQuery);
                    results.push(this.generateURLSuggestion(trimmedQuery));
                } else {
                    console.log('[Spotlight] Adding search suggestion for:', trimmedQuery);
                    results.push(this.generateSearchSuggestion(trimmedQuery));
                }

                // Add other results
                results.push(...openTabs, ...bookmarks, ...history);
                
                // Add top sites that match query
                const matchingTopSites = topSites.filter(site => 
                    site.title.toLowerCase().includes(trimmedQuery) ||
                    site.url.toLowerCase().includes(trimmedQuery)
                );
                console.log('[Spotlight] Matching top sites:', matchingTopSites.length);
                results.push(...matchingTopSites);

                console.log('[Spotlight] Total results before scoring:', results.length);
                // Score and sort results
                const finalResults = this.scoreAndSortResults(results, trimmedQuery);
                console.log('[Spotlight] Final results after scoring:', finalResults.length);
                return finalResults;
            } catch (error) {
                console.error('[Spotlight] Search error:', error);
                return [this.generateFallbackResult(trimmedQuery)];
            }
        }

        // Get default results when no query
        async getDefaultResults(mode) {
            const results = [];

            try {
                if (mode === 'new-tab') {
                    // Show recent tabs for new tab mode
                    const recentTabs = await this.getRecentTabs(5);
                    results.push(...recentTabs);
                }

                // Show top sites as suggestions
                const topSites = await this.getTopSites();
                results.push(...topSites.slice(0, 4));
            } catch (error) {
                console.error('Error getting default results:', error);
            }

            return results;
        }

        // Chrome tabs API integration via background script
        async getOpenTabs(query = '') {
            try {
                console.log('[Spotlight] Requesting tabs with query:', query);
                const response = await chrome.runtime.sendMessage({
                    action: 'searchTabs',
                    query: query
                });
                
                console.log('[Spotlight] Tabs response:', response);
                if (response && response.success) {
                    const results = response.tabs.map(tab => new SearchResult({
                        type: ResultType.OPEN_TAB,
                        title: tab.title,
                        url: tab.url,
                        favicon: tab.favIconUrl,
                        metadata: { tabId: tab.id, windowId: tab.windowId }
                    }));
                    console.log('[Spotlight] Created tab results:', results.length);
                    return results;
                }
                console.log('[Spotlight] No valid tabs response');
                return [];
            } catch (error) {
                console.error('[Spotlight] Error querying tabs:', error);
                return [];
            }
        }

        // Get recent tabs by activity via background script
        async getRecentTabs(limit = 5) {
            try {
                console.log('[Spotlight] Requesting recent tabs, limit:', limit);
                const response = await chrome.runtime.sendMessage({
                    action: 'getRecentTabs',
                    limit: limit
                });
                
                console.log('[Spotlight] Recent tabs response:', response);
                if (response && response.success) {
                    const results = response.tabs.map(tab => new SearchResult({
                        type: ResultType.OPEN_TAB,
                        title: tab.title,
                        url: tab.url,
                        favicon: tab.favIconUrl,
                        metadata: { tabId: tab.id, windowId: tab.windowId }
                    }));
                    console.log('[Spotlight] Created recent tab results:', results.length);
                    return results;
                }
                console.log('[Spotlight] No valid recent tabs response');
                return [];
            } catch (error) {
                console.error('[Spotlight] Error getting recent tabs:', error);
                return [];
            }
        }

        // Chrome bookmarks API integration via background script
        async searchBookmarks(query) {
            try {
                console.log('[Spotlight] Requesting bookmarks with query:', query);
                const response = await chrome.runtime.sendMessage({
                    action: 'searchBookmarks',
                    query: query
                });
                
                console.log('[Spotlight] Bookmarks response:', response);
                if (response && response.success) {
                    const results = response.bookmarks.map(bookmark => new SearchResult({
                        type: ResultType.BOOKMARK,
                        title: bookmark.title,
                        url: bookmark.url,
                        metadata: { bookmarkId: bookmark.id }
                    }));
                    console.log('[Spotlight] Created bookmark results:', results.length);
                    return results;
                }
                console.log('[Spotlight] No valid bookmarks response');
                return [];
            } catch (error) {
                console.error('[Spotlight] Error searching bookmarks:', error);
                return [];
            }
        }

        // Chrome history API integration via background script
        async searchHistory(query) {
            try {
                console.log('[Spotlight] Requesting history with query:', query);
                const response = await chrome.runtime.sendMessage({
                    action: 'searchHistory',
                    query: query
                });
                
                console.log('[Spotlight] History response:', response);
                if (response && response.success) {
                    const results = response.history.map(item => new SearchResult({
                        type: ResultType.HISTORY,
                        title: item.title || item.url,
                        url: item.url,
                        metadata: { visitCount: item.visitCount, lastVisitTime: item.lastVisitTime }
                    }));
                    console.log('[Spotlight] Created history results:', results.length);
                    return results;
                }
                console.log('[Spotlight] No valid history response');
                return [];
            } catch (error) {
                console.error('[Spotlight] Error searching history:', error);
                return [];
            }
        }

        // Chrome topSites API integration via background script
        async getTopSites() {
            try {
                console.log('[Spotlight] Requesting top sites');
                const response = await chrome.runtime.sendMessage({
                    action: 'getTopSites'
                });
                
                console.log('[Spotlight] Top sites response:', response);
                if (response && response.success) {
                    const results = response.topSites.map(site => new SearchResult({
                        type: ResultType.TOP_SITE,
                        title: site.title,
                        url: site.url
                    }));
                    console.log('[Spotlight] Created top sites results:', results.length);
                    return results;
                }
                console.log('[Spotlight] No valid top sites response');
                return [];
            } catch (error) {
                console.error('[Spotlight] Error getting top sites:', error);
                return [];
            }
        }

        // URL detection utility
        isURL(text) {
            // Check if it's already a complete URL
            try {
                new URL(text);
                return true;
            } catch {}

            // Check for domain-like patterns
            const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
            if (domainPattern.test(text)) {
                return true;
            }

            // Check for localhost
            if (text === 'localhost' || text.startsWith('localhost:')) {
                return true;
            }

            // Check for IP addresses
            if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(text)) {
                const parts = text.split(':')[0].split('.');
                return parts.every(part => {
                    const num = parseInt(part, 10);
                    return num >= 0 && num <= 255;
                });
            }

            // Common URL patterns without protocol
            if (/^[a-zA-Z0-9-]+\.(com|org|net|edu|gov|mil|int|co|io|ly|me|tv|app|dev|ai)([\/\?\#].*)?$/.test(text)) {
                return true;
            }

            return false;
        }

        // Generate URL suggestion
        generateURLSuggestion(input) {
            const url = input.startsWith('http') ? input : `https://${input}`;
            return new SearchResult({
                type: ResultType.URL_SUGGESTION,
                title: `Navigate to ${url}`,
                url: url,
                score: 95
            });
        }

        // Generate search suggestion
        generateSearchSuggestion(input) {
            return new SearchResult({
                type: ResultType.SEARCH_QUERY,
                title: `Search for "${input}"`,
                url: `https://www.google.com/search?q=${encodeURIComponent(input)}`,
                score: 80,
                metadata: { query: input }
            });
        }

        // Generate fallback result for errors
        generateFallbackResult(input) {
            if (this.isURL(input)) {
                return this.generateURLSuggestion(input);
            } else {
                return this.generateSearchSuggestion(input);
            }
        }

        // Score and sort results
        scoreAndSortResults(results, query) {
            results.forEach(result => {
                result.score = this.calculateRelevanceScore(result, query);
            });

            return results
                .sort((a, b) => b.score - a.score)
                .slice(0, 8);
        }

        // Relevance scoring algorithm
        calculateRelevanceScore(result, query) {
            let baseScore = 0;

            switch (result.type) {
                case ResultType.OPEN_TAB: baseScore = 100; break;
                case ResultType.URL_SUGGESTION: baseScore = 95; break;
                case ResultType.BOOKMARK: baseScore = 85; break;
                case ResultType.SEARCH_QUERY: baseScore = 80; break;
                case ResultType.TOP_SITE: baseScore = 70; break;
                case ResultType.HISTORY: baseScore = 60; break;
            }

            const queryLower = query.toLowerCase();
            const titleLower = result.title.toLowerCase();
            const urlLower = result.url.toLowerCase();

            if (titleLower === queryLower) baseScore += 20;
            else if (titleLower.startsWith(queryLower)) baseScore += 15;
            else if (titleLower.includes(queryLower)) baseScore += 10;

            if (urlLower.includes(queryLower)) baseScore += 5;

            return Math.max(0, baseScore);
        }
    }

    // Search Engine with caching
    class SearchEngine {
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
    
    // Handle toggle functionality for existing spotlight
    const existingDialog = document.getElementById('arcify-spotlight-dialog');
    if (existingDialog) {
        if (existingDialog.open) {
            existingDialog.close();
        } else {
            existingDialog.showModal();
            const input = existingDialog.querySelector('.arcify-spotlight-input');
            if (input) {
                setTimeout(() => {
                    input.focus();
                    input.select();
                    input.scrollLeft = 0;
                }, 50);
            }
        }
        return;
    }
    
    // Mark as injected only when creating new dialog
    window.arcifySpotlightInjected = true;

    // CSS styles (same as before)
    const spotlightCSS = `
        #arcify-spotlight-dialog {
            border: none;
            padding: 0;
            background: transparent;
            border-radius: 12px;
            width: 650px;
            max-width: 90vw;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
        }

        #arcify-spotlight-dialog::backdrop {
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }

        .arcify-spotlight-container {
            background: #2D2D2D;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #ffffff;
            position: relative;
            overflow: hidden;
        }

        .arcify-spotlight-input-wrapper {
            display: flex;
            align-items: center;
            padding: 12px 24px 12px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .arcify-spotlight-search-icon {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            opacity: 0.6;
            flex-shrink: 0;
        }

        .arcify-spotlight-input {
            flex: 1;
            background: transparent;
            border: none;
            color: #ffffff;
            font-size: 18px;
            line-height: 24px;
            padding: 8px 0;
            outline: none;
            font-weight: 400;
        }

        .arcify-spotlight-input::placeholder {
            color: rgba(255, 255, 255, 0.5);
        }

        .arcify-spotlight-input:focus {
            outline: none;
        }

        .arcify-spotlight-results {
            max-height: 400px;
            overflow-y: auto;
            padding: 8px 0;
        }

        .arcify-spotlight-result-item {
            display: flex;
            align-items: center;
            padding: 12px 24px 12px 20px;
            cursor: pointer;
            transition: background-color 0.15s ease;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            color: inherit;
            font-family: inherit;
        }

        .arcify-spotlight-result-item:hover,
        .arcify-spotlight-result-item:focus {
            background: rgba(139, 92, 246, 0.15);
            outline: none;
        }

        .arcify-spotlight-result-item.selected {
            background: rgba(139, 92, 246, 0.2);
        }

        .arcify-spotlight-result-favicon {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            border-radius: 4px;
            flex-shrink: 0;
        }

        .arcify-spotlight-result-content {
            flex: 1;
            min-width: 0;
        }

        .arcify-spotlight-result-title {
            font-size: 14px;
            font-weight: 500;
            color: #ffffff;
            margin: 0 0 2px 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .arcify-spotlight-result-url {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.6);
            margin: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .arcify-spotlight-result-action {
            font-size: 12px;
            color: rgba(139, 92, 246, 0.8);
            margin-left: 12px;
            flex-shrink: 0;
        }

        .arcify-spotlight-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: rgba(255, 255, 255, 0.6);
        }

        .arcify-spotlight-empty {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: rgba(255, 255, 255, 0.6);
            font-size: 14px;
        }

        #arcify-spotlight-dialog {
            animation: arcify-spotlight-show 0.2s ease-out;
        }

        @keyframes arcify-spotlight-show {
            from {
                opacity: 0;
                transform: scale(0.95) translateY(-10px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        @media (max-width: 640px) {
            #arcify-spotlight-dialog {
                width: 95vw;
                margin: 20px auto;
            }
            
            .arcify-spotlight-input {
                font-size: 16px;
            }
        }
    `;

    // Create and inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = spotlightCSS;
    document.head.appendChild(styleSheet);

    // Create spotlight dialog
    const dialog = document.createElement('dialog');
    dialog.id = 'arcify-spotlight-dialog';
    
    dialog.innerHTML = `
        <div class="arcify-spotlight-container">
            <div class="arcify-spotlight-input-wrapper">
                <svg class="arcify-spotlight-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <input 
                    type="text" 
                    class="arcify-spotlight-input" 
                    placeholder="${spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'Search or enter URL (opens in new tab)...' : 'Search or enter URL...'}"
                    spellcheck="false"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                >
            </div>
            <div class="arcify-spotlight-results">
                <div class="arcify-spotlight-loading">Loading...</div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // Get references to key elements
    const input = dialog.querySelector('.arcify-spotlight-input');
    const resultsContainer = dialog.querySelector('.arcify-spotlight-results');
    
    // Initialize search engine
    const searchEngine = new SearchEngine();
    let currentResults = [];

    // Selection Manager
    class SelectionManager {
        constructor(container) {
            this.container = container;
            this.selectedIndex = 0;
            this.results = [];
        }

        updateResults(newResults) {
            this.results = newResults;
            this.selectedIndex = 0;
            this.updateVisualSelection();
        }

        moveSelection(direction) {
            const maxIndex = this.results.length - 1;
            
            if (direction === 'down') {
                this.selectedIndex = Math.min(this.selectedIndex + 1, maxIndex);
            } else if (direction === 'up') {
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            }
            
            this.updateVisualSelection();
        }

        moveToFirst() {
            this.selectedIndex = 0;
            this.updateVisualSelection();
        }

        moveToLast() {
            this.selectedIndex = Math.max(0, this.results.length - 1);
            this.updateVisualSelection();
        }

        getSelectedResult() {
            return this.results[this.selectedIndex] || null;
        }

        updateVisualSelection() {
            const items = this.container.querySelectorAll('.arcify-spotlight-result-item');
            items.forEach((item, index) => {
                item.classList.toggle('selected', index === this.selectedIndex);
            });
        }
    }

    const selectionManager = new SelectionManager(resultsContainer);

    // Load initial results
    async function loadInitialResults() {
        try {
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            const results = await searchEngine.searchImmediate('', mode);
            displayResults(results);
        } catch (error) {
            console.error('Error loading initial results:', error);
            displayEmptyState();
        }
    }

    // Pre-fill URL in current-tab mode
    if (spotlightTabMode === SpotlightTabMode.CURRENT_TAB && window.arcifyCurrentTabUrl) {
        input.value = window.arcifyCurrentTabUrl;
        setTimeout(() => {
            handleInput();
        }, 10);
    } else {
        // Load initial results
        loadInitialResults();
    }

    // Handle input changes
    async function handleInput() {
        const query = input.value.trim();
        
        if (!query) {
            loadInitialResults();
            return;
        }

        // Show loading state
        resultsContainer.innerHTML = '<div class="arcify-spotlight-loading">Searching...</div>';

        try {
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            const results = await searchEngine.search(query, mode);
            displayResults(results);
        } catch (error) {
            console.error('Search error:', error);
            displayEmptyState();
        }
    }

    // Display search results
    function displayResults(results) {
        currentResults = results;
        selectionManager.updateResults(results);

        if (!results || results.length === 0) {
            displayEmptyState();
            return;
        }

        const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
        const html = results.map((result, index) => {
            const formatted = searchEngine.formatResult(result, mode);
            const isSelected = index === 0;
            
            return `
                <button class="arcify-spotlight-result-item ${isSelected ? 'selected' : ''}" 
                        data-index="${index}">
                    <img class="arcify-spotlight-result-favicon" 
                         src="${getFaviconUrl(result)}" 
                         alt="favicon"
                         onerror="this.src='data:image/svg+xml,${encodeURIComponent('<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\"><circle cx=\\"11\\" cy=\\"11\\" r=\\"8\\"></circle><path d=\\"m21 21-4.35-4.35\\"></path></svg>')}'">
                    <div class="arcify-spotlight-result-content">
                        <div class="arcify-spotlight-result-title">${escapeHtml(formatted.title)}</div>
                        <div class="arcify-spotlight-result-url">${escapeHtml(formatted.subtitle)}</div>
                    </div>
                    <div class="arcify-spotlight-result-action">${escapeHtml(formatted.action)}</div>
                </button>
            `;
        }).join('');

        resultsContainer.innerHTML = html;
    }

    // Get favicon URL with fallback
    function getFaviconUrl(result) {
        if (result.favicon && result.favicon.startsWith('http')) {
            return result.favicon;
        }
        
        if (result.url) {
            try {
                const url = new URL(result.url.startsWith('http') ? result.url : `https://${result.url}`);
                return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
            } catch {
                // Fallback for invalid URLs
            }
        }

        return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>')}`;
    }

    // Display empty state
    function displayEmptyState() {
        resultsContainer.innerHTML = '<div class="arcify-spotlight-empty">Start typing to search tabs, bookmarks, and history</div>';
        currentResults = [];
        selectionManager.updateResults([]);
    }

    // Escape HTML utility
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Debounced input handler
    let inputTimeout;
    input.addEventListener('input', () => {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(handleInput, 150);
    });

    // Handle result selection
    async function handleResultAction(result) {
        if (!result) return;

        try {
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            await searchEngine.handleResultAction(result, mode);
            closeSpotlight();
        } catch (error) {
            console.error('Error handling result action:', error);
        }
    }

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        if (!dialog.contains(document.activeElement)) {
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                e.stopPropagation();
                selectionManager.moveSelection('down');
                break;

            case 'ArrowUp':
                e.preventDefault();
                e.stopPropagation();
                selectionManager.moveSelection('up');
                break;

            case 'Home':
                e.preventDefault();
                e.stopPropagation();
                selectionManager.moveToFirst();
                break;

            case 'End':
                e.preventDefault();
                e.stopPropagation();
                selectionManager.moveToLast();
                break;

            case 'Enter':
                e.preventDefault();
                e.stopPropagation();
                const selected = selectionManager.getSelectedResult();
                if (selected) {
                    handleResultAction(selected);
                }
                break;

            case 'Escape':
                e.preventDefault();
                e.stopPropagation();
                closeSpotlight();
                break;
        }
    });

    // Handle clicks on results
    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.arcify-spotlight-result-item');
        if (item) {
            const index = parseInt(item.dataset.index);
            const result = currentResults[index];
            if (result) {
                handleResultAction(result);
            }
        }
    });

    // Close spotlight function
    function closeSpotlight() {
        dialog.close();
        
        chrome.runtime.sendMessage({
            action: 'spotlightClosed'
        });
        
        setTimeout(() => {
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
                styleSheet.parentNode.removeChild(styleSheet);
                window.arcifySpotlightInjected = false;
            }
        }, 200);
    }

    // Handle backdrop clicks
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeSpotlight();
        }
    });

    dialog.addEventListener('close', closeSpotlight);

    // Show dialog and focus input
    dialog.showModal();
    
    setTimeout(() => {
        input.focus();
        input.select();
        input.scrollLeft = 0;
    }, 50);

})(window.arcifySpotlightTabMode);