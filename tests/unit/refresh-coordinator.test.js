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
    assert.equal(scheduled.length, 0);
    busy = false;
    coordinator.schedule();
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

test('a render failure does not acknowledge the bookmark generation', async () => {
    let fail = true;
    const scheduled = [];
    const coordinator = new RefreshCoordinator({
        readSpaces: async () => [], adoptSpaces: async () => false,
        render: async () => { if (fail) throw new Error('render failed'); },
        schedule: callback => { scheduled.push(callback); return callback; }, cancel
    });
    coordinator.invalidateBookmarks();
    await scheduled.shift()();
    assert.equal(coordinator.handledBookmarkGeneration, 0);
    fail = false;
    await scheduled.shift()();
    assert.equal(coordinator.handledBookmarkGeneration, 1);
});

test('an editor starting during a delayed read prevents adoption and acknowledgment', async () => {
    let finishRead;
    let busy = false;
    let adoptions = 0;
    let renders = 0;
    const scheduled = [];
    const coordinator = new RefreshCoordinator({
        readSpaces: () => new Promise(resolve => { finishRead = resolve; }),
        adoptSpaces: async () => { adoptions++; return true; },
        render: async () => { renders++; },
        isBusy: () => busy,
        schedule: callback => { scheduled.push(callback); return callback; }, cancel
    });
    coordinator.invalidateBookmarks();
    const drain = scheduled.shift()();
    await Promise.resolve();
    busy = true;
    finishRead([]);
    await drain;
    assert.equal(adoptions, 0);
    assert.equal(renders, 0);
    assert.equal(coordinator.handledBookmarkGeneration, 0);
    busy = false;
});

test('persistent failures use bounded backoff and explicit retry retains dirty work', async () => {
    let fail = true;
    let reads = 0;
    const scheduled = [];
    const delays = [];
    const coordinator = new RefreshCoordinator({
        readSpaces: async () => { reads++; if (fail) throw new Error('persistent'); return []; },
        adoptSpaces: async () => false,
        render: async () => {},
        maxRetries: 2,
        schedule: (callback, delay) => { scheduled.push(callback); delays.push(delay); return callback; }, cancel
    });
    coordinator.invalidateBookmarks();
    await scheduled.shift()();
    await scheduled.shift()();
    await scheduled.shift()();
    assert.equal(reads, 3);
    assert.equal(scheduled.length, 0);
    assert.deepEqual(delays, [100, 100, 200]);
    assert.equal(coordinator.handledBookmarkGeneration, 0);
    fail = false;
    coordinator.retry();
    await scheduled.shift()();
    assert.equal(coordinator.handledBookmarkGeneration, 1);
});
