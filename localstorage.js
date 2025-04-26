async function getOrCreateArcifyFolder() {
    let [ folder ] = await chrome.bookmarks.search({ title: 'Arcify' });
    if (!folder) {
        folder = await chrome.bookmarks.create({ title: 'Arcify' });
    }
    return folder;
}

async function getOrCreateSpaceFolder(spaceName) {
    const arcifyFolder = await getOrCreateArcifyFolder();
    const children = await chrome.bookmarks.getChildren(arcifyFolder.id);
    let spaceFolder = children.find((f) => f.title === spaceName);

    if (!spaceFolder) {
        spaceFolder = await chrome.bookmarks.create({
            parentId: arcifyFolder.id,
            title: spaceName
        });
    }
    return spaceFolder;
}

// Helper function to generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export { getOrCreateArcifyFolder, getOrCreateSpaceFolder, generateUUID };