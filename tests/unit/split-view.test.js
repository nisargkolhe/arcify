import test from 'node:test';
import assert from 'node:assert/strict';
import { isInSplit, visibleSplitIds, pairSplits, splitRowRoles } from '../../split-view.js';

const tabs = list => new Map(list.map(tab => [tab.id, tab]));

test('only a real split id counts as split, including on Chrome versions without the field', () => {
    assert.equal(isInSplit({ splitViewId: 3 }), true);
    assert.equal(isInSplit({ splitViewId: -1 }), false);
    assert.equal(isInSplit({}), false);
    assert.equal(isInSplit(undefined), false);
});

test('the partner of an active split half is visible', () => {
    const visible = visibleSplitIds([
        { id: 1, active: true, splitViewId: 9 },
        { id: 2, active: false, splitViewId: 9 },
        { id: 3, active: false, splitViewId: 4 },
        { id: 4, active: true, splitViewId: -1 }
    ]);
    assert.deepEqual([...visible], [9]);
});

test('split halves are pulled together, left half first, where the first one appeared', () => {
    const byId = tabs([
        { id: 1, index: 0, splitViewId: -1 },
        { id: 2, index: 5, splitViewId: 7 },
        { id: 3, index: 1, splitViewId: -1 },
        { id: 4, index: 4, splitViewId: 7 }
    ]);
    assert.deepEqual(pairSplits([1, 2, 3, 4], byId), [1, 4, 2, 3]);
});

test('ids without tab data or without a split keep their order', () => {
    const byId = tabs([{ id: 2, index: 0 }]);
    assert.deepEqual(pairSplits([3, 2, 1], byId), [3, 2, 1]);
});

test('a split half whose partner is not in the list stays put', () => {
    const byId = tabs([{ id: 1, index: 0, splitViewId: 7 }, { id: 2, index: 1, splitViewId: -1 }]);
    assert.deepEqual(pairSplits([2, 1], byId), [2, 1]);
});

test('adjacent rows of the same split share a line; separated halves are marked alone', () => {
    assert.deepEqual(splitRowRoles([undefined, 7, 7, 8, undefined, 8]), [null, 'left', 'right', 'alone', null, 'alone']);
});

test('three rows with one split id pair the first two only', () => {
    assert.deepEqual(splitRowRoles([7, 7, 7]), ['left', 'right', 'alone']);
});
