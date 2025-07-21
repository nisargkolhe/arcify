// popup.js - Popup implementation using shared spotlight modules
// NOTE: This is only used for URLs with restricted script injection (primarily Chrome Extension & Chrome Store links).
// The primary & most used spotlight implementation is in spotlight/overlay.js

import { SearchEngine } from './shared/search-engine.js';
import { ContentScriptDataProvider } from './shared/data-providers/content-script-data-provider.js';
import { SpotlightTabMode } from './shared/search-types.js';
import { SpotlightUtils } from './shared/ui-utilities.js';
import { SelectionManager } from './shared/selection-manager.js';
import { SpotlightMessageClient } from './shared/message-client.js';


// Global state
let searchEngine;
let currentResults = [];
let instantSuggestion = null; // The real-time first suggestion
let asyncSuggestions = []; // Debounced suggestions
let spotlightMode = 'current-tab';
let selectionManager;


// Initialize popup
async function initPopup() {
    console.log('[Popup] Initializing spotlight popup');
    
    // Get DOM elements
    const input = document.getElementById('spotlightInput');
    const resultsContainer = document.getElementById('spotlightResults');
    
    // Initialize search engine and selection manager
    searchEngine = new SearchEngine(new ContentScriptDataProvider());
    selectionManager = new SelectionManager(resultsContainer);
    
    // Get spotlight mode from storage
    try {
        const storage = await chrome.storage.local.get(['spotlightMode', 'spotlightPopupActive']);
        spotlightMode = storage.spotlightMode || 'current-tab';
        
        // Update placeholder based on mode
        const placeholder = spotlightMode === SpotlightTabMode.NEW_TAB 
            ? 'Search or enter URL (opens in new tab)...' 
            : 'Search or enter URL...';
        input.placeholder = placeholder;
        
        console.log('[Popup] Spotlight mode:', spotlightMode);
    } catch (error) {
        console.error('[Popup] Error reading storage:', error);
    }
    
    // Get and apply accent color
    try {
        const activeSpaceColor = await SpotlightMessageClient.getActiveSpaceColor();
        const accentCSS = SpotlightUtils.getAccentColorCSS(activeSpaceColor);
        const styleSheet = document.createElement('style');
        styleSheet.textContent = accentCSS;
        document.head.appendChild(styleSheet);
        console.log('[Popup] Applied accent color:', activeSpaceColor);
    } catch (error) {
        console.log('[Popup] Failed to get accent color, using default:', error);
    }
    
    // Focus input
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
    
    // Load initial results
    loadInitialResults();
    
    // Set up event listeners
    setupEventListeners();
    
    // Notify background that spotlight opened (popup mode)
    SpotlightMessageClient.notifyOpened();
    
    // Listen for global close messages from background script
    SpotlightMessageClient.setupGlobalCloseListener(() => {
        SpotlightMessageClient.notifyClosed();
        window.close();
    });
    
    // Clear the popup active flag after a short delay
    setTimeout(() => {
        chrome.storage.local.remove(['spotlightPopupActive']);
    }, 1000);
}

// Setup event listeners
function setupEventListeners() {
    const input = document.getElementById('spotlightInput');
    const resultsContainer = document.getElementById('spotlightResults');
    
    // Input event handlers
    input.addEventListener('input', () => {
        // Update instant suggestion immediately (zero latency)
        handleInstantInput();
        
        // Trigger async search (SearchEngine handles debouncing via message)
        handleAsyncSearch();
    });
    
    // Handle keyboard navigation
    input.addEventListener('keydown', (e) => {
        // Use shared selection manager for navigation (skip container check for popup)
        if (selectionManager.handleKeyDown(e, true)) {
            return; // Event was handled by selection manager
        }
        
        // Handle additional keys not covered by selection manager
        switch (e.key) {
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
                SpotlightMessageClient.notifyClosed();
                window.close();
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
}

// Load initial results
async function loadInitialResults() {
    try {
        // Clear instant suggestion when loading initial results
        instantSuggestion = null;
        
        const results = await searchEngine.getSpotlightSuggestionsImmediate('', spotlightMode);
        asyncSuggestions = results || [];
        updateDisplay();
    } catch (error) {
        console.error('[Popup] Error loading initial results:', error);
        instantSuggestion = null;
        asyncSuggestions = [];
        displayEmptyState();
    }
}

// Handle instant suggestion update (no debouncing)
function handleInstantInput() {
    const input = document.getElementById('spotlightInput');
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
    const input = document.getElementById('spotlightInput');
    const query = input.value.trim();
    
    if (!query) {
        asyncSuggestions = [];
        updateDisplay();
        return;
    }

    try {
        const results = await searchEngine.getSpotlightSuggestionsUsingCache(query, spotlightMode);
        asyncSuggestions = results || [];
        updateDisplay();
    } catch (error) {
        console.error('[Popup] Search error:', error);
        asyncSuggestions = [];
        updateDisplay();
    }
}


// Display search results
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
    const resultsContainer = document.getElementById('spotlightResults');
    currentResults = combineResults();
    selectionManager.updateResults(currentResults);

    if (currentResults.length === 0) {
        displayEmptyState();
        return;
    }

    const html = currentResults.map((result, index) => {
        const formatted = SpotlightUtils.formatResult(result, spotlightMode);
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
    const resultsContainer = document.getElementById('spotlightResults');
    resultsContainer.innerHTML = '<div class="arcify-spotlight-empty">Start typing to search tabs, bookmarks, and history</div>';
    currentResults = [];
    instantSuggestion = null;
    asyncSuggestions = [];
    selectionManager.updateResults([]);
}

// Handle result selection
async function handleResultAction(result) {
    if (!result) {
        console.error('[Popup] No result provided');
        return;
    }

    try {
        await searchEngine.handleResultAction(result, spotlightMode);
        
        // Notify background that spotlight closed
        SpotlightMessageClient.notifyClosed();
        
        // Close popup
        window.close();
    } catch (error) {
        console.error('[Popup] Error in result action:', error);
    }
}


// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initPopup);