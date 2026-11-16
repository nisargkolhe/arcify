// Chrome split view support. Chrome 140+ sets tab.splitViewId; older versions
// leave it undefined, which every helper here treats as "not split".
export const SPLIT_VIEW_ID_NONE = -1;

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

// A pinned split is a bookmark folder with this title prefix holding exactly two
// bookmarks, left then right. The folder syncs with Chrome bookmarks and survives
// undo, which recreates bookmarks with new ids.
export const SPLIT_FOLDER_PREFIX = '⧉ ';

// Chrome 155+ can create splits; older versions show pinned splits as plain folders.
export function canCreateSplit(tabsApi = globalThis.chrome?.tabs) {
    return typeof tabsApi?.createSplit === 'function';
}

export function isSplitFolder(node) {
    return Boolean(node) && !node.url && typeof node.title === 'string'
        && node.title.startsWith(SPLIT_FOLDER_PREFIX)
        && node.children?.length === 2 && node.children.every(child => child.url);
}

export function splitFolderTitle(leftTitle, rightTitle) {
    return `${SPLIT_FOLDER_PREFIX}${leftTitle} | ${rightTitle}`;
}

/**
 * Splits two tabs with leftId on the left, moving the right tab beside it and
 * first releasing either tab from any other split.
 *
 * @return {Promise<void>}
 */
export async function ensureSplit(leftId, rightId, tabsApi = globalThis.chrome.tabs) {
    let [left, right] = await Promise.all([tabsApi.get(leftId), tabsApi.get(rightId)]);
    if (isInSplit(left) && left.splitViewId === right.splitViewId) return;
    for (const splitViewId of new Set([left, right].filter(isInSplit).map(tab => tab.splitViewId))) {
        await tabsApi.unsplit(splitViewId);
    }
    [left, right] = await Promise.all([tabsApi.get(leftId), tabsApi.get(rightId)]);
    // tabs.move takes the final index, which shifts down by one when the tab comes from the left.
    const index = right.windowId === left.windowId && right.index < left.index ? left.index : left.index + 1;
    await tabsApi.move(right.id, { windowId: left.windowId, index });
    await tabsApi.createSplit([left.id, right.id]);
}
