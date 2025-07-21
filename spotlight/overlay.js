/**
 * Spotlight Overlay - Content script implementation of command bar interface
 * 
 * Purpose: Primary spotlight implementation injected into web pages as content script
 * Key Functions: Real-time search across tabs/bookmarks/history, instant suggestions, keyboard navigation
 * Architecture: Self-contained IIFE bundle with embedded UI and shared spotlight modules
 * 
 * Critical Notes:
 * - Injected by background script with automatic popup fallback for restricted URLs
 * - Bundled as single file via Vite for content script compatibility (no ES6 imports)
 * - Only injected on-demand for privacy - no persistent content script presence
 * - Uses modal dialog with backdrop blur for non-intrusive overlay experience
 * - Handles URL prefill, tab ID injection, and optimized navigation for current-tab mode
 */

import { SpotlightUtils } from './shared/ui-utilities.js';
import { SelectionManager } from './shared/selection-manager.js';
import { SpotlightMessageClient } from './shared/message-client.js';
import { SpotlightTabMode } from './shared/search-types.js';

(async function(spotlightTabMode = 'current-tab') {
    
    // Handle toggle functionality for existing spotlight
    const existingDialog = document.getElementById('arcify-spotlight-dialog');
    if (existingDialog) {
        if (existingDialog.open) {
            existingDialog.close();
        } else {
            existingDialog.showModal();
            
            // Notify background that spotlight opened in this tab
            SpotlightMessageClient.notifyOpened();
            
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
        activeSpaceColor = await SpotlightMessageClient.getActiveSpaceColor();
    } catch (error) {
        console.error('[Spotlight] Failed to get active space color:', error);
    }

    // CSS styles with dynamic accent color
    const accentColorDefinitions = SpotlightUtils.getAccentColorCSS(activeSpaceColor);
    const spotlightCSS = `
        ${accentColorDefinitions}
        
        #arcify-spotlight-dialog {
            margin: 0;
            position: fixed;
            /* Not fully centered but this looks better than 50vh */
            top: calc(35vh);
            left: 50%;
            transform: translateX(-50%);
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

        #arcify-spotlight-dialog .arcify-spotlight-input-wrapper {
            display: flex;
            align-items: center;
            padding: 12px 24px 12px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        #arcify-spotlight-dialog .arcify-spotlight-search-icon {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            opacity: 0.6;
            flex-shrink: 0;
        }

        /* 
            Specific CSS directives to override styling on specific pages (stackoverflow, chrome docs).
            Otherwise the spotlight bar has a white background and some other weird UI.
        */
        #arcify-spotlight-dialog .arcify-spotlight-input {
            flex: 1 !important;
            background: transparent !important;
            background-color: transparent !important;
            background-image: none !important;
            border: none !important;
            border-style: none !important;
            border-width: 0 !important;
            border-color: transparent !important;
            color: #ffffff !important;
            font-size: 18px !important;
            line-height: 24px !important;
            padding: 8px 0 !important;
            margin: 0 !important;
            outline: none !important;
            outline-style: none !important;
            outline-width: 0 !important;
            font-weight: 400 !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            appearance: none !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
            text-indent: 0 !important;
            text-shadow: none !important;
            vertical-align: baseline !important;
            text-decoration: none !important;
            box-sizing: border-box !important;
        }

        #arcify-spotlight-dialog .arcify-spotlight-input::placeholder {
            color: rgba(255, 255, 255, 0.5) !important;
            opacity: 1 !important;
        }

        #arcify-spotlight-dialog .arcify-spotlight-input:focus {
            outline: none !important;
            outline-style: none !important;
            outline-width: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: transparent !important;
            background-color: transparent !important;
        }

        .arcify-spotlight-results {
            max-height: 270px;
            overflow-y: auto;
            padding: 8px 0;
            scroll-behavior: smooth;
            scrollbar-width: none; /* Firefox */
            -ms-overflow-style: none; /* IE and Edge */
        }

        .arcify-spotlight-results::-webkit-scrollbar {
            display: none; /* Chrome, Safari and Opera */
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
                transform: translateX(-50%) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) scale(1);
            }
        }

        @media (max-width: 640px) {
            #arcify-spotlight-dialog {
                width: 95vw;
                margin: 20px auto;
            }
            
            #arcify-spotlight-dialog .arcify-spotlight-input {
                font-size: 16px !important;
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
    let instantSuggestion = null; // The real-time first suggestion
    let asyncSuggestions = []; // Debounced suggestions from background

    // Send get suggestions message to background script using shared client
    async function sendGetSuggestionsMessage(query, mode) {
        return await SpotlightMessageClient.getSuggestions(query, mode);
    }

    // Handle result action via message passing using shared client (with tab ID optimization)
    async function handleResultActionViaMessage(result, mode) {
        return await SpotlightMessageClient.handleResult(result, mode);
    }


    const selectionManager = new SelectionManager(resultsContainer);

    // Load initial results
    async function loadInitialResults() {
        try {
            // Clear instant suggestion when loading initial results
            instantSuggestion = null;
            
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            const results = await sendGetSuggestionsMessage('', mode);
            asyncSuggestions = results || [];
            updateDisplay();
        } catch (error) {
            console.error('[Spotlight] Error loading initial results:', error);
            instantSuggestion = null;
            asyncSuggestions = [];
            displayEmptyState();
        }
    }

    // Pre-fill URL in current-tab mode
    if (spotlightTabMode === SpotlightTabMode.CURRENT_TAB && window.arcifyCurrentTabUrl) {
        input.value = window.arcifyCurrentTabUrl;
        setTimeout(() => {
            handleInstantInput();
            handleAsyncSearch();
        }, 10);
    } else {
        // Load initial results
        loadInitialResults();
    }

    // Handle instant suggestion update (no debouncing)
    function handleInstantInput() {
        const query = input.value.trim();
        
        if (!query) {
            instantSuggestion = null;
            loadInitialResults();
            return;
        }

        // Generate instant suggestion based on current input
        instantSuggestion = SpotlightUtils.generateInstantSuggestion(query);
        updateDisplay();
    }

    // Handle async search (debounced)
    async function handleAsyncSearch() {
        const query = input.value.trim();
        
        if (!query) {
            asyncSuggestions = [];
            updateDisplay();
            return;
        }

        try {
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            const results = await sendGetSuggestionsMessage(query, mode);
            asyncSuggestions = results || [];
            updateDisplay();
        } catch (error) {
            console.error('[Spotlight] Search error:', error);
            asyncSuggestions = [];
            updateDisplay();
        }
    }


    // Combine instant and async suggestions
    function combineResults() {
        const combined = [];
        
        // Add instant suggestion first (if exists)
        if (instantSuggestion) {
            combined.push(instantSuggestion);
        }
        
        // Add async suggestions
        combined.push(...asyncSuggestions);
        
        return combined;
    }

    // Update the display with combined results
    function updateDisplay() {
        currentResults = combineResults();
        selectionManager.updateResults(currentResults);

        if (currentResults.length === 0) {
            displayEmptyState();
            return;
        }

        const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
        
        const html = currentResults.map((result, index) => {
            const formatted = SpotlightUtils.formatResult(result, mode);
            const isSelected = index === 0; // First result (instant suggestion) is always selected by default
            
            return `
                <button class="arcify-spotlight-result-item ${isSelected ? 'selected' : ''}" 
                        data-index="${index}">
                    <img class="arcify-spotlight-result-favicon" 
                         src="${SpotlightUtils.getFaviconUrl(result)}" 
                         alt="favicon"
                         data-fallback-icon="true">
                    <div class="arcify-spotlight-result-content">
                        <div class="arcify-spotlight-result-title">${SpotlightUtils.escapeHtml(formatted.title)}</div>
                        <div class="arcify-spotlight-result-url">${SpotlightUtils.escapeHtml(formatted.subtitle)}</div>
                    </div>
                    <div class="arcify-spotlight-result-action">${SpotlightUtils.escapeHtml(formatted.action)}</div>
                </button>
            `;
        }).join('');

        resultsContainer.innerHTML = html;
        
        // Add error handling for favicon images using shared utility
        SpotlightUtils.setupFaviconErrorHandling(resultsContainer);
    }



    // Display empty state
    function displayEmptyState() {
        resultsContainer.innerHTML = '<div class="arcify-spotlight-empty">Start typing to search tabs, bookmarks, and history</div>';
        currentResults = [];
        instantSuggestion = null;
        asyncSuggestions = [];
        selectionManager.updateResults([]);
    }


    // Input event handlers
    input.addEventListener('input', () => {
        // Update instant suggestion immediately (zero latency)
        handleInstantInput();
        
        // Trigger async search (SearchEngine handles debouncing via message)
        handleAsyncSearch();
    });

    // Handle result selection
    async function handleResultAction(result) {
        if (!result) {
            console.error('[Spotlight] No result provided');
            return;
        }

        try {
            const mode = spotlightTabMode === SpotlightTabMode.NEW_TAB ? 'new-tab' : 'current-tab';
            
            // Add immediate visual feedback - close spotlight immediately for faster perceived performance
            closeSpotlight();
            
            // Navigate in background
            await handleResultActionViaMessage(result, mode);
        } catch (error) {
            console.error('[Spotlight] Error in result action:', error);
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
        
        SpotlightMessageClient.notifyClosed();
        
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

    // Listen for global close messages from background script
    SpotlightMessageClient.setupGlobalCloseListener(() => {
        const existingDialog = document.getElementById('arcify-spotlight-dialog');
        if (existingDialog && existingDialog.open) {
            closeSpotlight();
        }
    });

    // Show dialog and focus input
    dialog.showModal();
    
    // Notify background that spotlight opened in this tab
    SpotlightMessageClient.notifyOpened();
    
    setTimeout(() => {
        input.focus();
        input.select();
        input.scrollLeft = 0;
    }, 50);

})(window.arcifySpotlightTabMode);