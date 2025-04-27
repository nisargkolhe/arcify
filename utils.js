// Helper function to generate UUID (If you want to move this too)
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper function to fetch favicon
function faviconURL(u, size = "16") {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", u);
    url.searchParams.set("size", size);
    return url.toString();
}

// Helper function to get settings from storage
async function getSettings() {
    const defaultSettings = {
        defaultSpaceName: 'Home',
        autoArchiveEnabled: false, // Default: disabled
        autoArchiveIdleMinutes: 30, // Default: 30 minutes
        // ... other settings ...
    };
    const result = await chrome.storage.sync.get(defaultSettings);
    console.log("Retrieved settings:", result);
    return result;
}

// --- Tab Name Override Functions ---

// Get all overrides (keyed by tabId)
async function getTabNameOverrides() {
    const result = await chrome.storage.local.get('tabNameOverridesById'); // Changed key
    return result.tabNameOverridesById || {}; // Changed key
}

// Save all overrides (keyed by tabId)
async function saveTabNameOverrides(overrides) {
    await chrome.storage.local.set({ tabNameOverridesById: overrides }); // Changed key
}

// Set or update a single override using tabId
async function setTabNameOverride(tabId, url, name) { // Added tabId, kept url for domain
    if (!tabId || !url || !name) return; // Basic validation

    const overrides = await getTabNameOverrides();
    try {
        // Still store originalDomain in case we need it later, derived from the URL at time of setting
        const originalDomain = new URL(url).hostname;
        overrides[tabId] = { name: name, originalDomain: originalDomain }; // Use tabId as key
        await saveTabNameOverrides(overrides);
        console.log(`Override set for tab ${tabId}: ${name}`);
    } catch (e) {
        console.error("Error setting override - invalid URL?", url, e);
    }
}

// Remove an override using tabId
async function removeTabNameOverride(tabId) { // Changed parameter to tabId
    if (!tabId) return;

    const overrides = await getTabNameOverrides();
    if (overrides[tabId]) { // Check using tabId
        delete overrides[tabId]; // Delete using tabId
        await saveTabNameOverrides(overrides);
        console.log(`Override removed for tab ${tabId}`);
    }
}

// --- Archived Tabs Functions ---
const MAX_ARCHIVED_TABS = 100;
const ARCHIVED_TABS_KEY = 'archivedTabs';

// Get all archived tabs
async function getArchivedTabs() {
    const result = await chrome.storage.local.get(ARCHIVED_TABS_KEY);
    return result[ARCHIVED_TABS_KEY] || [];
}

// Save all archived tabs
async function saveArchivedTabs(tabs) {
    await chrome.storage.local.set({ [ARCHIVED_TABS_KEY]: tabs });
}

// Add a tab to the archive
async function addArchivedTab(tabData) { // tabData = { url, name, spaceId, archivedAt }
    if (!tabData || !tabData.url || !tabData.name || !tabData.spaceId) return;

    const archivedTabs = await getArchivedTabs();

    const exists = archivedTabs.some(t => t.url === tabData.url && t.spaceId === tabData.spaceId);
    if (exists) {
        console.log(`Tab already archived: ${tabData.name}`);
        return; // Don't add duplicates
    }

    // Add new tab with timestamp
    const newArchiveEntry = { ...tabData, archivedAt: Date.now() };
    archivedTabs.push(newArchiveEntry);

    // Sort by timestamp (newest first for potential slicing, though FIFO means oldest removed)
    archivedTabs.sort((a, b) => b.archivedAt - a.archivedAt);

    // Enforce limit (remove oldest if over limit - FIFO)
    if (archivedTabs.length > MAX_ARCHIVED_TABS) {
        archivedTabs.splice(MAX_ARCHIVED_TABS); // Remove items from the end (oldest)
    }

    await saveArchivedTabs(archivedTabs);
    console.log(`Archived tab: ${tabData.name} from space ${tabData.spaceId}`);
}

// Function to archive a tab (likely called from context menu)
async function archiveTab(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !activeSpaceId) return;

        const tabData = {
            url: tab.url,
            name: tab.title,
            spaceId: activeSpaceId // Archive within the current space
        };

        await addArchivedTab(tabData);
        await chrome.tabs.remove(tabId); // Close the original tab
        // Optionally: Refresh sidebar view if needed, though handleTabRemove should cover it

    } catch (error) {
        console.error(`Error archiving tab ${tabId}:`, error);
    }
}


// Remove a tab from the archive (e.g., after restoration)
async function removeArchivedTab(url, spaceId) {
    if (!url || !spaceId) return;

    let archivedTabs = await getArchivedTabs();
    archivedTabs = archivedTabs.filter(tab => !(tab.url === url && tab.spaceId === spaceId));
    await saveArchivedTabs(archivedTabs);
    console.log(`Removed archived tab: ${url} from space ${spaceId}`);
}

async function restoreArchivedTab(archivedTabData) {
    try {
        // Create the tab in the original space's group
        const newTab = await chrome.tabs.create({
            url: archivedTabData.url,
            active: true, // Make it active
            // windowId: currentWindow.id // Ensure it's in the current window
        });

        // Immediately group the new tab into the correct space
        await chrome.tabs.group({ tabIds: [newTab.id] });

        // Remove from archive storage
        await removeArchivedTab(archivedTabData.url, archivedTabData.spaceId);

        // The handleTabCreated and handleTabUpdate listeners should add the tab to the UI.
        // If not, you might need to manually add it or refresh the space view.

    } catch (error) {
        console.error(`Error restoring archived tab ${archivedTabData.url}:`, error);
    }
}


export {
    getSettings,
    generateUUID,
    faviconURL,
    getTabNameOverrides,
    setTabNameOverride,
    removeTabNameOverride,
    getArchivedTabs, 
    addArchivedTab,
    archiveTab,
    restoreArchivedTab,
    removeArchivedTab
};
