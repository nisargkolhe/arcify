/**
 * Background Service Worker (Manifest V3) - Core extension orchestrator
 * 
 * Purpose: Manages extension lifecycle, message passing, and system integrations
 * Key Functions: Spotlight injection/fallback, auto-archive system, tab activity tracking, Chrome API access
 * Architecture: Service worker that handles all Chrome API calls and coordinates between content scripts
 * 
 * Critical Notes:
 * - Only context with full Chrome API access (tabs, storage, search, etc.)
 * - Handles spotlight injection with automatic popup fallback for restricted URLs
 * - Manages tab activity tracking for auto-archive functionality
 * - All content script Chrome API requests must route through here via message passing
 */

import { Utils } from './utils.js';
import { SearchEngine } from './spotlight/shared/search-engine.js';
import { BackgroundDataProvider } from './spotlight/shared/data-providers/background-data-provider.js';
import { Logger } from './logger.js';

// Enum for spotlight tab modes
const SpotlightTabMode = {
    CURRENT_TAB: 'current-tab',
    NEW_TAB: 'new-tab'
};

// Create a single SearchEngine instance with BackgroundDataProvider
const backgroundSearchEngine = new SearchEngine(new BackgroundDataProvider());

const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity'; // Key to store timestamps

// Helper to handle async message responses with consistent error handling
function handleAsyncMessage(handler, sendResponse, errorContext, defaultErrorData = {}) {
    (async () => {
        try {
            const result = await handler();
            sendResponse({ success: true, ...result });
        } catch (error) {
            Logger.error(`[Background] Error ${errorContext}:`, error);
            sendResponse({ success: false, error: error.message, ...defaultErrorData });
        }
    })();
    return true; // Indicates async response
}

// Configure Chrome side panel behavior
chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch(error => Logger.error(error));

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // Check if onboarding has been completed before
        const result = await chrome.storage.sync.get(['onboardingCompleted']);
        if (!result.onboardingCompleted) {
            chrome.tabs.create({ url: 'installation-onboarding.html', active: true });
        }
    } else if (details.reason === 'update') {
        chrome.tabs.create({ url: 'installation-onboarding.html', active: true });
    }

    if (chrome.contextMenus) {
        chrome.contextMenus.create({
            id: "openArcify",
            title: "Arcify",
            contexts: ["all"]
        });
    }
});

// Handle context menu clicks
if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        info.menuItemId === "openArcify" && chrome.sidePanel.open({
            windowId: tab.windowId
        })
    });
}

// Listen for messages from the content script (sidebar)
chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
    // Forward the pin toggle command to the sidebar
    if (request.command === "toggleSpacePin") {
        chrome.runtime.sendMessage({ command: "toggleSpacePin", tabId: request.tabId });
    } else if (request.command === "toggleSpotlight") {
        await injectSpotlightScript(SpotlightTabMode.CURRENT_TAB);
    } else if (request.command === "toggleSpotlightNewTab") {
        await injectSpotlightScript(SpotlightTabMode.NEW_TAB);
    }
});

chrome.commands.onCommand.addListener(async function (command) {
    if (command === "quickPinToggle") {
        // Send a message to the sidebar
        chrome.runtime.sendMessage({ command: "quickPinToggle" });
    } else if (command === "NextTabInSpace") {
        Utils.findActiveSpaceAndTab().then(async ({ space, tab }) => {
            if (space) {
                await Utils.movToNextTabInSpace(tab.id, space);
            }
        });
    }
    else if (command === "PrevTabInSpace") {
        Utils.findActiveSpaceAndTab().then(async ({ space, tab }) => {
            if (space) {
                await Utils.movToPrevTabInSpace(tab.id, space);
            }
        });
        Logger.log("sending");
        // Send a message to the sidebar
        chrome.runtime.sendMessage({ command: "PrevTabInSpace" });
    } else if (command === "toggleSpotlight") {
        await injectSpotlightScript(SpotlightTabMode.CURRENT_TAB);
    } else if (command === "toggleSpotlightNewTab") {
        await injectSpotlightScript(SpotlightTabMode.NEW_TAB);
    } else if (command === "copyCurrentUrl") {
        await copyCurrentTabUrlWithFallback();
    }
});

// Track tabs that have spotlight open for efficient closing.
// Mainly used to close spotlight overlays in all tabs when it's
// closed in 1 / user switches to another tab with overlay open.
const spotlightOpenTabs = new Set();

// Close spotlight in tracked tabs only
async function closeSpotlightInTrackedTabs() {
    try {
        const closePromises = Array.from(spotlightOpenTabs).map(tabId =>
            chrome.tabs.sendMessage(tabId, { action: 'closeSpotlight' }).catch(() => {
                // Remove from tracking if tab no longer exists or script not loaded
                spotlightOpenTabs.delete(tabId);
            })
        );
        await Promise.all(closePromises);
        // Clear the set after closing
        spotlightOpenTabs.clear();
    } catch (error) {
        Logger.error('[Background] Error closing spotlight in tracked tabs:', error);
    }
}

/**
 * PERFORMANCE-OPTIMIZED SPOTLIGHT ACTIVATION
 * 
 * Primary Strategy: Fast messaging to dormant content script
 * - Content script pre-loaded on all pages at document_start
 * - Instant activation via chrome.tabs.sendMessage() (~50-100ms)
 * - No waiting for page resources or script injection
 * 
 * Fallback Strategy: Legacy script injection
 * - Used when messaging fails (content script not ready, restricted URLs)
 * - Chrome.scripting.executeScript() with variable setup + script injection
 * - Slower but reliable fallback for edge cases
 * 
 * Final Fallback: Popup mode
 * - Used when all content script methods fail (chrome:// URLs, etc.)
 * - Opens extension popup with same spotlight functionality
 */

// Helper function to check if a URL supports content script injection
function supportsContentScripts(url) {
    if (!url) return false;

    // URLs that don't support content scripts
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

    // Check if URL matches any restricted pattern
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
        const settings = await Utils.getSettings();
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
            // Check if the tab URL supports content scripts
            // If not, skip directly to custom new tab fallback
            if (!supportsContentScripts(tab.url)) {
                Logger.log("Tab URL doesn't support content scripts, opening custom new tab directly:", tab.url);
                await fallbackToChromeTabs(spotlightTabMode);
                return;
            }
            // PRIMARY: Try to send activation message to dormant content script
            // This is 20-40x faster than script injection (50-100ms vs 1-2s)
            try {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    action: 'activateSpotlight',
                    mode: spotlightTabMode,
                    tabUrl: tab.url,
                    tabId: tab.id
                });

                if (response && response.success) {
                    // Success! Spotlight activated instantly via messaging
                    chrome.runtime.sendMessage({
                        action: 'spotlightOpened',
                        mode: spotlightTabMode
                    });
                    return; // Exit early - no need for fallbacks
                }
            } catch (messageError) {
                Logger.log("Content script messaging failed, using new tab fallback:", messageError);
                // If messaging fails, fall back to opening spotlight in a new tab
                await fallbackToChromeTabs(spotlightTabMode);
                return;
            }
        }
    } catch (error) {
        Logger.log("All spotlight activation methods failed, using Chrome tab fallback:", error);
        // Final fallback: Chrome tab operations
        await fallbackToChromeTabs(spotlightTabMode);
    }
}

// Helper function for Chrome tab fallback when spotlight injection fails
async function fallbackToChromeTabs(spotlightTabMode) {
    try {
        // First, close any existing spotlights in tracked tabs
        await closeSpotlightInTrackedTabs();

        Logger.log(`Falling back to custom new tab page for mode: ${spotlightTabMode}`);

        // Open custom new tab page with spotlight
        // This provides a better UX than chrome://newtab/ since users can still use spotlight
        // even when it cannot be injected on restricted pages (chrome://, extension pages, etc.)
        await chrome.tabs.create({ url: chrome.runtime.getURL('spotlight/newtab.html'), active: true });
        Logger.log("Spotlight failed - opened custom new tab with spotlight interface");

    } catch (chromeTabError) {
        Logger.error("Error with Chrome tab fallback:", chromeTabError);
        // Final fallback: open side panel
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.sidePanel.open({ windowId: tab.windowId });
                Logger.log("Opened side panel as final fallback");
            }
        } catch (sidePanelError) {
            Logger.error("All fallbacks failed:", sidePanelError);
        }
    }
}

// Helper function for URL copying via script injection
async function copyCurrentTabUrlWithFallback() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            Logger.error("[URLCopy] No active tab found");
            return;
        }

        Logger.log(`[URLCopy] Copying URL via script injection: ${tab.url}`);

        // PRIMARY: Script injection approach (universal, no permission popups)
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (url) => {
                    // This function runs in webpage context but avoids permission issues
                    // by being injected from extension context
                    navigator.clipboard.writeText(url).then(() => {
                        Logger.log(`[URLCopy] Script injection succeeded: ${url}`);
                    }).catch(err => {
                        Logger.error("[URLCopy] Script injection clipboard failed:", err);
                        // Fallback to older method if clipboard API fails
                        const textarea = document.createElement('textarea');
                        textarea.value = url;
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        Logger.log(`[URLCopy] Fallback copy succeeded: ${url}`);
                    });
                },
                args: [tab.url]
            });

            Logger.log(`[URLCopy] Script injection completed for: ${tab.url}`);

            // Notify sidebar of successful URL copy
            try {
                chrome.runtime.sendMessage({ action: "urlCopySuccess" });
                Logger.log("[URLCopy] Success message sent to sidebar");
            } catch (notifyError) {
                Logger.log("[URLCopy] Could not notify sidebar:", notifyError);
            }

            return;

        } catch (injectionError) {
            Logger.log("[URLCopy] Script injection failed, trying sidebar fallback:", injectionError);
        }

        // FALLBACK: Sidebar approach (works when sidebar is focused)
        try {
            const sidebarResponse = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("Sidebar timeout"));
                }, 1000);

                chrome.runtime.sendMessage({
                    command: "copyCurrentUrl",
                    url: tab.url
                }, (response) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });

            Logger.log(`[URLCopy] Sidebar fallback succeeded: ${tab.url}`);
        } catch (sidebarError) {
            Logger.error("[URLCopy] Both script injection and sidebar failed:", sidebarError);
        }

    } catch (error) {
        Logger.error("[URLCopy] Failed to copy URL:", error);
    }
}

// --- Helper: Update Last Activity Timestamp ---
async function updateTabLastActivity(tabId) {
    if (!tabId) return;
    try {
        const result = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
        const activityData = result[TAB_ACTIVITY_STORAGE_KEY] || {};
        activityData[tabId] = Date.now();
        // Optional: Prune old entries if the storage grows too large
        await chrome.storage.local.set({ [TAB_ACTIVITY_STORAGE_KEY]: activityData });
    } catch (error) {
        Logger.error("Error updating tab activity:", error);
    }
}

// --- Helper: Remove Activity Timestamp ---
async function removeTabLastActivity(tabId) {
    if (!tabId) return;
    try {
        const result = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
        const activityData = result[TAB_ACTIVITY_STORAGE_KEY] || {};
        delete activityData[tabId];
        await chrome.storage.local.set({ [TAB_ACTIVITY_STORAGE_KEY]: activityData });
    } catch (error) {
        Logger.error("Error removing tab activity:", error);
    }
}


// --- Alarm Creation ---
async function setupAutoArchiveAlarm() {
    try {
        const settings = await Utils.getSettings();
        if (settings.autoArchiveEnabled && settings.autoArchiveIdleMinutes > 0) {
            // Create the alarm to fire periodically
            // Note: Chrome alarms are not exact, they fire *at least* this often.
            // Minimum period is 1 minute.
            const period = Math.max(1, settings.autoArchiveIdleMinutes / 2); // Check more frequently than the idle time
            await chrome.alarms.create(AUTO_ARCHIVE_ALARM_NAME, {
                periodInMinutes: period
            });
        } else {
            // If disabled, clear any existing alarm
            await chrome.alarms.clear(AUTO_ARCHIVE_ALARM_NAME);
        }
    } catch (error) {
        Logger.error("Error setting up auto-archive alarm:", error);
    }
}

// --- Alarm Listener ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_ARCHIVE_ALARM_NAME) {
        await runAutoArchiveCheck();
    }
});

// --- Archiving Logic ---
async function runAutoArchiveCheck() {
    const settings = await Utils.getSettings();
    if (!settings.autoArchiveEnabled || settings.autoArchiveIdleMinutes <= 0) {
        return;
    }

    const idleThresholdMillis = settings.autoArchiveIdleMinutes * 60 * 1000;
    const now = Date.now();

    try {
        const activityResult = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
        const tabActivity = activityResult[TAB_ACTIVITY_STORAGE_KEY] || {};

        // --- Build the protected favorite set from the durable Arcify bookmark tree ---
        // NOTE: space.spaceBookmarks holds ephemeral tab-IDs (not URLs), so the old
        // check here was always empty and never protected favorites from archiving.
        // The Arcify bookmark folder is the durable record of favorites; collect its
        // URLs normalized with the same pinned-URL key the renderer uses (origin+path).
        const protectedUrlKeys = new Set();
        try {
            const [arcifyFolder] = await chrome.bookmarks.search({ title: 'Arcify' });
            if (arcifyFolder) {
                const [subTree] = await chrome.bookmarks.getSubTree(arcifyFolder.id);
                const collectUrls = (node) => {
                    if (!node) return;
                    if (node.url) {
                        protectedUrlKeys.add(Utils.getPinnedUrlKey(node.url));
                    }
                    if (node.children) node.children.forEach(collectUrls);
                };
                collectUrls(subTree);
            }
        } catch (bookmarkError) {
            Logger.warn('Auto-archive: could not read Arcify bookmark tree for protection:', bookmarkError);
        }

        // Get all non-pinned tabs across all windows
        const tabs = await chrome.tabs.query({ pinned: false });
        const tabsToArchive = [];

        for (const tab of tabs) {
            // Skip audible, active, or recently active tabs
            if (tab.audible || tab.active) {
                await updateTabLastActivity(tab.id); // Update activity for active/audible tabs
                continue;
            }

            // Protect Arcify favorites: never archive a tab whose URL matches a bookmark
            // in the Arcify tree (compared by origin+pathname to tolerate query/hash drift).
            if (protectedUrlKeys.has(Utils.getPinnedUrlKey(tab.url))) {
                // Refresh activity so protected favorites aren't re-checked repeatedly.
                await updateTabLastActivity(tab.id);
                continue;
            }

            const lastActivity = tabActivity[tab.id];

            // If we have no record, or it's older than the threshold, mark for archiving
            // We assume tabs without a record haven't been active since tracking started or last check
            if (!lastActivity || (now - lastActivity > idleThresholdMillis)) {
                // Check if tab still exists before archiving
                try {
                    await chrome.tabs.get(tab.id); // Throws error if tab closed
                    tabsToArchive.push(tab);
                } catch (e) {
                    await removeTabLastActivity(tab.id); // Clean up record for closed tab
                }
            }
        }


        for (const tab of tabsToArchive) {
            const tabData = {
                url: tab.url,
                name: tab.title || tab.url, // Use URL if title is empty
                spaceId: tab.groupId // Archive within its current group/space
            };

            // Check if spaceId is valid (i.e., tab is actually in a group)
            if (tabData.spaceId && tabData.spaceId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                await Utils.addArchivedTab(tabData);
                await chrome.tabs.remove(tab.id); // Close the tab after archiving
                await removeTabLastActivity(tab.id); // Remove activity timestamp after archiving
            } else {
                // Decide if you want to update its activity or leave it for next check
                // await updateTabLastActivity(tab.id);
            }
        }

    } catch (error) {
        Logger.error("Error during auto-archive check:", error);
    }
}

// --- Event Listeners to Track Activity and Setup Alarm ---

// Run setup when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    setupAutoArchiveAlarm();
    // Initialize activity for all existing tabs? Maybe too much overhead.
    // Better to let the alarm handle it over time.
});

// Run setup when Chrome starts
chrome.runtime.onStartup.addListener(() => {
    setupAutoArchiveAlarm();
});

// Listen for changes in storage (e.g., settings updated from options page)
chrome.storage.onChanged.addListener((changes, areaName) => {
    // Check if any of the auto-archive settings changed
    const settingsChanged = ['autoArchiveEnabled', 'autoArchiveIdleMinutes'].some(key => key in changes);

    if ((areaName === 'sync' || areaName === 'local') && settingsChanged) {
        setupAutoArchiveAlarm(); // Re-create or clear the alarm based on new settings
    }

    // Clean up activity data if a tab is removed
    if (areaName === 'local' && TAB_ACTIVITY_STORAGE_KEY in changes) {
        // This might be less reliable than using tab removal events
    }
});

// Track tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateTabLastActivity(activeInfo.tabId);

    // Close any open spotlights when switching tabs
    await closeSpotlightInTrackedTabs();
});

// Track tab updates (e.g., audible status changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // If a tab becomes active (e.g., navigation finishes) or audible, update its timestamp
    if (changeInfo.status === 'complete' || changeInfo.audible !== undefined) {
        if (tab.active || tab.audible) {
            await updateTabLastActivity(tabId);
        }
    }
});

// Clean up timestamp when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await removeTabLastActivity(tabId);

    // Clean up tab name override for closed tab
    await Utils.removeTabNameOverride(tabId);

    // Clean up spotlight tracking for closed tab
    if (spotlightOpenTabs.has(tabId)) {
        spotlightOpenTabs.delete(tabId);
    }
});

// Optional: Listen for messages from options page to immediately update alarm
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === 'updateAutoArchiveSettings') {
        Logger.log("Received message to update auto-archive settings.");
        setupAutoArchiveAlarm();
        sendResponse({ success: true });
        return false; // Synchronous response
    } else if (message.action === 'openNewTab') {
        chrome.tabs.create({ url: message.url });
        sendResponse({ success: true });
        return false; // Synchronous response
    } else if (message.action === 'navigateToDefaultNewTab') {
        // Handle navigation to default new tab when custom new tab is disabled
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('newtab.html')) {
                    // Navigate to Chrome's default new tab page
                    // Try the standard URL first, then fallback to local NTP
                    try {
                        await chrome.tabs.update(tab.id, { url: 'chrome://new-tab-page/' });
                    } catch (e) {
                        // Fallback for some browsers or configurations
                        await chrome.tabs.update(tab.id, { url: 'chrome-search://local-ntp/local-ntp.html' });
                    }
                }
                sendResponse({ success: true });
            } catch (error) {
                Logger.error('[Background] Error navigating to default new tab:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'switchToTab') {
        return handleAsyncMessage(async () => {
            await chrome.tabs.update(message.tabId, { active: true });
            await chrome.windows.update(message.windowId, { focused: true });
            return {};
        }, sendResponse, 'switching to tab');

    } else if (message.action === 'searchTabs') {
        return handleAsyncMessage(async () => {
            const tabs = await chrome.tabs.query({});
            const query = message.query?.toLowerCase() || '';
            const filteredTabs = tabs.filter(tab => {
                if (!tab.title || !tab.url) return false;
                if (!query) return true;
                return tab.title.toLowerCase().includes(query) ||
                    tab.url.toLowerCase().includes(query);
            });
            return { tabs: filteredTabs };
        }, sendResponse, 'searching tabs');

    } else if (message.action === 'getRecentTabs') {
        return handleAsyncMessage(async () => {
            const tabs = await chrome.tabs.query({});
            const storage = await chrome.storage.local.get([TAB_ACTIVITY_STORAGE_KEY]);
            const activityData = storage[TAB_ACTIVITY_STORAGE_KEY] || {};

            const tabsWithActivity = tabs
                .filter(tab => tab.url && tab.title)
                .map(tab => ({ ...tab, lastActivity: activityData[tab.id] || 0 }))
                .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                .slice(0, message.limit || 5);

            return { tabs: tabsWithActivity };
        }, sendResponse, 'getting recent tabs');

    } else if (message.action === 'searchBookmarks') {
        return handleAsyncMessage(async () => {
            const bookmarks = await chrome.bookmarks.search(message.query);
            return { bookmarks: bookmarks.filter(b => b.url) };
        }, sendResponse, 'searching bookmarks');

    } else if (message.action === 'searchHistory') {
        return handleAsyncMessage(async () => {
            const historyItems = await chrome.history.search({
                text: message.query,
                maxResults: 10,
                startTime: Date.now() - (7 * 24 * 60 * 60 * 1000)
            });
            return { history: historyItems };
        }, sendResponse, 'searching history');

    } else if (message.action === 'getTopSites') {
        return handleAsyncMessage(async () => {
            const topSites = await chrome.topSites.get();
            return { topSites };
        }, sendResponse, 'getting top sites');

    } else if (message.action === 'getAutocomplete') {
        return handleAsyncMessage(async () => {
            const suggestions = await backgroundSearchEngine.dataProvider.getAutocompleteData(message.query);
            return { suggestions };
        }, sendResponse, 'getting autocomplete suggestions', { suggestions: [] });

    } else if (message.action === 'getPinnedTabs') {
        Logger.log('[Background] Received getPinnedTabs message:', message);
        return handleAsyncMessage(async () => {
            const pinnedTabs = await backgroundSearchEngine.dataProvider.getPinnedTabsData(message.query);
            Logger.log('[Background] Sending pinned tabs response:', pinnedTabs.length, 'tabs');
            return { pinnedTabs };
        }, sendResponse, 'getting pinned tabs', { pinnedTabs: [] });

    } else if (message.action === 'getActiveSpaceColor') {
        return handleAsyncMessage(async () => {
            const spacesResult = await chrome.storage.local.get('spaces');
            const spaces = spacesResult.spaces || [];
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!activeTab || !activeTab.groupId || activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                return { color: 'purple' };
            }

            const activeSpace = spaces.find(space => space.id === activeTab.groupId);
            return { color: activeSpace?.color || 'purple' };
        }, sendResponse, 'getting active space color', { color: 'purple' });

    } else if (message.action === 'performSearch') {
        return handleAsyncMessage(async () => {
            const disposition = message.mode === SpotlightTabMode.NEW_TAB ? 'NEW_TAB' : 'CURRENT_TAB';
            await chrome.search.query({ text: message.query, disposition });
            return {};
        }, sendResponse, 'performing search');

    } else if (message.action === 'getSpotlightSuggestions') {
        return handleAsyncMessage(async () => {
            const query = message.query.trim();
            const results = query
                ? await backgroundSearchEngine.getSpotlightSuggestionsUsingCache(query, message.mode)
                : await backgroundSearchEngine.getSpotlightSuggestionsImmediate('', message.mode);
            return { results };
        }, sendResponse, 'getting spotlight suggestions', { results: [] });

    } else if (message.action === 'spotlightHandleResult') {
        return handleAsyncMessage(async () => {
            if (!message.result || !message.result.type || !message.mode) {
                throw new Error('Invalid spotlight result message');
            }
            const tabId = sender.tab?.id || message.tabId;
            await backgroundSearchEngine.handleResultAction(message.result, message.mode, tabId);
            return {};
        }, sendResponse, 'handling spotlight result');

    } else if (message.action === 'spotlightOpened') {
        // Track when spotlight opens in a tab
        if (sender.tab && sender.tab.id) {
            spotlightOpenTabs.add(sender.tab.id);
        }
        return false;
    } else if (message.action === 'spotlightClosed') {
        // Track when spotlight closes in a tab
        if (sender.tab && sender.tab.id) {
            spotlightOpenTabs.delete(sender.tab.id);
        }
        return false;
    } else if (message.action === 'activatePinnedTab') {
        // Only forward if this came from overlay mode (content script)
        // Popup mode can send directly to sidebar, so don't forward to prevent double tabs
        if (sender.tab) {  // Message came from content script (overlay)
            chrome.runtime.sendMessage(message);
        }
        sendResponse({ success: true });
        return false; // Synchronous response
    }

    return false; // No async response needed
});
