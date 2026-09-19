import test from 'node:test';
import assert from 'node:assert/strict';
import { SpacePatchQueue } from '../../space-patch-queue.js';

test('failed save cancels dependent optimistic patches and the next edit uses recovered state', async () => {
    let rejectFirst;
    const calls = [];
    const authoritative = [{ id: 'a', name: 'Original', temporaryTabs: [1, 2] }];
    const queue = new SpacePatchQueue(async (before, after) => {
        calls.push({ before, after });
        if (calls.length === 1) await new Promise((_, reject) => { rejectFirst = reject; });
        return after;
    }, async () => authoritative);
    queue.reset([{ id: 'a', name: 'Original', temporaryTabs: [1] }]);
    const first = queue.submit([{ id: 'a', name: 'Failed', temporaryTabs: [1] }]);
    const second = queue.submit([{ id: 'a', name: 'Dependent', temporaryTabs: [] }]);
    const results = Promise.allSettled([first, second]);
    await Promise.resolve();
    assert.equal(queue.acknowledged[0].name, 'Original');
    rejectFirst(new Error('storage failed'));
    assert.deepEqual((await results).map(r => r.status), ['rejected', 'rejected']);
    assert.equal(calls.length, 1);
    await queue.submit([{ ...authoritative[0], name: 'Retry' }]);
    assert.deepEqual(calls[1].before, authoritative);
    assert.deepEqual(queue.acknowledged[0].temporaryTabs, [1, 2]);
});

test('successful queued edits retain the preceding optimistic base until acknowledgment', async () => {
    const calls = [];
    const queue = new SpacePatchQueue(async (before, after) => { calls.push(before); return after; }, async () => []);
    queue.reset([{ id: 'a', name: 'A' }]);
    await Promise.all([queue.submit([{ id: 'a', name: 'B' }]), queue.submit([{ id: 'a', name: 'C' }])]);
    assert.deepEqual(calls.map(before => before[0].name), ['A', 'B']);
    assert.equal(queue.acknowledged[0].name, 'C');
});

test('failed recovery blocks new writes until authoritative state is loaded', async () => {
    let calls = 0;
    const queue = new SpacePatchQueue(async () => { calls++; throw new Error('write failed'); }, async () => { throw new Error('read failed'); });
    await assert.rejects(queue.submit([]), /read failed/);
    await assert.rejects(queue.submit([{ id: 'unsafe' }]), /reload/);
    assert.equal(calls, 1);
    queue.reset([]);
    assert.equal(queue.blocked, false);
});
