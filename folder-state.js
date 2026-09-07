// Separate keys keep simultaneous updates to different folders independent.
const pendingWrites = new Map();
const keyFor = folderId => `folderCollapsed:${folderId}`;

export function saveFolderCollapsed(folderId, collapsed) {
    if (!folderId) return Promise.resolve();
    const previous = pendingWrites.get(folderId) || Promise.resolve();
    const write = previous.catch(() => {}).then(() =>
        chrome.storage.local.set({ [keyFor(folderId)]: collapsed })
    );
    pendingWrites.set(folderId, write);
    return write.finally(() => {
        if (pendingWrites.get(folderId) === write) pendingWrites.delete(folderId);
    });
}

export async function loadFolderCollapsed(folderId) {
    await pendingWrites.get(folderId);
    const key = keyFor(folderId);
    const saved = await chrome.storage.local.get(key);
    // Existing folders keep the previous collapsed default until toggled.
    return saved[key] !== false;
}
