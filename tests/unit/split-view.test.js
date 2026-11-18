import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isInSplit, visibleSplitIds, pairSplits, splitRowRoles,
    SPLIT_FOLDER_PREFIX, canCreateSplit, isSplitFolder, splitFolderTitle, ensureSplit,
    splitFolderName, namedSplitFolderTitle, getLiveSplitNames, setLiveSplitName
} from '../../split-view.js';

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

test('a split folder is a prefixed folder holding exactly two bookmarks', () => {
    const link = id => ({ id, url: `https://${id}.test/` });
    const folder = (title, children) => ({ id: 'f', title, children });
    assert.equal(isSplitFolder(folder(splitFolderTitle('A', 'B'), [link('a'), link('b')])), true);
    assert.equal(isSplitFolder(folder('Plain', [link('a'), link('b')])), false);
    assert.equal(isSplitFolder(folder(`${SPLIT_FOLDER_PREFIX}A`, [link('a')])), false);
    assert.equal(isSplitFolder(folder(`${SPLIT_FOLDER_PREFIX}A`, [link('a'), { id: 'sub', title: 'Sub', children: [] }])), false);
    assert.equal(isSplitFolder({ id: 'x', title: `${SPLIT_FOLDER_PREFIX}A`, url: 'https://x.test/' }), false);
});

test('split creation is only offered when Chrome provides it', () => {
    assert.equal(canCreateSplit({ createSplit() {} }), true);
    assert.equal(canCreateSplit({}), false);
    assert.equal(canCreateSplit(undefined), false);
});

function fakeTabs(list) {
    const calls = [];
    const byId = new Map(list.map(tab => [tab.id, { splitViewId: -1, windowId: 1, ...tab }]));
    return {
        calls,
        get: async id => ({ ...byId.get(id) }),
        unsplit: async splitViewId => {
            calls.push(['unsplit', splitViewId]);
            for (const tab of byId.values()) if (tab.splitViewId === splitViewId) tab.splitViewId = -1;
        },
        move: async (id, props) => { calls.push(['move', id, props]); },
        createSplit: async ids => { calls.push(['createSplit', ids]); }
    };
}

test('ensureSplit moves the right tab next to the left one before splitting', async () => {
    const api = fakeTabs([{ id: 1, index: 2 }, { id: 2, index: 6 }]);
    await ensureSplit(1, 2, api);
    assert.deepEqual(api.calls, [['move', 2, { windowId: 1, index: 3 }], ['createSplit', [1, 2]]]);
});

test('ensureSplit accounts for the index shift when the right tab starts on the left', async () => {
    const api = fakeTabs([{ id: 1, index: 4 }, { id: 2, index: 1 }]);
    await ensureSplit(1, 2, api);
    assert.deepEqual(api.calls[0], ['move', 2, { windowId: 1, index: 4 }]);
});

test('ensureSplit leaves an existing pairing alone and releases other splits first', async () => {
    const paired = fakeTabs([{ id: 1, index: 0, splitViewId: 5 }, { id: 2, index: 1, splitViewId: 5 }]);
    await ensureSplit(1, 2, paired);
    assert.deepEqual(paired.calls, []);

    const elsewhere = fakeTabs([{ id: 1, index: 0, splitViewId: 5 }, { id: 3, index: 1, splitViewId: 5 }, { id: 2, index: 4 }]);
    await ensureSplit(1, 2, elsewhere);
    assert.deepEqual(elsewhere.calls.map(call => call[0]), ['unsplit', 'move', 'createSplit']);
});

test('a split folder has a name only once its title stops repeating its halves', () => {
    const halves = [{ title: 'Gmail', url: 'https://mail.test/' }, { title: 'Calendar', url: 'https://cal.test/' }];
    assert.equal(splitFolderName({ title: splitFolderTitle('Gmail', 'Calendar'), children: halves }), '');
    assert.equal(splitFolderName({ title: `${SPLIT_FOLDER_PREFIX}Inbox + Cal`, children: halves }), 'Inbox + Cal');
    assert.equal(namedSplitFolderTitle('Inbox + Cal', 'Gmail', 'Calendar'), `${SPLIT_FOLDER_PREFIX}Inbox + Cal`);
    assert.equal(namedSplitFolderTitle('', 'Gmail', 'Calendar'), splitFolderTitle('Gmail', 'Calendar'));
});

test('unpinned split names are kept per split and cleared with an empty name', async () => {
    const data = {};
    const storage = {
        get: async key => ({ [key]: data[key] }),
        set: async values => Object.assign(data, values)
    };
    await setLiveSplitName(4, 'Inbox + Cal', storage);
    await setLiveSplitName(9, 'Docs', storage);
    await setLiveSplitName(4, '', storage);
    assert.deepEqual(await getLiveSplitNames(storage), { 9: 'Docs' });
});
