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
test('third-level and foreign-parent creation do not mutate bookmarks', async () => {
    for (const id of ['child', 'foreign', 'bookmark']) {
        await assert.rejects(createFolder('space', id, 'Invalid'));
    }
    assert.deepEqual(created, []);
});
test('sync mode allows top-level folders but prevents nested creation', async () => {
    syncTabGroups = true;
    await createFolder('space', 'space', 'Top');
    await assert.rejects(createFolder('space', 'parent', 'Child'));
    assert.deepEqual(created, [{ parentId: 'space', title: 'Top' }]);
});
test('enabling sync after opening the menu is rechecked at creation', async () => {
    assert.equal(await canCreateFolder('space', 'parent'), true);
    syncTabGroups = true;
    await assert.rejects(createFolder('space', 'parent', 'Child'));
    assert.deepEqual(created, []);
});
