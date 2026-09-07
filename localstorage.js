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
        let [folder] = await chrome.bookmarks.search({ title: 'Arcify' });
        if (!folder) {
            folder = await chrome.bookmarks.create({ title: 'Arcify' });
        }
        return folder;
    },
    getOrCreateSpaceFolder: async function (spaceName) {
        const arcifyFolder = await this.getOrCreateArcifyFolder();
        const children = await chrome.bookmarks.getChildren(arcifyFolder.id);
        let spaceFolder = children.find((f) => f.title === spaceName);

        if (!spaceFolder) {
            spaceFolder = await chrome.bookmarks.create({
                parentId: arcifyFolder.id,
                title: spaceName
            });
        }
        return spaceFolder;
    },

    // --- Recursive Helper Function to Merge Contents ---
    _mergeFolderContentsRecursive: async function (sourceFolderId, targetFolderId) {
        Logger.log(`Recursively merging contents from ${sourceFolderId} into ${targetFolderId}`);
        try {
            const sourceChildren = await chrome.bookmarks.getChildren(sourceFolderId);
            const targetChildren = await chrome.bookmarks.getChildren(targetFolderId);

            for (const sourceItem of sourceChildren) {
                if (sourceItem.url) { // It's a bookmark
                    const existsInTarget = targetChildren.some(targetItem => targetItem.url === sourceItem.url);
                    if (!existsInTarget) {
                        Logger.log(`Moving bookmark "${sourceItem.title}" (${sourceItem.id}) to ${targetFolderId}`);
                        await chrome.bookmarks.move(sourceItem.id, { parentId: targetFolderId });
                    } else {
                        Logger.log(`Bookmark "${sourceItem.title}" (${sourceItem.id}) already exists in target ${targetFolderId}, removing source.`);
                        await chrome.bookmarks.remove(sourceItem.id);
                    }
                } else { // It's a nested folder
                    const existingTargetSubfolder = targetChildren.find(targetItem => !targetItem.url && targetItem.title === sourceItem.title);

                    if (existingTargetSubfolder) {
                        // Target subfolder exists, merge recursively
                        Logger.log(`Subfolder "${sourceItem.title}" exists in target. Merging subfolder ${sourceItem.id} into ${existingTargetSubfolder.id}`);
                        await this._mergeFolderContentsRecursive(sourceItem.id, existingTargetSubfolder.id);
                        // After merging contents, remove the now-empty source subfolder
                        Logger.log(`Removing merged source subfolder "${sourceItem.title}" (${sourceItem.id})`);
                        await chrome.bookmarks.remove(sourceItem.id);
                    } else {
                        // Target subfolder doesn't exist, move the entire source subfolder
                        Logger.log(`Moving nested folder "${sourceItem.title}" (${sourceItem.id}) to ${targetFolderId}`);
                        await chrome.bookmarks.move(sourceItem.id, { parentId: targetFolderId });
                    }
                }
            }
        } catch (error) {
            Logger.error(`Error merging contents from ${sourceFolderId} to ${targetFolderId}:`, error);
            // Decide if you want to re-throw or just log
        }
    },

    // --- Updated Function to Merge Duplicate Space Folders ---
    mergeDuplicateSpaceFolders: async function () {
        Logger.log("Checking for duplicate space folders...");
        try {
            const [arcifyFolder] = await chrome.bookmarks.search({ title: 'Arcify' });
            if (!arcifyFolder) {
                Logger.log("Arcify folder not found.");
                return;
            }

            const children = await chrome.bookmarks.getChildren(arcifyFolder.id);
            const folders = children.filter(item => !item.url); // Keep only folders

            const folderGroups = new Map();
            folders.forEach(folder => {
                const name = folder.title;
                if (!folderGroups.has(name)) {
                    folderGroups.set(name, []);
                }
                folderGroups.get(name).push(folder);
            });

            for (const [name, group] of folderGroups.entries()) {
                if (group.length > 1) {
                    Logger.log(`Found ${group.length} folders named "${name}". Merging...`);
                    // Sort by dateAdded (oldest first) or just pick the first one
                    group.sort((a, b) => a.dateAdded - b.dateAdded); // Optional: Keep the oldest
                    const targetFolder = group[0]; // Keep the first/oldest one

                    for (let i = 1; i < group.length; i++) {
                        const sourceFolder = group[i];
                        Logger.log(`Merging duplicate folder ID ${sourceFolder.id} ("${sourceFolder.title}") into target ${targetFolder.id}`);
                        try {
                            // Call the recursive helper to merge contents
                            await this._mergeFolderContentsRecursive(sourceFolder.id, targetFolder.id);

                            // After contents are merged, remove the source folder itself
                            // Double-check it's empty first (optional but safer)
                            const remainingChildren = await chrome.bookmarks.getChildren(sourceFolder.id);
                            if (remainingChildren.length === 0) {
                                Logger.log(`Removing empty source folder "${sourceFolder.title}" (ID: ${sourceFolder.id})`);
                                await chrome.bookmarks.remove(sourceFolder.id);
                            } else {
                                Logger.warn(`Source folder ${sourceFolder.id} ("${sourceFolder.title}") not empty after merge attempt, attempting removal anyway or investigate.`);
                                // Decide whether to force remove or log error
                                await chrome.bookmarks.remove(sourceFolder.id); // Or removeTree if necessary
                            }
                        } catch (mergeError) {
                            Logger.error(`Error during top-level merge of folder ${sourceFolder.id} into ${targetFolder.id}:`, mergeError);
                        }
                    }
                    Logger.log(`Finished merging folders named "${name}".`);
                }
            }
            Logger.log("Duplicate folder check complete.");

        } catch (error) {
            Logger.error("Error during duplicate space folder merge process:", error);
        }
    },
    // --- End of Updated Function ---

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