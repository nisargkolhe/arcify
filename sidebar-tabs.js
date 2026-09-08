export function selectWindowSpaceTabs(space, tabs, windowId) {
    const byId = new Map(tabs.filter(t => t.windowId === windowId && !t.pinned).map(t => [t.id, t]));
    return [...(space?.spaceBookmarks || []), ...(space?.temporaryTabs || [])]
        .map(id => byId.get(id)).filter(Boolean);
}

// Reorder visible members without disturbing another window's positions.
export function mergeVisibleOrder(allIds, visibleIds) {
    const visible = new Set(visibleIds);
    let index = 0;
    const result = allIds.map(id => visible.has(id) ? visibleIds[index++] : id);
    return [...result, ...visibleIds.slice(index)];
}

export async function saveBookmarkOrder(parentId, displayIds, inverted) {
    const ids = inverted ? [...displayIds].reverse() : displayIds;
    for (let index = 0; index < ids.length; index++) {
        await chrome.bookmarks.move(ids[index], { parentId, index });
    }
}
