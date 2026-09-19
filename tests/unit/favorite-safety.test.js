import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedFavorite } from '../../favorite-safety.js';

test('navigated favorites remain protected by membership or binding, not only live URL', () => {
    const tab = { id: 7, url: 'https://elsewhere.test/other' };
    assert.equal(isProtectedFavorite(tab, new Set([7]), {}, new Set()), true);
    assert.equal(isProtectedFavorite(tab, new Set(), { 7: { bookmarkId: 'b' } }, new Set()), true);
    assert.equal(isProtectedFavorite(tab, new Set(), {}, new Set()), false);
    assert.equal(isProtectedFavorite({ ...tab, pinned: true }, new Set(), {}, new Set()), true);
});
