import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContextTabIds, getTabSelectionRange } from '../../tab-selection.js';

test('shift selection includes every tab between the anchor and target in either direction', () => {
    const order = [11, 12, 13, 14, 15];
    assert.deepEqual(getTabSelectionRange(order, 12, 15), [12, 13, 14, 15]);
    assert.deepEqual(getTabSelectionRange(order, 15, 12), [12, 13, 14, 15]);
});

test('shift selection falls back to the target when its anchor is no longer visible', () => {
    assert.deepEqual(getTabSelectionRange([11, 12, 13], 99, 12), [12]);
});

test('context actions use the group only when the right-clicked tab is selected', () => {
    assert.deepEqual(getContextTabIds(new Set([11, 12, 13]), 12), [11, 12, 13]);
    assert.deepEqual(getContextTabIds(new Set([11, 12, 13]), 14), [14]);
    assert.deepEqual(getContextTabIds(new Set([11]), 11), [11]);
});
