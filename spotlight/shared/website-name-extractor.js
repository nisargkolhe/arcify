/**
 * Website Name Extractor - Simplified website name resolution utility
 * 
 * Purpose: Extract clean, recognizable website names using curated mapping and hostname parsing
 * Key Functions: 2-tier fallback system for optimal performance and zero latency
 * Architecture: Standalone utility with synchronous operations only
 * 
 * Critical Notes:
 * - Tier 1: Curated mapping for popular sites (instant, high quality)
 * - Tier 2: Hostname parsing fallback (reliable, universal)
 * - Synchronous operation ensures zero latency for instant suggestions
 * - No Chrome API dependencies for maximum compatibility
 */

import { POPULAR_SITES } from './popular-sites.js';

export class WebsiteNameExtractor {
    constructor() {
        // Simplified - no caching needed for synchronous operations
    }

    // Main extraction method with 2-tier fallback (simplified, synchronous)
    extractWebsiteName(url) {
        try {
            const hostname = this.normalizeHostname(url);
            if (!hostname) return url;

            // Tier 1: Check curated mapping (instant)
            const curatedName = this.getCuratedName(hostname);
            if (curatedName) return curatedName;

            // Tier 2: Hostname parsing fallback (reliable)
            return this.parseHostnameToName(hostname);

        } catch (error) {
            console.error('[WebsiteNameExtractor] Error extracting name:', error);
            return this.parseHostnameToName(this.normalizeHostname(url)) || url;
        }
    }

    // Normalize URL to hostname
    normalizeHostname(url) {
        try {
            // Handle URLs without protocol
            const normalizedUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
            const urlObj = new URL(normalizedUrl);
            let hostname = urlObj.hostname.toLowerCase();
            
            // Remove www. prefix for consistent mapping
            if (hostname.startsWith('www.')) {
                hostname = hostname.substring(4);
            }
            
            return hostname;
        } catch {
            // Fallback for invalid URLs - extract hostname-like pattern
            const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/);
            return match ? match[1].toLowerCase() : url;
        }
    }

    // Tier 1: Get name from curated mapping
    getCuratedName(hostname) {
        return POPULAR_SITES[hostname] || null;
    }


    // Tier 3: Parse hostname to readable name (fallback)
    parseHostnameToName(hostname) {
        if (!hostname) return null;

        try {
            // Remove common subdomains
            let name = hostname.replace(/^(www|m|mobile|app|api|cdn|static)\./, '');
            
            // Remove TLD for cleaner display
            name = name.replace(/\.(com|org|net|edu|gov|mil|int|co|io|ly|me|tv|app|dev|ai)$/, '');
            
            // Handle special cases
            if (name.includes('.')) {
                // For multi-part domains, use the main part
                const parts = name.split('.');
                name = parts[parts.length - 1]; // Last part before TLD
            }
            
            // Capitalize first letter
            return name.charAt(0).toUpperCase() + name.slice(1);
        } catch {
            return hostname;
        }
    }

}

// Singleton instance for reuse
export const websiteNameExtractor = new WebsiteNameExtractor();