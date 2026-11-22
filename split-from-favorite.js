import { ownerOf } from './space-store.js';
import { ensureSplit } from './split-view.js';

// Session key the sidebar sets while it deliberately splits a favorite to pin the pair.
export const SPLIT_JOIN_KEY = 'splitJoinTabIds';

/**
 * Splitting a favorite with an unpinned tab (a link opened beside it, from Chrome or another
 * extension) leaves the favorite on its own, as in Arc: a copy of it and the other tab become an
 * unpinned split at the top of the space.
 *
 * @param {number} splitViewId
 * @param {object} deps - tabsApi, dispatch (space store), getBindings, isInverted, isJoining.
 * @return {Promise<boolean>} Whether the split was moved off the favorite.
 */
export async function moveSplitOffFavorite(splitViewId, { tabsApi = globalThis.chrome.tabs, dispatch, getBindings, isInverted, isJoining }) {
    const halves = (await tabsApi.query({}))
        .filter(tab => tab.splitViewId === splitViewId)
        .sort((a, b) => a.index - b.index);
    if (halves.length !== 2) return false;
    const bindings = await getBindings();
    const favorites = halves.filter(half => bindings[half.id]?.bookmarkId);
    if (favorites.length !== 1 || await isJoining(halves.map(half => half.id))) return false;

    const [favorite] = favorites;
    const other = halves.find(half => half !== favorite);
    const space = ownerOf(await dispatch({ action: 'get' }), favorite.id);
    await tabsApi.unsplit(splitViewId);
    const copy = await tabsApi.duplicate(favorite.id);
    // The copy takes the favorite's side of the split.
    const [left, right] = favorite.index < other.index ? [copy.id, other.id] : [other.id, copy.id];
    await ensureSplit(left, right, tabsApi);
    if (space) {
        // The top of the list as shown: the start of the stored order, or its end when inverted.
        const atStart = !(await isInverted());
        for (const tabId of atStart ? [right, left] : [left, right]) {
            await dispatch({ action: 'assign', tabId, spaceId: space.id, pinned: false, atStart });
        }
    }
    await tabsApi.update(other.id, { active: true });
    return true;
}
