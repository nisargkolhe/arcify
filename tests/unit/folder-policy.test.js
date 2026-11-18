import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { canCreateFolder, canMoveFolder, createFolder, isDescendant } from '../../folder-policy.js';

let syncTabGroups, created;
const splitTree = (id, parentId) => ({ id, parentId, title: '⧉ A | B', children: [
    { id: `${id}-a`, url: 'https://a.test/' }, { id: `${id}-b`, url: 'https://b.test/' }
] });
beforeEach(() => {
    syncTabGroups = false;
    created = [];
    const nodes = {
        parent: { id: 'parent', parentId: 'space' },
        child: { id: 'child', parentId: 'parent' },
        grandchild: { id: 'grandchild', parentId: 'child' },
        level4: { id: 'level4', parentId: 'grandchild' },
        inBookmark: { id: 'inBookmark', parentId: 'bookmark' },
        deep: { id: 'deep', parentId: 'child' },
        foreign: { id: 'foreign', parentId: 'other-space' },
        bookmark: { id: 'bookmark', parentId: 'space', url: 'https://example.com' },
        sibling: { id: 'sibling', parentId: 'space' }
    };
    const trees = {
        parent: { id: 'parent', parentId: 'space', children: [{ id: 'child', parentId: 'parent', children: [{ id: 'leaf', url: 'https://leaf.test/' }] }] },
        child: { id: 'child', parentId: 'parent', children: [{ id: 'leaf', url: 'https://leaf.test/' }] },
        deep: { id: 'deep', parentId: 'child', children: [] },
        sibling: { id: 'sibling', parentId: 'space', children: [{ id: 'tab', url: 'https://tab.test/' }] },
        bookmark: nodes.bookmark,
        split: splitTree('split', 'space'),
        withSplit: { id: 'withSplit', parentId: 'space', children: [splitTree('inner', 'withSplit')] }
    };
    globalThis.chrome = {
        storage: { sync: { get: async () => ({ syncTabGroups }) } },
        bookmarks: {
            get: async id => [nodes[id]],
            getSubTree: async id => [trees[id]],
            create: async data => { created.push(data); return { id: 'new', ...data }; }
        }
    };
});
test('independent mode creates a second-level folder under its exact parent', async () => {
    const result = await createFolder('space', 'parent', 'Child');
    assert.equal(result.parentId, 'parent');
    assert.deepEqual(created, [{ parentId: 'parent', title: 'Child' }]);
});
test('independent mode creates folders at levels 1 to 4', async () => {
    for (const id of ['space', 'parent', 'child', 'grandchild']) {
        assert.equal(await canCreateFolder('space', id), true);
        await createFolder('space', id, 'New');
    }
    assert.deepEqual(created.map(c => c.parentId), ['space', 'parent', 'child', 'grandchild']);
});
test('fifth-level and foreign-parent creation do not mutate bookmarks', async () => {
    for (const id of ['level4', 'foreign', 'bookmark', 'inBookmark', 'missing']) {
        await assert.rejects(createFolder('space', id, 'Invalid'));
    }
    assert.deepEqual(created, []);
});
test('sync mode allows top-level folders but prevents nested creation', async () => {
    syncTabGroups = true;
    await createFolder('space', 'space', 'Top');
    for (const id of ['parent', 'child', 'grandchild']) {
        await assert.rejects(createFolder('space', id, 'Child'));
    }
    assert.deepEqual(created, [{ parentId: 'space', title: 'Top' }]);
});
test('enabling sync after opening the menu is rechecked at creation', async () => {
    assert.equal(await canCreateFolder('space', 'parent'), true);
    syncTabGroups = true;
    await assert.rejects(createFolder('space', 'parent', 'Child'));
    assert.deepEqual(created, []);
});
test('isDescendant matches the folder itself and every node inside it', () => {
    const tree = { id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }, { id: 'd', url: 'https://d.test/' }] };
    for (const id of ['a', 'b', 'c', 'd']) assert.equal(isDescendant(tree, id), true);
    assert.equal(isDescendant(tree, 'space'), false);
    assert.equal(isDescendant({ id: 7 }, '7'), true);
});
test('folders cannot move into themselves or their descendants', async () => {
    for (const target of ['parent', 'child']) assert.equal(await canMoveFolder('space', 'parent', target), false);
    assert.equal(await canMoveFolder('space', 'child', 'child'), false);
});
test('folders move to the space root or into a top-level folder within two levels', async () => {
    assert.equal(await canMoveFolder('space', 'child', 'space'), true);
    assert.equal(await canMoveFolder('space', 'sibling', 'parent'), true);
    assert.equal(await canMoveFolder('space', 'sibling', 'child'), true);
    assert.equal(await canMoveFolder('space', 'parent', 'sibling'), true);
    assert.equal(await canMoveFolder('space', 'parent', 'grandchild'), false);
    assert.equal(await canMoveFolder('space', 'sibling', 'level4'), false);
    assert.equal(await canMoveFolder('space', 'bookmark', 'space'), false);
    syncTabGroups = true;
    assert.equal(await canMoveFolder('space', 'sibling', 'space'), true);
    assert.equal(await canMoveFolder('space', 'sibling', 'parent'), false);
});
test('nested folders reorder within their current parent whatever the sync setting or depth', async () => {
    syncTabGroups = true;
    assert.equal(await canMoveFolder('space', 'child', 'parent'), true);
    assert.equal(await canMoveFolder('space', 'sibling', 'parent'), false);
    syncTabGroups = false;
    assert.equal(await canMoveFolder('space', 'deep', 'child'), true);
    assert.equal(await canMoveFolder('space', 'sibling', 'child'), true);
});

test('a pinned split moves like a favorite, ignoring folder depth and sync limits', async () => {
    syncTabGroups = true;
    assert.equal(await canMoveFolder('space', 'split', 'level4'), true);
    assert.equal(await canMoveFolder('space', 'split', 'split'), false);
});
test('a pinned split inside a folder does not count as a folder level', async () => {
    assert.equal(await canMoveFolder('space', 'withSplit', 'grandchild'), true);
});
