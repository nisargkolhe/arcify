import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { SpaceStore, ownerOf } from '../../space-store.js';
import { isProtectedFavorite } from '../../favorite-safety.js';
import { Utils } from '../../utils.js';
import { Logger } from '../../logger.js';

const threshold = 360 * 60 * 1000;

const source = readFileSync(new URL('../../background.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '');
let local, session, tabs, removed;
const area = data => ({
    async get(keys) {
        const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || data);
        return Object.fromEntries(names.map(k => [k, structuredClone(data[k] ?? keys?.[k])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); }
});
const space = (id, ids = []) => ({ id, spaceUuid: id, name: id, color: 'blue', bookmarkFolderId: id, spaceBookmarks: [], temporaryTabs: ids });
beforeEach(() => {
    local = { spaceModelVersion: 2, spaces: [space('a', [1])] };
    session = { spaceSession: true }; removed = [];
    tabs = [{ id: 1, windowId: 1, url: 'https://one.test/', groupId: -1, active: false }];
});
function startBackground() {
    const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
    const chrome = globalThis.chrome = {
        runtime: { getURL: path => `chrome-extension://arcify/${path}`, onInstalled: event(), onStartup: event(), onMessage: event() },
        sidePanel: { setPanelBehavior: async () => {} },
        commands: { onCommand: event() },
        alarms: { onAlarm: event() },
        storage: { local: area(local), session: area(session), sync: area({ autoArchiveEnabled: true }), onChanged: event() },
        tabs: { onCreated: event(), onUpdated: event(), onRemoved: event(), onReplaced: event(), onActivated: event(), onMoved: event(),
            query: async () => structuredClone(tabs), get: async id => structuredClone(tabs.find(t => t.id === id)),
            remove: async id => { removed.push(id); tabs = tabs.filter(t => t.id !== id); } },
        tabGroups: { onRemoved: event(), onUpdated: event(), query: async () => [] },
        bookmarks: { search: async () => [{ id: 'root' }], getChildren: async () => [], getSubTree: async () => [{ id: 'root', children: [] }] }
    };
    runInNewContext(source, {
        chrome, console, setTimeout, clearTimeout,
        registerTourMessages() {}, registerBookmarkListeners() {},
        enqueueBookmarkOperation: async () => ({}), copyCurrentTabUrlWithFallback: async () => {},
        SpaceStore, ownerOf, isProtectedFavorite, Utils, Logger
    });
    return () => Promise.all(chrome.alarms.onAlarm.listeners.map(fn => fn({ name: 'autoArchiveTabsAlarm' })));
}

test('a background tab with no activity record is tracked instead of archived', async () => {
    local.tabLastActivity = {};
    await startBackground()();
    assert.deepEqual(removed, []);
    assert.equal(local.archivedTabs, undefined);
    assert.equal(typeof local.tabLastActivity[1], 'number');
});
test('a tab idle past the threshold in the same session is archived', async () => {
    local.tabLastActivity = { 1: Date.now() - threshold - 1000 };
    await startBackground()();
    assert.deepEqual(removed, [1]);
    assert.equal(local.archivedTabs[0].url, 'https://one.test/');
});
test('a previous-session record for a reused tab id does not archive it at the first check after restart', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [{ spaceId: 'a', section: 'temporaryTabs', order: 0, url: 'https://restored.test/' }];
    local.tabLastActivity = { 42: Date.now() - threshold - 1000 };
    tabs = [{ id: 42, windowId: 1, url: 'https://restored.test/', groupId: -1, active: false }];
    await startBackground()();
    assert.deepEqual(removed, []);
    assert.deepEqual(local.spaces[0].temporaryTabs, [42]);
    assert.ok(Date.now() - local.tabLastActivity[42] < threshold);
});
test('an activation write in flight during the new-session clear does not restore previous-session records', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [{ spaceId: 'a', section: 'temporaryTabs', order: 1, url: 'https://restored.test/' }];
    local.tabLastActivity = { 42: Date.now() - threshold - 1000 };
    tabs = [{ id: 7, windowId: 1, url: 'https://active.test/', groupId: -1, active: true },
        { id: 42, windowId: 1, url: 'https://restored.test/', groupId: -1, active: false }];
    const fireAlarm = startBackground();
    const storage = chrome.storage.local, get = storage.get, set = storage.set;
    let markCleared;
    const cleared = new Promise(resolve => { markCleared = resolve; });
    storage.set = async values => { await set(values); if ('tabLastActivity' in values) markCleared(); };
    storage.get = async keys => {
        if (keys !== 'tabLastActivity') return get(keys);
        const snapshot = await get(keys);
        await cleared;
        return snapshot;
    };
    await Promise.all(chrome.tabs.onActivated.listeners.map(fn => fn({ tabId: 7, windowId: 1 })));
    await fireAlarm();
    assert.deepEqual(removed, []);
    assert.ok(Date.now() - local.tabLastActivity[42] < threshold);
});
