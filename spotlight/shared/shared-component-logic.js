/**
 * Shared Component Logic - Common functionality between overlay.js and popup.js
 * 
 * Purpose: Eliminate code duplication by extracting shared spotlight UI logic
 * Key Functions: Result combination, display updates, result rendering, event handling patterns
 * Architecture: Stateless utility functions that can be used by both overlay and popup contexts
 * 
 * Critical Notes:
 * - Functions are designed to work with both content script (overlay) and popup contexts
 * - Uses dependency injection pattern to avoid tight coupling to specific implementations
 * - Memory optimized using the SearchResult object pool for temporary objects
 * - Compatible with both ES6 modules (popup) and bundled IIFE (overlay)
 */

import { SpotlightUtils } from './ui-utilities.js';

export class SharedSpotlightLogic {
    
    /**
     * Combine instant and async suggestions with deduplication
     * @param {Object} instantSuggestion - The instant suggestion object (may be null)
     * @param {Array} asyncSuggestions - Array of async suggestion results
     * @returns {Array} Combined and deduplicated results
     */
    static combineResults(instantSuggestion, asyncSuggestions) {
        const combined = [];
        
        // Add instant suggestion first (if exists)
        if (instantSuggestion) {
            combined.push(instantSuggestion);
        }
        
        // Add async suggestions, filtering out duplicates of the instant suggestion
        for (const asyncResult of asyncSuggestions) {
            const isDuplicate = instantSuggestion && SpotlightUtils.areResultsDuplicate(instantSuggestion, asyncResult);
            if (!isDuplicate) {
                combined.push(asyncResult);
            }
        }
        
        return combined;
    }

    /**
     * Generate HTML for results list
     * @param {Array} results - Array of search results to render
     * @param {string} mode - Spotlight mode ('current-tab' or 'new-tab')
     * @returns {string} HTML string for the results
     */
    static generateResultsHTML(results, mode) {
        if (!results || results.length === 0) {
            return '<div class="arcify-spotlight-empty">Start typing to search tabs, bookmarks, and history</div>';
        }

        return results.map((result, index) => {
            const formatted = SpotlightUtils.formatResult(result, mode);
            const isSelected = index === 0; // First result is always selected by default
            
            return `
                <button class="arcify-spotlight-result-item ${isSelected ? 'selected' : ''}" 
                        data-index="${index}">
                    <img class="arcify-spotlight-result-favicon" 
                         src="${SpotlightUtils.getFaviconUrl(result)}" 
                         alt="favicon"
                         data-fallback-icon="true">
                    <div class="arcify-spotlight-result-content">
                        <div class="arcify-spotlight-result-title">${SpotlightUtils.escapeHtml(formatted.title)}${SpotlightUtils.formatDebugInfo(result)}</div>
                        <div class="arcify-spotlight-result-url">${SpotlightUtils.escapeHtml(formatted.subtitle)}</div>
                    </div>
                    <div class="arcify-spotlight-result-action">${SpotlightUtils.escapeHtml(formatted.action)}</div>
                </button>
            `;
        }).join('');
    }

    /**
     * Update results display with incremental DOM updates
     * @param {HTMLElement} resultsContainer - The results container element
     * @param {Array} currentResults - Current results array
     * @param {Array} newResults - New results to display
     * @param {string} mode - Spotlight mode
     */
    static updateResultsDisplay(resultsContainer, currentResults, newResults, mode) {
        // For now, we'll do a simple full update, but this can be optimized later for incremental updates
        const html = SharedSpotlightLogic.generateResultsHTML(newResults, mode);
        resultsContainer.innerHTML = html;
        
        // Setup favicon error handling for new images
        SpotlightUtils.setupFaviconErrorHandling(resultsContainer);
    }

    /**
     * Setup keyboard handling with SelectionManager integration
     * @param {Object} selectionManager - SelectionManager instance for navigation
     * @param {Function} onEnter - Handler for enter key, receives selected result
     * @param {Function} onEscape - Handler for escape key
     * @param {boolean} skipContainerCheck - Skip container focus check (for popup mode)
     * @returns {Function} Event handler function for keydown events
     */
    static createKeyDownHandler(selectionManager, onEnter, onEscape, skipContainerCheck = true) {
        return (e) => {
            // Let SelectionManager handle navigation keys first
            if (selectionManager.handleKeyDown(e, skipContainerCheck)) {
                return; // Event was handled by selection manager
            }
            
            // Handle additional keys not covered by selection manager
            switch (e.key) {
                case 'Enter':
                    if (onEnter) {
                        e.preventDefault();
                        e.stopPropagation();
                        const selected = selectionManager.getSelectedResult();
                        if (selected) {
                            onEnter(selected, e);
                        }
                    }
                    break;

                case 'Escape':
                    if (onEscape) {
                        e.preventDefault();
                        e.stopPropagation();
                        onEscape(e);
                    }
                    break;
            }
        };
    }

    /**
     * Setup common result click handling with event delegation
     * @param {HTMLElement} resultsContainer - Container element for results
     * @param {Function} onResultClick - Handler for result clicks, receives (result, index)
     * @param {Function} getCurrentResults - Function that returns current results array
     */
    static setupResultClickHandling(resultsContainer, onResultClick, getCurrentResults) {
        // Use event delegation for better performance
        resultsContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.arcify-spotlight-result-item');
            if (item) {
                const currentResults = getCurrentResults();
                if (currentResults) {
                    const index = parseInt(item.dataset.index);
                    const result = currentResults[index];
                    if (result && onResultClick) {
                        onResultClick(result, index);
                    }
                }
            }
        });
    }


    /**
     * Handle input events with debouncing
     * @param {Function} onInstantUpdate - Handler for instant suggestions (no debounce)
     * @param {Function} onAsyncUpdate - Handler for async suggestions (debounced)
     * @param {number} debounceDelay - Debounce delay in ms (default: 150)
     * @returns {Function} Input event handler
     */
    static createInputHandler(onInstantUpdate, onAsyncUpdate, debounceDelay = 150) {
        let debounceTimeout = null;

        return (e) => {
            // Clear previous debounced call
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }

            // Call instant update immediately
            if (onInstantUpdate) {
                onInstantUpdate(e);
            }

            // Debounce async update
            if (onAsyncUpdate) {
                debounceTimeout = setTimeout(() => {
                    onAsyncUpdate(e);
                }, debounceDelay);
            }
        };
    }
}