import { Utils } from './utils.js';

// URL matching is conservative extra protection, never bookmark identity.
export function isProtectedFavorite(tab, memberIds, bindings, urlKeys) {
    return tab.pinned || memberIds.has(tab.id) || Boolean(bindings[tab.id]?.bookmarkId)
        || urlKeys.has(Utils.getPinnedUrlKey(tab.url));
}
