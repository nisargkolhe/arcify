export function getTabSelectionRange(orderedTabIds, anchorTabId, targetTabId) {
    const targetIndex = orderedTabIds.indexOf(targetTabId);
    if (targetIndex < 0) return [];
    const anchorIndex = orderedTabIds.indexOf(anchorTabId);
    if (anchorIndex < 0) return [targetTabId];
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return orderedTabIds.slice(start, end + 1);
}

export function getContextTabIds(selectedTabIds, targetTabId) {
    const selected = [...selectedTabIds];
    return selected.length > 1 && selected.includes(targetTabId)
        ? selected
        : [targetTabId];
}
