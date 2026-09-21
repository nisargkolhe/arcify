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

export function canonicalOrderFromDisplay(displayIds, inverted) {
    return inverted ? [...displayIds].reverse() : [...displayIds];
}

export function mergeCapturedTemporaryOrder(allIds, displayIds, inverted) {
    return mergeVisibleOrder(allIds, canonicalOrderFromDisplay(displayIds, inverted));
}

export async function saveBookmarkOperation(operation) {
    const response = await chrome.runtime.sendMessage({ type: 'bookmarkOrder', operation });
    if (!response?.success) {
        const error = new Error(response?.error || 'Bookmark order could not be saved.');
        error.code = response?.code;
        error.observedOrders = response?.observedOrders;
        error.moved = response?.moved;
        throw error;
    }
    return response;
}

export async function saveBookmarkOrder(parentId, expectedCanonicalIds, desiredCanonicalIds) {
    return saveBookmarkOperation({ parents: [{ parentId, expectedCanonicalIds, desiredCanonicalIds }] });
}
