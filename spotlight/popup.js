/**
 * Spotlight Popup - Fallback implementation for restricted URLs
 * 
 * Purpose: Popup-based spotlight when content script injection fails (chrome://, extension pages)
 * Key Functions: Same search functionality as overlay but in popup window context
 * Architecture: Extension popup with ES6 modules and shared spotlight components
 * 
 * Critical Notes:
 * - Automatic fallback when overlay injection fails on restricted URLs
 * - Shares same search functionality and UI components as overlay version
 * - Has popup-specific URL prefill implementation (queries active tab directly)
 * - Popup context has different security permissions than content script
 * - Primary implementation remains overlay.js - this is used <5% of the time
 */

import { SearchEngine } from './shared/search-engine.js';
import { ContentScriptDataProvider } from './shared/data-providers/content-script-data-provider.js';
import { SpotlightTabMode } from './shared/search-types.js';
import { SpotlightUtils } from './shared/ui-utilities.js';
import { SelectionManager } from './shared/selection-manager.js';
import { SpotlightMessageClient } from './shared/message-client.js';
import { SharedSpotlightLogic } from './shared/shared-component-logic.js';


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
    
    // Pre-fill URL in current-tab mode
    if (spotlightMode === SpotlightTabMode.CURRENT_TAB) {
        try {
            // Get current tab URL for prefill
            const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (activeTab && activeTab.url) {
                input.value = activeTab.url;
                setTimeout(() => {
                    handleInstantInput();
                    handleAsyncSearch();
                }, 10);
            } else {
                // Load initial results if no URL to prefill
                loadInitialResults();
            }
        } catch (error) {
            console.error('[Popup] Error getting current tab for URL prefill:', error);
            loadInitialResults();
        }
    } else {
        // Load initial results for new-tab mode
        loadInitialResults();
    }
    
    // Focus input
    setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
    
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
    input.addEventListener('input', SharedSpotlightLogic.createInputHandler(
        handleInstantInput,    // instant update (zero latency)
        handleAsyncSearch,     // async update (debounced by SearchEngine)
        150                    // debounce delay in ms
    ));
    
    // Handle keyboard navigation
    input.addEventListener('keydown', SharedSpotlightLogic.createKeyDownHandler(
        selectionManager,                      // SelectionManager for navigation
        (selected) => handleResultAction(selected),  // Enter handler
        () => {                                // Escape handler
            SpotlightMessageClient.notifyClosed();
            window.close();
        },
        true                                   // skipContainerCheck for popup mode
    ));
    
    // Handle clicks on results
    SharedSpotlightLogic.setupResultClickHandling(
        resultsContainer,
        (result, index) => handleResultAction(result), // adapter: only pass result to existing handler
        () => currentResults // function that returns current results
    );
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



// Combine instant and async suggestions with deduplication
function combineResults() {
    return SharedSpotlightLogic.combineResults(instantSuggestion, asyncSuggestions);
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

    SharedSpotlightLogic.updateResultsDisplay(resultsContainer, [], currentResults, spotlightMode);
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