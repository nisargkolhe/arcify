// The space's bookmark root is level zero; user folders may occupy levels 1 to MAX_FOLDER_DEPTH.
export const MAX_FOLDER_DEPTH = 4;

export async function canCreateFolder(spaceFolderId, parentId) {
    if (parentId === spaceFolderId) return true;
    const { syncTabGroups = false } = await chrome.storage.sync.get('syncTabGroups');
    if (syncTabGroups) return false;
    // A new folder sits one level below its parent, so the parent may be at most MAX_FOLDER_DEPTH - 1.
    let id = parentId;
    for (let depth = 1; depth < MAX_FOLDER_DEPTH; depth++) {
        const [node] = await chrome.bookmarks.get(id);
        if (!node || node.url) return false;
        if (node.parentId === spaceFolderId) return true;
        id = node.parentId;
    }
    return false;
}

export async function createFolder(spaceFolderId, parentId, title) {
    if (!await canCreateFolder(spaceFolderId, parentId)) {
        throw new Error(`Nested folders require tab group sync to be off and support up to ${MAX_FOLDER_DEPTH} folder levels.`);
    }
    return chrome.bookmarks.create({ parentId, title });
}
