let chain = Promise.resolve();

export class BookmarkOrderError extends Error {
    constructor(message, { code = 'bookmark_order_failed', observedOrders = {}, moved = false } = {}) {
        super(message);
        this.name = 'BookmarkOrderError';
        this.code = code;
        this.observedOrders = observedOrders;
        this.moved = moved;
    }
}

const ids = nodes => nodes.map(node => String(node.id));
const equal = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const sameSet = (a, b) => a.length === b.length && a.every(id => b.includes(id));

function normalizeList(value, name, { allowNew = false } = {}) {
    if (!Array.isArray(value)) throw new BookmarkOrderError(`${name} must be an array.`, { code: 'invalid_request' });
    const normalized = value.map(String);
    if (!allowNew && normalized.includes('$new')) throw new BookmarkOrderError(`${name} contains an invalid ID.`, { code: 'invalid_request' });
    if (new Set(normalized).size !== normalized.length) {
        throw new BookmarkOrderError(`${name} contains duplicate IDs.`, { code: 'invalid_request' });
    }
    return normalized;
}

async function readOrders(parents) {
    const result = {};
    for (const parent of parents) result[parent.parentId] = ids(await chrome.bookmarks.getChildren(parent.parentId));
    return result;
}

async function reorderParent(parentId, desired, initial, observedOrders) {
    let live = [...initial];
    for (let index = 0; index < desired.length; index++) {
        if (live[index] === desired[index]) continue;
        const fresh = ids(await chrome.bookmarks.getChildren(parentId));
        if (!equal(fresh, live)) {
            observedOrders[parentId] = fresh;
            throw new BookmarkOrderError('Bookmark order changed concurrently. Refresh and retry.', {
                code: 'conflict', observedOrders, moved: true
            });
        }
        await chrome.bookmarks.move(desired[index], { parentId, index });
        const next = ids(await chrome.bookmarks.getChildren(parentId));
        const expected = [...live];
        expected.splice(expected.indexOf(desired[index]), 1);
        expected.splice(index, 0, desired[index]);
        if (!equal(next, expected)) {
            observedOrders[parentId] = next;
            throw new BookmarkOrderError('Bookmark order changed concurrently. Refresh and retry.', {
                code: 'partial', observedOrders, moved: true
            });
        }
        live = next;
        observedOrders[parentId] = live;
    }
    return live;
}

async function applyOperation(request = {}) {
    const parents = (request.parents || []).map(parent => ({
        parentId: String(parent.parentId),
        expected: normalizeList(parent.expectedCanonicalIds, 'expectedCanonicalIds'),
        desired: normalizeList(parent.desiredCanonicalIds, 'desiredCanonicalIds', { allowNew: true })
    }));
    if (!parents.length || new Set(parents.map(parent => parent.parentId)).size !== parents.length) {
        throw new BookmarkOrderError('Bookmark operation has invalid parents.', { code: 'invalid_request' });
    }

    let observedOrders;
    try {
        observedOrders = await readOrders(parents);
    } catch (error) {
        throw new BookmarkOrderError(error.message || 'Bookmark folder is unavailable.', {
            code: 'unavailable', moved: false
        });
    }
    for (const parent of parents) {
        if (!equal(observedOrders[parent.parentId], parent.expected)) {
            throw new BookmarkOrderError('Bookmark order changed before this action was saved. Refresh and retry.', {
                code: 'conflict', observedOrders, moved: false
            });
        }
    }

    const relocation = request.relocation || null;
    let createdId = null;
    if (!relocation) {
        for (const parent of parents) {
            if (!sameSet(parent.expected, parent.desired)) {
                throw new BookmarkOrderError('Bookmark order request has incomplete membership.', {
                    code: 'invalid_request', observedOrders, moved: false
                });
            }
        }
    } else if (relocation.kind === 'create') {
        for (const parent of parents) {
            const desiredWithoutNew = parent.desired.filter(id => id !== '$new');
            const expectedNewCount = parent.parentId === String(relocation.parentId) ? 1 : 0;
            if (parent.desired.filter(id => id === '$new').length !== expectedNewCount || !sameSet(parent.expected, desiredWithoutNew)) {
                throw new BookmarkOrderError('New bookmark request has incomplete membership.', {
                    code: 'invalid_request', observedOrders, moved: false
                });
            }
        }
    } else if (relocation.kind === 'move') {
        const movedId = String(relocation.bookmarkId);
        const expectedUnion = parents.flatMap(parent => parent.expected);
        const desiredUnion = parents.flatMap(parent => parent.desired);
        if (!sameSet(expectedUnion, desiredUnion) || expectedUnion.filter(id => id === movedId).length !== 1 ||
            !parents.find(parent => parent.parentId === String(relocation.parentId))?.desired.includes(movedId)) {
            throw new BookmarkOrderError('Bookmark move request has incomplete membership.', {
                code: 'invalid_request', observedOrders, moved: false
            });
        }
        for (const parent of parents) {
            if (!sameSet(parent.expected.filter(id => id !== movedId), parent.desired.filter(id => id !== movedId))) {
                throw new BookmarkOrderError('Bookmark move request changes unrelated membership.', {
                    code: 'invalid_request', observedOrders, moved: false
                });
            }
        }
    }
    if (relocation) {
        // Chrome bookmarks has no compare-and-swap transaction. Recheck immediately
        // before the first write and verify every resulting order; a Chrome/Sync edit
        // can still race between those calls, in which case we stop and report it.
        const fresh = await readOrders(parents);
        for (const parent of parents) {
            if (!equal(fresh[parent.parentId], parent.expected)) {
                throw new BookmarkOrderError('Bookmark order changed before this action was saved. Refresh and retry.', {
                    code: 'conflict', observedOrders: fresh, moved: false
                });
            }
        }
        if (relocation.kind === 'create') {
            const target = parents.find(parent => parent.parentId === String(relocation.parentId));
            if (!target || target.desired.filter(id => id === '$new').length !== 1) {
                throw new BookmarkOrderError('New bookmark position is invalid.', { code: 'invalid_request', observedOrders: fresh });
            }
            const index = target.desired.indexOf('$new');
            const created = await chrome.bookmarks.create({
                parentId: target.parentId, index, title: relocation.title, url: relocation.url
            });
            createdId = String(created.id);
            for (const parent of parents) parent.desired = parent.desired.map(id => id === '$new' ? createdId : id);
        } else if (relocation.kind === 'move') {
            const bookmarkId = String(relocation.bookmarkId);
            const target = parents.find(parent => parent.parentId === String(relocation.parentId));
            if (!target || !target.desired.includes(bookmarkId)) {
                throw new BookmarkOrderError('Bookmark destination is invalid.', { code: 'invalid_request', observedOrders: fresh });
            }
            await chrome.bookmarks.move(bookmarkId, { parentId: target.parentId, index: target.desired.indexOf(bookmarkId) });
        } else {
            throw new BookmarkOrderError('Bookmark relocation is invalid.', { code: 'invalid_request', observedOrders: fresh });
        }
        observedOrders = await readOrders(parents);
    }

    for (const parent of parents) {
        const live = observedOrders[parent.parentId];
        if (!sameSet(live, parent.desired)) {
            throw new BookmarkOrderError('Bookmark membership changed while this action was saved. Refresh and retry.', {
                code: relocation ? 'partial' : 'conflict', observedOrders, moved: Boolean(relocation)
            });
        }
    }
    for (const parent of parents) {
        observedOrders[parent.parentId] = await reorderParent(parent.parentId, parent.desired, observedOrders[parent.parentId], observedOrders);
    }
    return { orders: observedOrders, createdId };
}

export function enqueueBookmarkOperation(request) {
    const run = chain.then(() => applyOperation(request));
    chain = run.catch(() => {});
    return run;
}

export function enqueueBookmarkOrder({ parentId, expectedCanonicalIds, desiredCanonicalIds }) {
    return enqueueBookmarkOperation({ parents: [{ parentId, expectedCanonicalIds, desiredCanonicalIds }] });
}
