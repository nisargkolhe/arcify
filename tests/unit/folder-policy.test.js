import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { canCreateFolder, createFolder } from '../../folder-policy.js';

let syncTabGroups, created;
beforeEach(() => {
    syncTabGroups = false;
    created = [];
    const nodes = {
        parent: { id: 'parent', parentId: 'space' },
        child: { id: 'child', parentId: 'parent' },
        grandchild: { id: 'grandchild', parentId: 'child' },
        foreign: { id: 'foreign', parentId: 'other-space' },
        bookmark: { id: 'bookmark', parentId: 'space', url: 'https://example.com' }
    };
    globalThis.chrome = {
        storage: { sync: { get: async () => ({ syncTabGroups }) } },
        bookmarks: {
            get: async id => [nodes[id]],
            create: async data => { created.push(data); return { id: 'new', ...data }; }
        }
    };
});
test('independent mode creates a second-level folder under its exact parent', async () => {
    const result = await createFolder('space', 'parent', 'Child');
    assert.equal(result.parentId, 'parent');
    assert.deepEqual(created, [{ parentId: 'parent', title: 'Child' }]);
});
test('independent mode creates a third-level folder under its exact parent', async () => {
    const result = await createFolder('space', 'child', 'Grandchild');
    assert.equal(result.parentId, 'child');
    assert.deepEqual(created, [{ parentId: 'child', title: 'Grandchild' }]);
});
test('fourth-level and invalid-parent creation do not mutate bookmarks', async () => {
    for (const id of ['grandchild', 'foreign', 'bookmark']) {
        await assert.rejects(createFolder('space', id, 'Invalid'));
    }
    assert.deepEqual(created, []);
});
test('sync mode allows top-level and nested folder creation', async () => {
    syncTabGroups = true;
    await createFolder('space', 'space', 'Top');
    await createFolder('space', 'parent', 'Child');
    await createFolder('space', 'child', 'Grandchild');
    assert.deepEqual(created, [
        { parentId: 'space', title: 'Top' },
        { parentId: 'parent', title: 'Child' },
        { parentId: 'child', title: 'Grandchild' }
    ]);
});
test('changing the sync setting does not invalidate nested folder creation', async () => {
    assert.equal(await canCreateFolder('space', 'parent'), true);
    syncTabGroups = true;
    await createFolder('space', 'parent', 'Child');
    assert.deepEqual(created, [{ parentId: 'parent', title: 'Child' }]);
});
