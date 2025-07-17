// spotlight-overlay-fixed.js - Self-contained spotlight with embedded search
// Privacy-safe content script injected on-demand only

(async function(spotlightTabMode = 'current-tab') {
    
    // Constants are defined in search-types.js, duplicated here because injected content scripts
    // cannot import other modules / files.
    // IMPORTANT: Update these constants when updating them in search-types.js (and vice versa).
    // Result type constants
    const ResultType = {
        URL_SUGGESTION: 'url-suggestion',
        SEARCH_QUERY: 'search-query',
        OPEN_TAB: 'open-tab',
        BOOKMARK: 'bookmark',
        HISTORY: 'history',
        TOP_SITE: 'top-site'
    };

    // Spotlight tab mode constants
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

    // Utility functions for overlay UI
    function isURL(text) {
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

    // Function to get accent color CSS based on active space color
    function getAccentColorCSS(spaceColor) {
        // RGB values for each color name (matching --chrome-*-color variables in styles.css)
        // We need this mapping to create rgba() variants with different opacities
        // Can't directly reuse the constants in styles.css due to two reasons:
        //   1. Color constants are in hexcode, cannot use this value in rgba
        //   2. CSS is not directly available in content scripts
        const colorMap = {
            grey: '204, 204, 204',
            blue: '139, 179, 243',
            red: '255, 158, 151',
            yellow: '255, 226, 159',
            green: '139, 218, 153',
            pink: '251, 170, 215',
            purple: '214, 166, 255',
            cyan: '165, 226, 234'
        };

        const rgb = colorMap[spaceColor] || colorMap.purple; // Fallback to purple

        return `
            :root {
                --spotlight-accent-color: rgb(${rgb});
                --spotlight-accent-color-15: rgba(${rgb}, 0.15);
                --spotlight-accent-color-20: rgba(${rgb}, 0.2);
                --spotlight-accent-color-80: rgba(${rgb}, 0.8);
            }
        `;
    }

    // Format result for display (moved from SearchEngine)
    function formatResult(result, mode) {
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

    // Get active space color
    let activeSpaceColor = 'purple'; // Default fallback
    try {
        const colorResponse = await chrome.runtime.sendMessage({
            action: 'getActiveSpaceColor'
        });
        if (colorResponse && colorResponse.success && colorResponse.color) {
            activeSpaceColor = colorResponse.color;
            console.log('[Spotlight] Using active space color:', activeSpaceColor);
        }
    } catch (error) {
        console.log('[Spotlight] Failed to get active space color, using default:', error);
    }

    // CSS styles with dynamic accent color
    const accentColorDefinitions = getAccentColorCSS(activeSpaceColor);
    const spotlightCSS = `
        ${accentColorDefinitions}
        
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
            background: var(--spotlight-accent-color-15);
            outline: none;
        }

        .arcify-spotlight-result-item.selected {
            background: var(--spotlight-accent-color-20);
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
            color: var(--spotlight-accent-color-80);
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
    
    // Initialize spotlight state
    let currentResults = [];
    let searchTimeout = null;
    const DEBOUNCE_DELAY = 150;

    // Search function using message passing to background script
    async function performSearch(query, mode, immediate = false) {
        return new Promise((resolve) => {
            if (!immediate) {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(async () => {
                    const results = await sendGetSuggestionsMessage(query, mode);
                    resolve(results);
                }, DEBOUNCE_DELAY);
            } else {
                sendGetSuggestionsMessage(query, mode).then(resolve);
            }
        });
    }

    // Send get suggestions message to background script
    async function sendGetSuggestionsMessage(query, mode) {
        try {
            console.log('[Spotlight] Sending get suggestions request:', query, mode);
            const response = await chrome.runtime.sendMessage({
                action: 'getSpotlightSuggestions',
                query: query.trim(),
                mode: mode
            });
            
            if (response && response.success) {
                console.log('[Spotlight] Suggestions received:', response.results.length);
                return response.results;
            } else {
                console.error('[Spotlight] Get suggestions failed:', response?.error);
                return [];
            }
        } catch (error) {
            console.error('[Spotlight] Get suggestions error:', error);
            return [];
        }
    }

    // Handle result action via message passing
    async function handleResultActionViaMessage(result, mode) {
        try {
            console.log('[Spotlight] Handling result action:', result.type, mode);
            const response = await chrome.runtime.sendMessage({
                action: 'spotlightHandleResult',
                result: result,
                mode: mode
            });
            
            if (response && !response.success) {
                console.error('[Spotlight] Result action failed:', response.error);
            }
        } catch (error) {
            console.error('[Spotlight] Error handling result action:', error);
        }
    }

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
            const results = await performSearch('', mode, true);
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

        // Keep previous results while searching (no loading state to avoid jittery UI)
        try {
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            const results = await performSearch(query, mode, false);
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
            const formatted = formatResult(result, mode);
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
            await handleResultActionViaMessage(result, mode);
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