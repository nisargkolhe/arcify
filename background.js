import { Utils } from './utils.js';

const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity'; // Key to store timestamps

// Configure Chrome side panel behavior
chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch(error => console.error(error));


// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.tabs.create({ url: 'onboarding.html', active: true });
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

chrome.commands.onCommand.addListener(function(command) {
    if (command === "quickPinToggle") {
        console.log("sending");
        // Send a message to the sidebar
        chrome.runtime.sendMessage({ command: "quickPinToggle" });
    }
});


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
});

// Optional: Listen for messages from options page to immediately update alarm
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateAutoArchiveSettings') {
        console.log("Received message to update auto-archive settings.");
        setupAutoArchiveAlarm();
        sendResponse({ success: true });
    }
    // Keep the message channel open for asynchronous response if needed
    // return true;
});
