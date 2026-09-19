/**
 * LocalStorage - Bookmark-based persistence and Chrome storage utilities
 * 
 * Purpose: Manages space bookmarks and provides legacy storage compatibility
 * Key Functions: Arcify bookmark folder management, space bookmark operations, storage synchronization
 * Architecture: Static utility object for bookmark-based data persistence
 * 
 * Critical Notes:
 * - Creates and manages "Arcify" bookmark folder for space persistence
 * - Provides bookmark-based storage as alternative to chrome.storage
 * - Used for space bookmark functionality (separate from main space data in chrome.storage)
 * - Handles bookmark folder creation and organization automatically
 */

import { Logger } from './logger.js';

const LocalStorage = {
    // Durable space IDs anchored to bookmark folders. SpaceStore owns live membership;
    // this registry keeps the folder association stable through migration and restart.
    _registryChain: Promise.resolve(),
    _serializeRegistryOp: function (op) {
        const run = this._registryChain.then(op, op);
        this._registryChain = run.then(() => { }, () => { });
        return run;
    },
    getSpaceRegistry: async function () {
        const result = await chrome.storage.local.get('spaceRegistry');
        return result.spaceRegistry || {};
    },
    saveSpaceRegistry: async function (registry) {
        await chrome.storage.local.set({ spaceRegistry: registry || {} });
    },
    // Get the durable entry for a space's bookmark folder, creating it (with a fresh
    // spaceUuid) on first sight. On creation the passed name/color seed the entry.
    getOrCreateSpaceRegistryEntry: async function (bookmarkFolderId, attrs = {}) {
        if (!bookmarkFolderId) return null;
        return this._serializeRegistryOp(async () => {
            const registry = await this.getSpaceRegistry();
            let entry = registry[bookmarkFolderId];
            if (!entry) {
                const spaceUuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `space-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                entry = {
                    spaceUuid,
                    bookmarkFolderId,
                    name: attrs.name ?? null,
                    color: attrs.color ?? null,
                    order: attrs.order ?? 0,
                };
                registry[bookmarkFolderId] = entry;
                await this.saveSpaceRegistry(registry);
            }
            return entry;
        });
    },
    removeSpaceRegistryEntry: async function (bookmarkFolderId) {
        if (!bookmarkFolderId) return;
        return this._serializeRegistryOp(async () => {
            const registry = await this.getSpaceRegistry();
            if (registry[bookmarkFolderId]) {
                delete registry[bookmarkFolderId];
                await this.saveSpaceRegistry(registry);
            }
        });
    },
    // Update a registry entry's mutable attributes (name/color/order) so the durable record
    // tracks the user's renames/recolors. No-op if the entry doesn't exist yet.
    updateSpaceRegistryEntry: async function (bookmarkFolderId, attrs = {}) {
        if (!bookmarkFolderId) return;
        return this._serializeRegistryOp(async () => {
            const registry = await this.getSpaceRegistry();
            const entry = registry[bookmarkFolderId];
            if (!entry) return;
            if (attrs.name !== undefined) entry.name = attrs.name;
            if (attrs.color !== undefined) entry.color = attrs.color;
            if (attrs.order !== undefined) entry.order = attrs.order;
            await this.saveSpaceRegistry(registry);
        });
    },

    getOrCreateArcifyFolder: async function () {
        let folder = (await chrome.bookmarks.search({ title: 'Arcify' })).find(node => !node.url);
        if (!folder) {
            folder = await chrome.bookmarks.create({ title: 'Arcify' });
        }
        return folder;
    },
    getOrCreateSpaceFolder: async function (spaceName) {
        const arcifyFolder = await this.getOrCreateArcifyFolder();
        const children = await chrome.bookmarks.getChildren(arcifyFolder.id);
        let spaceFolder = children.find((f) => !f.url && f.title === spaceName);

        if (!spaceFolder) {
            spaceFolder = await chrome.bookmarks.create({
                parentId: arcifyFolder.id,
                title: spaceName
            });
        }
        return spaceFolder;
    },

    // Get all space names from Arcify bookmark folders (source of truth)
    getSpaceNames: async function () {
        let spaceNames = new Set(); // Use Set to automatically deduplicate

        try {
            // Get the Arcify folder
            const arcifyFolder = await this.getOrCreateArcifyFolder();
            if (arcifyFolder) {
                // Get all children of the Arcify folder
                const children = await chrome.bookmarks.getChildren(arcifyFolder.id);

                // Filter for folders only (not bookmarks) and extract names
                const folders = children.filter(item => !item.url);
                folders.forEach(folder => {
                    spaceNames.add(folder.title);
                });

                Logger.log('Found spaces from Arcify bookmark folders:', spaceNames.size);
            }
        } catch (bookmarkError) {
            Logger.log('Could not get spaces from bookmark folders:', bookmarkError);
        }

        // Return sorted array of unique space names
        return Array.from(spaceNames).sort();
    }
}

export { LocalStorage };