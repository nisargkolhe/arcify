// Chrome split view support. Chrome 140+ sets tab.splitViewId; older versions
// leave it undefined, which every helper here treats as "not split".
export const SPLIT_VIEW_ID_NONE = -1;

// A split is pinned whole or not at all, as in Arc.
export const SPLIT_PIN_BLOCKED_MESSAGE = 'Tabs in a split view can\'t be pinned one at a time. Unsplit them to pin this tab.';

export function isInSplit(tab) {
    return Number.isInteger(tab?.splitViewId) && tab.splitViewId !== SPLIT_VIEW_ID_NONE;
}

// Both halves of a split are on screen when either one is the active tab.
export function visibleSplitIds(tabs) {
    return new Set(tabs.filter(tab => tab.active && isInSplit(tab)).map(tab => tab.splitViewId));
}

/**
 * Reorders tab ids so the halves of each split sit together, left half first,
 * where the first of them appeared. Other ids keep their order.
 *
 * @param {number[]} ids
 * @param {Map<number, chrome.tabs.Tab>} tabsById
 * @return {number[]}
 */
export function pairSplits(ids, tabsById) {
    const ordered = [];
    const placed = new Set();
    for (const id of ids) {
        if (placed.has(id)) continue;
        const tab = tabsById.get(id);
        const group = isInSplit(tab)
            ? ids.filter(other => tabsById.get(other)?.splitViewId === tab.splitViewId)
                .sort((a, b) => tabsById.get(a).index - tabsById.get(b).index)
            : [id];
        for (const member of group) {
            if (placed.has(member)) continue;
            placed.add(member);
            ordered.push(member);
        }
    }
    return ordered;
}

/**
 * Decides how consecutive sidebar rows display: two adjacent rows from the same
 * split share one line ('left'/'right'); a split half without its partner next
 * to it is 'alone'; everything else is null.
 *
 * @param {Array<number|undefined>} splitViewIds - One entry per row, in order.
 * @return {Array<'left'|'right'|'alone'|null>}
 */
export function splitRowRoles(splitViewIds) {
    const roles = splitViewIds.map(id => (id === undefined ? null : 'alone'));
    for (let i = 0; i < splitViewIds.length - 1; i++) {
        if (roles[i] === 'alone' && splitViewIds[i] === splitViewIds[i + 1]) {
            roles[i] = 'left';
            roles[i + 1] = 'right';
            i++;
        }
    }
    return roles;
}
