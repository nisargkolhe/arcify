import { isPracticeUrl } from './tour-practice.js';
import { syncSpaceGroups } from './tab-group-sync.js';
import { LocalStorage } from './localstorage.js';

const sections = ['spaceBookmarks', 'temporaryTabs'];
export const tabIds = space => sections.flatMap(key => space?.[key] || []);
export const ownerOf = (spaces, tabId) => spaces.find(space => tabIds(space).includes(tabId));
const clone = value => structuredClone(value);

// The service worker is the only writer. UI patches express changes relative to the
// panel's previous view, so a stale panel cannot erase tabs created in another window.
export function applySpacePatch(current, before, after) {
    const removed = new Set(before.filter(s => !after.some(n => n.id === s.id)).map(s => s.id));
    let result = clone(current.filter(s => !removed.has(s.id)));
    for (const next of after) {
        const prev = before.find(s => s.id === next.id);
        let target = result.find(s => s.id === next.id);
        if (!target) {
            if (prev) continue; // A different panel deleted this space.
            target = { ...clone(next), spaceBookmarks: [], temporaryTabs: [] };
            result.push(target);
        }
        for (const [key, value] of Object.entries(next)) {
            if (!sections.includes(key) && JSON.stringify(value) !== JSON.stringify(prev?.[key])) target[key] = clone(value);
        }
        for (const key of sections) {
            const oldIds = prev?.[key] || [];
            const newIds = next[key] || [];
            if (JSON.stringify(oldIds) === JSON.stringify(newIds)) continue;
            const deleted = oldIds.filter(id => !newIds.includes(id));
            const added = newIds.filter(id => !oldIds.includes(id));
            for (const id of added) {
                for (const space of result) for (const section of sections) space[section] = space[section].filter(t => t !== id);
            }
            const existing = target[key].filter(id => !deleted.includes(id));
            target[key] = [...newIds.filter(id => existing.includes(id) || added.includes(id)), ...existing.filter(id => !newIds.includes(id))];
        }
    }
    if (JSON.stringify(before.map(s => s.id)) !== JSON.stringify(after.map(s => s.id))) {
        result.sort((a, b) => {
            const rank = s => { const i = after.findIndex(n => n.id === s.id); return i < 0 ? after.length : i; };
            return rank(a) - rank(b);
        });
    }
    return result;
}

export class SpaceStore {
    constructor() { this.chain = Promise.resolve(); this.initialized = false; }
    run(operation) {
        const pending = this.chain.then(async () => { await this.initialize(); return operation(); });
        this.chain = pending.catch(console.error);
        return pending;
    }
    async makeSpace(name, color = 'grey', folder = null) {
        folder ||= await LocalStorage.getOrCreateSpaceFolder(name);
        const entry = await LocalStorage.getOrCreateSpaceRegistryEntry(folder.id, { name, color });
        return { id: entry.spaceUuid, spaceUuid: entry.spaceUuid, uuid: entry.spaceUuid,
            bookmarkFolderId: folder.id, name, color, spaceBookmarks: [], temporaryTabs: [] };
    }
    async initialize() {
        if (this.initialized) return;
        const data = await chrome.storage.local.get(['spaces', 'spaceModelVersion', 'spaceTabSnapshot', 'archivedTabs']);
        const session = await chrome.storage.session.get(['spaceSession', 'spaceRestoreQueue', 'activeSpaces', 'restoredTabRanks']);
        this.spaces = data.spaces || [];
        this.snapshotByTab = new Map((data.spaceTabSnapshot || []).filter(t => t.tabId).map(t => [t.tabId, t]));
        this.provisional = new Set();
        this.restoredMetadata = [];
        this.restoredRanks = new Map(session.restoredTabRanks || []);
        this.active = session.activeSpaces || {};
        this.defaultSpaceName = (await chrome.storage.sync.get('defaultSpaceName')).defaultSpaceName || 'Home';
        const live = await chrome.tabs.query({});
        if (data.spaceModelVersion !== 2) {
            const idMap = new Map();
            const migrated = [];
            const legacyGroups = this.spaces.length ? await chrome.tabGroups.query({}) : [];
            for (const old of this.spaces) {
                const space = await this.makeSpace(old.name, old.color);
                idMap.set(old.id, space.id);
                // Legacy groups are read once to preserve existing users' membership.
                const namedGroups = legacyGroups.filter(g => g.title === old.name);
                const legacyIds = new Set(namedGroups.length ? namedGroups.map(g => g.id) : [old.id]);
                const members = live.filter(t => legacyIds.has(t.groupId) && !t.pinned);
                const pinned = old.spaceBookmarks || [];
                space.spaceBookmarks = members.filter(t => pinned.includes(t.id)).map(t => t.id);
                space.temporaryTabs = members.filter(t => !pinned.includes(t.id)).map(t => t.id);
                const existing = migrated.find(s => s.id === space.id);
                if (existing) {
                    for (const key of sections) existing[key].push(...space[key]);
                } else migrated.push(space);
            }
            this.spaces = migrated;
            if (migrated.length) await chrome.storage.local.set({ tabGroupImportDismissed: true });
            const root = await LocalStorage.getOrCreateArcifyFolder();
            for (const folder of await chrome.bookmarks.getChildren(root.id)) {
                if (!folder.url && !this.spaces.some(s => s.bookmarkFolderId === folder.id)) {
                    this.spaces.push(await this.makeSpace(folder.title, 'grey', folder));
                }
            }
            if (data.archivedTabs) await chrome.storage.local.set({ archivedTabs: data.archivedTabs.map(t => ({ ...t, spaceId: idMap.get(t.spaceId) || t.spaceId })) });
            this.restoreQueue = [];
        } else if (!session.spaceSession) {
            // Chrome tab IDs are session-local. Never accept an old ID after restart.
            this.restoreQueue = data.spaceTabSnapshot || [];
            this.spaces.forEach(s => { s.spaceBookmarks = []; s.temporaryTabs = []; delete s.lastTab; });
            this.active = {};
            this.restoredRanks.clear();
            await chrome.storage.local.set({ pinnedTabStatesById: {}, tabNameOverridesById: {} });
        } else {
            this.restoreQueue = session.spaceRestoreQueue || [];
        }
        if (!this.spaces.length) {
            this.spaces.push(await this.makeSpace(this.defaultSpaceName));
        }
        const valid = new Set(live.map(t => t.id));
        for (const space of this.spaces) for (const key of sections) space[key] = (space[key] || []).filter(id => valid.has(id));
        for (const tab of live) this.track(tab);
        this.initialized = true;
        await this.persist();
    }
    track(tab) {
        const url = tab.url || tab.pendingUrl;
        if (tab.pinned) {
            for (const space of this.spaces) for (const key of sections) space[key] = space[key].filter(id => id !== tab.id);
            return;
        }
        if (url?.startsWith(chrome.runtime?.getURL?.('') || 'chrome-extension://invalid/') && !isPracticeUrl(url)) {
            for (const space of this.spaces) for (const key of sections) space[key] = space[key].filter(id => id !== tab.id);
            return;
        }
        const existing = ownerOf(this.spaces, tab.id);
        if (existing) {
            if (!this.provisional.has(tab.id) || !url) return;
            this.provisional.delete(tab.id);
            if (!this.restoreQueue.some(t => t.url === url)) return;
            for (const key of sections) existing[key] = existing[key].filter(id => id !== tab.id);
        }
        if (!url) this.provisional.add(tab.id);
        const restoredIndex = this.restoreQueue.findIndex(t => t.url === url && this.spaces.some(s => s.id === t.spaceId));
        const restored = restoredIndex >= 0 ? this.restoreQueue.splice(restoredIndex, 1)[0] : null;
        // Chrome can attach the current tab as opener even for Cmd/Ctrl+T.
        // A blank new-tab page belongs to the selected space, not that incidental opener.
        const isNewTabPage = !url || /^(chrome:\/\/(newtab|new-tab-page)\/?|about:blank)$/.test(url);
        const openerSpace = isNewTabPage ? null : ownerOf(this.spaces, tab.openerTabId);
        const space = this.spaces.find(s => s.id === restored?.spaceId) || openerSpace
            || this.spaces.find(s => s.id === this.active[tab.windowId])
            || this.spaces.find(s => s.name === this.defaultSpaceName) || this.spaces[0];
        if (!space) return;
        const key = restored?.section || 'temporaryTabs';
        if (restored) {
            this.restoredMetadata.push({ ...restored, tabId: tab.id });
            // Preserve extension order when Chrome restores tabs in a different order.
            this.restoredRanks ||= new Map();
            this.restoredRanks.set(tab.id, restored.order);
            space[key].push(tab.id);
            space[key].sort((a, b) => (this.restoredRanks.get(a) ?? Infinity) - (this.restoredRanks.get(b) ?? Infinity));
        } else {
            const openerIndex = space[key].indexOf(tab.openerTabId);
            if (openerIndex >= 0) space[key].splice(openerIndex + 1, 0, tab.id);
            else space[key].push(tab.id);
        }
    }
    async persist() {
        const tabs = new Map((await chrome.tabs.query({})).map(t => [t.id, t]));
        this.restoreQueue = this.restoreQueue.filter(t => this.spaces.some(s => s.id === t.spaceId));
        const metadata = await chrome.storage.local.get(['pinnedTabStatesById', 'tabNameOverridesById']);
        const pinnedStates = metadata.pinnedTabStatesById || {};
        const overrides = metadata.tabNameOverridesById || {};
        if (this.restoredMetadata.length) {
            for (const record of this.restoredMetadata) {
                if (record.pinnedState) pinnedStates[record.tabId] = record.pinnedState;
                if (record.nameOverride) overrides[record.tabId] = record.nameOverride;
            }
            await chrome.storage.local.set({ pinnedTabStatesById: pinnedStates, tabNameOverridesById: overrides });
            this.restoredMetadata = [];
        }
        const snapshot = [];
        for (const space of this.spaces) for (const section of sections) {
            space[section] = [...new Set(space[section])].filter(id => tabs.has(id));
            space[section].forEach((id, order) => {
                const tab = tabs.get(id);
                const record = { tabId: id, spaceId: space.id, section, order: this.restoredRanks.get(id) ?? order, url: tab.url || tab.pendingUrl || '',
                    ...(pinnedStates[id] ? { pinnedState: pinnedStates[id] } : {}),
                    ...(overrides[id] ? { nameOverride: overrides[id] } : {}) };
                snapshot.push(record);
                this.snapshotByTab.set(id, record);
            });
        }
        await chrome.storage.local.set({ spaces: clone(this.spaces), spaceModelVersion: 2, spaceTabSnapshot: [...snapshot, ...this.restoreQueue] });
        await chrome.storage.session.set({ spaceSession: true, activeSpaces: this.active, spaceRestoreQueue: this.restoreQueue, restoredTabRanks: [...this.restoredRanks] });
        try { await syncSpaceGroups(this.spaces, this.active); }
        catch (error) { console.warn('Tab group sync deferred:', error); }
    }
    async dispatch(message) {
        return this.run(async () => {
            switch (message.action) {
                case 'get': break;
                case 'patch':
                    for (const next of message.after) {
                        const prev = message.before.find(s => s.id === next.id);
                        for (const key of sections) if (JSON.stringify(next[key]) !== JSON.stringify(prev?.[key])) {
                            for (const id of next[key] || []) this.restoredRanks.delete(id);
                        }
                    }
                    this.spaces = applySpacePatch(this.spaces, message.before, message.after);
                    if (!this.spaces.length) this.spaces.push(await this.makeSpace(this.defaultSpaceName));
                    break;
                case 'activate': this.active[message.windowId] = message.spaceId; break;
                case 'assign': {
                    const target = this.spaces.find(s => s.id === message.spaceId);
                    if (target) {
                        this.provisional.delete(message.tabId);
                        for (const space of this.spaces) for (const key of sections) space[key] = space[key].filter(id => id !== message.tabId);
                        target[message.pinned ? 'spaceBookmarks' : 'temporaryTabs'].push(message.tabId);
                    }
                    break;
                }
                case 'import': {
                    const groups = await chrome.tabGroups.query({ windowId: message.windowId });
                    const tabs = await chrome.tabs.query({ windowId: message.windowId });
                    for (const group of groups) {
                        let name = group.title || 'Imported space';
                        const base = name;
                        for (let i = 2; this.spaces.some(s => s.name === name); i++) name = `${base} ${i}`;
                        const space = await this.makeSpace(name, group.color);
                        const ids = tabs.filter(t => t.groupId === group.id && !t.pinned).map(t => t.id);
                        for (const old of this.spaces) for (const key of sections) old[key] = old[key].filter(id => !ids.includes(id));
                        space.temporaryTabs = ids;
                        this.spaces.push(space);
                    }
                    await chrome.storage.local.set({ tabGroupImportDismissed: true });
                    break;
                }
                default: throw new Error('Unknown space action');
            }
            if (message.action !== 'get') await this.persist();
            return clone(this.spaces);
        });
    }
    install() {
        const handle = operation => this.run(async () => { await operation(); await this.persist(); }).catch(console.error);
        chrome.tabs.onCreated.addListener(tab => handle(() => this.track(tab)));
        chrome.tabs.onUpdated.addListener((id, change, tab) => {
            if (change.url || change.pinned !== undefined) handle(() => this.track(tab));
        });
        chrome.tabs.onRemoved.addListener((id, info) => handle(() => {
            const record = this.snapshotByTab.get(id);
            if (info?.isWindowClosing && record && this.spaces.some(s => s.id === record.spaceId)) this.restoreQueue.push(record);
            this.snapshotByTab.delete(id);
            this.provisional.delete(id);
            for (const space of this.spaces) {
                for (const key of sections) space[key] = space[key].filter(t => t !== id);
                if (space.lastTab === id) delete space.lastTab;
            }
        }));
        chrome.tabs.onReplaced.addListener((added, removed) => handle(() => {
            for (const space of this.spaces) {
                for (const key of sections) space[key] = space[key].map(id => id === removed ? added : id);
                if (space.lastTab === removed) space.lastTab = added;
            }
        }));
        chrome.tabs.onActivated.addListener(info => handle(() => {
            const space = ownerOf(this.spaces, info.tabId);
            if (space) { space.lastTab = info.tabId; this.active[info.windowId] = space.id; }
        }));
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && (changes.pinnedTabStatesById || changes.tabNameOverridesById)) handle(() => {});
            if (area === 'sync' && changes.syncTabGroups) handle(() => {});
            if (area === 'sync' && changes.defaultSpaceName) handle(() => { this.defaultSpaceName = changes.defaultSpaceName.newValue || 'Home'; });
        });
        // Tab-strip changes only request a projection; they never alter the model.
        let syncTimer;
        const scheduleSync = () => {
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => this.run(() => syncSpaceGroups(this.spaces, this.active)).catch(console.error), 200);
        };
        chrome.tabs.onMoved.addListener(scheduleSync);
        chrome.tabs.onUpdated.addListener((id, change) => { if (change.groupId !== undefined) scheduleSync(); });
        chrome.tabGroups.onRemoved.addListener(scheduleSync);
        chrome.tabGroups.onUpdated.addListener(scheduleSync);
        this.run(() => {}).catch(console.error);
    }
}
