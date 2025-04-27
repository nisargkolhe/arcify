const ChromeHelper = {
    createNewTab: async function() {
        const newTab = await new Promise((resolve, reject) => {
            chrome.tabs.create({ active: true }, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(tab);
                }
            });
        });
        return newTab;
    },
    createNewTabGroup: async function(newTab, spaceName, spaceColor) {
        // Create a new tab group with the new tab
        const groupId = await chrome.tabs.group({ tabIds: [newTab.id] });
        await chrome.tabGroups.update(groupId, { title: spaceName, color: spaceColor });
        return groupId;
    }
}


export { ChromeHelper };