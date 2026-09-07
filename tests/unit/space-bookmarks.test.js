import test from 'node:test';
import assert from 'node:assert/strict';
import { removeSpacePin, getSpaceBookmarkFolder } from '../../space-bookmarks.js';
import { BookmarkUtils } from '../../bookmark-utils.js';
function mock() {
    const removed = [];
    const tree = { root: [{ id: 'space', title: 'Renamed' }, { id: 'other', title: 'Old name' }], space: [{ id: 'folder', title: 'Nested' }], folder: [
        { id: 'first', title: 'Twin', url: 'https://saved.test/' }, { id: 'bound', title: 'Saved', url: 'https://saved.test/' }
    ] };
    const pins = { 1: { bookmarkId: 'bound', pinnedUrl: 'https://saved.test/' } };
    globalThis.chrome = { storage: { local: { async get() { return { pinnedTabStatesById: pins, spaces: [{ id: 's', spaceBookmarks: [1], temporaryTabs: [2] }] }; } } },
        tabs: { async query() { return [{ id: 1, url: 'https://navigated.test/' }, { id: 2, url: 'https://saved.test/' }]; } },
        bookmarks: { async search() { return [{ id: 'url-twin', url: 'https://arcify.io' }, { id: 'root' }]; },
            async getChildren(id) { return tree[id] || []; }, async remove(id) { removed.push(id); } } };
    return { removed, tree };
}
test('unpin removes the bound nested bookmark after navigation, preserving URL twins', async () => {
    const { removed } = mock();
    const space = { bookmarkFolderId: 'space', name: 'Old name' };
    assert.equal((await getSpaceBookmarkFolder(space)).id, 'space');
    await removeSpacePin(space, { id: 1, url: 'https://navigated.test/' });
    assert.deepEqual(removed, ['bound']);
});
test('startup bookmark binding preserves navigated pins and does not steal their URL twin', async () => {
    mock();
    const bindings = [];
    const ids = await BookmarkUtils.matchTabsWithBookmarks({ id: 'space' }, 's', null,
        async (id, binding) => bindings.push([id, binding]), null, url => url);
    assert.deepEqual(ids, [2, 1]);
    assert.equal(bindings.find(([id]) => id === 1)[1].bookmarkId, 'bound');
});
