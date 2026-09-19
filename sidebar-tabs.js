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
    const response = await chrome.runtime.sendMessage({ type: 'bookmarkOrder', parentId, displayIds, inverted });
    if (!response?.success) throw new Error(response?.error || 'Bookmark order could not be saved.');
    return response.order;
}
