const COALESCE_MS = 100;
let rootId = null;
let timer = null;

async function getRootId() {
    if (rootId) {
        const [node] = await chrome.bookmarks.get(rootId).catch(() => []);
        if (node) return rootId;
        rootId = null;
    }
    const nodes = await chrome.bookmarks.search({ title: 'Arcify' }).catch(() => []);
    rootId = nodes.find(node => !node.url)?.id || null;
    return rootId;
}

async function isRelevant(ids) {
    const root = await getRootId();
    if (!root) return false;
    for (const original of ids.filter(Boolean)) {
        let id = String(original);
        for (let depth = 0; depth < 16; depth++) {
            if (id === String(root)) return true;
            const [node] = await chrome.bookmarks.get(id).catch(() => []);
            if (!node?.parentId) break;
            id = String(node.parentId);
        }
    }
    return false;
}

function notify(reason) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        try {
            const sent = chrome.runtime.sendMessage({ action: 'arcifyBookmarksChanged', reason });
            sent?.catch?.(() => {});
        } catch { /* No sidebar is normally open. */ }
    }, COALESCE_MS);
}

async function handle(ids, reason) {
    if (await isRelevant(ids)) notify(reason);
}

export function registerBookmarkListeners() {
    chrome.bookmarks.onCreated.addListener((id, node) => handle([node?.parentId], 'created'));
    chrome.bookmarks.onRemoved.addListener((id, info) => {
        if (String(id) === String(rootId)) {
            rootId = null;
            notify('root-removed');
            return;
        }
        handle([id, info?.parentId], 'removed');
    });
    chrome.bookmarks.onMoved.addListener((id, info) => handle([id, info?.parentId, info?.oldParentId], 'moved'));
    chrome.bookmarks.onChanged.addListener(id => handle([id], 'changed'));
    chrome.bookmarks.onChildrenReordered?.addListener((id) => handle([id], 'reordered'));
    chrome.bookmarks.onImportBegan?.addListener(() => notify('import-started'));
    chrome.bookmarks.onImportEnded?.addListener(() => { rootId = null; notify('import-finished'); });
}
