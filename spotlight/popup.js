// popup.js - Popup implementation using shared spotlight modules
// NOTE: This is only used for URLs with restricted script injection (primarily Chrome Extension & Chrome Store links).
// The primary & most used spotlight implementation is in spotlight/overlay.js

import { SearchEngine } from './shared/search-engine.js';
import { ContentScriptDataProvider } from './shared/data-providers/content-script-data-provider.js';
import { SpotlightTabMode } from './shared/search-types.js';
import { getAccentColorCSS } from './shared/styling.js';

// Utility function to detect URLs
function isURL(text) {
    try {
        new URL(text);
        return true;
    } catch {}

    const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
    if (domainPattern.test(text)) return true;

    if (text === 'localhost' || text.startsWith('localhost:')) return true;

    if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(text)) {
        const parts = text.split(':')[0].split('.');
        return parts.every(part => {
            const num = parseInt(part, 10);
            return num >= 0 && num <= 255;
        });
    }

    if (/^[a-zA-Z0-9-]+\.(com|org|net|edu|gov|mil|int|co|io|ly|me|tv|app|dev|ai)([\/\?\#].*)?$/.test(text)) {
        return true;
    }

    return false;
}

// Generate instant first suggestion based on current input
function generateInstantSuggestion(query) {
    const trimmedQuery = query.trim();
    
    if (!trimmedQuery) return null;

    if (isURL(trimmedQuery)) {
        const url = trimmedQuery.startsWith('http') ? trimmedQuery : `https://${trimmedQuery}`;
        return {
            type: 'url-suggestion',
            title: trimmedQuery,
            url: url,
            score: 1000,
            metadata: {},
            domain: '',
            favicon: null
        };
    } else {
        return {
            type: 'search-query',
            title: `Search for "${trimmedQuery}"`,
            url: '',
            score: 1000,
            metadata: { query: trimmedQuery },
            domain: '',
            favicon: null
        };
    }
}

// Global state
let searchEngine;
let currentResults = [];
let instantSuggestion = null; // The real-time first suggestion
let asyncSuggestions = []; // Debounced suggestions
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
        
        // Auto-scroll selected item into view
        if (items[this.selectedIndex]) {
            items[this.selectedIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
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
    
    // Input event handlers
    input.addEventListener('input', () => {
        // Update instant suggestion immediately (zero latency)
        handleInstantInput();
        
        // Trigger async search (SearchEngine handles debouncing via message)
        handleAsyncSearch();
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
    instantSuggestion = generateInstantSuggestion(query);
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

// Legacy function for compatibility
async function handleInput() {
    handleInstantInput(); // Update instant suggestion immediately
    handleAsyncSearch(); // Trigger debounced async search
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
        const formatted = searchEngine.formatResult(result, spotlightMode);
        const isSelected = index === 0; // First result (instant suggestion) is always selected by default
        
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

// Legacy function for compatibility (now redirects to updateDisplay)
function displayResults(results) {
    asyncSuggestions = results || [];
    updateDisplay();
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
        chrome.runtime.sendMessage({
            action: 'spotlightClosed'
        });
        
        // Close popup
        window.close();
    } catch (error) {
        console.error('[Popup] Error in result action:', error);
    }
}

// Escape HTML utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initPopup);