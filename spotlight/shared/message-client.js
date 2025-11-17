// message-client.js - Shared message passing abstraction for spotlight components
// Consolidates chrome.runtime.sendMessage patterns from overlay.js and popup.js

export class SpotlightMessageClient {
    // Get suggestions from background script
    static async getSuggestions(query, mode) {
        try {
            const message = {
                action: 'getSpotlightSuggestions',
                query: query.trim(),
                mode: mode
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (response && response.success) {
                return response.results;
            } else {
                console.error('[SpotlightMessageClient] Get suggestions failed:', response?.error);
                return [];
            }
        } catch (error) {
            console.error('[SpotlightMessageClient] Get suggestions error:', error);
            return [];
        }
    }

    // Handle result action via message passing
    static async handleResult(result, mode) {
        try {
            const message = {
                action: 'spotlightHandleResult',
                result: result,
                mode: mode,
                tabId: window.arcifyCurrentTabId || null  // Include tab ID for optimization
            };
            
            const response = await chrome.runtime.sendMessage(message);
            
            if (!response || response.success === false) {
                console.error('[SpotlightMessageClient] Result action failed:', response?.error || 'No response');
                return false;
            }
            return true;
        } catch (error) {
            console.error('[SpotlightMessageClient] Error handling result action:', error);
            return false;
        }
    }


    // Get active space color from background
    static async getActiveSpaceColor() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getActiveSpaceColor'
            });
            
            if (response && response.success && response.color) {
                return response.color;
            } else {
                console.error('[SpotlightMessageClient] Failed to get active space color:', response?.error);
                return 'purple'; // Default fallback
            }
        } catch (error) {
            console.error('[SpotlightMessageClient] Error getting active space color:', error);
            return 'purple'; // Default fallback
        }
    }

    // Notify background that spotlight opened
    static notifyOpened() {
        try {
            chrome.runtime.sendMessage({ action: 'spotlightOpened' });
        } catch (error) {
            console.error('[SpotlightMessageClient] Error notifying spotlight opened:', error);
        }
    }

    // Notify background that spotlight closed
    static notifyClosed() {
        try {
            chrome.runtime.sendMessage({ action: 'spotlightClosed' });
        } catch (error) {
            console.error('[SpotlightMessageClient] Error notifying spotlight closed:', error);
        }
    }

    // Switch to tab (new-tab mode)
    static async switchToTab(tabId, windowId) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'switchToTab',
                tabId: tabId,
                windowId: windowId
            });
            return response?.success === true;
        } catch (error) {
            console.error('[SpotlightMessageClient] Error switching to tab:', error);
            return false;
        }
    }

    // Navigate current tab
    static async navigateCurrentTab(url) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'navigateCurrentTab',
                url: url
            });
            return response?.success === true;
        } catch (error) {
            console.error('[SpotlightMessageClient] Error navigating current tab:', error);
            return false;
        }
    }


    // Open new tab
    static async openNewTab(url) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'openNewTab',
                url: url
            });
            return response?.success === true;
        } catch (error) {
            console.error('[SpotlightMessageClient] Error opening new tab:', error);
            return false;
        }
    }

    // Perform search
    static async performSearch(query, mode) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'performSearch',
                query: query,
                mode: mode
            });
            return response?.success === true;
        } catch (error) {
            console.error('[SpotlightMessageClient] Error performing search:', error);
            return false;
        }
    }

    // Setup message listener for global close commands
    static setupGlobalCloseListener(onCloseCallback) {
        const messageListener = (message) => {
            if (message.action === 'closeSpotlight') {
                onCloseCallback();
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);
        
        // Return cleanup function
        return () => {
            chrome.runtime.onMessage.removeListener(messageListener);
        };
    }
}