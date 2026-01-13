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

import { Utils } from './utils.js';
import { Logger } from './logger.js';

const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity';

// Configure Chrome side panel behavior
chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch(error => Logger.error(error));

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
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
    if (request.command === "toggleSpacePin") {
        chrome.runtime.sendMessage({ command: "toggleSpacePin", tabId: request.tabId });
    }
});

chrome.commands.onCommand.addListener(async function (command) {
    if (command === "quickPinToggle") {
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

        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (url) => {
                    navigator.clipboard.writeText(url).then(() => {
                        console.log(`[URLCopy] Script injection succeeded: ${url}`);
                    }).catch(err => {
                        console.error("[URLCopy] Script injection clipboard failed:", err);
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
            const period = Math.max(1, settings.autoArchiveIdleMinutes / 2);
            await chrome.alarms.create(AUTO_ARCHIVE_ALARM_NAME, {
                periodInMinutes: period
            });
        } else {
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

        const spacesResult = await chrome.storage.local.get('spaces');
        const spaces = spacesResult.spaces || [];
        const bookmarkedUrls = new Set();
        spaces.forEach(space => {
            if (space.spaceBookmarks) {
                space.spaceBookmarks.forEach(bookmark => {
                    if (typeof bookmark === 'string') {
                        bookmarkedUrls.add(bookmark);
                    } else if (bookmark && bookmark.url) {
                        bookmarkedUrls.add(bookmark.url);
                    }
                });
            }
        });

        const tabs = await chrome.tabs.query({ pinned: false });
        const tabsToArchive = [];

        for (const tab of tabs) {
            if (tab.audible || tab.active) {
                await updateTabLastActivity(tab.id);
                continue;
            }

            if (bookmarkedUrls.has(tab.url)) {
                await updateTabLastActivity(tab.id);
                continue;
            }

            const lastActivity = tabActivity[tab.id];

            if (!lastActivity || (now - lastActivity > idleThresholdMillis)) {
                try {
                    await chrome.tabs.get(tab.id);
                    tabsToArchive.push(tab);
                } catch (e) {
                    await removeTabLastActivity(tab.id);
                }
            }
        }

        for (const tab of tabsToArchive) {
            const tabData = {
                url: tab.url,
                name: tab.title || tab.url,
                spaceId: tab.groupId
            };

            if (tabData.spaceId && tabData.spaceId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                await Utils.addArchivedTab(tabData);
                await chrome.tabs.remove(tab.id);
                await removeTabLastActivity(tab.id);
            }
        }

    } catch (error) {
        Logger.error("Error during auto-archive check:", error);
    }
}

// --- Event Listeners to Track Activity and Setup Alarm ---

chrome.runtime.onInstalled.addListener(() => {
    setupAutoArchiveAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    setupAutoArchiveAlarm();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    const settingsChanged = ['autoArchiveEnabled', 'autoArchiveIdleMinutes'].some(key => key in changes);

    if ((areaName === 'sync' || areaName === 'local') && settingsChanged) {
        setupAutoArchiveAlarm();
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    await updateTabLastActivity(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.audible !== undefined) {
        if (tab.active || tab.audible) {
            await updateTabLastActivity(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await removeTabLastActivity(tabId);
    await Utils.removeTabNameOverride(tabId);
});

// Message listener for extension features
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === 'updateAutoArchiveSettings') {
        Logger.log("Received message to update auto-archive settings.");
        setupAutoArchiveAlarm();
        sendResponse({ success: true });
        return false;
    } else if (message.action === 'openNewTab') {
        chrome.tabs.create({ url: message.url });
        sendResponse({ success: true });
        return false;
    }

    return false;
});
