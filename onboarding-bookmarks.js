// Read only: setup should describe the actual bookmark tree without creating spaces.
export async function readBookmarkSpaces() {
    const roots = await chrome.bookmarks.search({ title: 'Arcify' });
    const root = roots.find(node => !node.url);
    if (!root) return { folderId: null, names: [] };
    const children = await chrome.bookmarks.getChildren(root.id);
    return { folderId: root.id, names: children.filter(node => !node.url).map(node => node.title) };
}
