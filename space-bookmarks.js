import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';

export async function getSpaceBookmarkFolder(space) {
    const root = await LocalStorage.getOrCreateArcifyFolder();
    const folders = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url);
    return folders.find(folder => folder.id === space.bookmarkFolderId)
        || folders.find(folder => folder.title === space.name)
        || LocalStorage.getOrCreateSpaceFolder(space.name);
}

export async function removeSpacePin(space, tab) {
    const folder = await getSpaceBookmarkFolder(space);
    const binding = await Utils.getPinnedTabState(tab.id);
    const bookmarks = [];
    async function collect(id) {
        for (const node of await chrome.bookmarks.getChildren(id)) {
            if (node.url) bookmarks.push(node);
            else await collect(node.id);
        }
    }
    await collect(folder.id);
    // Limit removal to this space, and prefer the exact binding over a URL twin.
    const bookmark = bookmarks.find(node => node.id === binding?.bookmarkId)
        || bookmarks.find(node => node.url === (binding?.pinnedUrl || tab.url));
    if (bookmark) await chrome.bookmarks.remove(bookmark.id);
}
