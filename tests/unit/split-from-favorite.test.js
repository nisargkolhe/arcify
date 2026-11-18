import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSplitOffFavorite } from '../../split-from-favorite.js';

// Tab strip: favorite 1 (pinned, index 0) split with link 2 (index 1); tab 3 is an existing unpinned tab.
function setup({ bindings = { 1: { bookmarkId: 'b1' } }, inverted = false, joining = false } = {}) {
    let nextSplit = 50;
    const tabs = [
        { id: 1, index: 0, splitViewId: 7, windowId: 1 },
        { id: 2, index: 1, splitViewId: 7, windowId: 1 },
        { id: 3, index: 2, splitViewId: -1, windowId: 1 }
    ];
    const reindex = () => tabs.sort((a, b) => a.index - b.index).forEach((tab, index) => { tab.index = index; });
    const spaces = [{ id: 's', spaceBookmarks: [1], temporaryTabs: [3, 2] }];
    const updates = [];
    const tabsApi = {
        query: async () => tabs.map(tab => ({ ...tab })),
        get: async id => ({ ...tabs.find(tab => tab.id === id) }),
        unsplit: async splitViewId => tabs.forEach(tab => { if (tab.splitViewId === splitViewId) tab.splitViewId = -1; }),
        duplicate: async id => {
            const copy = { id: 9, index: tabs.find(tab => tab.id === id).index + 0.5, splitViewId: -1, windowId: 1 };
            tabs.push(copy);
            reindex();
            return { ...copy };
        },
        move: async (id, { index }) => {
            const tab = tabs.splice(tabs.findIndex(t => t.id === id), 1)[0];
            tabs.splice(index, 0, tab);
            tabs.forEach((t, i) => { t.index = i; });
        },
        createSplit: async ids => { const id = nextSplit++; ids.forEach(tabId => { tabs.find(tab => tab.id === tabId).splitViewId = id; }); },
        update: async (id, props) => { updates.push([id, props]); }
    };
    const dispatch = async message => {
        if (message.action === 'assign') {
            for (const space of spaces) for (const key of ['spaceBookmarks', 'temporaryTabs']) space[key] = space[key].filter(id => id !== message.tabId);
            spaces[0].temporaryTabs[message.atStart ? 'unshift' : 'push'](message.tabId);
        }
        return structuredClone(spaces);
    };
    const deps = { tabsApi, dispatch, getBindings: async () => bindings, isInverted: async () => inverted, isJoining: async () => joining };
    return { tabs, spaces, updates, deps, byId: id => tabs.find(tab => tab.id === id) };
}

test('a favorite split with a link stays alone; a copy and the link become an unpinned split at the top', async () => {
    const { spaces, updates, deps, byId } = setup();
    assert.equal(await moveSplitOffFavorite(7, deps), true);
    assert.equal(byId(1).splitViewId, -1);
    assert.notEqual(byId(9).splitViewId, -1);
    assert.equal(byId(9).splitViewId, byId(2).splitViewId);
    assert.ok(byId(9).index < byId(2).index, 'the copy keeps the favorite\'s side');
    assert.deepEqual(spaces[0].spaceBookmarks, [1]);
    assert.deepEqual(spaces[0].temporaryTabs, [9, 2, 3]);
    assert.deepEqual(updates, [[2, { active: true }]]);
});

test('with inverted tab order the new split goes to the end of the stored order, which shows at the top', async () => {
    const { spaces, deps } = setup({ inverted: true });
    await moveSplitOffFavorite(7, deps);
    assert.deepEqual(spaces[0].temporaryTabs, [3, 9, 2]);
});

test('pinned splits, unpinned splits and deliberate joins are left alone', async () => {
    for (const options of [
        { bindings: { 1: { bookmarkId: 'b1' }, 2: { bookmarkId: 'b2' } } },
        { bindings: {} },
        { joining: true }
    ]) {
        const { byId, deps } = setup(options);
        assert.equal(await moveSplitOffFavorite(7, deps), false);
        assert.equal(byId(1).splitViewId, 7);
    }
});
