import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWindowSpaceTabs, mergeVisibleOrder, saveBookmarkOrder } from '../../sidebar-tabs.js';

test('window-scoped space tabs retain extension order despite native order and duplicate URLs', () => {
    const space = { spaceBookmarks: [3, 2], temporaryTabs: [4, 1, 5] };
    const tabs = [1, 2, 3, 4, 5].map(id => ({ id, windowId: id % 2 ? 10 : 20, url: 'https://same.test', pinned: id === 5 }));
    assert.deepEqual(selectWindowSpaceTabs(space, tabs, 10).map(t => t.id), [3, 1]);
    assert.deepEqual(selectWindowSpaceTabs(space, tabs, 20).map(t => t.id), [2, 4]);
    tabs[0].windowId = 20;
    assert.deepEqual(selectWindowSpaceTabs(space, tabs, 10).map(t => t.id), [3]);
    assert.deepEqual(selectWindowSpaceTabs(space, tabs, 20).map(t => t.id), [2, 4, 1]);
});
test('reordering one window preserves other window slots and membership', () => {
    assert.deepEqual(mergeVisibleOrder([1, 2, 3, 4], [3, 1]), [3, 2, 1, 4]);
    assert.deepEqual(mergeVisibleOrder([1, 2, 3], [3, 1, 5]), [3, 2, 1, 5]);
});
test('bookmark drag order round-trips through storage in both display directions', async () => {
    for (const inverted of [false, true]) {
        let stored = ['a', 'b', 'c'];
        globalThis.chrome = { bookmarks: { move: async (id, { parentId, index }) => {
            assert.equal(parentId, 'folder');
            stored = stored.filter(value => value !== id);
            stored.splice(index, 0, id);
        } } };
        await saveBookmarkOrder('folder', ['c', 'a', 'b'], inverted);
        assert.deepEqual(inverted ? [...stored].reverse() : stored, ['c', 'a', 'b']);
    }
});
