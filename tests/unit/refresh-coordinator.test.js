import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshCoordinator } from '../../refresh-coordinator.js';

const immediate = callback => { queueMicrotask(callback); return callback; };
const cancel = () => {};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('bookmark invalidation renders even when adoption sees activation-only metadata', async () => {
    let renders = 0;
    const coordinator = new RefreshCoordinator({
        readSpaces: async () => [{ id: 's', lastTab: 2 }],
        adoptSpaces: async () => false,
        render: async () => { renders++; },
        schedule: immediate, cancel
    });
    coordinator.invalidateBookmarks();
    await flush();
    assert.equal(renders, 1);
    assert.equal(coordinator.handledBookmarkGeneration, 1);
});

test('an invalidation delivered during a delayed render survives for a second drain', async () => {
    let release;
    let renders = 0;
    const coordinator = new RefreshCoordinator({
        readSpaces: async () => [], adoptSpaces: async () => false,
        render: async () => {
            renders++;
            if (renders === 1) await new Promise(resolve => { release = resolve; });
        }, schedule: immediate, cancel
    });
    coordinator.invalidateBookmarks();
    await flush();
    coordinator.invalidateBookmarks();
    release();
    await flush();
    await flush();
    assert.equal(renders, 2);
    assert.equal(coordinator.handledBookmarkGeneration, 2);
});

test('busy and failed drains retain invalidation until a later successful retry', async () => {
    let busy = true;
    let attempts = 0;
    let renders = 0;
    const errors = [];
    const scheduled = [];
    const coordinator = new RefreshCoordinator({
        readSpaces: async () => {
            attempts++;
            if (attempts === 1) throw new Error('read failed');
            return [];
        },
        adoptSpaces: async () => false,
        render: async () => { renders++; },
        isBusy: () => busy,
        onError: error => errors.push(error.message),
        schedule: callback => { scheduled.push(callback); return callback; }, cancel
    });
    coordinator.invalidateBookmarks();
    await scheduled.shift()();
    assert.equal(attempts, 0);
    busy = false;
    await scheduled.shift()();
    assert.equal(coordinator.handledBookmarkGeneration, 0);
    assert.deepEqual(errors, ['read failed']);
    await scheduled.shift()();
    assert.equal(renders, 1);
    assert.equal(coordinator.handledBookmarkGeneration, 1);
});

test('activation-only space updates avoid rendering without bookmark dirtiness', async () => {
    let renders = 0;
    const coordinator = new RefreshCoordinator({
        readSpaces: async () => [], adoptSpaces: async () => false,
        render: async () => { renders++; }, schedule: immediate, cancel
    });
    coordinator.invalidateSpaces();
    await flush();
    assert.equal(renders, 0);
});
