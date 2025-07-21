import { Utils } from './utils.js';
import { SearchEngine } from './spotlight/shared/search-engine.js';
import { BackgroundDataProvider } from './spotlight/shared/data-providers/background-data-provider.js';

// Enum for spotlight tab modes
const SpotlightTabMode = {
    CURRENT_TAB: 'current-tab',
    NEW_TAB: 'new-tab'
};

// Create a single SearchEngine instance with BackgroundDataProvider
const backgroundSearchEngine = new SearchEngine(new BackgroundDataProvider());

const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity'; // Key to store timestamps

// Configure Chrome side panel behavior
chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch(error => console.error(error));


// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
    // if (details.reason === 'install' || details.reason === 'update') {
    //     chrome.tabs.create({ url: 'onboarding.html', active: true });
    // }
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
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // Forward the pin toggle command to the sidebar
    if (request.command === "toggleSpacePin") {
        chrome.runtime.sendMessage({ command: "toggleSpacePin", tabId: request.tabId });
    }
});

chrome.commands.onCommand.addListener(async function(command) {
    if (command === "quickPinToggle") {
        // Send a message to the sidebar
        chrome.runtime.sendMessage({ command: "quickPinToggle" });
    } else if (command === "toggleSpotlight") {
        console.log("[Background] Spotlight (current tab) command received");
        await injectSpotlightScript(SpotlightTabMode.CURRENT_TAB);
    } else if (command === "toggleSpotlightNewTab") {
        console.log("[Background] Spotlight (new tab) command received");
        await injectSpotlightScript(SpotlightTabMode.NEW_TAB);
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
        console.log(`[Background] Closed spotlight in ${spotlightOpenTabs.size} tracked tabs`);
        // Clear the set after closing
        spotlightOpenTabs.clear();
    } catch (error) {
        console.error('[Background] Error closing spotlight in tracked tabs:', error);
    }
}

// Helper function to inject spotlight script with spotlightTabMode
async function injectSpotlightScript(spotlightTabMode) {
    try {
        // First, close any existing spotlights in tracked tabs
        await closeSpotlightInTrackedTabs();
        
        // Get the active tab
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        if (tab) {
            // First, set the spotlightTabMode, current URL, and tab ID in the content script context
            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: (spotlightTabMode, currentUrl, tabId) => {
                    window.arcifySpotlightTabMode = spotlightTabMode;
                    window.arcifyCurrentTabUrl = currentUrl;
                    window.arcifyCurrentTabId = tabId;
                },
                args: [spotlightTabMode, tab.url, tab.id]
            });
            
            // Then inject the spotlight overlay script
            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                files: ['spotlight/overlay.js']
            });
            
            // Notify sidebar about spotlight mode
            // Needed to highlight the new tab button in the sidebar for new tab spotlight mode.
            chrome.runtime.sendMessage({
                action: 'spotlightOpened',
                mode: spotlightTabMode
            });
        }
    } catch (error) {
        console.log("Content script injection failed, using popup fallback:", error);
        // Fallback: open spotlight popup if content script injection fails
        await openSpotlightPopup(spotlightTabMode);
    }
}

// Helper function to open spotlight popup fallback
async function openSpotlightPopup(spotlightTabMode) {
    try {
        // First, close any existing spotlights in tracked tabs
        await closeSpotlightInTrackedTabs();
        
        // Set popup mode and tab mode in storage for popup to read
        await chrome.storage.local.set({ 
            spotlightMode: spotlightTabMode,
            spotlightPopupActive: true 
        });
        
        // Notify sidebar about spotlight mode
        chrome.runtime.sendMessage({
            action: 'spotlightOpened',
            mode: spotlightTabMode
        });
        
        // Open popup (requires popup to be configured in manifest)
        await chrome.action.openPopup();
        
        console.log("Opened spotlight popup fallback with mode:", spotlightTabMode);
    } catch (popupError) {
        console.error("Error opening spotlight popup fallback:", popupError);
        // Final fallback: open side panel
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            if (tab) {
                chrome.sidePanel.open({windowId: tab.windowId});
            }
        } catch (sidePanelError) {
            console.error("All fallbacks failed:", sidePanelError);
        }
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
        console.error("Error updating tab activity:", error);
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
        console.error("Error removing tab activity:", error);
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
            console.log(`Auto-archive alarm set to run every ${period} minutes.`);
        } else {
            // If disabled, clear any existing alarm
            await chrome.alarms.clear(AUTO_ARCHIVE_ALARM_NAME);
            console.log("Auto-archive disabled, alarm cleared.");
        }
    } catch (error) {
        console.error("Error setting up auto-archive alarm:", error);
    }
}

// --- Alarm Listener ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_ARCHIVE_ALARM_NAME) {
        console.log("Auto-archive alarm triggered.");
        await runAutoArchiveCheck();
    }
});

// --- Archiving Logic ---
async function runAutoArchiveCheck() {
    const settings = await Utils.getSettings();
    if (!settings.autoArchiveEnabled || settings.autoArchiveIdleMinutes <= 0) {
        console.log("Auto-archive check skipped (disabled or invalid time).");
        return;
    }

    const idleThresholdMillis = settings.autoArchiveIdleMinutes * 60 * 1000;
    const now = Date.now();

    try {
        const activityResult = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
        const tabActivity = activityResult[TAB_ACTIVITY_STORAGE_KEY] || {};

        // --- Fetch spaces data to check against bookmarks ---
        const spacesResult = await chrome.storage.local.get('spaces');
        const spaces = spacesResult.spaces || [];
        const bookmarkedUrls = new Set();
        spaces.forEach(space => {
            if (space.spaceBookmarks) {
                // Assuming spaceBookmarks stores URLs directly.
                // If it stores tab IDs or other objects, adjust this logic.
                space.spaceBookmarks.forEach(bookmark => {
                    // Check if bookmark is an object with a url or just a url string
                    if (typeof bookmark === 'string') {
                        bookmarkedUrls.add(bookmark);
                    } else if (bookmark && bookmark.url) {
                        bookmarkedUrls.add(bookmark.url);
                    }
                });
            }
        });
        console.log("Bookmarked URLs for exclusion:", bookmarkedUrls);

        // Get all non-pinned tabs across all windows
        const tabs = await chrome.tabs.query({ pinned: false });
        const tabsToArchive = [];

        for (const tab of tabs) {
            // Skip audible, active, or recently active tabs
            if (tab.audible || tab.active) {
                await updateTabLastActivity(tab.id); // Update activity for active/audible tabs
                continue;
            }

            if (bookmarkedUrls.has(tab.url)) {
                console.log(`Skipping archive for tab ${tab.id} - URL is bookmarked in a space.`);
                // Optionally update activity for bookmarked tabs so they don't get checked repeatedly
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
                    console.log(`Tab ${tab.id} closed before archiving, removing activity record.`);
                    await removeTabLastActivity(tab.id); // Clean up record for closed tab
                 }
            }
        }

        console.log(`Found ${tabsToArchive.length} tabs eligible for auto-archiving.`);

        for (const tab of tabsToArchive) {
            console.log(`Auto-archiving tab: ${tab.id} - ${tab.title}`);
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
                console.log(`Skipping archive for tab ${tab.id} - not in a valid group.`);
                 // Decide if you want to update its activity or leave it for next check
                 // await updateTabLastActivity(tab.id);
            }
        }

    } catch (error) {
        console.error("Error during auto-archive check:", error);
    }
}

// --- Event Listeners to Track Activity and Setup Alarm ---

// Run setup when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension installed/updated. Setting up alarm.");
    setupAutoArchiveAlarm();
    // Initialize activity for all existing tabs? Maybe too much overhead.
    // Better to let the alarm handle it over time.
});

// Run setup when Chrome starts
chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome started. Setting up alarm.");
    setupAutoArchiveAlarm();
});

// Listen for changes in storage (e.g., settings updated from options page)
chrome.storage.onChanged.addListener((changes, areaName) => {
    // Check if any of the auto-archive settings changed
    const settingsChanged = ['autoArchiveEnabled', 'autoArchiveIdleMinutes'].some(key => key in changes);

    if ((areaName === 'sync' || areaName === 'local') && settingsChanged) {
        console.log("Auto-archive settings changed. Re-evaluating alarm setup.");
        setupAutoArchiveAlarm(); // Re-create or clear the alarm based on new settings
    }

    // Clean up activity data if a tab is removed
    if (areaName === 'local' && TAB_ACTIVITY_STORAGE_KEY in changes) {
        // This might be less reliable than using tab removal events
    }
});

// Track tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    console.log(`Tab activated: ${activeInfo.tabId}`);
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
    console.log(`Tab removed: ${tabId}`);
    await removeTabLastActivity(tabId);
    
    // Clean up spotlight tracking for closed tab
    if (spotlightOpenTabs.has(tabId)) {
        spotlightOpenTabs.delete(tabId);
        console.log(`[Background] Removed closed tab ${tabId} from spotlight tracking`);
    }
});

// Optional: Listen for messages from options page to immediately update alarm
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.action);
    
    if (message.action === 'updateAutoArchiveSettings') {
        console.log("Received message to update auto-archive settings.");
        setupAutoArchiveAlarm();
        sendResponse({ success: true });
        return false; // Synchronous response
    } else if (message.action === 'openNewTab') {
        chrome.tabs.create({ url: message.url });
        sendResponse({ success: true });
        return false; // Synchronous response
    } else if (message.action === 'navigateCurrentTab') {
        // Handle navigation of current tab for popup current-tab mode
        // Needs message passing to background script because the browser `window` object
        // is not available in popup. Popup only has access to its own window.
        (async () => {
            try {
                const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
                if (activeTab) {
                    await chrome.tabs.update(activeTab.id, { url: message.url });
                    sendResponse({ success: true });
                } else {
                    console.error('[Background] No active tab found');
                    sendResponse({ success: false, error: 'No active tab found' });
                }
            } catch (error) {
                console.error('[Background] Error navigating current tab:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'switchToTab') {
        // Handle tab switching for spotlight search results
        (async () => {
            try {
                await chrome.tabs.update(message.tabId, { active: true });
                await chrome.windows.update(message.windowId, { focused: true });
                sendResponse({ success: true });
            } catch (error) {
                console.error('[Background] Error switching to tab:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'searchTabs') {
        // Handle async operation properly
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
                console.error('[Background] Error searching tabs:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'getRecentTabs') {
        (async () => {
            try {
                const tabs = await chrome.tabs.query({});
                const storage = await chrome.storage.local.get([TAB_ACTIVITY_STORAGE_KEY]);
                const activityData = storage[TAB_ACTIVITY_STORAGE_KEY] || {};
                
                const tabsWithActivity = tabs
                    .filter(tab => tab.url && tab.title)
                    .map(tab => ({
                        ...tab,
                        lastActivity: activityData[tab.id] || 0
                    }))
                    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                    .slice(0, message.limit || 5);
                    
                sendResponse({ success: true, tabs: tabsWithActivity });
            } catch (error) {
                console.error('[Background] Error getting recent tabs:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'searchBookmarks') {
        (async () => {
            try {
                const bookmarks = await chrome.bookmarks.search(message.query);
                const filteredBookmarks = bookmarks.filter(bookmark => bookmark.url);
                sendResponse({ success: true, bookmarks: filteredBookmarks });
            } catch (error) {
                console.error('[Background] Error searching bookmarks:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'searchHistory') {
        (async () => {
            try {
                const historyItems = await chrome.history.search({
                    text: message.query,
                    maxResults: 10,
                    startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
                });
                sendResponse({ success: true, history: historyItems });
            } catch (error) {
                console.error('[Background] Error searching history:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'getTopSites') {
        (async () => {
            try {
                console.log('[Background] Getting top sites');
                const topSites = await chrome.topSites.get();
                console.log('[Background] Found top sites:', topSites.length);
                sendResponse({ success: true, topSites: topSites });
            } catch (error) {
                console.error('[Background] Error getting top sites:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'getActiveSpaceColor') {
        (async () => {
            try {
                console.log('[Background] Getting active space color');
                const spacesResult = await chrome.storage.local.get('spaces');
                const spaces = spacesResult.spaces || [];
                
                // Get the current active tab to determine which space it belongs to
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (!activeTab || !activeTab.groupId || activeTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    console.log('[Background] No active tab group, using default purple');
                    sendResponse({ success: true, color: 'purple' });
                    return;
                }
                
                // Find the space that matches the active tab's group
                const activeSpace = spaces.find(space => space.id === activeTab.groupId);
                
                if (activeSpace && activeSpace.color) {
                    console.log('[Background] Found active space color:', activeSpace.color);
                    sendResponse({ success: true, color: activeSpace.color });
                } else {
                    console.log('[Background] No space found for group, using default purple');
                    sendResponse({ success: true, color: 'purple' });
                }
            } catch (error) {
                console.error('[Background] Error getting active space color:', error);
                sendResponse({ success: false, error: error.message, color: 'purple' });
            }
        })();
        return true; // Async response
    } else if (message.action === 'performSearch') {
        // Handle search using the user's default search engine via chrome.search API
        (async () => {
            try {
                console.log('[Background] Performing search with query:', message.query);
                console.log('[Background] Search mode:', message.mode);
                
                // Determine disposition based on spotlight tab mode
                const disposition = message.mode === SpotlightTabMode.NEW_TAB ? 'NEW_TAB' : 'CURRENT_TAB';
                
                // Use chrome.search API to search with the user's default search engine
                await chrome.search.query({
                    text: message.query,
                    disposition: disposition
                });
                
                console.log('[Background] Search completed successfully');
                sendResponse({ success: true });
            } catch (error) {
                console.error('[Background] Error performing search:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'getSpotlightSuggestions') {
        // Handle spotlight suggestions requests from overlay.js
        (async () => {
            try {
                const query = message.query.trim();
                
                // Get suggestions using the background search engine with debouncing
                const results = query
                    ? await backgroundSearchEngine.getSpotlightSuggestionsUsingCache(query, message.mode)
                    : await backgroundSearchEngine.getSpotlightSuggestionsImmediate('', message.mode);
                
                sendResponse({ success: true, results: results });
            } catch (error) {
                console.error('[Background] Error getting spotlight suggestions:', error);
                sendResponse({ success: false, error: error.message, results: [] });
            }
        })();
        return true; // Async response
    } else if (message.action === 'spotlightHandleResult') {
        // Handle spotlight result actions from overlay.js
        (async () => {
            try {
                // Validate inputs
                if (!message.result || !message.result.type || !message.mode) {
                    throw new Error('Invalid spotlight result message');
                }
                
                // Handle the result action (pass tabId if provided for optimization)
                await backgroundSearchEngine.handleResultAction(message.result, message.mode, message.tabId);
                sendResponse({ success: true });
            } catch (error) {
                console.error('[Background] Error handling spotlight result:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Async response
    } else if (message.action === 'spotlightOpened') {
        // Track when spotlight opens in a tab
        if (sender.tab && sender.tab.id) {
            spotlightOpenTabs.add(sender.tab.id);
            console.log(`[Background] Spotlight opened in tab ${sender.tab.id}, tracking ${spotlightOpenTabs.size} tabs`);
        }
        return false;
    } else if (message.action === 'spotlightClosed') {
        // Track when spotlight closes in a tab
        if (sender.tab && sender.tab.id) {
            spotlightOpenTabs.delete(sender.tab.id);
            console.log(`[Background] Spotlight closed in tab ${sender.tab.id}, tracking ${spotlightOpenTabs.size} tabs`);
        }
        return false;
    }
    
    return false; // No async response needed
});
