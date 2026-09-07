import { registerTourMessages } from './tour-state.js';
registerTourMessages();
/**
 * Background Service Worker (Manifest V3) - Core extension orchestrator
 *
 * Purpose: Manages extension lifecycle, message passing, and system integrations
 * Key Functions: Auto-archive system, tab activity tracking, Chrome API access
 * Architecture: Service worker that handles all Chrome API calls and coordinates between content scripts
 *
 * Critical Notes:
 * - Only context with full Chrome API access (tabs, storage, etc.)
 * - Manages tab activity tracking for auto-archive functionality
 * - All content script Chrome API requests must route through here via message passing
 */

import { SpaceStore, ownerOf } from './space-store.js';

const spaceStore = new SpaceStore();
spaceStore.install();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'spaceStore') return;
    spaceStore.dispatch(message).then(spaces => sendResponse({ success: true, spaces }), error => sendResponse({ success: false, error: error.message }));
    return true;
});

import { Utils } from './utils.js';
import { Logger } from './logger.js';

const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity'; // Key to store timestamps
const ONBOARDING_VERSION_KEY = 'onboardingVersion';

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
    const version = chrome.runtime.getManifest().version;
    const result = await chrome.storage.sync.get(['onboardingCompleted', ONBOARDING_VERSION_KEY]);
    const firstInstall = details.reason === 'install' && !result.onboardingCompleted;
    const newVersion = details.reason === 'update' && result[ONBOARDING_VERSION_KEY] !== version;
    if (firstInstall || newVersion) {
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
// Do not return a Promise for unrelated messages: it can win the response race
// against the asynchronous space-store handler on Chrome versions with Promise replies.
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Forward the pin toggle command to the sidebar
    if (request.command === "toggleSpacePin") {
        chrome.runtime.sendMessage({ command: "toggleSpacePin", tabId: request.tabId });
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
    } else if (command === "copyCurrentUrl") {
        await copyCurrentTabUrlWithFallback();
    }
});

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
                        console.log(`[URLCopy] Script injection succeeded: ${url}`);
                    }).catch(err => {
                        console.error("[URLCopy] Script injection clipboard failed:", err);
                        // Fallback to older method if clipboard API fails
                        const textarea = document.createElement('textarea');
                        textarea.value = url;
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        console.log(`[URLCopy] Fallback copy succeeded: ${url}`);
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
                spaceId: ownerOf(await spaceStore.dispatch({ action: 'get' }), tab.id)?.id
            };

            // Archive only tabs owned by an extension space.
            if (tabData.spaceId) {
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
        
    } else if (message.action === 'activatePinnedTab') {
        // Forward pinned tab activation to sidebar
        chrome.runtime.sendMessage(message);
        sendResponse({ success: true });
        return false; // Synchronous response
    }

    return false; // No async response needed
});
