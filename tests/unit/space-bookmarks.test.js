import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpaceBookmarkById, removeSpacePin, getSpaceBookmarkFolder, getSpaceBookmarkTree } from '../../space-bookmarks.js';
import { BookmarkUtils } from '../../bookmark-utils.js';
function mock() {
    const removed = [];
    const tree = { root: [{ id: 'space', parentId: 'root', title: 'Renamed' }, { id: 'other', parentId: 'root', title: 'Old name' }], space: [{ id: 'folder', parentId: 'space', title: 'Nested' }], folder: [
        { id: 'first', title: 'Twin', url: 'https://saved.test/' }, { id: 'bound', title: 'Saved', url: 'https://saved.test/' }
    ] };
    const pins = { 1: { bookmarkId: 'bound', pinnedUrl: 'https://saved.test/' } };
    globalThis.chrome = { storage: { local: { async get() { return { pinnedTabStatesById: pins, spaces: [{ id: 's', spaceBookmarks: [1], temporaryTabs: [2] }] }; } } },
        tabs: { async query() { return [{ id: 1, url: 'https://navigated.test/' }, { id: 2, url: 'https://saved.test/' }]; } },
        bookmarks: { async search() { return [{ id: 'url-twin', url: 'https://arcify.io' }, { id: 'root', title: 'Arcify' }]; },
            async get(id) { return Object.values(tree).flat().filter(node => node.id === id); }, async getChildren(id) { return tree[id] || []; }, async remove(id) { removed.push(id); } } };
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
    assert.deepEqual(ids, [1]);
    assert.equal(bindings.find(([id]) => id === 1)[1].bookmarkId, 'bound');
});

test('a stale binding never deletes the first URL twin', async () => {
    const { removed } = mock();
    await removeSpacePin({ bookmarkFolderId: 'space' }, { bookmarkId: 'missing', url: 'https://saved.test/' });
    assert.deepEqual(removed, []);
});

test('an unbound temporary tab cannot delete a same-URL favorite', async () => {
    const { removed } = mock();
    await assert.rejects(removeSpacePin({ bookmarkFolderId: 'space' }, { id: 2, url: 'https://saved.test/' }), /identity/);
    assert.deepEqual(removed, []);
});

test('closed favorites delete their exact node and preserve a duplicate sibling', async () => {
    const { removed } = mock();
    await removeSpacePin({ bookmarkFolderId: 'space' }, { bookmarkId: 'bound' });
    assert.deepEqual(removed, ['bound']);
});

test('missing folder identity never falls back to a same-named folder', async () => {
    mock();
    await assert.rejects(getSpaceBookmarkFolder({ name: 'Old name', bookmarkFolderId: 'missing' }), /unavailable/);
    await assert.rejects(getSpaceBookmarkFolder({ name: 'Old name' }), /association/);
});

test('bookmark identity is accepted only inside the associated space subtree', async () => {
    mock();
    assert.equal((await getSpaceBookmarkById({ bookmarkFolderId: 'space' }, 'bound')).id, 'bound');
    assert.equal(await getSpaceBookmarkById({ bookmarkFolderId: 'space' }, 'url-twin'), null);
});

test('bookmark tree loading is all-or-nothing and performs no recovery writes', async () => {
    const { tree } = mock();
    const writes = [];
    globalThis.chrome.bookmarks.create = async (...args) => writes.push(['create', ...args]);
    globalThis.chrome.bookmarks.update = async (...args) => writes.push(['update', ...args]);
    globalThis.chrome.bookmarks.move = async (...args) => writes.push(['move', ...args]);
    const loaded = await getSpaceBookmarkTree({ bookmarkFolderId: 'space' });
    assert.equal(loaded.id, 'space');
    assert.equal(loaded.children[0].id, 'folder');
    assert.deepEqual(loaded.children[0].children.map(node => node.id), ['first', 'bound']);
    assert.deepEqual(writes, []);

    const original = globalThis.chrome.bookmarks.getChildren;
    globalThis.chrome.bookmarks.getChildren = async id => {
        if (id === 'folder') throw new Error('injected read failure');
        return original(id);
    };
    await assert.rejects(getSpaceBookmarkTree({ bookmarkFolderId: 'space' }), /injected read failure/);
    assert.deepEqual(writes, []);
    assert.equal(tree.folder.length, 2);
});
