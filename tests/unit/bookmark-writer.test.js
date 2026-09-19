import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueBookmarkOrder } from '../../bookmark-writer.js';

function install(initial, delayed = false) {
    let children = initial.map(id => ({ id }));
    let active = 0;
    let overlap = false;
    globalThis.chrome = { bookmarks: {
        getChildren: async () => structuredClone(children),
        move: async (id, { index }) => {
            active++;
            if (active > 1) overlap = true;
            if (delayed) await new Promise(resolve => setTimeout(resolve, 5));
            children = children.filter(node => node.id !== id);
            children.splice(index, 0, { id });
            active--;
        }
    } };
    return { ids: () => children.map(node => node.id), overlapped: () => overlap, mutate: ids => { children = ids.map(id => ({ id })); } };
}

test('serializes competing panel order writes and verifies the live tree after each move', async () => {
    const state = install(['a', 'b', 'c'], true);
    await Promise.all([
        enqueueBookmarkOrder({ parentId: 'p', displayIds: ['c', 'a', 'b'], inverted: false }),
        enqueueBookmarkOrder({ parentId: 'p', displayIds: ['b', 'c', 'a'], inverted: false })
    ]);
    assert.deepEqual(state.ids(), ['b', 'c', 'a']);
    assert.equal(state.overlapped(), false);
});

test('refuses an incomplete DOM order instead of moving hidden bookmarks', async () => {
    const state = install(['visible', 'hidden']);
    await assert.rejects(enqueueBookmarkOrder({ parentId: 'p', displayIds: ['visible'], inverted: false }), /changed/);
    assert.deepEqual(state.ids(), ['visible', 'hidden']);
});

test('applies display inversion exactly once', async () => {
    const state = install(['a', 'b', 'c']);
    await enqueueBookmarkOrder({ parentId: 'p', displayIds: ['a', 'c', 'b'], inverted: true });
    assert.deepEqual(state.ids(), ['b', 'c', 'a']);
});
