/**
 * UI Utilities - Shared spotlight UI functions and formatting
 * 
 * Purpose: Provides consistent UI utilities, result formatting, and display helpers for spotlight components
 * Key Functions: URL detection/normalization, instant suggestions, result formatting, favicon handling, accent colors
 * Architecture: Static utility class with pure functions for UI operations
 * 
 * Critical Notes:
 * - Consolidates duplicate code from overlay.js, popup.js, and data providers
 * - Handles complex URL detection including chrome:// protocols and localhost
 * - Provides dynamic accent color CSS generation matching active space colors
 * - Central location for all spotlight display logic and formatting
 */

import { ResultType, SpotlightTabMode } from './search-types.js';
import { websiteNameExtractor } from './website-name-extractor.js';

export class SpotlightUtils {
    // Helper to properly prefix URLs with protocol
    static normalizeURL(url) {
        // Return as-is if it already has a protocol (http, https, chrome, etc.)
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
            return url;
        }
        // Default to https for URLs without protocol
        return `https://${url}`;
    }

    // URL detection utility (consolidated from multiple files)
    static isURL(text) {
        // Check if it's already a complete URL
        try {
            new URL(text);
            return true;
        } catch {
            // Continue to other checks
        }

        // Check for domain-like patterns
        const domainPattern = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
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
        if (/^[a-zA-Z0-9-]+\.(com|org|net|edu|gov|mil|int|co|io|ly|me|tv|app|dev|ai)([/\?#].*)?$/.test(text)) {
            return true;
        }

        return false;
    }

    // Generate instant suggestion based on current input (consolidated from overlay.js and popup.js)
    static generateInstantSuggestion(query) {
        const trimmedQuery = query.trim();
        
        if (!trimmedQuery) {
            return null;
        }
        if (SpotlightUtils.isURL(trimmedQuery)) {
            // Create URL suggestion
            const url = SpotlightUtils.normalizeURL(trimmedQuery);
            const websiteName = SpotlightUtils.extractWebsiteName(url);
            return {
                type: ResultType.URL_SUGGESTION,
                title: websiteName,
                url: url,
                score: 1000, // Highest priority
                metadata: { originalInput: trimmedQuery },
                domain: '',
                favicon: null
            };
        } else {
            // Create search suggestion  
            return {
                type: ResultType.SEARCH_QUERY,
                title: `Search for "${trimmedQuery}"`,
                url: '',
                score: 1000, // Highest priority
                metadata: { query: trimmedQuery },
                domain: '',
                favicon: null
            };
        }
    }

    // Escape HTML utility (consolidated from overlay.js and popup.js)
    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Extract website name from URL for better display
    static extractWebsiteName(url) {
        try {
            return websiteNameExtractor.extractWebsiteName(url);
        } catch (error) {
            console.error('[SpotlightUtils] Error extracting website name:', error);
            // Fallback to basic hostname parsing
            try {
                const normalizedUrl = SpotlightUtils.normalizeURL(url);
                const urlObj = new URL(normalizedUrl);
                let hostname = urlObj.hostname;
                
                // Remove www. prefix for cleaner display
                if (hostname.startsWith('www.')) {
                    hostname = hostname.substring(4);
                }
                
                // Capitalize first letter for better presentation
                return hostname.charAt(0).toUpperCase() + hostname.slice(1);
            } catch {
                // Final fallback to original URL
                return url;
            }
        }
    }

    // Get favicon URL with fallback (consolidated from overlay.js and popup.js)
    static getFaviconUrl(result) {
        if (result.favicon && result.favicon.startsWith('http')) {
            return result.favicon;
        }
        
        // Special handling for autocomplete suggestions
        if (result.type === ResultType.AUTOCOMPLETE_SUGGESTION) {
            if (result.metadata?.isUrl && result.url) {
                // For URL autocomplete suggestions, get the website favicon
                try {
                    const url = new URL(SpotlightUtils.normalizeURL(result.url));
                    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
                } catch {
                    // Fallback to search icon if URL parsing fails
                }
            }
            // For search autocomplete suggestions, use search icon
            return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>')}`;
        }
        
        if (result.url) {
            try {
                const url = new URL(SpotlightUtils.normalizeURL(result.url));
                return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
            } catch {
                // Fallback for invalid URLs
            }
        }

        return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>')}`;
    }

    // Format result for display (moved from SearchEngine and duplicated code)
    static formatResult(result, mode) {
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
            [ResultType.AUTOCOMPLETE_SUGGESTION]: {
                title: result.title,
                subtitle: result.metadata?.isUrl ? result.url : 'Search',
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

    // Generate accent color CSS based on active space color (from overlay.js)
    static getAccentColorCSS(spaceColor) {
        // RGB values for each color name (matching --chrome-*-color variables in styles.css)
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

    // Check if two results are duplicates based on URL (for deduplication)
    static areResultsDuplicate(result1, result2) {
        if (!result1 || !result2) return false;
        
        // Compare normalized URLs for URL-based results
        if (result1.url && result2.url) {
            const url1 = result1.url.toLowerCase().replace(/\/+$/, ''); // Remove trailing slashes
            const url2 = result2.url.toLowerCase().replace(/\/+$/, '');
            return url1 === url2;
        }
        
        // Compare titles for search queries
        if (result1.type === 'search-query' && result2.type === 'search-query') {
            return result1.title === result2.title;
        }
        
        return false;
    }

    // Setup favicon error handling (consolidated pattern from overlay.js and popup.js)
    static setupFaviconErrorHandling(container) {
        const faviconImages = container.querySelectorAll('.arcify-spotlight-result-favicon[data-fallback-icon="true"]');
        faviconImages.forEach(img => {
            img.addEventListener('error', function() {
                this.src = SpotlightUtils.getFaviconUrl({ url: null, favicon: null });
            });
        });
    }
}