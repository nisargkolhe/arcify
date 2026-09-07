// The space's bookmark root is level zero; user folders may occupy levels 1–2.
export async function canCreateFolder(spaceFolderId, parentId) {
    if (parentId === spaceFolderId) return true;
    const { syncTabGroups = false } = await chrome.storage.sync.get('syncTabGroups');
    if (syncTabGroups) return false;
    const [parent] = await chrome.bookmarks.get(parentId);
    return Boolean(parent && !parent.url && parent.parentId === spaceFolderId);
}

export async function createFolder(spaceFolderId, parentId, title) {
    if (!await canCreateFolder(spaceFolderId, parentId)) {
        throw new Error('Nested folders require tab group sync to be off and support two folder levels.');
    }
    return chrome.bookmarks.create({ parentId, title });
}
