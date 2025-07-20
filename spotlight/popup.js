// popup.js - Popup implementation using shared spotlight modules
// NOTE: This is only used for URLs with restricted script injection (primarily Chrome Extension & Chrome Store links).
// The primary & most used spotlight implementation is in spotlight/overlay.js

import { SearchEngine } from './shared/search-engine.js';
import { ContentScriptDataProvider } from './shared/data-providers/content-script-data-provider.js';
import { SpotlightTabMode } from './shared/search-types.js';
import { getAccentColorCSS } from './shared/styling.js';

// Global state
let searchEngine;
let currentResults = [];
let spotlightMode = 'current-tab';
let selectionManager;

// Selection Manager for keyboard navigation
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
        const colorResponse = await chrome.runtime.sendMessage({
            action: 'getActiveSpaceColor'
        });
        
        if (colorResponse && colorResponse.success && colorResponse.color) {
            const accentCSS = getAccentColorCSS(colorResponse.color);
            const styleSheet = document.createElement('style');
            styleSheet.textContent = accentCSS;
            document.head.appendChild(styleSheet);
            console.log('[Popup] Applied accent color:', colorResponse.color);
        }
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
    
    // Clear the popup active flag after a short delay
    setTimeout(() => {
        chrome.storage.local.remove(['spotlightPopupActive']);
    }, 1000);
}

// Setup event listeners
function setupEventListeners() {
    const input = document.getElementById('spotlightInput');
    const resultsContainer = document.getElementById('spotlightResults');
    
    // Handle input changes with debouncing
    let inputTimeout;
    input.addEventListener('input', () => {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(handleInput, 150);
    });
    
    // Handle keyboard navigation
    input.addEventListener('keydown', (e) => {
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
        const results = await searchEngine.getSpotlightSuggestionsImmediate('', spotlightMode);
        displayResults(results);
    } catch (error) {
        console.error('[Popup] Error loading initial results:', error);
        displayEmptyState();
    }
}

// Handle input changes
async function handleInput() {
    const input = document.getElementById('spotlightInput');
    const query = input.value.trim();
    
    if (!query) {
        loadInitialResults();
        return;
    }

    try {
        const results = await searchEngine.getSpotlightSuggestionsUsingCache(query, spotlightMode);
        displayResults(results);
    } catch (error) {
        console.error('[Popup] Search error:', error);
        displayEmptyState();
    }
}

// Display search results
function displayResults(results) {
    const resultsContainer = document.getElementById('spotlightResults');
    currentResults = results;
    selectionManager.updateResults(results);

    if (!results || results.length === 0) {
        displayEmptyState();
        return;
    }

    const html = results.map((result, index) => {
        const formatted = searchEngine.formatResult(result, spotlightMode);
        const isSelected = index === 0;
        
        return `
            <button class="arcify-spotlight-result-item ${isSelected ? 'selected' : ''}" 
                    data-index="${index}">
                <img class="arcify-spotlight-result-favicon" 
                     src="${getFaviconUrl(result)}" 
                     alt="favicon"
                     data-fallback-icon="true">
                <div class="arcify-spotlight-result-content">
                    <div class="arcify-spotlight-result-title">${escapeHtml(formatted.title)}</div>
                    <div class="arcify-spotlight-result-url">${escapeHtml(formatted.subtitle)}</div>
                </div>
                <div class="arcify-spotlight-result-action">${escapeHtml(formatted.action)}</div>
            </button>
        `;
    }).join('');

    resultsContainer.innerHTML = html;
    
    // Add error handling for favicon images (CSP compliant)
    const faviconImages = resultsContainer.querySelectorAll('.arcify-spotlight-result-favicon[data-fallback-icon="true"]');
    faviconImages.forEach(img => {
        img.addEventListener('error', function() {
            this.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>')}`;
        });
    });
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
    const resultsContainer = document.getElementById('spotlightResults');
    resultsContainer.innerHTML = '<div class="arcify-spotlight-empty">Start typing to search tabs, bookmarks, and history</div>';
    currentResults = [];
    selectionManager.updateResults([]);
}

// Handle result selection
async function handleResultAction(result) {
    console.log('[Popup] ========== HANDLE RESULT ACTION START ==========');
    console.log('[Popup] handleResultAction called with result:', {
        type: result?.type,
        title: result?.title,
        url: result?.url,
        domain: result?.domain,
        metadata: result?.metadata,
        fullResult: result
    });

    if (!result) {
        console.error('[Popup] ❌ No result provided, returning early');
        return;
    }

    try {
        console.log('[Popup] About to call searchEngine.handleResultAction...');
        console.log('[Popup] Spotlight mode:', spotlightMode);
        
        const startTime = Date.now();
        await searchEngine.handleResultAction(result, spotlightMode);
        const endTime = Date.now();
        
        console.log('[Popup] ✅ searchEngine.handleResultAction completed successfully in', endTime - startTime, 'ms');
        
        // Notify background that spotlight closed
        console.log('[Popup] Sending spotlightClosed notification...');
        chrome.runtime.sendMessage({
            action: 'spotlightClosed'
        });
        console.log('[Popup] ✅ spotlightClosed notification sent');
        
        // Close popup
        console.log('[Popup] Closing popup window...');
        window.close();
        console.log('[Popup] ✅ Popup close initiated');
    } catch (error) {
        console.error('[Popup] ❌ Exception in handleResultAction:', error);
        console.error('[Popup] Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
    }
    
    console.log('[Popup] ========== HANDLE RESULT ACTION END ==========');
}

// Escape HTML utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initPopup);