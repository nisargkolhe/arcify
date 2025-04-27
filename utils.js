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
    return new Promise((resolve) => {
        chrome.storage.local.get({ defaultSpaceName: 'Home' }, (items) => {
            resolve(items.defaultSpaceName); // Resolve with the value
        });
    });
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

// Export new functions
export { 
    getSettings, 
    generateUUID, 
    faviconURL, 
    getTabNameOverrides, 
    setTabNameOverride, 
    removeTabNameOverride 
}; 