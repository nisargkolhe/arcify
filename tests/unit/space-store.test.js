import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceStore, applySpacePatch, ownerOf } from '../../space-store.js';
import { syncSpaceGroups } from '../../tab-group-sync.js';
import { Utils } from '../../utils.js';

let local, session, sync, tabs, mutations, groups;
const area = data => ({
    async get(keys) {
        const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || data);
        return Object.fromEntries(names.map(k => [k, structuredClone(data[k] ?? keys?.[k])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); }
});
const space = (id, ids = []) => ({ id, spaceUuid: id, name: id, color: 'blue', bookmarkFolderId: id, spaceBookmarks: [], temporaryTabs: ids });
beforeEach(() => {
    local = { spaceModelVersion: 2, spaces: [space('a', [1]), space('b', [2])] };
    session = { spaceSession: true }; sync = {}; mutations = []; groups = [];
    tabs = [{ id: 1, windowId: 1, url: 'https://one.test/', groupId: -1 }, { id: 2, windowId: 1, url: 'https://two.test/', groupId: -1 }];
    const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { this.listeners.forEach(fn => fn(...args)); } });
    globalThis.chrome = {
        runtime: { getURL: path => `chrome-extension://arcify/${path}` },
        storage: { local: area(local), session: area(session), sync: area(sync), onChanged: event() },
        tabs: { onCreated: event(), onUpdated: event(), onRemoved: event(), onReplaced: event(), onActivated: event(), onMoved: event(), query: async query => tabs.filter(t => query.groupId === undefined || query.groupId === t.groupId),
            group: async args => { mutations.push(['group', args]); const id = args.groupId ?? 100 + groups.length; if (!groups.some(g => g.id === id)) groups.push({ id, windowId: 1 }); tabs.filter(t => args.tabIds.includes(t.id)).forEach(t => t.groupId = id); return id; },
            move: async (...args) => mutations.push(['move', ...args]) },
        tabGroups: { onRemoved: event(), onUpdated: event(), query: async () => groups, update: async (id, attrs) => { mutations.push(['update', id, attrs]); Object.assign(groups.find(g => g.id === id), attrs); } },
        bookmarks: { search: async () => [{ id: 'root' }], getChildren: async () => [], create: async ({ title }) => ({ id: title, title }) }
    };
});
test('independent default ignores group identity and order and retains empty spaces', async () => {
    tabs[0].groupId = 99; tabs.reverse();
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.equal(ownerOf(store.spaces, 1).id, 'a');
    tabs = tabs.filter(t => t.id !== 1);
    await store.dispatch({ action: 'activate', spaceId: 'a', windowId: 1 });
    assert.deepEqual(local.spaces[0].temporaryTabs, []);
    assert.equal(local.spaces[0].id, 'a');
    assert.deepEqual(mutations, []);
});
test('stale panel patch preserves concurrent tabs, moves and metadata', () => {
    const before = [space('a', [1]), space('b', [2])];
    const current = structuredClone(before); current[0].temporaryTabs.push(3); current[1].color = 'red';
    const after = structuredClone(before); after[0].temporaryTabs = []; after[1].temporaryTabs.push(1);
    const result = applySpacePatch(current, before, after);
    assert.deepEqual(result[0].temporaryTabs, [3]);
    assert.deepEqual(result[1].temporaryTabs, [2, 1]);
    assert.equal(result[1].color, 'red');
});
test('restart remaps URLs to new IDs and retains stored order', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [
        { spaceId: 'a', section: 'temporaryTabs', order: 0, url: 'https://two.test/' },
        { spaceId: 'a', section: 'temporaryTabs', order: 1, url: 'https://one.test/' }
    ];
    tabs = [{ id: 9, windowId: 1, url: 'https://one.test/' }, { id: 8, windowId: 1, url: 'https://two.test/' }, { id: 2, windowId: 1, url: 'https://unrelated.test/' }];
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    assert.deepEqual(store.spaces[0].temporaryTabs, [8, 9, 2]);
    assert.deepEqual(store.spaces[1].temporaryTabs, []);
});
test('worker restart preserves session membership and opener determines new tab space', async () => {
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    const child = { id: 3, windowId: 1, openerTabId: 2, url: 'https://child.test/' }; tabs.push(child);
    await store.run(async () => { store.track(child); await store.persist(); });
    const next = new SpaceStore(); await next.dispatch({ action: 'get' });
    assert.deepEqual(next.spaces[1].temporaryTabs, [2, 3]);
});
test('explicit assignment beats creation fallback', async () => {
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'assign', tabId: 1, spaceId: 'b', pinned: true });
    assert.deepEqual(local.spaces[0].temporaryTabs, []);
    assert.deepEqual(local.spaces[1].spaceBookmarks, [1]);
});
test('sync is opt-in and disabling it performs no mutations', async () => {
    await syncSpaceGroups(local.spaces); assert.deepEqual(mutations, []);
    sync.syncTabGroups = true; await syncSpaceGroups(local.spaces);
    assert.equal(mutations.filter(m => m[0] === 'group').length, 2);
    assert.deepEqual(local.spaces.map(s => s.id), ['a', 'b']);
    mutations.length = 0; sync.syncTabGroups = false;
    await syncSpaceGroups(local.spaces); assert.deepEqual(mutations, []);
});
test('sync creates each group in its tabs original window', async () => {
    tabs[1].windowId = 2;
    sync.syncTabGroups = true;
    await syncSpaceGroups(local.spaces);
    assert.deepEqual(mutations.filter(m => m[0] === 'group').map(m => m[1]), [
        { tabIds: [1], createProperties: { windowId: 1 } },
        { tabIds: [2], createProperties: { windowId: 2 } }
    ]);
});
test('legacy membership and archived IDs migrate once without group writes', async () => {
    delete local.spaceModelVersion;
    local.spaces = [space(42, [1])]; local.spaces[0].name = 'Work';
    local.archivedTabs = [{ url: 'https://archive.test', spaceId: 42 }];
    tabs[0].groupId = 42;
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    assert.equal(typeof local.spaces[0].id, 'string');
    assert.equal(local.archivedTabs[0].spaceId, local.spaces[0].id);
    assert.equal(ownerOf(local.spaces, 1).id, local.spaces[0].id);
    assert.deepEqual(mutations, []);
});
test('optional import copies groups without changing them', async () => {
    groups = [{ id: 42, title: 'Imported', color: 'green', windowId: 1 }]; tabs[1].groupId = 42;
    const store = new SpaceStore(); await store.dispatch({ action: 'import', windowId: 1 });
    assert.equal(ownerOf(local.spaces, 2).name, 'Imported');
    assert.equal(local.tabGroupImportDismissed, true);
    assert.deepEqual(mutations, []);
});
test('late restored URL is assigned after an initially blank tab resolves', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [{ spaceId: 'b', section: 'temporaryTabs', order: 0, url: 'https://late.test/' }];
    tabs = [{ id: 10, windowId: 1 }];
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    tabs[0].url = 'https://late.test/';
    await store.run(async () => { store.track(tabs[0]); await store.persist(); });
    assert.equal(ownerOf(local.spaces, 10).id, 'b');
});
test('native pinning removes a space binding even when the sidebar is closed', async () => {
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    tabs[0].pinned = true;
    await store.run(async () => { store.track(tabs[0]); await store.persist(); });
    assert.equal(ownerOf(local.spaces, 1), undefined);
    tabs[0].pinned = false;
    await store.run(async () => { store.track(tabs[0]); await store.persist(); });
    assert.equal(ownerOf(local.spaces, 1).id, 'a');
});
test('background event handlers track tab replacement and preserve window-close restore records', async () => {
    const store = new SpaceStore(); store.install(); await store.run(() => {});
    tabs[0].id = 11;
    chrome.tabs.onReplaced.emit(11, 1); await store.run(() => {});
    assert.equal(ownerOf(local.spaces, 11).id, 'a');
    tabs = tabs.filter(t => t.id !== 11);
    chrome.tabs.onRemoved.emit(11, { isWindowClosing: true }); await store.run(() => {});
    assert.equal(local.spaces[0].temporaryTabs.length, 0);
    assert.equal(local.spaceTabSnapshot.find(t => t.url === 'https://one.test/').spaceId, 'a');
});
test('extension pages are removed when a blank helper tab finishes navigating', async () => {
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    tabs[0].url = 'chrome-extension://arcify/options.html';
    await store.run(async () => { store.track(tabs[0]); await store.persist(); });
    assert.equal(ownerOf(local.spaces, 1), undefined);
});
test('migration recovers legacy groups whose IDs changed before the upgrade', async () => {
    delete local.spaceModelVersion;
    local.spaces = [space(42, [1])]; local.spaces[0].name = 'Work';
    local.spaces.push({ ...space(88, []), name: 'Home' });
    groups = [{ id: 77, title: 'Work', color: 'blue', windowId: 1 }, { id: 42, title: 'Unrelated', color: 'red', windowId: 1 }];
    tabs[0].groupId = 77;
    tabs[1].groupId = 42;
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    assert.equal(ownerOf(local.spaces, 1).name, 'Work');
    assert.equal(ownerOf(local.spaces, 2).name, 'Home');
    assert.deepEqual(mutations, []);
});
test('restart restores bookmark bindings even after navigation away from the pinned URL', async () => {
    session.spaceSession = false;
    local.pinnedTabStatesById = { 1: { bookmarkId: 'old-wrong' } };
    local.spaceTabSnapshot = [{ spaceId: 'b', section: 'spaceBookmarks', order: 0,
        url: 'https://navigated.test/', pinnedState: { bookmarkId: 'favorite', pinnedUrl: 'https://original.test/' } }];
    tabs = [{ id: 12, windowId: 1, url: 'https://navigated.test/' }];
    const store = new SpaceStore(); await store.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[1].spaceBookmarks, [12]);
    assert.equal(local.pinnedTabStatesById[12].bookmarkId, 'favorite');
    assert.equal(local.pinnedTabStatesById[1], undefined);
});
test('ordinary new-tab pages use the selected space even with an incidental opener', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    const tab = { id: 3, windowId: 1, openerTabId: 1, url: 'chrome://newtab/' };
    tabs.push(tab);
    await store.run(async () => { store.track(tab); await store.persist(); });
    assert.equal(ownerOf(local.spaces, 3).id, 'b');
});
test('manual archive records the stored owner without a sidebar global', async () => {
    const removed = [];
    chrome.tabs.get = async id => ({ ...tabs.find(t => t.id === id), title: 'Archived example' });
    chrome.tabs.remove = async id => removed.push(id);
    chrome.runtime.sendMessage = async () => ({ success: true, spaces: local.spaces });
    await Utils.archiveTab(2);
    assert.equal(local.archivedTabs[0].spaceId, 'b');
    assert.equal(local.archivedTabs[0].url, 'https://two.test/');
    assert.deepEqual(removed, [2]);
});
test('explicit tab focus raises the window returned by Chrome', async () => {
    const actions = [];
    chrome.tabs.update = async (id, update) => { actions.push(['tab', id, update]); return { id, windowId: 22 }; };
    chrome.windows = { update: async (id, update) => actions.push(['window', id, update]) };
    await Utils.focusTab(2);
    assert.deepEqual(actions, [['tab', 2, { active: true }], ['window', 22, { focused: true }]]);
});
