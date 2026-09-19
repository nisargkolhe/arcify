import { Utils } from './utils.js';

export async function getSpaceBookmarkFolder(space) {
    if (!space?.bookmarkFolderId) throw new Error('This space has no bookmark folder association.');
    const [folder] = await chrome.bookmarks.get(space.bookmarkFolderId);
    if (!folder || folder.url) throw new Error('The bookmark folder for this space is unavailable.');
    const root = (await chrome.bookmarks.search({ title: 'Arcify' })).find(node => !node.url);
    if (!root || String(folder.parentId) !== String(root.id)) {
        throw new Error('The bookmark folder is no longer inside the Arcify folder.');
    }
    return folder;
}

export async function getSpaceBookmarkById(space, bookmarkId) {
    if (!bookmarkId) return null;
    const folder = await getSpaceBookmarkFolder(space);
    async function find(parentId) {
        for (const node of await chrome.bookmarks.getChildren(parentId)) {
            if (String(node.id) === String(bookmarkId)) return node.url ? node : null;
            if (!node.url) {
                const match = await find(node.id);
                if (match) return match;
            }
        }
        return null;
    }
    return find(folder.id);
}

export async function removeSpacePin(space, tab) {
    const binding = tab.id ? await Utils.getPinnedTabState(tab.id) : null;
    const bookmarkId = tab.bookmarkId || binding?.bookmarkId;
    if (!bookmarkId) throw new Error('Cannot remove a favorite without its bookmark identity.');
    const bookmark = await getSpaceBookmarkById(space, bookmarkId);
    if (bookmark) await chrome.bookmarks.remove(bookmark.id);
}
