/**
 * Utils - Spotlight-specific utility functions
 *
 * Purpose: Provides common utilities for the Spotlight extension
 * Key Functions: Favicon URL generation, settings retrieval
 */

// Helper function to fetch favicon
export function getFaviconUrl(u, size = "16") {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", u);
    url.searchParams.set("size", size);
    return url.toString();
}

// Get spotlight settings
export async function getSettings() {
    const defaultSettings = {
        enableSpotlight: true, // Default: enabled
        colorOverrides: null, // Default: no color overrides
        debugLoggingEnabled: false, // Default: disabled
    };
    const result = await chrome.storage.sync.get(defaultSettings);
    return result;
}

// Utils object for compatibility with imported code
export const Utils = {
    getFaviconUrl,
    getSettings
};
