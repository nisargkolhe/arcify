import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveFolderCollapsed, loadFolderCollapsed } from '../../folder-state.js';

test('folder states survive a fresh reader, remain independent, and rapid toggles keep the latest value', async () => {
    const data = {};
    globalThis.chrome = { storage: { local: {
        get: async key => ({ [key]: data[key] }),
        set: async patch => { await new Promise(resolve => setImmediate(resolve)); Object.assign(data, patch); }
    } } };
    assert.equal(await loadFolderCollapsed('existing'), true);
    await Promise.all([
        saveFolderCollapsed('parent', false),
        saveFolderCollapsed('child', false),
        saveFolderCollapsed('parent', true),
        saveFolderCollapsed('child', true),
        saveFolderCollapsed('child', false)
    ]);
    const fresh = await import('../../folder-state.js?fresh-reader');
    assert.equal(await fresh.loadFolderCollapsed('parent'), true);
    assert.equal(await fresh.loadFolderCollapsed('child'), false);
    const write = saveFolderCollapsed('parent', false);
    assert.equal(await loadFolderCollapsed('parent'), false);
    await write;
});
