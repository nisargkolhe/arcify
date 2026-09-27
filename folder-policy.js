// The space's bookmark root is level zero; user folders may occupy levels 1–3.
export async function canCreateFolder(spaceFolderId, parentId) {
    if (parentId === spaceFolderId) return true;
    const [parent] = await chrome.bookmarks.get(parentId);
    if (!parent || parent.url) return false;
    if (parent.parentId === spaceFolderId) return true;
    const [grandparent] = await chrome.bookmarks.get(parent.parentId);
    return Boolean(grandparent && !grandparent.url && grandparent.parentId === spaceFolderId);
}

export async function createFolder(spaceFolderId, parentId, title) {
    if (!await canCreateFolder(spaceFolderId, parentId)) {
        throw new Error('Folders can be nested up to three levels.');
    }
    return chrome.bookmarks.create({ parentId, title });
}
