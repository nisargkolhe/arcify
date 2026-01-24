/**
 * Spotlight Background Service Worker (Manifest V3)
 *
 * Purpose: Manages spotlight extension lifecycle, message passing, and Chrome API access
 * Key Functions: Spotlight injection/fallback, tab searching, bookmarks/history access
 * Architecture: Service worker that handles all Chrome API calls for spotlight functionality
 */

import { SearchEngine } from './shared/search-engine.js';
import { BackgroundDataProvider } from './shared/data-providers/background-data-provider.js';
import { Logger } from './logger.js';
import { getSettings } from './utils.js';

// Enum for spotlight tab modes
const SpotlightTabMode = {
    CURRENT_TAB: 'current-tab',
    NEW_TAB: 'new-tab'
};

// Create a single SearchEngine instance with BackgroundDataProvider
const backgroundSearchEngine = new SearchEngine(new BackgroundDataProvider());

// Track tabs that have spotlight open for efficient closing
const spotlightOpenTabs = new Set();

// Close spotlight in tracked tabs only
async function closeSpotlightInTrackedTabs() {
    try {
        const closePromises = Array.from(spotlightOpenTabs).map(tabId =>
            chrome.tabs.sendMessage(tabId, { action: 'closeSpotlight' }).catch(() => {
                spotlightOpenTabs.delete(tabId);
            })
        );
        await Promise.all(closePromises);
        spotlightOpenTabs.clear();
    } catch (error) {
        Logger.error('[Background] Error closing spotlight in tracked tabs:', error);
    }
}

// Helper function to check if a URL supports content script injection
function supportsContentScripts(url) {
    if (!url) return false;

    const restrictedPatterns = [
        /^chrome:\/\//,
        /^chrome-extension:\/\//,
        /^edge:\/\//,
        /^about:/,
        /^moz-extension:\/\//,
        /^vivaldi:\/\//,
        /^brave:\/\//,
        /^opera:\/\//
    ];

    for (const pattern of restrictedPatterns) {
        if (pattern.test(url)) {
            return false;
        }
    }

    return true;
}

// Helper function to activate spotlight via content script messaging
async function injectSpotlightScript(spotlightTabMode) {
    try {
        // Check if spotlight is enabled
        const settings = await getSettings();
        if (!settings.enableSpotlight) {
            Logger.log("Spotlight is disabled in settings.");

            if (spotlightTabMode === SpotlightTabMode.NEW_TAB) {
                Logger.log("Opening default new tab instead of spotlight new tab.");
                try {
                    await chrome.tabs.create({ url: 'chrome://new-tab-page/' });
                } catch (e) {
                    await chrome.tabs.create({ url: 'chrome-search://local-ntp/local-ntp.html' });
                }
            } else {
                Logger.log("Aborting spotlight injection.");
            }
            return;
        }

        // First, close any existing spotlights in tracked tabs
        await closeSpotlightInTrackedTabs();

        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            if (!supportsContentScripts(tab.url)) {
                Logger.log("Tab URL doesn't support content scripts, opening custom new tab directly:", tab.url);
                await fallbackToChromeTabs(spotlightTabMode);
                return;
            }

            try {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    action: 'activateSpotlight',
                    mode: spotlightTabMode,
                    tabUrl: tab.url,
                    tabId: tab.id
                });

                if (response && response.success) {
                    chrome.runtime.sendMessage({
                        action: 'spotlightOpened',
                        mode: spotlightTabMode
                    });
                    return;
                }
            } catch (messageError) {
                Logger.log("Content script messaging failed, using new tab fallback:", messageError);
                await fallbackToChromeTabs(spotlightTabMode);
                return;
            }
        }
    } catch (error) {
        Logger.log("All spotlight activation methods failed, using Chrome tab fallback:", error);
        await fallbackToChromeTabs(spotlightTabMode);
    }
}

// Helper function for Chrome tab fallback when spotlight injection fails
async function fallbackToChromeTabs(spotlightTabMode) {
    try {
        await closeSpotlightInTrackedTabs();

        Logger.log(`Falling back to custom new tab page for mode: ${spotlightTabMode}`);
        await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html'), active: true });
        Logger.log("Spotlight failed - opened custom new tab with spotlight interface");

    } catch (chromeTabError) {
        Logger.error("Error with Chrome tab fallback:", chromeTabError);
    }
}

// Listen for commands
chrome.commands.onCommand.addListener(async function (command) {
    if (command === "toggleSpotlight") {
        await injectSpotlightScript(SpotlightTabMode.CURRENT_TAB);
    } else if (command === "toggleSpotlightNewTab") {
        await injectSpotlightScript(SpotlightTabMode.NEW_TAB);
    }
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    if (request.command === "toggleSpotlight") {
        await injectSpotlightScript(SpotlightTabMode.CURRENT_TAB);
    } else if (request.command === "toggleSpotlightNewTab") {
        await injectSpotlightScript(SpotlightTabMode.NEW_TAB);
    }
});

// Track tab activation to close spotlights
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await closeSpotlightInTrackedTabs();
});

// Clean up spotlight tracking for closed tabs
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if (spotlightOpenTabs.has(tabId)) {
        spotlightOpenTabs.delete(tabId);
    }
});

// Main message listener for spotlight operations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openNewTab') {
        chrome.tabs.create({ url: message.url });
        sendResponse({ success: true });
        return false;
    } else if (message.action === 'navigateToDefaultNewTab') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('newtab.html')) {
                    try {
                        await chrome.tabs.update(tab.id, { url: 'chrome://new-tab-page/' });
                    } catch (e) {
                        await chrome.tabs.update(tab.id, { url: 'chrome-search://local-ntp/local-ntp.html' });
                    }
                }
                sendResponse({ success: true });
            } catch (error) {
                Logger.error('[Background] Error navigating to default new tab:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'switchToTab') {
        (async () => {
            try {
                await chrome.tabs.update(message.tabId, { active: true });
                await chrome.windows.update(message.windowId, { focused: true });
                sendResponse({ success: true });
            } catch (error) {
                Logger.error('[Background] Error switching to tab:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'navigateCurrentTab') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    await chrome.tabs.update(tab.id, { url: message.url });
                }
                sendResponse({ success: true });
            } catch (error) {
                Logger.error('[Background] Error navigating current tab:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'searchTabs') {
        (async () => {
            try {
                const tabs = await chrome.tabs.query({});
                const query = message.query?.toLowerCase() || '';
                const filteredTabs = tabs.filter(tab => {
                    if (!tab.title || !tab.url) return false;
                    if (!query) return true;
                    return tab.title.toLowerCase().includes(query) ||
                        tab.url.toLowerCase().includes(query);
                });
                sendResponse({ success: true, tabs: filteredTabs });
            } catch (error) {
                Logger.error('[Background] Error searching tabs:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'searchBookmarks') {
        (async () => {
            try {
                const bookmarks = await chrome.bookmarks.search(message.query);
                const filteredBookmarks = bookmarks.filter(bookmark => bookmark.url);
                sendResponse({ success: true, bookmarks: filteredBookmarks });
            } catch (error) {
                Logger.error('[Background] Error searching bookmarks:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'searchHistory') {
        (async () => {
            try {
                const historyItems = await chrome.history.search({
                    text: message.query,
                    maxResults: 10,
                    startTime: Date.now() - (7 * 24 * 60 * 60 * 1000)
                });
                sendResponse({ success: true, history: historyItems });
            } catch (error) {
                Logger.error('[Background] Error searching history:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'getTopSites') {
        (async () => {
            try {
                const topSites = await chrome.topSites.get();
                sendResponse({ success: true, topSites: topSites });
            } catch (error) {
                Logger.error('[Background] Error getting top sites:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'getAutocomplete') {
        (async () => {
            try {
                const dataProvider = backgroundSearchEngine.dataProvider;
                const suggestions = await dataProvider.getAutocompleteData(message.query);
                sendResponse({ success: true, suggestions: suggestions });
            } catch (error) {
                Logger.error('[Background] Error getting autocomplete suggestions:', error);
                sendResponse({ success: false, error: error.message, suggestions: [] });
            }
        })();
        return true;
    } else if (message.action === 'getPinnedTabs') {
        Logger.log('[Background] Received getPinnedTabs message:', message);
        (async () => {
            try {
                const dataProvider = backgroundSearchEngine.dataProvider;
                Logger.log('[Background] Getting pinned tabs from data provider...');
                const pinnedTabs = await dataProvider.getPinnedTabsData(message.query);
                Logger.log('[Background] Sending pinned tabs response:', pinnedTabs.length, 'tabs');
                sendResponse({ success: true, pinnedTabs: pinnedTabs });
            } catch (error) {
                Logger.error('[Background] Error getting pinned tabs:', error);
                sendResponse({ success: false, error: error.message, pinnedTabs: [] });
            }
        })();
        return true;
    } else if (message.action === 'getActiveSpaceColor') {
        (async () => {
            try {
                const spacesResult = await chrome.storage.local.get('spaces');
                const spaces = spacesResult.spaces || [];

                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

                if (!activeTab || !activeTab.groupId || activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    sendResponse({ success: true, color: 'purple' });
                    return;
                }

                const activeSpace = spaces.find(space => space.id === activeTab.groupId);

                if (activeSpace && activeSpace.color) {
                    sendResponse({ success: true, color: activeSpace.color });
                } else {
                    sendResponse({ success: true, color: 'purple' });
                }
            } catch (error) {
                Logger.error('[Background] Error getting active space color:', error);
                sendResponse({ success: false, error: error.message, color: 'purple' });
            }
        })();
        return true;
    } else if (message.action === 'performSearch') {
        (async () => {
            try {
                const disposition = message.mode === SpotlightTabMode.NEW_TAB ? 'NEW_TAB' : 'CURRENT_TAB';
                await chrome.search.query({
                    text: message.query,
                    disposition: disposition
                });
                sendResponse({ success: true });
            } catch (error) {
                Logger.error('[Background] Error performing search:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'getSpotlightSuggestions') {
        (async () => {
            try {
                const query = message.query.trim();
                const results = query
                    ? await backgroundSearchEngine.getSpotlightSuggestionsUsingCache(query, message.mode)
                    : await backgroundSearchEngine.getSpotlightSuggestionsImmediate('', message.mode);
                sendResponse({ success: true, results: results });
            } catch (error) {
                Logger.error('[Background] Error getting spotlight suggestions:', error);
                sendResponse({ success: false, error: error.message, results: [] });
            }
        })();
        return true;
    } else if (message.action === 'spotlightHandleResult') {
        (async () => {
            try {
                if (!message.result || !message.result.type || !message.mode) {
                    throw new Error('Invalid spotlight result message');
                }

                const tabId = (sender.tab && sender.tab.id) ? sender.tab.id : message.tabId;
                await backgroundSearchEngine.handleResultAction(message.result, message.mode, tabId);
                sendResponse({ success: true });
            } catch (error) {
                Logger.error('[Background] Error handling spotlight result:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    } else if (message.action === 'spotlightOpened') {
        if (sender.tab && sender.tab.id) {
            spotlightOpenTabs.add(sender.tab.id);
        }
        return false;
    } else if (message.action === 'spotlightClosed') {
        if (sender.tab && sender.tab.id) {
            spotlightOpenTabs.delete(sender.tab.id);
        }
        return false;
    } else if (message.action === 'activatePinnedTab') {
        // Forward pinned tab activation to Arcify extension if installed
        // This allows Spotlight to work with Arcify's pinned tabs
        chrome.runtime.sendMessage(message);
        sendResponse({ success: true });
        return false;
    }

    return false;
});
