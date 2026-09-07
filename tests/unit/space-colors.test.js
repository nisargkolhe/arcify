import test from 'node:test';
import assert from 'node:assert/strict';
import { firstUnusedColor } from '../../space-colors.js';
const palette = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
test('new spaces preselect the first unused color in palette order', () => {
    assert.equal(firstUnusedColor([], palette), 'grey');
    assert.equal(firstUnusedColor([{ color: 'grey' }, { color: 'red' }], palette), 'blue');
    assert.equal(firstUnusedColor([{ color: 'blue' }, { color: 'blue' }], palette), 'grey');
});
test('after exhausting the palette, fallback is its first entry', () => {
    const spaces = palette.map(color => ({ color }));
    assert.equal(firstUnusedColor(spaces, palette), 'grey');
    assert.equal(firstUnusedColor(spaces.filter(space => space.color !== 'pink'), palette), 'pink');
});
