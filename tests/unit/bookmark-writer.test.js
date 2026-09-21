import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueBookmarkOperation, enqueueBookmarkOrder } from '../../bookmark-writer.js';

function install(initialByParent, { delayed = false } = {}) {
    const trees = Object.fromEntries(Object.entries(initialByParent).map(([parent, values]) =>
        [parent, values.map(id => ({ id: String(id), parentId: parent }))]));
    let nextId = 100;
    const moves = [];
    const creates = [];
    let afterMove = null;
    let afterCreate = null;
    globalThis.chrome = { bookmarks: {
        getChildren: async parentId => structuredClone(trees[parentId] || []),
        move: async (id, { parentId, index }) => {
            if (delayed) await new Promise(resolve => setTimeout(resolve, 3));
            let node;
            for (const nodes of Object.values(trees)) {
                const oldIndex = nodes.findIndex(item => item.id === String(id));
                if (oldIndex >= 0) [node] = nodes.splice(oldIndex, 1);
            }
            if (!node) throw new Error('missing bookmark');
            node.parentId = parentId;
            trees[parentId].splice(index, 0, node);
            moves.push([String(id), parentId, index]);
            if (afterMove) await afterMove({ trees, moves });
            return structuredClone(node);
        },
        create: async data => {
            const node = { ...data, id: String(nextId++), parentId: data.parentId };
            trees[data.parentId].splice(data.index, 0, node);
            creates.push(node);
            if (afterCreate) await afterCreate({ trees, creates, node });
            return structuredClone(node);
        }
    } };
    return {
        ids: parent => trees[parent].map(node => node.id), moves, creates,
        mutate: (parent, values) => { trees[parent] = values.map(id => ({ id: String(id), parentId: parent })); },
        afterMove: callback => { afterMove = callback; },
        afterCreate: callback => { afterCreate = callback; }
    };
}

test('a stale second panel conflicts before moving and preserves the completed first order', async () => {
    const state = install({ p: ['a', 'b', 'c'] }, { delayed: true });
    const first = enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a', 'b', 'c'], desiredCanonicalIds: ['c', 'a', 'b'] });
    const second = enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a', 'b', 'c'], desiredCanonicalIds: ['b', 'a', 'c'] });
    await first;
    await assert.rejects(second, error => error.code === 'conflict' && error.moved === false);
    assert.deepEqual(state.ids('p'), ['c', 'a', 'b']);
    assert.equal(state.moves.length, 1);
});

test('rejects incomplete, duplicate, and stale same-set requests without moving', async () => {
    const state = install({ p: ['a', 'b', 'c'] });
    await assert.rejects(enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a', 'b'], desiredCanonicalIds: ['b', 'a'] }),
        error => error.code === 'conflict');
    await assert.rejects(enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a', 'b', 'c'], desiredCanonicalIds: ['a', 'a', 'c'] }),
        error => error.code === 'invalid_request');
    state.mutate('p', ['b', 'a', 'c']);
    await assert.rejects(enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a', 'b', 'c'], desiredCanonicalIds: ['c', 'b', 'a'] }),
        error => error.code === 'conflict');
    assert.equal(state.moves.length, 0);
});

test('external reorder between moves stops the remaining stale pass', async () => {
    const state = install({ p: ['a', 'b', 'c', 'd'] });
    state.afterMove(({ moves }) => {
        if (moves.length === 1) state.mutate('p', ['d', 'c', 'a', 'b']);
    });
    await assert.rejects(enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a', 'b', 'c', 'd'], desiredCanonicalIds: ['c', 'd', 'a', 'b'] }),
        error => error.code === 'partial' || error.code === 'conflict');
    assert.deepEqual(state.ids('p'), ['d', 'c', 'a', 'b']);
});

test('cross-parent move validates both stale sources before the first mutation', async () => {
    const state = install({ source: ['a', 'b'], target: ['c', 'd'] });
    state.mutate('target', ['d', 'c']);
    await assert.rejects(enqueueBookmarkOperation({
        parents: [
            { parentId: 'source', expectedCanonicalIds: ['a', 'b'], desiredCanonicalIds: ['b'] },
            { parentId: 'target', expectedCanonicalIds: ['c', 'd'], desiredCanonicalIds: ['c', 'a', 'd'] }
        ],
        relocation: { kind: 'move', bookmarkId: 'a', parentId: 'target' }
    }), error => error.code === 'conflict' && error.moved === false);
    assert.deepEqual(state.ids('source'), ['a', 'b']);
    assert.equal(state.moves.length, 0);
});

test('cross-parent move and creation use validated worker-side positions', async () => {
    const state = install({ source: ['a', 'b'], target: ['c', 'd'] });
    await enqueueBookmarkOperation({
        parents: [
            { parentId: 'source', expectedCanonicalIds: ['a', 'b'], desiredCanonicalIds: ['b'] },
            { parentId: 'target', expectedCanonicalIds: ['c', 'd'], desiredCanonicalIds: ['c', 'a', 'd'] }
        ],
        relocation: { kind: 'move', bookmarkId: 'a', parentId: 'target' }
    });
    const result = await enqueueBookmarkOperation({
        parents: [{ parentId: 'target', expectedCanonicalIds: ['c', 'a', 'd'], desiredCanonicalIds: ['$new', 'c', 'a', 'd'] }],
        relocation: { kind: 'create', parentId: 'target', title: 'New', url: 'https://new.test/' }
    });
    assert.deepEqual(state.ids('source'), ['b']);
    assert.deepEqual(state.ids('target'), [result.createdId, 'c', 'a', 'd']);
    assert.equal(state.creates.length, 1);
});

test('cross-parent relocation stops when an external same-set reorder wins after the move', async () => {
    const state = install({ source: ['a', 'b'], target: ['c', 'd'] });
    state.afterMove(({ moves }) => {
        if (moves.length === 1) state.mutate('target', ['d', 'a', 'c']);
    });
    await assert.rejects(enqueueBookmarkOperation({
        parents: [
            { parentId: 'source', expectedCanonicalIds: ['a', 'b'], desiredCanonicalIds: ['b'] },
            { parentId: 'target', expectedCanonicalIds: ['c', 'd'], desiredCanonicalIds: ['c', 'a', 'd'] }
        ],
        relocation: { kind: 'move', bookmarkId: 'a', parentId: 'target' }
    }), error => error.code === 'partial' && error.moved === true);
    assert.deepEqual(state.ids('source'), ['b']);
    assert.deepEqual(state.ids('target'), ['d', 'a', 'c']);
    assert.equal(state.moves.length, 1);
});

test('creation stops when an external same-set reorder wins after the create', async () => {
    const state = install({ target: ['c', 'd'] });
    state.afterCreate(({ node }) => state.mutate('target', ['d', node.id, 'c']));
    await assert.rejects(enqueueBookmarkOperation({
        parents: [
            { parentId: 'target', expectedCanonicalIds: ['c', 'd'], desiredCanonicalIds: ['c', '$new', 'd'] }
        ],
        relocation: { kind: 'create', parentId: 'target', title: 'New', url: 'https://new.test/' }
    }), error => error.code === 'partial' && error.moved === true);
    assert.deepEqual(state.ids('target'), ['d', state.creates[0].id, 'c']);
    assert.equal(state.moves.length, 0);
});

test('a deleted parent fails safely before any mutation', async () => {
    const state = install({ p: ['a'] });
    globalThis.chrome.bookmarks.getChildren = async () => { throw new Error('parent deleted'); };
    await assert.rejects(enqueueBookmarkOrder({ parentId: 'p', expectedCanonicalIds: ['a'], desiredCanonicalIds: ['a'] }),
        error => error.code === 'unavailable' && error.moved === false);
    assert.equal(state.moves.length, 0);
});

test('malformed create membership is rejected before creating a bookmark', async () => {
    const state = install({ p: ['a', 'b'] });
    await assert.rejects(enqueueBookmarkOperation({
        parents: [{ parentId: 'p', expectedCanonicalIds: ['a', 'b'], desiredCanonicalIds: ['$new', 'a'] }],
        relocation: { kind: 'create', parentId: 'p', title: 'New', url: 'https://new.test/' }
    }), error => error.code === 'invalid_request' && error.moved === false);
    assert.equal(state.creates.length, 0);
    assert.deepEqual(state.ids('p'), ['a', 'b']);
});
