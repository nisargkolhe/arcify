import { getSpaceBookmarkFolder, removeSpacePin } from './space-bookmarks.js';
import { initSidebarTour } from './sidebar-tour.js';
/**
 * Sidebar - Main extension UI and tab/space management
 * 
 * Purpose: Implements Arc-like vertical tab organization with spaces
 * Key Functions: Space creation/management, tab organization, drag-and-drop, archived tabs
 * Architecture: Side panel UI backed by extension-owned space data
 * 
 * Critical Notes:
 * - Primary user interface for tab and space management
 * - Real-time sync with extension data and active tab changes
 * - Handles drag-and-drop for tab/space reorganization
 * - Manages archived tabs and auto-archive settings
 */

import { ChromeHelper } from './chromeHelper.js';
import { spaceRequest } from './space-client.js';
import { ownerOf } from './space-store.js';
import { canCreateFolder, createFolder } from './folder-policy.js';
import { loadFolderCollapsed, saveFolderCollapsed } from './folder-state.js';
import { FOLDER_CLOSED_ICON, FOLDER_CLOSED_DOTS_ICON, FOLDER_OPEN_ICON } from './icons.js';
import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';
import {
    setupDOMElements,
    showSpaceNameInput,
    activateTabInDOM,
    activateSpaceInDOM,
    showTabContextMenu,
    showArchivedTabsPopup,
    setupQuickPinListener,
    getDragAfterElement,
    getSpaceElement,
    getContainers,
    getTabElement,
    getPinnedContainer,
    getTempContainer,
    clearAllActiveStates,
    hideAllDropIndicators,
    showDropIndicator,
    getDropPosition,
    handleEmptyContainerDrop
} from './domManager.js';
import { BookmarkUtils } from './bookmark-utils.js';
import { Logger } from './logger.js';
import { MOUSE_BUTTON, CSS_CLASSES, TIMING } from './constants.js';

// DOM Elements
const spacesList = document.getElementById('spacesList');
const spaceSwitcher = document.getElementById('spaceSwitcher');
const addSpaceBtn = document.getElementById('addSpaceBtn');
const newTabBtn = document.getElementById('newTabBtn');
const spaceTemplate = document.getElementById('spaceTemplate');

// Global state
let spaces = [];
let activeSpaceId = null;
let previousSpaceId = null;
let isCreatingSpace = false;
let isOpeningBookmark = false;
let isDraggingTab = false;
let currentWindow = null;
let defaultSpaceName = 'Home';
let showAllOpenTabsInCollapsedFolders = false; // default Arc behavior is false (active-only)
let activeChromeTabId = null;
// Arc-like behavior: track which tabs have been active in each collapsed folder.
// These tabs stay visible until user manually opens/closes the folder.
// WeakMap<HTMLElement (folder), Set<number (tabId)>>
const collapsedFolderShownTabs = new WeakMap();

// Helper function to update bookmark for a tab
async function updateBookmarkForTab(tab, bookmarkTitle) {
    Logger.log("updating bookmark", tab, bookmarkTitle);
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

    for (const spaceFolder of spaceFolders) {
        Logger.log("looking for space folder", spaceFolder);
        // Prefer stored mapping (tabId -> bookmarkId) so we can update even if the tab navigated away.
        const pinnedState = await Utils.getPinnedTabState(tab.id);
        if (pinnedState?.bookmarkId) {
            try {
                await chrome.bookmarks.update(pinnedState.bookmarkId, { title: bookmarkTitle });
                return;
            } catch (e) {
                Logger.warn('[Bookmarks] Failed updating bookmark by stored bookmarkId, falling back to URL search.', e);
            }
        }

        // Fallback: search by pinned URL (not tab.url!) and only update title.
        const pinnedUrl = pinnedState?.pinnedUrl;
        if (!pinnedUrl) continue;
        const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
        Logger.log("looking for bookmarks", bookmarks);
        const bookmark = BookmarkUtils.findBookmarkByUrl(bookmarks, pinnedUrl);
        if (bookmark) {
            await chrome.bookmarks.update(bookmark.id, { title: bookmarkTitle });
            await Utils.setPinnedTabState(tab.id, { bookmarkId: bookmark.id, pinnedUrl: pinnedUrl });
            return;
        }
    }

}

async function replaceBookmarkUrlWithCurrentUrl(tab, tabElement) {
    if (!tab?.id) return;

    // Always prefer the live tab URL (the `tab` object captured by the UI can be stale).
    let liveTab = null;
    try {
        liveTab = await chrome.tabs.get(tab.id);
    } catch (e) {
        // We'll fall back to dataset/tab url below.
    }

    const newUrl = liveTab?.url || tabElement?.dataset?.url || tab?.url || null;
    if (!newUrl) {
        console.warn('[Arcify] Replace bookmark URL failed: missing current tab URL', { tabId: tab.id });
        return;
    }
    const newTitle = liveTab?.title || tab?.title || null;

    const stored = await Utils.getPinnedTabState(tab.id);
    const bookmarkId = tabElement?.dataset?.bookmarkId || stored?.bookmarkId;
    const pinnedUrl = tabElement?.dataset?.pinnedUrl || stored?.pinnedUrl;

    // If we don't know the bookmarkId, try resolving by pinnedUrl within the current space folder.
    let resolvedBookmarkId = bookmarkId;
    if (!resolvedBookmarkId && pinnedUrl) {
        const activeSpace = spaces.find(s => s.id === activeSpaceId);
        if (activeSpace) {
            const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
            const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
            if (spaceFolder) {
                const result = await BookmarkUtils.findBookmarkInFolderRecursive(spaceFolder.id, { url: pinnedUrl });
                resolvedBookmarkId = result?.bookmark?.id || null;
            }
        }
    }

    if (!resolvedBookmarkId) {
        console.warn('[Arcify] Cannot replace bookmark URL: missing bookmarkId and unable to resolve.', {
            tabId: tab.id,
            pinnedUrl,
            dataset: tabElement?.dataset
        });
        return;
    }

    try {
        const updatePayload = { url: newUrl };
        // Keep bookmark title in sync with the new pinned page for clarity.
        if (newTitle) updatePayload.title = newTitle;
        await chrome.bookmarks.update(resolvedBookmarkId, updatePayload);
    } catch (e) {
        console.error('[Arcify] chrome.bookmarks.update failed', { bookmarkId: resolvedBookmarkId, newUrl, error: e });
        return;
    }

    await Utils.setPinnedTabState(tab.id, { bookmarkId: resolvedBookmarkId, pinnedUrl: newUrl });
    if (newTitle) {
        // Update override baseline (and pinned display) to the new URL/title.
        await Utils.setTabNameOverride(tab.id, newUrl, newTitle);
    }

    if (tabElement) {
        tabElement.dataset.pinnedUrl = newUrl;
        tabElement.dataset.url = newUrl;
        // Tab is now pinned to current URL; "back to pinned" should no longer be available.
        const favicon = tabElement.querySelector('.tab-favicon') || tabElement.querySelector('img');
        if (favicon) {
            favicon.classList.remove('pinned-back');
            favicon.title = '';
        }
        const slash = tabElement.querySelector('.tab-url-changed-slash');
        if (slash) slash.classList.remove('visible');

        // Ensure the displayed title + domain subtitle reflect the new pinned URL immediately.
        const titleDisplay = tabElement.querySelector('.tab-title-display');
        if (titleDisplay && newTitle) titleDisplay.textContent = newTitle;
        const domainDisplay = tabElement.querySelector('.tab-domain-display');
        if (domainDisplay) domainDisplay.style.display = 'none';
    }
}

// Function to apply color overrides from settings
async function applyColorOverrides() {
    try {
        const settings = await Utils.getSettings();
        Logger.log('Applying color overrides, settings:', settings);

        const root = document.documentElement;

        // Clear any existing overrides first
        const colorNames = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
        colorNames.forEach(colorName => {
            root.style.removeProperty(`--user-chrome-${colorName}-color`);
        });

        // Apply new overrides if they exist
        if (settings.colorOverrides && Object.keys(settings.colorOverrides).length > 0) {
            Logger.log('Found color overrides:', settings.colorOverrides);
            Object.keys(settings.colorOverrides).forEach(colorName => {
                const colorValue = settings.colorOverrides[colorName];
                if (colorValue) {
                    root.style.setProperty(`--user-chrome-${colorName}-color`, colorValue);
                    Logger.log(`Applied color override: --user-chrome-${colorName}-color = ${colorValue}`);
                }
            });
        } else {
            Logger.log('No color overrides found in settings');
        }

        // Re-apply colors to all existing spaces
        reapplySpaceColors();
    } catch (error) {
        Logger.error('Error applying color overrides:', error);
    }
}

// Function to re-apply colors to the active space
function reapplySpaceColors() {
    const sidebarContainer = document.getElementById('sidebar-container');
    if (!sidebarContainer || !activeSpaceId || spaces.length === 0) return;

    // Find the active space
    const activeSpace = spaces.find(space => space.id === activeSpaceId);
    if (!activeSpace) return;

    const root = document.documentElement;
    const colorVar = `--chrome-${activeSpace.color}-color`;
    const colorDarkVar = `--chrome-${activeSpace.color}-color-dark`;

    // Get computed values
    const computedStyle = getComputedStyle(root);
    let colorValue = computedStyle.getPropertyValue(colorVar).trim();
    let colorDarkValue = computedStyle.getPropertyValue(colorDarkVar).trim();

    // Fallback if variables aren't set yet
    if (!colorValue) {
        colorValue = `var(--chrome-${activeSpace.color}-color, rgba(255, 255, 255, 0.1))`;
    }
    if (!colorDarkValue) {
        colorDarkValue = `var(--chrome-${activeSpace.color}-color-dark, rgba(255, 255, 255, 0.1))`;
    }

    sidebarContainer.style.setProperty('--space-bg-color', colorValue);
    sidebarContainer.style.setProperty('--space-bg-color-dark', colorDarkValue);
}

// Function to update pinned favicons
async function updatePinnedFavicons() {
    const pinnedFavicons = document.getElementById('pinnedFavicons');
    const pinnedTabs = await chrome.tabs.query({ pinned: true });

    // Remove favicon elements for tabs that are no longer pinned
    Array.from(pinnedFavicons.children).forEach(element => {
        // Only remove elements that are pinned favicons (have the pinned-favicon class)
        if (element.classList.contains('pinned-favicon')) {
            const tabId = element.dataset.tabId;
            if (!pinnedTabs.some(tab => tab.id.toString() === tabId)) {
                element.remove();
            }
        }
    });

    pinnedTabs.forEach(tab => {
        // Check if favicon element already exists for this tab
        const existingElement = pinnedFavicons.querySelector(`[data-tab-id="${tab.id}"]`);
        if (!existingElement) {
            const faviconElement = document.createElement('div');
            faviconElement.className = 'pinned-favicon';
            faviconElement.title = tab.title;
            faviconElement.dataset.tabId = tab.id;
            faviconElement.draggable = true; // Make pinned favicon draggable

            const img = document.createElement('img');
            img.src = Utils.getFaviconUrl(tab.url, "96");
            img.onerror = () => {
                img.src = tab.favIconUrl;
                img.onerror = () => { img.src = 'assets/default_icon.png'; }; // Fallback favicon
            };
            img.alt = tab.title;

            faviconElement.appendChild(img);
            faviconElement.addEventListener('mousedown', (event) => {
                if (event.button === MOUSE_BUTTON.LEFT) {
                    clearAllActiveStates();
                    // Add active class to clicked tab
                    faviconElement.classList.add('active');
                    chrome.tabs.update(tab.id, { active: true });
                }
            });

            // Add drag event listeners for pinned favicon
            faviconElement.addEventListener('dragstart', () => {
                faviconElement.classList.add('dragging');
            });

            faviconElement.addEventListener('dragend', () => {
                faviconElement.classList.remove('dragging');
            });

            pinnedFavicons.appendChild(faviconElement);
        }
    });

    // Show/hide placeholder based on whether there are pinned tabs
    const placeholderContainer = pinnedFavicons.querySelector('.pinned-placeholder-container');
    if (placeholderContainer) {
        if (pinnedTabs.length === 0) {
            placeholderContainer.style.display = 'block';
        } else {
            placeholderContainer.style.display = 'none';
        }
    }

    // Add drag and drop event listeners ONCE. updatePinnedFavicons() is called from many
    // handlers; re-adding these container listeners every call leaked duplicate handlers
    // that fired repeatedly (B8). Guard on a dataset flag so they bind exactly once.
    if (!pinnedFavicons.dataset.dragListenersBound) {
        pinnedFavicons.dataset.dragListenersBound = 'true';
    pinnedFavicons.addEventListener('dragover', e => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');

        // Show drop indicator for horizontal favicons
        const draggingElement = document.querySelector('.dragging');
        if (draggingElement) {
            const afterElement = getDragAfterElementFavicon(pinnedFavicons, e.clientX);
            if (afterElement) {
                // Check if this is a placeholder (empty container)
                if (afterElement.classList.contains('pinned-placeholder-container')) {
                    // Show visual feedback on the placeholder itself
                    afterElement.classList.add('drag-over');
                    hideAllDropIndicators(); // Don't show traditional indicators for placeholders
                } else {
                    // Show traditional drop indicators for actual favicons
                    const position = getDropPosition(afterElement, e.clientX, e.clientY, true);
                    showDropIndicator(afterElement, position, true);
                    // Remove any placeholder drag-over state
                    const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
                    if (placeholder) placeholder.classList.remove('drag-over');
                }
            } else {
                hideAllDropIndicators();
                // Remove any placeholder drag-over state
                const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
                if (placeholder) placeholder.classList.remove('drag-over');
            }
        }
    });

    pinnedFavicons.addEventListener('dragleave', e => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        // Hide indicators when leaving the pinned favicons area
        if (!pinnedFavicons.contains(e.relatedTarget)) {
            hideAllDropIndicators();
            // Remove any placeholder drag-over state
            const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
            if (placeholder) placeholder.classList.remove('drag-over');
        }
    });

    pinnedFavicons.addEventListener('drop', async e => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        hideAllDropIndicators(); // Clean up indicators on drop
        // Remove any placeholder drag-over state
        const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
        if (placeholder) placeholder.classList.remove('drag-over');
        const draggingElement = document.querySelector('.dragging');
        if (draggingElement && draggingElement.dataset.tabId) {
            const tabId = parseInt(draggingElement.dataset.tabId);

            // If dragging a pinned favicon to reorder, handle positioning
            if (draggingElement.classList.contains('pinned-favicon')) {
                const afterElement = getDragAfterElementFavicon(pinnedFavicons, e.clientX);
                if (afterElement) {
                    // Check if this is a placeholder (empty container)
                    if (afterElement.classList.contains('pinned-placeholder-container')) {
                        // Empty container - append directly and hide placeholder
                        pinnedFavicons.appendChild(draggingElement);
                        afterElement.style.display = 'none';
                    } else {
                        // Normal positioning logic for actual favicons
                        const position = getDropPosition(afterElement, e.clientX, e.clientY, true);

                        // Position element based on indicator logic
                        if (position === 'left') {
                            pinnedFavicons.insertBefore(draggingElement, afterElement);
                        } else { // 'right'
                            const nextSibling = afterElement.nextElementSibling;
                            if (nextSibling) {
                                pinnedFavicons.insertBefore(draggingElement, nextSibling);
                            } else {
                                pinnedFavicons.appendChild(draggingElement);
                            }
                        }
                    }
                } else {
                    // Fallback: append to end
                    pinnedFavicons.appendChild(draggingElement);
                }
            } else {
                // Dragging a regular tab to make it pinned
                const afterElement = getDragAfterElementFavicon(pinnedFavicons, e.clientX);
                let position = null;
                let targetIndex = 0; // Default to index 0 for empty containers

                if (afterElement) {
                    if (afterElement.classList.contains('pinned-placeholder-container')) {
                        // Empty container - use index 0 and hide placeholder after pinning
                        targetIndex = 0;
                    } else {
                        // Normal positioning logic for actual favicons
                        position = getDropPosition(afterElement, e.clientX, e.clientY, true);
                        targetIndex = calculatePinnedTabIndex(afterElement, position, pinnedFavicons);
                    }
                }

                // Step 1: Pin the tab (this adds it to the end by default)
                await chrome.tabs.update(tabId, { pinned: true });

                // Step 2: Move it to the correct position if needed
                if (targetIndex !== undefined && targetIndex >= 0) {
                    try {
                        await chrome.tabs.move(tabId, { index: targetIndex });
                    } catch (error) {
                        Logger.warn('Error moving pinned tab to target index:', error);
                    }
                }

                // Step 3: Update the favicon display
                updatePinnedFavicons();

                // Hide placeholder if this was an empty container
                if (afterElement && afterElement.classList.contains('pinned-placeholder-container')) {
                    afterElement.style.display = 'none';
                }

                // Remove the tab from its original container
                draggingElement.remove();
            }
        }
    });
    } // end bind-once guard for pinnedFavicons drag listeners
}

// Utility function to activate a pinned tab by URL (reuses existing bookmark opening logic)
async function activatePinnedTabByURL(bookmarkUrl, targetSpaceId, spaceName) {
    Logger.log('[PinnedTabActivator] Activating pinned tab:', bookmarkUrl, targetSpaceId, spaceName);

    try {
        // Try to find existing tab with this URL
        const tabs = await getOwnedTabs(targetSpaceId);
        const existingTab = BookmarkUtils.findTabByUrl(tabs, bookmarkUrl);

        if (existingTab) {
            Logger.log('[PinnedTabActivator] Found existing tab, switching to it:', existingTab.id);
            // Tab already exists, just switch to it and highlight
            await Utils.focusTab(existingTab.id);
            activateTabInDOM(existingTab.id);

            // Store last active tab for the space
            const space = ownerOf(spaces, existingTab.id);
            if (space) {
                space.lastTab = existingTab.id;
                saveSpaces();
            }
        } else {
            Logger.log('[PinnedTabActivator] No existing tab found, opening bookmark');
            // Find existing bookmark-only element to replace
            const existingBookmarkElement = document.querySelector(`[data-url="${bookmarkUrl}"].bookmark-only`);

            // Find the bookmark to get the correct title
            const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
            const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            const spaceFolder = spaceFolders.find(f => f.title === spaceName);

            let bookmarkTitle = null;
            if (spaceFolder) {
                const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
                const matchingBookmark = BookmarkUtils.findBookmarkByUrl(bookmarks, bookmarkUrl);
                if (matchingBookmark) {
                    bookmarkTitle = matchingBookmark.title;
                }
            }

            // Prepare bookmark data for opening
            const bookmarkData = {
                url: bookmarkUrl,
                title: bookmarkTitle || 'Bookmark',
                spaceName: spaceName,
                pinnedUrl: bookmarkUrl,
                bookmarkId: existingBookmarkElement?.dataset?.bookmarkId || null
            };

            // Prepare context for BookmarkUtils
            const context = {
                spaces,
                activeSpaceId,
                currentWindow,
                saveSpaces,
                createTabElement,
                activateTabInDOM,
                Utils,
                persistSpaceTabOrder
            };

            // Use shared bookmark opening logic
            isOpeningBookmark = true;
            try {
                await BookmarkUtils.openBookmarkAsTab(bookmarkData, targetSpaceId, existingBookmarkElement, context, /*isPinned=*/true);
            } finally {
                isOpeningBookmark = false;
            }
        }
    } catch (error) {
        Logger.error("[PinnedTabActivator] Error activating pinned tab:", error);
        isOpeningBookmark = false;
    }
}

// Initialize the sidebar when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    Logger.log('DOM loaded, initializing sidebar...');
    await applyColorOverrides();

    // Listen for storage changes to re-apply colors when they're updated
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.colorOverrides) {
            Logger.log('Color overrides changed, re-applying...');
            applyColorOverrides();
        }

        // Re-render active space when tab order inversion setting changes
        if (areaName === 'sync' && changes.invertTabOrder) {
            Logger.log('invertTabOrder changed, refreshing active space UI...');
            if (refreshActiveSpaceUITimeout) clearTimeout(refreshActiveSpaceUITimeout);
            refreshActiveSpaceUITimeout = setTimeout(() => {
                refreshActiveSpaceUITimeout = null;
                refreshActiveSpaceUI();
            }, 50);
        }

        if (areaName === 'sync' && changes.showAllOpenTabsInCollapsedFolders) {
            showAllOpenTabsInCollapsedFolders = Boolean(changes.showAllOpenTabsInCollapsedFolders.newValue);
            syncCollapsedFoldersInActiveSpace();
        }
    });

    await initSidebar();
    await updatePinnedFavicons(); // Initial load before taking the tour baseline
    initSidebarTour().catch(error => Logger.error("Tour initialization failed:", error));

    // Add Chrome tab event listeners
    chrome.tabs.onCreated.addListener(handleTabCreated);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        handleTabUpdate(tabId, changeInfo, tab);
        if (tab.pinned) updatePinnedFavicons(); // Update favicons when a tab is pinned/unpinned
    });
    chrome.tabs.onRemoved.addListener(handleTabRemove);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    // Setup Quick Pin listener
    setupQuickPinListener(moveTabToSpace, moveTabToPinned, moveTabToTemp, activeSpaceId, setActiveSpace, activatePinnedTabByURL);

    // Tab navigation listener
    // Add event listener for placeholder close button
    const closePlaceholderBtn = document.querySelector('.placeholder-close-btn');
    const placeholderContainer = document.querySelector('.pinned-placeholder-container');
    if (closePlaceholderBtn && placeholderContainer) {
        closePlaceholderBtn.addEventListener('click', () => {
            placeholderContainer.style.display = 'none';
        });
    }

    // --- Space Switching with Trackpad Swipe ---
    let isSwiping = false;
    let swipeTimeout = null;
    const swipeThreshold = 25; // Min horizontal movement to trigger a swipe

    document.getElementById('sidebar-container').addEventListener('wheel', async (event) => {
        // Defense-in-depth: ignore wheel events that originate inside the
        // chip strip. The strip lives inside #sidebar-container, so without
        // this guard a horizontal swipe meant to scroll the chips would also
        // switch the active space — that exact conflict is why chip
        // scrolling felt slow and randomly reversed direction. The chip
        // strip's own wheel handler (domManager.setupDOMElements) already
        // stopPropagation()s its events so we shouldn't reach this branch
        // for those gestures, but we filter here too in case any future
        // code path bypasses that.
        if (event.target.closest('#spaceSwitcher')) {
            return;
        }

        // Ignore vertical scrolling or if a swipe is already being processed
        if (Math.abs(event.deltaX) < Math.abs(event.deltaY) || isSwiping) {
            return;
        }

        if (Math.abs(event.deltaX) > swipeThreshold) {
            isSwiping = true;
            event.preventDefault(); // Stop browser from navigating back/forward

            const currentIndex = spaces.findIndex(s => s.id === activeSpaceId);
            if (currentIndex === -1) {
                isSwiping = false;
                return;
            }

            let nextIndex;
            // deltaX > 0 means swiping right (finger moves right, content moves left) -> previous space
            if (event.deltaX < 0) {
                nextIndex = (currentIndex - 1 + spaces.length) % spaces.length;
            } else {
                // deltaX < 0 means swiping left (finger moves left, content moves right) -> next space
                nextIndex = (currentIndex + 1) % spaces.length;
            }

            const nextSpace = spaces[nextIndex];
            if (nextSpace) {
                await setActiveSpace(nextSpace.id);
            }

            // Cooldown to prevent re-triggering during the same gesture
            clearTimeout(swipeTimeout);
            swipeTimeout = setTimeout(() => {
                isSwiping = false;
            }, 400); // 400ms cooldown
        }
    }, { passive: false }); // 'passive: false' is required to use preventDefault()
});

let savedSpaces = [];
let pendingSpaceSaves = Promise.resolve();
let pendingSaveCount = 0;
let sidebarReady = false;

async function adoptStoredSpaces(next) {
    const old = spaces;
    const oldMetadata = new Map(old.map(s => [s.id, { name: s.name, color: s.color }]));
    spaces = next.map(space => {
        const existing = old.find(s => s.id === space.id);
        return existing ? Object.assign(existing, structuredClone(space)) : structuredClone(space);
    });
    savedSpaces = structuredClone(next);
    for (const space of old) {
        if (!spaces.some(s => s.id === space.id)) getSpaceElement(space.id)?.remove();
    }
    for (const space of spaces) {
        // Remove old projections immediately when another panel moves or closes a tab.
        // Newly added rows are rendered when the destination space is shown.
        const owned = new Set([...space.spaceBookmarks, ...space.temporaryTabs]);
        getSpaceElement(space.id)?.querySelectorAll('.tab[data-tab-id]').forEach(element => {
            if (!owned.has(Number(element.dataset.tabId))) element.remove();
        });
        const previous = oldMetadata.get(space.id);
        if (!previous || previous.name !== space.name || previous.color !== space.color) {
            getSpaceElement(space.id)?.remove();
            createSpaceElement(space);
        }
    }
    if (!spaces.some(s => s.id === activeSpaceId)) activeSpaceId = spaces[0]?.id;
    await activateSpaceInDOM(activeSpaceId, spaces, updateSpaceSwitcher);
    await refreshActiveSpaceUI();
}

async function initSidebar() {
    const settings = await Utils.getSettings();
    defaultSpaceName = settings.defaultSpaceName || 'Home';
    showAllOpenTabsInCollapsedFolders = Boolean(settings.showAllOpenTabsInCollapsedFolders);
    currentWindow = await chrome.windows.getCurrent({ populate: false });
    spaces = await spaceRequest('get');
    savedSpaces = structuredClone(spaces);
    const allTabs = await chrome.tabs.query({});
    await Utils.prunePinnedTabStates(allTabs.map(t => t.id));
    // Restore bookmark bindings using only this space's owned tabs.
    for (const space of spaces) {
        const folder = await getSpaceBookmarkFolder(space);
        const bound = await BookmarkUtils.matchTabsWithBookmarks(folder, space.id,
            Utils.setTabNameOverride.bind(Utils), Utils.setPinnedTabState.bind(Utils), null, Utils.getPinnedUrlKey.bind(Utils));
        const previousPins = space.spaceBookmarks;
        space.spaceBookmarks = [...new Set(bound)];
        space.temporaryTabs = [...new Set([...space.temporaryTabs, ...previousPins])].filter(id => !space.spaceBookmarks.includes(id));
        for (const id of previousPins) if (!space.spaceBookmarks.includes(id)) await Utils.removePinnedTabState(id);
        createSpaceElement(space);
    }
    await saveSpaces();
    const activeTab = allTabs.find(t => t.active && t.windowId === currentWindow.id);
    activeChromeTabId = activeTab?.id;
    const { activeSpaces = {} } = await chrome.storage.session.get('activeSpaces');
    await setActiveSpace(activeSpaces[currentWindow.id] || ownerOf(spaces, activeTab?.id)?.id || spaces[0]?.id, false);
    previousSpaceId = activeSpaceId;
    setupDOMElements(createNewSpace, () => spaces);
    sidebarReady = true;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.spaces || !sidebarReady) return;
        clearTimeout(storedSpacesRefresh);
        storedSpacesRefresh = setTimeout(async () => {
            await pendingSpaceSaves;
            if (isDraggingTab || pendingSaveCount) return;
            const next = await spaceRequest('get');
            if (JSON.stringify(next) !== JSON.stringify(spaces)) await adoptStoredSpaces(next);
        }, 100);
    });
    await offerTabGroupImport();
}
let storedSpacesRefresh;

async function offerTabGroupImport() {
    const { tabGroupImportDismissed } = await chrome.storage.local.get('tabGroupImportDismissed');
    if (tabGroupImportDismissed) return;
    const groups = await chrome.tabGroups.query({ windowId: currentWindow.id });
    if (!groups.length) return;
    const notice = document.createElement('div');
    notice.className = 'tab-group-import';
    const text = document.createElement('p');
    text.textContent = 'Create spaces from your existing Chrome tab groups? Your groups will stay unchanged.';
    const accept = document.createElement('button');
    accept.textContent = 'Create spaces';
    const dismiss = document.createElement('button');
    dismiss.textContent = 'No thanks';
    accept.onclick = async () => {
        accept.disabled = true;
        try {
            await pendingSpaceSaves;
            await adoptStoredSpaces(await spaceRequest('import', { windowId: currentWindow.id }));
            notice.remove();
        } catch (error) { accept.disabled = false; Logger.error('Import failed', error); }
    };
    dismiss.onclick = async () => {
        await chrome.storage.local.set({ tabGroupImportDismissed: true });
        notice.remove();
    };
    notice.append(text, accept, dismiss);
    document.getElementById('sidebar-container').prepend(notice);
}

async function getOwnedTabs(spaceId) {
    const space = spaces.find(s => s.id === spaceId);
    const tabs = new Map((await chrome.tabs.query({})).map(t => [t.id, t]));
    return [...(space?.spaceBookmarks || []), ...(space?.temporaryTabs || [])].map(id => tabs.get(id)).filter(tab => tab && !tab.pinned);
}

function createSpaceElement(space) {
    Logger.log('Creating space element for:', space.id);
    const spaceElement = spaceTemplate.content.cloneNode(true);
    const sidebarContainer = document.getElementById('sidebar-container');
    const spaceContainer = spaceElement.querySelector('.space');
    spaceContainer.dataset.spaceId = space.id;
    spaceContainer.style.display = space.id === activeSpaceId ? 'flex' : 'none';
    spaceContainer.dataset.spaceUuid = space.id;

    // Set space background color from extension settings
    // Get the computed value from :root to ensure overrides are applied
    const root = document.documentElement;
    const colorVar = `--chrome-${space.color}-color`;
    const colorDarkVar = `--chrome-${space.color}-color-dark`;

    // Get computed values - this will resolve the CSS variable chain
    const computedStyle = getComputedStyle(root);
    let colorValue = computedStyle.getPropertyValue(colorVar).trim();
    let colorDarkValue = computedStyle.getPropertyValue(colorDarkVar).trim();

    // Fallback if variables aren't set yet
    if (!colorValue) {
        colorValue = `var(--chrome-${space.color}-color, rgba(255, 255, 255, 0.1))`;
    }
    if (!colorDarkValue) {
        colorDarkValue = `var(--chrome-${space.color}-color-dark, rgba(255, 255, 255, 0.1))`;
    }

    sidebarContainer.style.setProperty('--space-bg-color', colorValue);
    sidebarContainer.style.setProperty('--space-bg-color-dark', colorDarkValue);

    // Set up color select
    const colorSelect = spaceElement.getElementById('spaceColorSelect');
    colorSelect.value = space.color;
    colorSelect.addEventListener('change', async () => {
        const newColor = colorSelect.value;
        space.color = newColor;



        // Update space background color
        sidebarContainer.style.setProperty('--space-bg-color', `var(--chrome-${newColor}-color, rgba(255, 255, 255, 0.1))`);
        sidebarContainer.style.setProperty('--space-bg-color-dark', `var(--chrome-${space.color}-color-dark, rgba(255, 255, 255, 0.1))`);

        saveSpaces();
        await updateSpaceSwitcher();
    });

    // Handle color swatch clicks
    const spaceOptionColorSwatch = spaceElement.getElementById('spaceOptionColorSwatch');
    spaceOptionColorSwatch.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-swatch')) {
            const colorPicker = e.target.closest('.color-picker-grid');
            const color = e.target.dataset.color;

            // Update selected swatch
            colorPicker.querySelectorAll('.color-swatch').forEach(swatch => {
                swatch.classList.remove('selected');
            });
            e.target.classList.add('selected');

            // Update hidden select value
            colorSelect.value = color;

            // Trigger change event on select
            const event = new Event('change');
            colorSelect.dispatchEvent(event);
        }
    });

    // Set up space name input
    const nameInput = spaceElement.querySelector('.space-name');
    nameInput.value = space.name;
    nameInput.addEventListener('change', async () => {
        // Update bookmark folder name
        const oldName = space.name;
        const oldFolder = await LocalStorage.getOrCreateSpaceFolder(oldName);
        await chrome.bookmarks.update(oldFolder.id, { title: nameInput.value });

        space.name = nameInput.value;
        saveSpaces();
        await updateSpaceSwitcher();
    });

    // Set up chevron toggle for pinned section
    const chevronButton = spaceElement.querySelector('.space-toggle-chevron');
    const pinnedSection = spaceElement.querySelector('.pinned-tabs');

    // Initialize state from localStorage or default to expanded
    const isPinnedCollapsed = localStorage.getItem(`space-${space.id}-pinned-collapsed`) === 'true';
    if (isPinnedCollapsed) {
        chevronButton.classList.add('collapsed');
        pinnedSection.classList.add('collapsed');
    }

    // Initialize chevron state
    updateChevronState(spaceElement, pinnedSection);



    chevronButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent space name editing
        const isCollapsed = chevronButton.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand
            chevronButton.classList.remove('collapsed');
            pinnedSection.classList.remove('collapsed');
            localStorage.setItem(`space-${space.id}-pinned-collapsed`, 'false');
        } else {
            // Collapse
            chevronButton.classList.add('collapsed');
            pinnedSection.classList.add('collapsed');
            localStorage.setItem(`space-${space.id}-pinned-collapsed`, 'true');
        }

        // Update chevron state
        updateChevronState(spaceElement, pinnedSection);
    });

    // Set up containers
    const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
    const tempContainer = spaceElement.querySelector('[data-tab-type="temporary"]');
    const placeholderContainer = spaceElement.querySelector('.placeholder-container');

    // Set up drag and drop
    setupDragAndDrop(pinnedContainer, tempContainer);

    // Set up drag and drop for placeholder container to make entire placeholder area droppable
    if (placeholderContainer) {
        setupPlaceholderDragAndDrop(placeholderContainer, pinnedContainer);
    }

    // Set up clean tabs button
    const cleanBtn = spaceElement.querySelector('.clean-tabs-btn');
    cleanBtn.addEventListener('click', () => cleanTemporaryTabs(space.id));

    // Set up options menu
    const newFolderBtn = spaceElement.querySelector('.new-folder-btn');
    const deleteSpaceBtn = spaceElement.querySelector('.delete-space-btn');
    const settingsBtn = spaceElement.querySelector('.settings-btn');

    newFolderBtn.addEventListener('click', () => {
        createNewFolder(spaceContainer);
    });

    deleteSpaceBtn.addEventListener('click', () => {
        if (confirm('Delete this space and close all its tabs?')) {
            deleteSpace(space.id);
        }
    });

    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Load tabs
    loadTabs(space, pinnedContainer, tempContainer).then(() => {
        // Update placeholders after loading tabs (ensure this happens after all async operations)
        updatePinnedSectionPlaceholders();
    });

    const popup = spaceElement.querySelector('.archived-tabs-popup');
    const archiveButton = spaceElement.querySelector('.sidebar-button');
    const spaceContent = spaceElement.querySelector('.space-content');

    archiveButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent closing immediately if clicking outside logic exists
        spaceContent.classList.toggle('hidden');
        const isVisible = popup.style.opacity == 1;
        if (isVisible) {
            popup.classList.toggle('visible');
        } else {
            showArchivedTabsPopup(space.id); // Populate and show
            popup.classList.toggle('visible');
        }
    });

    // Add to DOM
    spacesList.appendChild(spaceElement);

    // Set up settings button to open extension options
    const settingsButton = spaceElement.querySelector('#space-settings');
    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            }
        });
    }
}

async function updateSpaceSwitcher() {
    Logger.log('Updating space switcher...');
    spaceSwitcher.innerHTML = '';

    // --- Drag and Drop State ---
    let draggedButton = null;

    // --- Add listeners to the container ---
    spaceSwitcher.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        const currentlyDragged = document.querySelector('.dragging-switcher');
        if (!currentlyDragged) return; // Don't do anything if not dragging a switcher button

        const afterElement = getDragAfterElementSwitcher(spaceSwitcher, e.clientX);

        // Remove placeholder classes from all buttons first
        const buttons = spaceSwitcher.querySelectorAll('button');
        buttons.forEach(button => {
            button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
        });

        // Add placeholder class to the appropriate element
        if (afterElement) {
            // Add margin *before* the element we'd insert before
            afterElement.classList.add('drag-over-placeholder-before');
        } else {
            // If afterElement is null, we are dropping at the end.
            // Add margin *after* the last non-dragging element.
            const lastElement = spaceSwitcher.querySelector('button:not(.dragging-switcher):last-of-type');
            if (lastElement) {
                lastElement.classList.add('drag-over-placeholder-after');
            }
        }

        // --- Remove this block ---
        // We no longer move the element during dragover, rely on CSS placeholders
        /*
        if (currentlyDragged) {
            if (afterElement == null) {
                spaceSwitcher.appendChild(currentlyDragged);
            } else {
                spaceSwitcher.insertBefore(currentlyDragged, afterElement);
            }
        }
        */
        // --- End of removed block ---
    });

    spaceSwitcher.addEventListener('dragleave', (e) => {
        // Simple cleanup: remove placeholders if the mouse leaves the container area
        // More robust check might involve relatedTarget, but this is often sufficient
        if (e.target === spaceSwitcher) {
            const buttons = spaceSwitcher.querySelectorAll('button');
            buttons.forEach(button => {
                button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
            });
        }
    });

    spaceSwitcher.addEventListener('drop', async (e) => {
        e.preventDefault();

        // Ensure placeholders are removed after drop
        const buttons = spaceSwitcher.querySelectorAll('button');
        buttons.forEach(button => {
            button.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
        });

        if (draggedButton) {
            const targetElement = e.target.closest('button'); // Find the button dropped onto or near
            const draggedSpaceId = draggedButton.dataset.spaceId;
            let targetSpaceId = targetElement ? targetElement.dataset.spaceId : null;

            // Find original index
            const originalIndex = spaces.findIndex(s => s.id === draggedSpaceId);
            if (originalIndex === -1) return; // Should not happen

            const draggedSpace = spaces[originalIndex];

            // Remove from original position
            spaces.splice(originalIndex, 1);

            // Find new index
            let newIndex;
            if (targetSpaceId) {
                const targetIndex = spaces.findIndex(s => s.id === targetSpaceId);
                // Determine if dropping before or after the target based on drop position relative to target center
                const targetRect = targetElement.getBoundingClientRect();
                const dropX = e.clientX; // *** Use clientX ***
                if (dropX < targetRect.left + targetRect.width / 2) { // *** Use left and width ***
                    newIndex = targetIndex; // Insert before target
                } else {
                    newIndex = targetIndex + 1; // Insert after target
                }

            } else {
                // If dropped not on a specific button (e.g., empty area), append to end
                newIndex = spaces.length;
            }

            // Insert at new position
            // Ensure newIndex is within bounds (can happen if calculation is slightly off at edges)
            // newIndex = Math.max(0, Math.min(newIndex, spaces.length));
            Logger.log("droppedat", newIndex);

            if (newIndex < 0) {
                newIndex = 0;
            } else if (newIndex > spaces.length) {
                newIndex = spaces.length;
            }
            Logger.log("set", newIndex);

            spaces.splice(newIndex, 0, draggedSpace);

            // Save and re-render
            saveSpaces();
            await updateSpaceSwitcher(); // Re-render to reflect new order and clean up listeners
        }
        draggedButton = null; // Reset dragged item
    });


    spaces.forEach(space => {
        const button = document.createElement('button');
        button.textContent = space.name;
        button.dataset.spaceId = space.id; // Store space ID
        button.classList.toggle('active', space.id === activeSpaceId);
        button.draggable = true; // Make the button draggable

        button.addEventListener('click', async () => {
            if (button.classList.contains('dragging-switcher')) return;

            Logger.log("clicked for active", space);
            await setActiveSpace(space.id);
        });

        // --- Drag Event Listeners for Buttons ---
        button.addEventListener('dragstart', (e) => {
            draggedButton = button; // Store the button being dragged
            // Use a specific class to avoid conflicts with tab dragging
            setTimeout(() => button.classList.add('dragging-switcher'), 0);
            e.dataTransfer.effectAllowed = 'move';
            // Optional: Set drag data if needed elsewhere, though not strictly necessary for reordering within the same list
            // e.dataTransfer.setData('text/plain', space.id);
        });

        button.addEventListener('dragend', () => {
            // Clean up placeholders and dragging class on drag end (cancel/drop outside)
            const buttons = spaceSwitcher.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.classList.remove('drag-over-placeholder-before', 'drag-over-placeholder-after');
            });
            if (draggedButton) { // Check if draggedButton is still set
                draggedButton.classList.remove('dragging-switcher');
            }
            draggedButton = null; // Ensure reset here too
        });

        spaceSwitcher.appendChild(button);
    });

    // Inactive space from bookmarks
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    spaceFolders.forEach(spaceFolder => {
        if (spaces.find(space => space.name == spaceFolder.title)) {
            return;
        } else {
            const button = document.createElement('button');
            button.textContent = spaceFolder.title;
            button.addEventListener('click', async () => {
                const newTab = await ChromeHelper.createNewTab();
                await createSpaceFromInactive(spaceFolder.title, newTab);
            });
            spaceSwitcher.appendChild(button);
        }
    });

    // const spaceFolder = spaceFolders.find(f => f.title === space.name);

}

// Wrapper functions that use the unified getDragAfterElement from domManager.js
function getDragAfterElementSwitcher(container, x) {
    return getDragAfterElement(container, x, {
        axis: 'x',
        selector: 'button:not(.dragging-switcher)'
    });
}

function getDragAfterElementTabs(container, y) {
    return getDragAfterElement(container, y, {
        axis: 'y',
        selector: ':scope > .tab:not(.dragging), :scope > .folder:not(.dragging)',
        placeholderSelector: ':scope > .tab-placeholder'
    });
}

function getDragAfterElementFavicon(container, x) {
    return getDragAfterElement(container, x, {
        axis: 'x',
        selector: '.pinned-favicon:not(.dragging)',
        placeholderSelector: '.pinned-placeholder-container'
    });
}

function calculatePinnedTabIndex(afterElement, position, pinnedFavicons) {
    if (!afterElement) {
        // If no target element, append to the end
        return pinnedFavicons.querySelectorAll('.pinned-favicon').length;
    }

    const pinnedElements = Array.from(pinnedFavicons.querySelectorAll('.pinned-favicon'));
    const afterIndex = pinnedElements.indexOf(afterElement);

    if (afterIndex === -1) {
        // Fallback: append to end if element not found
        return pinnedElements.length;
    }

    if (position === 'left') {
        return afterIndex; // Insert before the target element
    } else { // position === 'right'
        return afterIndex + 1; // Insert after the target element  
    }
}

// Helper function to set up drag event listeners for tab elements
function setupTabDragHandlers(tabElement) {
    tabElement.addEventListener('dragstart', event => {
        event.dataTransfer.setData('text/plain', tabElement.dataset.tabId || tabElement.dataset.url || '');
        event.dataTransfer.effectAllowed = 'move';
        tabElement.classList.add('dragging');
        // Track the source folder (if any) so we can resync collapsed-folder projections after drop.
        dragSourceFolderElement = tabElement.closest('.folder');
    });

    tabElement.addEventListener('dragend', () => {
        tabElement.classList.remove('dragging');
        dragSourceFolderElement = null;
    });
}

// Variables for folder auto-open functionality
let folderOpenTimer = null;
let currentHoveredFolder = null;
let dragSourceFolderElement = null;

function setFolderCollapsed(folderElement, collapsed, persist = true) {
    folderElement.classList.toggle('collapsed', collapsed);
    folderElement.querySelector(':scope > .folder-content').classList.toggle('collapsed', collapsed);
    folderElement.querySelector('.folder-toggle').classList.toggle('collapsed', collapsed);
    syncCollapsedFolderTabs(folderElement);
    if (persist) {
        saveFolderCollapsed(folderElement.dataset.bookmarkId, collapsed)
            .catch(error => Logger.error('Could not save folder state', error));
    }
}

// Drag auto-open and child creation use the same durable state as manual toggles.
function openFolder(folderElement) {
    if (folderElement.classList.contains('collapsed')) setFolderCollapsed(folderElement, false);
}

// Helper function to start auto-open timer for a folder
function startFolderOpenTimer(folderElement) {
    clearFolderOpenTimer(); // Clear any existing timer

    currentHoveredFolder = folderElement;
    folderOpenTimer = setTimeout(() => {
        if (currentHoveredFolder === folderElement && folderElement.classList.contains('collapsed')) {
            openFolder(folderElement);
        }
        folderOpenTimer = null;
        currentHoveredFolder = null;
    }, 250); // 750ms delay like macOS Finder
}

// Helper function to clear the folder auto-open timer
function clearFolderOpenTimer() {
    if (folderOpenTimer) {
        clearTimeout(folderOpenTimer);
        folderOpenTimer = null;
    }
    currentHoveredFolder = null;
}

async function setActiveSpace(spaceId, updateTab = true) {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    if (activeSpaceId && activeSpaceId !== spaceId) previousSpaceId = activeSpaceId;
    activeSpaceId = spaceId;
    await pendingSpaceSaves;
    await spaceRequest('activate', { windowId: currentWindow.id, spaceId });
    await activateSpaceInDOM(spaceId, spaces, updateSpaceSwitcher);
    await refreshActiveSpaceUI();
    if (updateTab) {
        const tabs = (await getOwnedTabs(spaceId)).filter(t => t.windowId === currentWindow.id);
        const tab = tabs.find(t => t.id === space.lastTab) || tabs[tabs.length - 1];
        if (tab) {
            await chrome.tabs.update(tab.id, { active: true });
            activateTabInDOM(tab.id);
        }
    }
}

async function createSpaceFromInactive(spaceName, tabToMove) {
    Logger.log(`Creating inactive space "${spaceName}" with tab:`, tabToMove);
    isCreatingSpace = true;
    try {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title === spaceName);

        if (!spaceFolder) {
            Logger.error(`Bookmark folder for inactive space "${spaceName}" not found.`);
            return;
        }

        const spaceColor = await Utils.getSpaceColor(spaceName);

        const spaceBookmarks = [];
        const registryEntry = await LocalStorage.getOrCreateSpaceRegistryEntry(spaceFolder.id, {
            name: spaceName,
            color: spaceColor,
        });

        const space = {
            id: registryEntry.spaceUuid,
            spaceUuid: registryEntry?.spaceUuid ?? Utils.generateUUID(),
            bookmarkFolderId: spaceFolder.id,
            uuid: registryEntry?.spaceUuid ?? Utils.generateUUID(),
            name: spaceName,
            color: spaceColor,
            spaceBookmarks: spaceBookmarks,
            temporaryTabs: [tabToMove.id],
            lastTab: tabToMove.id,
        };

        // Remove the moved tab from its old space
        const oldSpace = spaces.find(s =>
            s.temporaryTabs.includes(tabToMove.id) || s.spaceBookmarks.includes(tabToMove.id)
        );
        if (oldSpace) {
            oldSpace.temporaryTabs = oldSpace.temporaryTabs.filter(id => id !== tabToMove.id);
            oldSpace.spaceBookmarks = oldSpace.spaceBookmarks.filter(id => id !== tabToMove.id);
        }

        // Remove the tab's DOM element from the old space's UI
        const tabElementToRemove = document.querySelector(`[data-tab-id="${tabToMove.id}"]`);
        if (tabElementToRemove) {
            tabElementToRemove.remove();
        }

        spaces.push(space);
        saveSpaces();
        createSpaceElement(space);
        await setActiveSpace(space.id);
        updateSpaceSwitcher();
    } catch (error) {
        Logger.error(`Error creating space from inactive bookmark:`, error);
    } finally {
        isCreatingSpace = false;
    }
}

function saveSpaces() {
    const before = structuredClone(savedSpaces);
    const after = structuredClone(spaces);
    savedSpaces = structuredClone(after);
    pendingSaveCount++;
    const run = pendingSpaceSaves.then(() => spaceRequest('patch', { before, after }));
    pendingSpaceSaves = run.catch(error => Logger.error('Saving spaces failed', error)).finally(() => pendingSaveCount--);
    return run;
}

async function moveTabToPinned(space, tab) {
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tab.id);
    if (!space.spaceBookmarks.includes(tab.id)) {
        space.spaceBookmarks.push(tab.id);
    }
    const spaceFolder = await getSpaceBookmarkFolder(space);
    const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
    const existingBookmark = BookmarkUtils.findBookmarkByUrl(bookmarks, tab.url);
    let bookmarkIdToStore = existingBookmark?.id || null;
    if (!existingBookmark) {
        // delete existing bookmark
        await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url);

        const created = await chrome.bookmarks.create({
            parentId: spaceFolder.id,
            title: tab.title,
            url: tab.url
        });
        bookmarkIdToStore = created?.id || null;
    }

    // Track the original pinned URL for Arc-like "Back to Pinned URL" behavior.
    await Utils.setPinnedTabState(tab.id, { pinnedUrl: tab.url, bookmarkId: bookmarkIdToStore });

    // Update chevron state after moving tab to pinned
    const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
    if (spaceElement) {
        const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
        updateChevronState(spaceElement, pinnedContainer);
    }

    // Update placeholders after moving tab to pinned
    updatePinnedSectionPlaceholders();

    // Persist extension ordering after membership changes.
    await persistSpaceTabOrder(space.id, { source: 'arcify', movedTabId: tab.id });
}

async function moveTabToTemp(space, tab) {
    await removeSpacePin(space, tab);

    // Move tab from bookmarks to temporary tabs in space data
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tab.id);
    if (!space.temporaryTabs.includes(tab.id)) {
        space.temporaryTabs.push(tab.id);
    }

    // No longer a space-pinned tab; clear pinned state mapping.
    await Utils.removePinnedTabState(tab.id);

    saveSpaces();

    // Update chevron state after moving tab from pinned
    const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
    if (spaceElement) {
        const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
        updateChevronState(spaceElement, pinnedContainer);
    }

    // Persist extension ordering after membership changes.
    await persistSpaceTabOrder(space.id, { source: 'arcify', movedTabId: tab.id });
}

// Helper function to manage folder placeholder state
function updateFolderPlaceholder(folderElement) {
    if (!folderElement) return;

    const folderContent = folderElement.querySelector('.folder-content');
    const placeholder = folderElement.querySelector('.tab-placeholder');

    if (!folderContent || !placeholder) return;

    // Count actual tab elements (not placeholders)
    const tabElements = folderContent.querySelectorAll(':scope > .tab:not(.tab-placeholder), :scope > .folder');
    const isEmpty = tabElements.length === 0;

    if (isEmpty) {
        placeholder.classList.remove('hidden');
        Logger.log('Showing placeholder for empty folder');
    } else {
        placeholder.classList.add('hidden');
        Logger.log('Hiding placeholder for populated folder');
    }
}

function updateFolderIcon(folderElement) {
    if (!folderElement) return;
    const folderIcon = folderElement.querySelector('.folder-icon');
    if (!folderIcon) return;
    const isCollapsed = folderElement.classList.contains('collapsed');
    const hasOpenTabs = folderElement.classList.contains('has-open-tabs');
    folderIcon.innerHTML = isCollapsed
        ? (hasOpenTabs ? FOLDER_CLOSED_DOTS_ICON : FOLDER_CLOSED_ICON)
        : FOLDER_OPEN_ICON;
}

// Arc-like: when a folder is collapsed, show open bookmark tabs (active Chrome tabs) for that folder.
// Implementation detail: we MOVE the existing open tab elements between containers (no duplicates),
// so tab updates/active highlighting continue to work consistently.
function syncCollapsedFolderTabs(folderElement) {
    if (!folderElement) return;
    const collapsedContainer = folderElement.querySelector('.folder-collapsed-tabs');
    const folderContent = folderElement.querySelector('.folder-content');
    if (!collapsedContainer || !folderContent) return;

    const isCollapsed = folderElement.classList.contains('collapsed');

    if (isCollapsed) {
        // If any bookmark-only tabs ended up in the collapsed container (e.g., tab got closed while collapsed),
        // move them back into the real folder content so the collapsed view only shows open tabs.
        Array.from(collapsedContainer.querySelectorAll('.tab.bookmark-only')).forEach(el => {
            folderContent.appendChild(el);
        });

        // Always clear any previously projected open tabs back into folder content first.
        Array.from(collapsedContainer.querySelectorAll('.tab:not(.bookmark-only)')).forEach(el => {
            folderContent.appendChild(el);
        });

        if (showAllOpenTabsInCollapsedFolders) {
            // Arcify mode: show all open (non-bookmark-only) tabs even when folder is collapsed.
            const openTabs = Array.from(folderContent.querySelectorAll(':scope > .tab'))
                .filter(t => !t.classList.contains('bookmark-only') && t.dataset.tabId);
            openTabs.forEach(t => collapsedContainer.appendChild(t));
        } else {
            // Arc mode: show tabs that are active OR were previously active while folder was collapsed.
            // This list resets when user manually opens/closes the folder.
            let shownTabIds = collapsedFolderShownTabs.get(folderElement);
            
            // Also seed the currently active tab if it's in this folder (handles initialization case).
            if (activeChromeTabId) {
                const activeTabEl = folderContent.querySelector(`:scope > .tab[data-tab-id="${activeChromeTabId}"]:not(.bookmark-only)`);
                if (activeTabEl) {
                    if (!shownTabIds) {
                        shownTabIds = new Set();
                        collapsedFolderShownTabs.set(folderElement, shownTabIds);
                    }
                    shownTabIds.add(activeChromeTabId);
                }
            }
            
            if (shownTabIds && shownTabIds.size > 0) {
                shownTabIds.forEach(tabId => {
                    const tabEl = folderContent.querySelector(`:scope > .tab[data-tab-id="${tabId}"]:not(.bookmark-only)`);
                    if (tabEl) {
                        collapsedContainer.appendChild(tabEl);
                    }
                });
            }
        }
    } else {
        // Expanded: move everything back into the folder content.
        Array.from(collapsedContainer.querySelectorAll(':scope > .tab')).forEach(t => folderContent.appendChild(t));
    }

    // Arc-like: indicate collapsed folder contains an open tab (in Arc mode this only happens for active tab).
    const hasOpenTabs = isCollapsed && Boolean(collapsedContainer.querySelector('.tab:not(.bookmark-only)'));
    folderElement.classList.toggle('has-open-tabs', hasOpenTabs);
    updateFolderIcon(folderElement);

    // Recompute placeholder visibility now that DOM contents may have changed.
    updateFolderPlaceholder(folderElement);
}

function syncCollapsedFoldersInActiveSpace() {
    const spaceElement = document.querySelector(`[data-space-id="${activeSpaceId}"]`);
    if (!spaceElement) return;
    spaceElement.querySelectorAll('.folder').forEach(folderEl => syncCollapsedFolderTabs(folderEl));
}

// Update all pinned section placeholders in the current space (folders + main section)
function updatePinnedSectionPlaceholders() {
    const currentSpace = document.querySelector(`[data-space-id="${activeSpaceId}"]`);
    if (!currentSpace) return;

    // Update folder placeholders
    const folders = currentSpace.querySelectorAll('.folder');
    folders.forEach(folder => {
        updateFolderPlaceholder(folder);
    });

    // Update main space pinned section placeholder
    const pinnedContainer = currentSpace.querySelector('[data-tab-type="pinned"]');
    const placeholderContainer = currentSpace.querySelector('.placeholder-container');

    if (pinnedContainer && placeholderContainer) {
        const placeholder = placeholderContainer.querySelector('.tab-placeholder');
        if (placeholder) {
            // Check if pinned container has any actual content (tabs or folders, not placeholders)
            const hasContent = pinnedContainer.querySelectorAll('.tab:not(.tab-placeholder), .folder').length > 0;

            if (hasContent) {
                placeholder.classList.add('hidden');
            } else {
                placeholder.classList.remove('hidden');
            }
        }
    }
}

// Convert favorite tab (pinned-favicon) to proper tab element
async function convertFavoriteToTab(draggingElement, targetIsPinned) {
    const tabId = parseInt(draggingElement.dataset.tabId);

    // Unpin from Chrome favorites
    await chrome.tabs.update(tabId, { pinned: false });

    // Get fresh tab data and create proper UI element
    const tab = await chrome.tabs.get(tabId);
    const newTabElement = await createTabElement(tab, targetIsPinned, false);

    // Replace the small favicon with full tab element
    draggingElement.replaceWith(newTabElement);

    // Refresh favorites area to remove the original
    updatePinnedFavicons();

    return { tab, newTabElement };
}

// Handle bookmark operations during drop events
async function handleBookmarkOperations(event, draggingElement, container, targetFolder) {
    // Validate required elements exist
    if (!draggingElement || !container || !event) {
        Logger.warn('Missing required elements for bookmark operations');
        return;
    }

    // Handle tab being moved to pinned section or folder (both open tabs and bookmark-only tabs)
    if (container.dataset.tabType === 'pinned' && (draggingElement.dataset.tabId || draggingElement.dataset.url)) {
        // Handle favorite tab conversion
        if (draggingElement.classList.contains('pinned-favicon')) {
            await convertFavoriteToTab(draggingElement, true);
            return; // Exit early, conversion complete
        }

        Logger.log("Tab dropped to pinned section or folder");

        // Determine if this is a bookmark-only tab or a regular tab
        const isBookmarkOnly = !draggingElement.dataset.tabId && draggingElement.dataset.url;
        Logger.log("Processing drag drop - isBookmarkOnly:", isBookmarkOnly);

        try {
            let tab;
            let tabId;

            if (isBookmarkOnly) {
                // For bookmark-only tabs, create a synthetic tab object from DOM data
                const titleElement = draggingElement.querySelector('.tab-title-display');
                tab = {
                    id: null,
                    url: draggingElement.dataset.url,
                    title: titleElement ? titleElement.textContent : 'Untitled',
                    favIconUrl: null
                };
                tabId = null;
                Logger.log("Created synthetic tab object for bookmark-only:", tab);
            } else {
                // For regular tabs, fetch the actual tab object
                tabId = parseInt(draggingElement.dataset.tabId);
                tab = await chrome.tabs.get(tabId);
                Logger.log("Fetched real tab object:", tab);
            }
            const spaceElement = container.closest('.space');
            if (!spaceElement) {
                Logger.error('Could not find parent space element');
                return;
            }

            const spaceId = spaceElement.dataset.spaceId;
            const space = spaces.find(s => s.id === spaceId);

            if (!space) {
                Logger.error(`Space not found for ID: ${spaceId}`);
                return;
            }

            if (!tab) {
                Logger.error(`Tab not found for ID: ${tabId}`);
                return;
            }

            // Move tab from temporary to pinned in space data (only for regular tabs with real IDs)
            if (!isBookmarkOnly && tabId) {
                space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                if (!space.spaceBookmarks.includes(tabId)) {
                    space.spaceBookmarks.push(tabId);
                }
                Logger.log("Updated space data for regular tab:", tabId);
            } else {
                Logger.log("Skipping space data update for bookmark-only tab");
            }

            // Determine the target folder
            const targetFolderElement = targetFolder ? targetFolder.closest('.folder') : null;

            // Add to bookmarks if URL doesn't exist
            const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(space.name);
            if (spaceFolder) {
                let parentId = spaceFolder.id;
                if (targetFolderElement) {
                    Logger.log("moving into a folder");
                    const folderName = targetFolderElement.querySelector('.folder-name').value;
                    parentId = targetFolderElement.dataset.bookmarkId;
                    if (!parentId) throw new Error('Save the folder name before adding tabs.');

                    // Check if bookmark already exists in the target folder
                    const existingBookmarks = await chrome.bookmarks.getChildren(parentId);
                    const bookmarkAlreadyInTarget = Boolean(BookmarkUtils.findBookmarkByUrl(existingBookmarks, tab.url));
                    if (bookmarkAlreadyInTarget) {
                        Logger.log('Bookmark already exists in folder:', folderName);
                    }

                    // Ensure we don't show duplicate UI entries for the same URL inside the folder:
                    // if the folder already has a bookmark-only item for this URL, remove it when dropping an open tab.
                    const targetFolderContentEl = targetFolderElement.querySelector('.folder-content');
                    if (targetFolderContentEl && !isBookmarkOnly && tab?.url) {
                        const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s.replace(/"/g, '\\"');
                        const dupe = targetFolderContentEl.querySelector(`.tab.bookmark-only[data-url="${esc(tab.url)}"]`);
                        if (dupe && dupe !== draggingElement) {
                            dupe.remove();
                        }
                    }

                    // Only move the bookmark in Chrome bookmarks if it's not already in the target folder.
                    if (!bookmarkAlreadyInTarget) {
                        // Find and remove the bookmark from its original location
                        await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url);

                        // Create the bookmark in the new location
                        await chrome.bookmarks.create({
                            parentId: parentId,
                            title: tab.title,
                            url: tab.url
                        });
                    }

                    // Keep folder placeholder state accurate (DOM was already positioned by drop handler).
                    updateFolderPlaceholder(targetFolderElement);
                } else {
                    await moveTabToPinned(space, tab);
                }
            }

            saveSpaces();

            // Update all folder placeholders after bookmark operations
            updatePinnedSectionPlaceholders();
        } catch (error) {
            Logger.error('Error handling pinned tab drop:', error);
            // Update placeholders even if there was an error
            updatePinnedSectionPlaceholders();
        }
    } else if (container.dataset.tabType === 'temporary' && draggingElement.dataset.tabId) {
        // Handle favorite tab conversion
        if (draggingElement.classList.contains('pinned-favicon')) {
            const { tab } = await convertFavoriteToTab(draggingElement, false);
            const space = spaces.find(s => s.id === activeSpaceId);
            if (space) moveTabToTemp(space, tab);
            return; // Exit early, conversion complete
        }

        Logger.log("Tab dropped to temporary section");
        const tabId = parseInt(draggingElement.dataset.tabId);

        try {
            const tab = await chrome.tabs.get(tabId);
            const space = spaces.find(s => s.id === activeSpaceId);

            if (space && tab) {
                // Remove tab from bookmarks if it exists
                moveTabToTemp(space, tab);

                // Update all folder placeholders after removing bookmark
                updatePinnedSectionPlaceholders();
            }
        } catch (error) {
            Logger.error('Error handling temporary tab drop:', error);
            // Update placeholders even if there was an error
            updatePinnedSectionPlaceholders();
        }
    } else if (draggingElement && draggingElement.classList.contains('pinned-favicon') && draggingElement.dataset.tabId) {
        const tabId = parseInt(draggingElement.dataset.tabId);
        try {
            // 1. Unpin the tab from Chrome favorites
            await chrome.tabs.update(tabId, { pinned: false });

            // Update all folder placeholders after conversion
            updatePinnedSectionPlaceholders();
        } catch (error) {
            Logger.error('Error converting favorite tab to space tab:', error);
            // Update placeholders even if there was an error
            updatePinnedSectionPlaceholders();
        }
    }
}

function uniqPreserveOrder(ids) {
    const out = [];
    const seen = new Set();
    for (const id of ids) {
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * Flatten visual order of pinned section for a space:
 * - root-level `.tab[data-tab-id]` in order
 * - then folder contents (per folder in DOM order), `.tab[data-tab-id]` in order
 *
 * Bookmark-only items (no tabId) are skipped since they don't exist in Chrome.
 */
function getFlattenedPinnedSectionTabIds(spaceElement) {
    const pinnedContainer = getPinnedContainer(spaceElement);
    if (!pinnedContainer) return [];

    const out = [];
    const children = Array.from(pinnedContainer.children);
    for (const child of children) {
        if (child.classList?.contains('tab') && child.dataset?.tabId) {
            out.push(parseInt(child.dataset.tabId));
            continue;
        }
        if (child.classList?.contains('folder')) {
            const folderContent = child.querySelector('.folder-content');
            if (!folderContent) continue;
            const folderTabs = Array.from(folderContent.querySelectorAll('.tab[data-tab-id]'))
                .map(el => parseInt(el.dataset.tabId));
            out.push(...folderTabs);
        }
    }
    return uniqPreserveOrder(out);
}

function getTempSectionTabIds(spaceElement) {
    const tempContainer = getTempContainer(spaceElement);
    if (!tempContainer) return [];
    return uniqPreserveOrder(
        Array.from(tempContainer.querySelectorAll('.tab[data-tab-id]')).map(el => parseInt(el.dataset.tabId))
    );
}

// Order belongs to extension data; Chrome's tab-strip order is irrelevant.
async function persistSpaceTabOrder(spaceId) {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    space.spaceBookmarks = uniqPreserveOrder(space.spaceBookmarks);
    space.temporaryTabs = uniqPreserveOrder(space.temporaryTabs.filter(id => !space.spaceBookmarks.includes(id)));
    await saveSpaces();
}

/**
 * Called after an Arcify drag+drop to update the space model (spaceBookmarks/temporaryTabs)
 * from the DOM and persist the extension order.
 */
async function handleArcifyOrderChangeAfterDropByTabId(tabId, container) {
    if (!tabId || !container) return;
    const spaceElement = container.closest('.space');
    if (!spaceElement) return;
    const spaceId = spaceElement.dataset.spaceId;
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;

    const tabType = container.dataset.tabType;
    const invertTabOrder = await Utils.getInvertTabOrder();
    if (tabType === 'temporary') {
        // DOM order is display order (top->bottom). Canonical storage is extension order (left->right).
        const tempIdsDisplayOrder = getTempSectionTabIds(spaceElement);
        const tempIdsChromeOrder = invertTabOrder ? [...tempIdsDisplayOrder].reverse() : tempIdsDisplayOrder;
        // Preserve any non-rendered temp ids (should be rare), append to end.
        const existing = (space.temporaryTabs ?? []).filter(id => !tempIdsChromeOrder.includes(id));
        space.temporaryTabs = uniqPreserveOrder([...tempIdsChromeOrder, ...existing]);
    } else if (tabType === 'pinned') {
        // DOM order is display order. Canonical storage is extension order.
        const pinnedIdsDisplayOrder = getFlattenedPinnedSectionTabIds(spaceElement);
        const pinnedIdsChromeOrder = invertTabOrder ? [...pinnedIdsDisplayOrder].reverse() : pinnedIdsDisplayOrder;
        const existing = (space.spaceBookmarks ?? []).filter(id => !pinnedIdsChromeOrder.includes(id));
        space.spaceBookmarks = uniqPreserveOrder([...pinnedIdsChromeOrder, ...existing]);
    } else {
        return;
    }

    await persistSpaceTabOrder(spaceId, { source: 'arcify', movedTabId: tabId });
}

async function setupDragAndDrop(pinnedContainer, tempContainer) {
    Logger.log('Setting up drag and drop handlers...');
    [pinnedContainer, tempContainer].forEach(container => {
        container.addEventListener('dragover', e => {
            e.preventDefault();
            const draggingElement = document.querySelector('.dragging');
            if (draggingElement) {
                const targetFolder = e.target.closest('.folder')?.querySelector(':scope > .folder-content');
                const targetContainer = targetFolder || container;

                // Check for collapsed folder auto-open functionality
                const folderElement = e.target.closest('.folder');
                if (folderElement && folderElement.classList.contains('collapsed')) {
                    // Start timer to auto-open collapsed folder if hovering over it
                    if (currentHoveredFolder !== folderElement) {
                        startFolderOpenTimer(folderElement);
                    }
                } else {
                    // Clear timer if not hovering over a collapsed folder
                    clearFolderOpenTimer();
                }

                // Get the element we're dragging over to show drop indicator
                const afterElement = getDragAfterElementTabs(targetContainer, e.clientY);
                if (afterElement && targetContainer.contains(afterElement)) {
                    // Check if this is a placeholder (empty container)
                    if (afterElement.classList.contains('tab-placeholder')) {
                        // Show visual feedback on the placeholder itself
                        afterElement.classList.add('drag-over');
                        hideAllDropIndicators(); // Don't show traditional indicators for placeholders
                    } else {
                        // Show traditional drop indicators for actual tabs/folders
                        const position = getDropPosition(afterElement, e.clientX, e.clientY, false);
                        showDropIndicator(afterElement, position, false);
                        // Remove any placeholder drag-over state in this container
                        const placeholder = targetContainer.querySelector('.tab-placeholder');
                        if (placeholder) placeholder.classList.remove('drag-over');
                    }
                } else {
                    // If no specific element, hide indicators
                    hideAllDropIndicators();
                    // Remove any placeholder drag-over state in this container
                    const placeholder = targetContainer.querySelector('.tab-placeholder');
                    if (placeholder) placeholder.classList.remove('drag-over');
                }

                // Note: Actual bookmark operations moved to drop event for proper architecture
            }
        });

        // Add dragleave handler to hide indicators when leaving container
        container.addEventListener('dragleave', e => {
            // Only hide indicators if we're actually leaving the container (not moving to a child)
            if (!container.contains(e.relatedTarget)) {
                hideAllDropIndicators();
                // Remove any placeholder drag-over state in this container
                const placeholder = container.querySelector('.tab-placeholder');
                if (placeholder) placeholder.classList.remove('drag-over');
                // Clear folder auto-open timer when leaving the container
                clearFolderOpenTimer();
            }
        });

        // Add drop handler to position elements and hide indicators
        container.addEventListener('drop', async e => {
            e.preventDefault();
            hideAllDropIndicators();
            // Remove any placeholder drag-over state in this container
            const placeholder = container.querySelector('.tab-placeholder');
            if (placeholder) placeholder.classList.remove('drag-over');
            // Clear folder auto-open timer on drop
            clearFolderOpenTimer();

            const draggingElement = document.querySelector('.dragging');
            if (draggingElement) {
                const droppedTabId = draggingElement.dataset.tabId ? parseInt(draggingElement.dataset.tabId) : null;
                // If dropping on a folder header / collapsed folder area, treat it as dropping into that folder.
                const targetFolderElement = e.target.closest('.folder');
                const targetFolder = targetFolderElement?.querySelector(':scope > .folder-content');
                if (targetFolderElement) openFolder(targetFolderElement);

                const targetContainer = targetFolder || container;

                // Calculate drop position using same logic as indicators
                const afterElement = getDragAfterElementTabs(targetContainer, e.clientY);
                if (afterElement && targetContainer.contains(afterElement)) {
                    // Check if this is a placeholder (empty container)
                    if (afterElement.classList.contains('tab-placeholder')) {
                        // Empty container - append directly and hide placeholder
                        targetContainer.appendChild(draggingElement);
                        afterElement.classList.add('hidden');
                    } else {
                        // Normal positioning logic for actual tabs/folders
                        const position = getDropPosition(afterElement, e.clientX, e.clientY, false);

                        // Position element based on indicator logic
                        if (position === 'above') {
                            targetContainer.insertBefore(draggingElement, afterElement);
                        } else { // 'below'
                            const nextSibling = afterElement.nextElementSibling;
                            if (nextSibling) {
                                targetContainer.insertBefore(draggingElement, nextSibling);
                            } else {
                                targetContainer.appendChild(draggingElement);
                            }
                        }
                    }
                } else {
                    // Fallback: append to end if no specific target
                    targetContainer.appendChild(draggingElement);
                }

                // Handle bookmark operations after DOM positioning is complete
                await handleBookmarkOperations(e, draggingElement, container, targetFolder);

                // Resync collapsed-folder projections/icons after move (source + destination)
                if (dragSourceFolderElement) {
                    syncCollapsedFolderTabs(dragSourceFolderElement);
                }
                if (targetFolderElement && targetFolderElement !== dragSourceFolderElement) {
                    syncCollapsedFolderTabs(targetFolderElement);
                }

                // Update the model from the DOM (Arcify is source of truth here), then reconcile Chrome.
                // This is intentionally done after bookmark operations so section membership is correct.
                if (droppedTabId) {
                    await handleArcifyOrderChangeAfterDropByTabId(droppedTabId, container);
                }
            }
        });
    });
}

// Function to set up drag and drop for placeholder containers to make entire placeholder area droppable
function setupPlaceholderDragAndDrop(placeholderContainer, pinnedContainer) {
    Logger.log('Setting up placeholder drag and drop handlers...');

    placeholderContainer.addEventListener('dragover', e => {
        e.preventDefault();
        const draggingElement = document.querySelector('.dragging');
        if (draggingElement) {
            // Check if pinned container is empty (no tabs or folders, only placeholder)
            const hasContent = pinnedContainer.querySelectorAll('.tab:not(.tab-placeholder), .folder').length > 0;

            if (!hasContent) {
                // Container is empty - show visual feedback on placeholder
                const placeholder = placeholderContainer.querySelector('.tab-placeholder');
                if (placeholder) {
                    placeholder.classList.add('drag-over');
                }
                hideAllDropIndicators();
            }
        }
    });

    placeholderContainer.addEventListener('dragleave', e => {
        // Only hide if leaving the placeholder container entirely
        if (!placeholderContainer.contains(e.relatedTarget)) {
            const placeholder = placeholderContainer.querySelector('.tab-placeholder');
            if (placeholder) {
                placeholder.classList.remove('drag-over');
            }
        }
    });

    placeholderContainer.addEventListener('drop', async e => {
        e.preventDefault();
        const placeholder = placeholderContainer.querySelector('.tab-placeholder');
        if (placeholder) {
            placeholder.classList.remove('drag-over');
        }
        hideAllDropIndicators();

        const draggingElement = document.querySelector('.dragging');
        if (draggingElement) {
            // Check if pinned container is empty
            const hasContent = pinnedContainer.querySelectorAll('.tab:not(.tab-placeholder), .folder').length > 0;

            if (!hasContent) {
                // Forward the drop to the pinned container by simulating the drop event
                Logger.log('Forwarding placeholder drop to pinned container');

                // Create a synthetic drop event for the pinned container
                const syntheticEvent = new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: e.dataTransfer,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    screenX: e.screenX,
                    screenY: e.screenY
                });

                // Dispatch the event on the pinned container
                pinnedContainer.dispatchEvent(syntheticEvent);
            }
        }
    });
}

async function createNewFolder(spaceElement, parentFolderElement = null) {
    const spaceName = spaceElement.querySelector('.space-name').value;
    const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(spaceName);
    const parentId = parentFolderElement?.dataset.bookmarkId || spaceFolder.id;
    if (parentFolderElement && !parentFolderElement.dataset.bookmarkId) return;
    if (!await canCreateFolder(spaceFolder.id, parentId)) return;
    const pinnedContainer = parentFolderElement
        ? parentFolderElement.querySelector(':scope > .folder-content')
        : spaceElement.querySelector('[data-tab-type="pinned"]');
    if (parentFolderElement) openFolder(parentFolderElement);
    const folderTemplate = document.getElementById('folderTemplate');
    const newFolder = folderTemplate.content.cloneNode(true);
    const folderElement = newFolder.querySelector('.folder');
    const folderHeader = folderElement.querySelector('.folder-header');
    const folderTitle = folderElement.querySelector('.folder-title');
    const folderNameInput = folderElement.querySelector('.folder-name');
    const folderIcon = folderElement.querySelector('.folder-icon');
    const folderToggle = folderElement.querySelector('.folder-toggle');
    const folderContent = folderElement.querySelector('.folder-content');

    // Save the initial expanded state once the bookmark ID is assigned.
    setFolderCollapsed(folderElement, false, false);

    // Set up initial display for new folder
    folderNameInput.style.display = 'inline-block';
    folderTitle.style.display = 'none';

    folderHeader.addEventListener('click', () => {
        // Clear the tracked shown tabs when user manually toggles the folder (Arc behavior).
        collapsedFolderShownTabs.delete(folderElement);
        setFolderCollapsed(folderElement, !folderElement.classList.contains('collapsed'));
    });

    // Keep the created folder's identity when this editor is used again.
    // Serialize Enter and blur so they cannot create two bookmark folders.
    let createdFolderId;
    let savedFolderName = 'Untitled';
    let folderSave = Promise.resolve();
    let cancelFolderBlur = false;

    // Add double-click functionality for folder name editing (for new folders)
    folderHeader.addEventListener('dblclick', (e) => {
        // Prevent dblclick on folder toggle button from triggering rename
        if (e.target === folderToggle) return;

        folderTitle.style.display = 'none';
        folderNameInput.style.display = 'inline-block';
        folderNameInput.readOnly = false;
        folderNameInput.disabled = false;
        folderNameInput.select();
        folderNameInput.focus();
    });

    const saveOrCancelNewFolderEdit = async (save) => {
        const newName = folderNameInput.value.trim();
        if (save) {
            if (newName) {
                folderSave = folderSave.then(async () => {
                    if (createdFolderId) {
                        if (newName !== savedFolderName) await chrome.bookmarks.update(createdFolderId, { title: newName });
                    } else {
                        const folder = await createFolder(spaceFolder.id, parentId, newName);
                        createdFolderId = folder.id;
                        folderElement.dataset.bookmarkId = folder.id;
                        await saveFolderCollapsed(folder.id, folderElement.classList.contains('collapsed'));
                    }
                    savedFolderName = newName;
                });
                try {
                    await folderSave;
                } catch (error) {
                    folderSave = Promise.resolve();
                    alert(error.message);
                    if (!createdFolderId) {
                        folderElement.remove();
                        if (parentFolderElement) updateFolderPlaceholder(parentFolderElement);
                    }
                    return;
                }
            }
        }
        // Update display regardless of save/cancel
        folderNameInput.value = savedFolderName;
        folderNameInput.style.display = 'none';
        folderTitle.textContent = savedFolderName;
        folderTitle.style.display = 'inline';
    };

    folderNameInput.addEventListener('blur', () => {
        if (cancelFolderBlur) { cancelFolderBlur = false; return; }
        saveOrCancelNewFolderEdit(true);
    });
    folderNameInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            await saveOrCancelNewFolderEdit(true);
            folderNameInput.blur();
        } else if (e.key === 'Escape') {
            cancelFolderBlur = true;
            await saveOrCancelNewFolderEdit(false);
            folderNameInput.blur();
        }
    });

    // Add the new folder to the pinned container
    pinnedContainer.appendChild(folderElement);
    if (parentFolderElement) updateFolderPlaceholder(parentFolderElement);

    // Set up context menu for the new folder
    setupFolderContextMenu(folderElement, { name: spaceElement.querySelector('.space-name').value });

    // Ensure new empty folder shows placeholder
    updateFolderPlaceholder(folderElement);

    folderNameInput.focus();
}

const spaceRenderTasks = new Map();
async function loadTabs(space, pinnedContainer, tempContainer) {
    const previous = spaceRenderTasks.get(space.id) || Promise.resolve();
    const run = previous.catch(error => Logger.warn('Previous space render failed', error)).then(async () => {
        if (!pinnedContainer.isConnected) return;
        pinnedContainer.querySelectorAll('.tab, .folder').forEach(el => el.remove());
        tempContainer.querySelectorAll('.tab').forEach(el => el.remove());
        await renderSpaceTabs(space, pinnedContainer, tempContainer);
    });
    spaceRenderTasks.set(space.id, run);
    try { await run; }
    finally { if (spaceRenderTasks.get(space.id) === run) spaceRenderTasks.delete(space.id); }
}

async function renderSpaceTabs(space, pinnedContainer, tempContainer) {
    Logger.log('Loading tabs for space:', space.id);
    Logger.log('Space bookmarks in space:', space.spaceBookmarks);

    // Track which *tabIds* are already represented in the pinned bookmarks UI so we don't double-render them
    // in the temporary section. We intentionally avoid URL-key based exclusion here because multiple open
    // tabs can share the same base URL (e.g. abc.com?x=y and abc.com?x=z).
    const representedPinnedTabIds = new Set();
    try {
        const invertTabOrder = await Utils.getInvertTabOrder();
        const tabs = (await getOwnedTabs(space.id)).filter(t => !t.pinned);
        const pinnedStatesById = await Utils.getPinnedTabStates();
        const pinnedTabs = await chrome.tabs.query({ pinned: true });
        const pinnedUrls = new Set(pinnedTabs.map(tab => tab.url));

        const spaceFolder = await getSpaceBookmarkFolder(space);

        if (spaceFolder) {
            // Recursive function to process bookmarks and folders
            async function processBookmarkNode(node, container) {
                const bookmarks = await chrome.bookmarks.getChildren(node.id);
                Logger.log('Processing bookmarks:', bookmarks);
                const processedUrls = new Set();

                const itemsToRender = invertTabOrder ? [...bookmarks].reverse() : bookmarks;
                for (const item of itemsToRender) {
                    if (!item.url) {
                        // This is a folder
                        const folderTemplate = document.getElementById('folderTemplate');
                        const newFolder = folderTemplate.content.cloneNode(true);
                        const folderElement = newFolder.querySelector('.folder');
                        folderElement.dataset.bookmarkId = item.id;
                        const folderHeader = folderElement.querySelector('.folder-header');
                        const folderIcon = folderElement.querySelector('.folder-icon');
                        const folderTitle = folderElement.querySelector('.folder-title');
                        const folderNameInput = folderElement.querySelector('.folder-name');
                        const folderContent = folderElement.querySelector('.folder-content');
                        const folderToggle = folderElement.querySelector('.folder-toggle');
                        const placeHolderElement = folderElement.querySelector('.tab-placeholder');
                        // Set up folder toggle functionality
                        // Add context menu for folder
                        setupFolderContextMenu(folderElement, space, item);

                        folderHeader.addEventListener('click', () => {
                            // Clear the tracked shown tabs when user manually toggles the folder (Arc behavior).
                            collapsedFolderShownTabs.delete(folderElement);
                            setFolderCollapsed(folderElement, !folderElement.classList.contains('collapsed'));
                        });

                        // Add double-click functionality for folder name editing
                        folderHeader.addEventListener('dblclick', (e) => {
                            // Prevent dblclick on folder toggle button from triggering rename
                            if (e.target === folderToggle) return;

                            folderTitle.style.display = 'none';
                            folderNameInput.style.display = 'inline-block';
                            folderNameInput.readOnly = false;
                            folderNameInput.disabled = false;
                            folderNameInput.select();
                            folderNameInput.focus();
                        });

                        const saveOrCancelFolderEdit = async (save) => {
                            if (save) {
                                const newName = folderNameInput.value.trim();
                                if (newName && newName !== item.title) {
                                    try {
                                        await chrome.bookmarks.update(item.id, { title: newName });
                                        item.title = newName; // Update local item object
                                    } catch (error) {
                                        Logger.error("Error updating folder name:", error);
                                    }
                                }
                            }
                            // Update display regardless of save/cancel
                            folderNameInput.value = item.title;
                            folderNameInput.readOnly = true;
                            folderNameInput.disabled = true;
                            folderNameInput.style.display = 'none';
                            folderTitle.textContent = item.title;
                            folderTitle.style.display = 'inline';
                        };

                        folderNameInput.addEventListener('blur', () => saveOrCancelFolderEdit(true));
                        folderNameInput.addEventListener('keydown', async (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                await saveOrCancelFolderEdit(true);
                                folderNameInput.blur();
                            } else if (e.key === 'Escape') {
                                await saveOrCancelFolderEdit(false);
                                folderNameInput.blur();
                            }
                        });

                        folderNameInput.value = item.title;
                        folderNameInput.readOnly = true;
                        folderNameInput.disabled = true;
                        folderNameInput.style.display = 'none';
                        folderTitle.textContent = item.title;
                        folderTitle.style.display = 'inline';

                        container.appendChild(folderElement);

                        // Recursively process the folder's contents
                        await processBookmarkNode(item, folderElement.querySelector('.folder-content'));

                        // Update folder placeholder state after loading contents
                        updateFolderPlaceholder(folderElement);
                        // Restore parent and child states independently after their contents render.
                        setFolderCollapsed(folderElement, await loadFolderCollapsed(item.id), false);
                    } else {
                        // This is a bookmark
                        if (!processedUrls.has(item.url) && !pinnedUrls.has(item.url)) {
                            // Choose ONE open tab (if any) to represent this bookmark:
                            // 1) Strongest: pinned state points to this bookmarkId
                            // 2) Tab already bound to this space's pinned set, matching by base URL
                            //    (prevents a newly opened URL twin from displacing the established pinned tab)
                            // 3) Exact URL match, but only if not already used for another bookmark
                            // 4) Base URL match (origin+pathname), but only if not already used for another bookmark
                            const byBookmarkId = tabs.find(t => pinnedStatesById?.[t.id]?.bookmarkId === item.id);
                            // A tab explicitly bound to a *different* bookmark belongs to that
                            // bookmark's byBookmarkId match. Don't let a weaker URL-based match
                            // steal it — that's what produced a duplicate render when two
                            // bookmarks in the same space share a base-URL key.
                            const notBoundElsewhere = t => {
                                const bid = pinnedStatesById?.[t.id]?.bookmarkId;
                                return !bid || bid === item.id;
                            };
                            const bySpaceMember = tabs.find(t =>
                                t?.id &&
                                !representedPinnedTabIds.has(t.id) &&
                                notBoundElsewhere(t) &&
                                space.spaceBookmarks.includes(t.id) &&
                                Utils.getPinnedUrlKey(t.url) === Utils.getPinnedUrlKey(item.url)
                            );
                            const byExactUrl = tabs.find(t =>
                                t?.id &&
                                !representedPinnedTabIds.has(t.id) &&
                                notBoundElsewhere(t) &&
                                t.url === item.url
                            );
                            const byBaseUrl = tabs.find(t =>
                                t?.id &&
                                !representedPinnedTabIds.has(t.id) &&
                                notBoundElsewhere(t) &&
                                Utils.getPinnedUrlKey(t.url) === Utils.getPinnedUrlKey(item.url)
                            );
                            const existingTab = byBookmarkId || bySpaceMember || byExactUrl || byBaseUrl;
                            if (existingTab) {
                                Logger.log('Creating UI element for active bookmark:', existingTab);
                                representedPinnedTabIds.add(existingTab.id);
                                existingTab.pinnedUrl = item.url;
                                existingTab.bookmarkId = item.id;
                                // Repair the persistent binding so subsequent renders use byBookmarkId
                                // (cheap; only writes if state is missing or stale for this tab).
                                const stored = pinnedStatesById?.[existingTab.id];
                                if (!stored || stored.bookmarkId !== item.id || stored.pinnedUrl !== item.url) {
                                    pinnedStatesById[existingTab.id] = { pinnedUrl: item.url, bookmarkId: item.id };
                                    await Utils.setPinnedTabState(existingTab.id, { pinnedUrl: item.url, bookmarkId: item.id });
                                }
                                const tabElement = await createTabElement(existingTab, true);
                                Logger.log('Appending tab element to container:', tabElement);
                                container.appendChild(tabElement);
                            } else {
                                // Create UI element for inactive bookmark
                                const bookmarkTab = {
                                    id: null,
                                    title: item.title,
                                    url: item.url,
                                    favIconUrl: null,
                                    spaceName: space.name,
                                    pinnedUrl: item.url,
                                    bookmarkId: item.id
                                };
                                Logger.log('Creating UI element for inactive bookmark:', item);
                                const tabElement = await createTabElement(bookmarkTab, true, true);
                                container.appendChild(tabElement);
                            }
                            processedUrls.add(item.url);
                            // Update placeholder state for folder if this container is inside a folder
                            const parentFolder = container.closest('.folder');
                            if (parentFolder) {
                                updateFolderPlaceholder(parentFolder);
                            }
                        }
                    }
                }
                return;
            }

            // Process the space folder and get all bookmarked URLs
            await processBookmarkNode(spaceFolder, pinnedContainer);
        }


        // Load temporary tabs
        let tabsToLoad = [...space.temporaryTabs]; // Create a copy

        if (invertTabOrder) {
            tabsToLoad.reverse();
        }

        for (const tabId of tabsToLoad) {
            Logger.log("checking", tabId, spaces);
            const tab = tabs.find(t => t.id === tabId);
            const representedAsPinned = representedPinnedTabIds.has(tabId);
            Logger.log("representedAsPinned", representedAsPinned);

            if (tab && !representedAsPinned) {
                const tabElement = await createTabElement(tab);
                tempContainer.appendChild(tabElement);
            }
        }
    } catch (error) {
        Logger.error('Error loading tabs:', error);
    }
}

// Debounced UI refresh when settings change (e.g., invertTabOrder)
let refreshActiveSpaceUITimeout = null;

async function refreshActiveSpaceUI() {
    try {
        if (!activeSpaceId) return;
        const space = spaces.find(s => s.id === activeSpaceId);
        if (!space) return;

        const spaceElement = document.querySelector(`[data-space-id="${activeSpaceId}"]`);
        if (!spaceElement) return;

        const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
        const tempContainer = spaceElement.querySelector('[data-tab-type="temporary"]');
        if (!pinnedContainer || !tempContainer) return;

        // Clear existing rendered elements but keep templates (e.g., #folderTemplate).
        pinnedContainer.querySelectorAll('.tab, .folder').forEach(el => el.remove());
        tempContainer.querySelectorAll('.tab').forEach(el => el.remove());

        await loadTabs(space, pinnedContainer, tempContainer);
        updatePinnedSectionPlaceholders();

        // Restore active highlight if possible
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTabs?.length) {
            activateTabInDOM(activeTabs[0].id);
        }
    } catch (e) {
        Logger.warn('[UIRefresh] Error refreshing active space UI:', e);
    }
}

// Function to update chevron state based on pinned section visibility
function updateChevronState(spaceElement, pinnedContainer) {
    const chevronButton = spaceElement.querySelector('.space-toggle-chevron');
    const isCollapsed = pinnedContainer.classList.contains('collapsed');
    if (!chevronButton) {
        return;
    }

    if (isCollapsed) {
        chevronButton.classList.add('collapsed');
    } else {
        chevronButton.classList.remove('collapsed');
    }
}

async function closeTab(tabElement, tab, isPinned = false, isBookmarkOnly = false) {
    Logger.log('Closing tab:', tab, tabElement, isPinned, isBookmarkOnly);

    if (isBookmarkOnly) {
        // Remove from bookmarks
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const activeSpace = spaces.find(s => s.id === activeSpaceId);

        const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
        Logger.log("spaceFolder", spaceFolder);
        if (spaceFolder) {
            await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url, {
                removeTabElement: true,
                tabElement: tabElement,
                logRemoval: true
            });
        }

        // Update folder placeholders after removing bookmark
        updatePinnedSectionPlaceholders();
        return;
    }

    const activeSpace = spaces.find(s => s.id === activeSpaceId);
    Logger.log("activeSpace", activeSpace);
    const isCurrentlyPinned = activeSpace?.spaceBookmarks.includes(tab.id);
    const isCurrentlyTemporary = activeSpace?.temporaryTabs.includes(tab.id);
    Logger.log("isCurrentlyPinned", isCurrentlyPinned, "isCurrentlyTemporary", isCurrentlyTemporary, "isPinned", isPinned);
    if (isCurrentlyPinned || (isPinned && !isCurrentlyTemporary)) {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

        const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
        Logger.log("spaceFolder", spaceFolder);
        if (spaceFolder) {
            Logger.log("tab", tab);

            // For actual tabs, check overrides
            const overrides = await Utils.getTabNameOverrides();
            const override = overrides[tab.id];
            const displayTitle = override ? override.name : tab.title;

            const bookmarkTab = {
                id: null,
                title: displayTitle,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                spaceName: tab.spaceName
            };
            const parentFolder = tabElement.closest('.folder');
            const inactiveTabElement = await createTabElement(bookmarkTab, true, true);
            tabElement.replaceWith(inactiveTabElement);
            if (parentFolder) syncCollapsedFolderTabs(parentFolder);

            chrome.tabs.remove(tab.id);

            // Update chevron state after closing pinned tab
            const spaceElement = document.querySelector(`[data-space-id="${activeSpaceId}"]`);
            if (spaceElement) {
                const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
                updateChevronState(spaceElement, pinnedContainer);
            }
            return;
        }
    } else {
        chrome.tabs.remove(tab.id);
    }

    // Update chevron state after closing any tab
    const spaceElement = document.querySelector(`[data-space-id="${activeSpaceId}"]`);
    if (spaceElement) {
        const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
        updateChevronState(spaceElement, pinnedContainer);
    }
}

async function createTabElement(tab, isPinned = false, isBookmarkOnly = false) {
    Logger.log('Creating tab element:', tab.id, 'IsBookmarkOnly:', isBookmarkOnly);

    // Get the template and clone it
    const template = document.getElementById('tabTemplate');
    const tabElement = template.content.cloneNode(true).querySelector('.tab');

    // Set up the tab element properties
    tabElement.draggable = true; // Enable dragging for all tabs (regular and bookmark-only)

    if (isBookmarkOnly) {
        tabElement.classList.add('inactive', 'bookmark-only');
        tabElement.dataset.url = tab.url;
        if (tab.pinnedUrl) tabElement.dataset.pinnedUrl = tab.pinnedUrl;
        if (tab.bookmarkId) tabElement.dataset.bookmarkId = tab.bookmarkId;
    } else {
        tabElement.dataset.tabId = tab.id;
        tabElement.dataset.url = tab.url;
        if (tab.active) {
            tabElement.classList.add('active');
        }
    }

    // Get references to template elements
    const favicon = tabElement.querySelector('.tab-favicon');
    const tabDetails = tabElement.querySelector('.tab-details');
    const titleDisplay = tabElement.querySelector('.tab-title-display');
    const domainDisplay = tabElement.querySelector('.tab-domain-display');
    const titleInput = tabElement.querySelector('.tab-title-input');
    const actionButton = tabElement.querySelector('.tab-close');

    // Arc-like visual indicator: "/" shown next to favicon when pinned URL has changed.
    let urlChangedSlash = tabElement.querySelector('.tab-url-changed-slash');
    if (!urlChangedSlash) {
        urlChangedSlash = document.createElement('span');
        urlChangedSlash.className = 'tab-url-changed-slash';
        urlChangedSlash.textContent = '/';
        favicon.insertAdjacentElement('afterend', urlChangedSlash);
    }

    // Track pinned URL + bookmarkId for Arc-like behavior (only for space-pinned, active tabs).
    let pinnedUrlForTab = null;
    if (isPinned && !isBookmarkOnly && tab?.id) {
        const stored = await Utils.getPinnedTabState(tab.id);
        pinnedUrlForTab = tab.pinnedUrl || stored?.pinnedUrl || tab.url;
        const bookmarkIdForTab = tab.bookmarkId || stored?.bookmarkId || null;
        tabElement.dataset.pinnedUrl = pinnedUrlForTab;
        if (bookmarkIdForTab) tabElement.dataset.bookmarkId = bookmarkIdForTab;
        await Utils.setPinnedTabState(tab.id, { pinnedUrl: pinnedUrlForTab, bookmarkId: bookmarkIdForTab });
    }

    // Set up favicon
    favicon.src = Utils.getFaviconUrl(tab.url);
    favicon.classList.add('tab-favicon');
    favicon.draggable = false; // Drag the tab, never the favicon image URL.
    favicon.onerror = () => {
        favicon.src = tab.favIconUrl;
        favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; }; // Fallback favicon
    }; // Fallback favicon

    // Arc-like: clicking the favicon takes you back to the pinned URL (if navigated away).
    if (isPinned && !isBookmarkOnly) {
        const computePinnedUrl = async () => {
            const stored = tab?.id ? await Utils.getPinnedTabState(tab.id) : null;
            return tabElement.dataset.pinnedUrl || tab.pinnedUrl || stored?.pinnedUrl || tab.url || null;
        };

        // IMPORTANT: always prefer the dataset URL (kept fresh by handleTabUpdate) over the captured `tab.url`
        // to avoid stale comparisons after navigation.
        const computeCurrentUrl = () => tabElement.dataset.url || tab.url || null;

        const canBackToPinned = async () => {
            const pinnedUrl = await computePinnedUrl();
            const currentUrl = computeCurrentUrl();
            return Boolean(pinnedUrl && currentUrl && Utils.getPinnedUrlKey(currentUrl) !== Utils.getPinnedUrlKey(pinnedUrl));
        };

        const setBackButtonState = async () => {
            const enabled = await canBackToPinned();
            favicon.classList.toggle('pinned-back', enabled);
            favicon.title = enabled ? 'Back to Pinned URL' : '';
            urlChangedSlash.classList.toggle('visible', enabled);
        };

        await setBackButtonState();

        favicon.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!tab?.id) return;
            try {
                const pinnedUrl = await computePinnedUrl();
                if (!pinnedUrl) return;
                const current = await chrome.tabs.get(tab.id);
                if (!current?.url || current.url === pinnedUrl) return;
                await chrome.tabs.update(tab.id, { url: pinnedUrl, active: true });
            } catch (err) {
                Logger.warn('[PinnedTab] Failed to navigate back to pinned URL:', err);
            }
        });
    }

    // Set up action button
    actionButton.classList.remove('tab-close');
    actionButton.classList.add(isBookmarkOnly ? 'tab-remove' : 'tab-close');
    actionButton.innerHTML = isBookmarkOnly ? '−' : '×';
    actionButton.title = isBookmarkOnly ? 'Remove Bookmark' : 'Close Tab';
    actionButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const activeSpace = spaces.find(s => s.id === activeSpaceId);
        Logger.log("activeSpace", activeSpace);
        const isCurrentlyPinned = activeSpace?.spaceBookmarks.includes(tab.id);
        closeTab(tabElement, tab, isCurrentlyPinned, isBookmarkOnly);
    });

    // --- Function to update display based on overrides ---
    const updateDisplay = async () => {
        // For bookmark-only elements, just display the stored title
        if (isBookmarkOnly) {
            titleDisplay.textContent = tab.title || 'Bookmark'; // Use stored title
            titleDisplay.style.display = 'inline';
            titleInput.style.display = 'none';
            domainDisplay.style.display = 'none';
            return;
        }

        // For actual tabs, check overrides
        const overrides = await Utils.getTabNameOverrides();
        const override = overrides[tab.id];
        let displayTitle = tab.title; // Default to actual tab title
        let displayDomain = null;

        titleInput.value = tab.title; // Default input value is current tab title

        // For space-pinned tabs: only force the bookmark/override title when we're still on the pinned URL.
        // If the tab navigates away, show the real page title (Arc-like).
        const pinnedUrl = (isPinned ? (tabElement.dataset.pinnedUrl || pinnedUrlForTab) : null);
        const isNavigatedAway = Boolean(isPinned && pinnedUrl && tab.url && Utils.getPinnedUrlKey(tab.url) !== Utils.getPinnedUrlKey(pinnedUrl));

        if (override && !isNavigatedAway) {
            displayTitle = override.name;
            titleInput.value = override.name; // Set input value to override name
        }

        // Domain subtitle: only show when navigated away from the pinned domain.
        if (isPinned && pinnedUrl && tab.url && Utils.getPinnedUrlKey(tab.url) !== Utils.getPinnedUrlKey(pinnedUrl)) {
            try {
                const pinnedDomain = new URL(pinnedUrl).hostname;
                const currentDomain = new URL(tab.url).hostname;
                if (currentDomain && pinnedDomain && currentDomain !== pinnedDomain) {
                    displayDomain = currentDomain;
                }
            } catch (e) {
                Logger.warn("Error parsing URL for domain check:", tab.url, e);
            }
        }

        titleDisplay.textContent = displayTitle;
        if (displayDomain) {
            domainDisplay.textContent = displayDomain;
            domainDisplay.classList.remove('back-to-pinned');
            domainDisplay.style.display = 'block';
        } else {
            domainDisplay.classList.remove('back-to-pinned');
            domainDisplay.style.display = 'none';
        }

        // Ensure correct elements are visible
        titleDisplay.style.display = 'inline'; // Or 'block' if needed
        titleInput.style.display = 'none';
    };

    // --- Event Listeners for Editing (Only for actual tabs) ---
    if (!isBookmarkOnly) {
        tabDetails.addEventListener('dblclick', (e) => {
            // Prevent dblclick on favicon or close button from triggering rename
            if (e.target === favicon || e.target === actionButton) return;

            titleDisplay.style.display = 'none';
            domainDisplay.style.display = 'none'; // Hide domain while editing
            titleInput.style.display = 'inline-block'; // Or 'block'
            titleInput.select(); // Select text for easy replacement
            titleInput.focus(); // Focus the input
        });

        const saveOrCancelEdit = async (save) => {
            if (save) {
                const newName = titleInput.value.trim();
                try {
                    // Fetch the latest tab info in case the title changed naturally
                    const currentTabInfo = await chrome.tabs.get(tab.id);
                    const originalTitle = currentTabInfo.title;
                    const activeSpace = spaces.find(s => s.id === activeSpaceId);

                    if (newName && newName !== originalTitle) {
                        await Utils.setTabNameOverride(tab.id, tab.url, newName);
                        if (isPinned) {
                            await updateBookmarkForTab(tab, newName);
                        }
                    } else {
                        // If name is empty or same as original, remove override
                        await Utils.removeTabNameOverride(tab.id);
                        if (isPinned) {
                            await updateBookmarkForTab(tab, originalTitle);
                        }
                    }
                } catch (error) {
                    Logger.error("Error getting tab info or saving override:", error);
                    // Handle cases where the tab might have been closed during edit
                }
            }
            // Update display regardless of save/cancel to show correct state
            // Need to fetch tab again in case URL changed during edit? Unlikely but possible.
            try {
                const potentiallyUpdatedTab = await chrome.tabs.get(tab.id);
                tab.title = potentiallyUpdatedTab.title; // Update local tab object title
                tab.url = potentiallyUpdatedTab.url; // Update local tab object url
            } catch (e) {
                Logger.log("Tab likely closed during edit, cannot update display.");
                // If tab closed, the element will be removed by handleTabRemove anyway
                return;
            }
            await updateDisplay();
        };

        titleInput.addEventListener('blur', () => saveOrCancelEdit(true));
        titleInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent potential form submission if wrapped
                await saveOrCancelEdit(true);
                titleInput.blur(); // Explicitly blur to hide input
            } else if (e.key === 'Escape') {
                await saveOrCancelEdit(false); // Cancel reverts input visually via updateDisplay
                titleInput.blur(); // Explicitly blur to hide input
            }
        });
    }

    // --- Initial Display ---
    await updateDisplay(); // Call initially to set the correct title/domain


    // Handle mousedown events (left-click to open, middle-click to close)
    tabElement.addEventListener('auxclick', event => {
        if (event.button === MOUSE_BUTTON.MIDDLE) {
            event.preventDefault();
            closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        }
    });
    // Activate after mouse-up so dragging an inactive tab does not rebuild its source.
    tabElement.addEventListener('click', async (event) => {
        if (event.button === MOUSE_BUTTON.MIDDLE) {
            event.preventDefault(); // Prevent default middle-click actions (like autoscroll)
            closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        } else if (event.button === MOUSE_BUTTON.LEFT) {
            // Don't activate tab when clicking close button
            if (event.target === actionButton) return;

            // Remove active class from all tabs and favicons
            clearAllActiveStates();

            let chromeTab = null;
            try {
                chromeTab = await chrome.tabs.get(tab.id);
            } catch (e) {
                Logger.log("Tab likely closed during archival.", e, tab);
            }

            if (isBookmarkOnly || !chromeTab) {
                Logger.log('Opening bookmark:', tab);
                isOpeningBookmark = true; // Set flag
                try {
                    // Get URL from dataset if tab object doesn't have it (archived tab case)
                    const tabUrl = tab.url || tabElement.dataset.url;
                    if (!tabUrl) {
                        Logger.error("Cannot open bookmark: No URL found for archived tab.");
                        isOpeningBookmark = false;
                        return;
                    }

                    // Check if tab exists by URL (might be open but in different window/state)
                    const allTabs = await chrome.tabs.query({});
                    const existingTab = BookmarkUtils.findTabByUrl(allTabs.filter(t => ownerOf(spaces, t.id)?.id === activeSpaceId), tabUrl);

                    if (existingTab) {
                        const clickedBookmarkId = tabElement.dataset.bookmarkId || null;
                        const clickedPinnedUrl = tabElement.dataset.pinnedUrl || tabUrl;
                        const clickedPinnedKey = Utils.getPinnedUrlKey(clickedPinnedUrl);

                        // If another tab in the target space already represents this bookmark,
                        // focus that one instead of promoting `existingTab` to pinned.
                        // This prevents URL twins from being silently auto-pinned alongside
                        // the original pinned tab.
                        const pinnedStatesById = await Utils.getPinnedTabStates();
                        const targetSpace = ownerOf(spaces, existingTab.id) || spaces.find(s => s.id === activeSpaceId);
                        let boundTab = null;
                        if (isPinned && targetSpace) {
                            for (const boundId of targetSpace.spaceBookmarks) {
                                if (boundId === existingTab.id) continue;
                                const candidate = allTabs.find(t => t.id === boundId);
                                if (!candidate) continue;
                                const state = pinnedStatesById[boundId];
                                const matchesByBookmark = clickedBookmarkId && state?.bookmarkId === clickedBookmarkId;
                                const matchesByUrl = Utils.getPinnedUrlKey(candidate.url) === clickedPinnedKey;
                                if (matchesByBookmark || matchesByUrl) {
                                    boundTab = candidate;
                                    break;
                                }
                            }
                        }

                        const tabToFocus = boundTab || existingTab;
                        Logger.log('Found existing tab with same URL, activating:', tabToFocus.id, boundTab ? '(preferred already-bound pinned tab)' : '');
                        await Utils.focusTab(tabToFocus.id);
                        activateTabInDOM(tabToFocus.id);

                        if (isPinned && !boundTab) {
                            // Only persist pinned-state for `existingTab` when we're actually
                            // promoting it (i.e., no other tab is already bound to this bookmark).
                            await Utils.setPinnedTabState(existingTab.id, { pinnedUrl: clickedPinnedUrl, bookmarkId: clickedBookmarkId });
                        }

                        // Update space data if needed
                        const space = ownerOf(spaces, tabToFocus.id);
                        if (space) {
                            space.lastTab = tabToFocus.id;
                            // Only auto-add to spaceBookmarks when no other tab already represents this bookmark.
                            if (isPinned && !boundTab && !space.spaceBookmarks.includes(existingTab.id)) {
                                space.spaceBookmarks.push(existingTab.id);
                                // If this tab was previously sitting in the temp section,
                                // remove it from temporaryTabs and drop any temp DOM element
                                // so it doesn't appear in both sections.
                                if (space.temporaryTabs.includes(existingTab.id)) {
                                    space.temporaryTabs = space.temporaryTabs.filter(id => id !== existingTab.id);
                                    const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
                                    if (spaceElement) {
                                        const tempContainer = spaceElement.querySelector('[data-tab-type="temporary"]');
                                        if (tempContainer) {
                                            const targetTabId = String(existingTab.id);
                                            tempContainer.querySelectorAll('.tab').forEach(el => {
                                                if (el.dataset.tabId && String(el.dataset.tabId) === targetTabId) el.remove();
                                            });
                                        }
                                    }
                                }
                            }
                            saveSpaces();
                        }

                        // Replace the element with the active tab element for whichever tab now owns the bookmark.
                        if (boundTab) {
                            // boundTab already has its own live element in the pinned section
                            // (it's a member of the space's spaceBookmarks). Cloning a second
                            // element for it would duplicate the tab in the DOM, so just drop
                            // the clicked placeholder instead.
                            tabElement.remove();
                        } else {
                            const updatedTabElement = await createTabElement(tabToFocus, isPinned, false);
                            tabElement.replaceWith(updatedTabElement);
                        }
                        isOpeningBookmark = false;
                        return;
                    }

                    // Check if tab is in archive and restore it
                    const archivedTabs = await Utils.getArchivedTabs();
                    const archivedTab = archivedTabs.find(t => t.url === tabUrl);

                    let targetSpaceId = activeSpaceId;
                    let bookmarkTitle = tab.title || tabElement.querySelector('.tab-title-display')?.textContent || 'Bookmark';

                    if (archivedTab) {
                        Logger.log('Found archived tab, restoring from archive:', archivedTab);
                        targetSpaceId = archivedTab.spaceId || activeSpaceId;
                        bookmarkTitle = archivedTab.name || bookmarkTitle;

                        // Restore the archived tab
                        const restoredTab = await Utils.restoreArchivedTab(archivedTab);

                        if (restoredTab) {
                            // Pin the restored tab if it was originally pinned
                            if (isPinned) {
                                await chrome.tabs.update(restoredTab.id, { pinned: true });
                            }

                            // Tab is already active from restore, but ensure it's activated
                            chrome.tabs.update(restoredTab.id, { active: true });
                            activateTabInDOM(restoredTab.id);

                            // Update space data
                            const space = spaces.find(s => s.id === targetSpaceId);
                            if (space) {
                                space.lastTab = restoredTab.id;
                                // If this was a pinned tab, ensure it's in spaceBookmarks
                                if (isPinned) {
                                    // Remove any stale tabId references (in case old tabId was still in array)
                                    if (tab.id) {
                                        space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tab.id);
                                    }
                                    // Add the new restored tabId
                                    if (!space.spaceBookmarks.includes(restoredTab.id)) {
                                        space.spaceBookmarks.push(restoredTab.id);
                                    }
                                }
                                saveSpaces();
                            }

                            // Ensure restored tab lands in correct Chrome position for this space.
                            await persistSpaceTabOrder(targetSpaceId, { source: 'arcify', movedTabId: restoredTab.id });

                            // Replace the element with the active tab element
                            if (isPinned) {
                                const pinnedUrl = tabElement.dataset.pinnedUrl || tabUrl;
                                const bookmarkId = tabElement.dataset.bookmarkId || null;
                                restoredTab.pinnedUrl = pinnedUrl;
                                restoredTab.bookmarkId = bookmarkId;
                                await Utils.setPinnedTabState(restoredTab.id, { pinnedUrl: pinnedUrl, bookmarkId: bookmarkId });
                            }
                            const updatedTabElement = await createTabElement(restoredTab, isPinned, false);
                            tabElement.replaceWith(updatedTabElement);
                            isOpeningBookmark = false;
                            return;
                        }
                    }

                    // Tab not found and not in archive, open as new bookmark
                    const space = spaces.find(s => s.id === targetSpaceId);
                    if (!space) {
                        Logger.error("Cannot open bookmark: Active space not found.");
                        isOpeningBookmark = false;
                        return;
                    }

                    // Get bookmark title from Chrome bookmarks if available
                    if (!tab.spaceName) {
                        // Try to find space name from targetSpaceId
                        const spaceWithTab = spaces.find(s => s.id === targetSpaceId);
                        if (spaceWithTab) {
                            tab.spaceName = spaceWithTab.name;
                        }
                    }

                    // Prepare bookmark data for opening
                    const bookmarkData = {
                        url: tabUrl,
                        title: bookmarkTitle,
                        spaceName: tab.spaceName || space.name,
                        pinnedUrl: tabElement.dataset.pinnedUrl || tabUrl,
                        bookmarkId: tabElement.dataset.bookmarkId || null
                    };

                    // Prepare context for BookmarkUtils
                    const context = {
                        spaces,
                        activeSpaceId: targetSpaceId,
                        currentWindow,
                        saveSpaces,
                        createTabElement,
                        activateTabInDOM,
                        Utils,
                        persistSpaceTabOrder
                    };

                    // Use shared bookmark opening logic
                    await BookmarkUtils.openBookmarkAsTab(bookmarkData, targetSpaceId, tabElement, context, isPinned);

                } catch (error) {
                    Logger.error("Error opening bookmark:", error);
                } finally {
                    isOpeningBookmark = false; // Reset flag
                }
            } else {
                // It's a regular tab, just activate it
                tabElement.classList.add('active');
                await Utils.focusTab(tab.id);
                // Store last active tab for the space
                const space = ownerOf(spaces, tab.id);
                if (space) {
                    space.lastTab = tab.id;
                    saveSpaces();
                }
            }
        }
    });

    // Set up drag handlers for all tabs (regular and bookmark-only)
    setupTabDragHandlers(tabElement);

    // --- Context Menu ---
    tabElement.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const allBookmarkSpaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        showTabContextMenu(
            e.pageX,
            e.pageY,
            tab,
            isPinned,
            isBookmarkOnly,
            tabElement,
            closeTab,
            spaces,
            moveTabToSpace,
            setActiveSpace,
            allBookmarkSpaceFolders,
            createSpaceFromInactive,
            replaceBookmarkUrlWithCurrentUrl
        );
    });

    return tabElement;
}

async function createNewTab(callback = () => {}) {
    const spaceId = activeSpaceId;
    const tab = await chrome.tabs.create({ active: true, windowId: currentWindow.id });
    await spaceRequest('assign', { tabId: tab.id, spaceId });
    await adoptStoredSpaces(await spaceRequest('get'));
    if (typeof callback === 'function') callback();
    return tab;
}

async function createNewSpace() {
    Logger.log('Creating new space... Button clicked');
    isCreatingSpace = true;
    try {
        const spaceNameInput = document.getElementById('newSpaceName');
        const spaceColorSelect = document.getElementById('spaceColor');
        const spaceName = spaceNameInput.value.trim();
        const spaceColor = spaceColorSelect.value;

        if (!spaceName || spaces.some(space => space.name.toLowerCase() === spaceName.toLowerCase())) {
            const errorPopup = document.createElement('div');
            errorPopup.className = 'error-popup';
            errorPopup.textContent = 'A space with this name already exists';
            const inputContainer = document.getElementById('addSpaceInputContainer');
            inputContainer.appendChild(errorPopup);

            // Remove the error message after 3 seconds
            setTimeout(() => {
                errorPopup.remove();
            }, 3000);
            return;
        }


        // Create bookmark folder for new space, then anchor durable identity to it.
        const newSpaceFolder = await LocalStorage.getOrCreateSpaceFolder(spaceName);
        const registryEntry = await LocalStorage.getOrCreateSpaceRegistryEntry(newSpaceFolder.id, {
            name: spaceName,
            color: spaceColor,
        });

        const space = {
            id: registryEntry.spaceUuid,
            spaceUuid: registryEntry?.spaceUuid ?? Utils.generateUUID(),
            bookmarkFolderId: newSpaceFolder.id,
            uuid: registryEntry?.spaceUuid ?? Utils.generateUUID(),
            name: spaceName,
            color: spaceColor,
            spaceBookmarks: [],
            temporaryTabs: []
        };

        spaces.push(space);
        Logger.log('New space created:', { spaceId: space.id, spaceName: space.name, spaceColor: space.color });

        createSpaceElement(space);
        await updateSpaceSwitcher();
        await saveSpaces();
        await setActiveSpace(space.id);

        isCreatingSpace = false;
        // Reset the space creation UI and show space switcher
        const addSpaceBtn = document.getElementById('addSpaceBtn');
        const inputContainer = document.getElementById('addSpaceInputContainer');
        const spaceSwitcher = document.getElementById('spaceSwitcher');
        addSpaceBtn.classList.remove('active');
        inputContainer.classList.remove('visible');
        spaceSwitcher.style.opacity = '1';
        spaceSwitcher.style.visibility = 'visible';
    } catch (error) {
        Logger.error('Error creating new space:', error);
    }
}

/**
 * Collect the URL keys (origin+pathname) of every favorite bookmark in a space's folder.
 * Used to protect favorites from bulk-close operations even if a favorite's tab id leaked
 * into temporaryTabs or its tab navigated away from the exact bookmarked URL.
 */
async function getSpaceFavoriteUrlKeys(spaceName) {
    const keys = new Set();
    try {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => !f.url && f.title === spaceName);
        if (!spaceFolder) return keys;
        const [subTree] = await chrome.bookmarks.getSubTree(spaceFolder.id);
        const walk = (node) => {
            if (!node) return;
            if (node.url) keys.add(Utils.getPinnedUrlKey(node.url));
            if (node.children) node.children.forEach(walk);
        };
        walk(subTree);
    } catch (error) {
        Logger.warn('Could not read favorite URL keys for space:', spaceName, error);
    }
    return keys;
}

async function cleanTemporaryTabs(spaceId) {
    Logger.log('Cleaning temporary tabs for space:', spaceId);
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;

    // Only close live tabs owned by this space, protecting favorite bindings.
    const ownedTabs = await getOwnedTabs(spaceId);
    const protectedIds = new Set(space.spaceBookmarks);
    const favoriteUrlKeys = await getSpaceFavoriteUrlKeys(space.name);
    const closable = ownedTabs.filter(t =>
        !protectedIds.has(t.id) && !favoriteUrlKeys.has(Utils.getPinnedUrlKey(t.url))
    );

    closable.forEach(t => chrome.tabs.remove(t.id));

    // Keep only surviving favorites.
    space.temporaryTabs = space.temporaryTabs.filter(id => protectedIds.has(id));
    saveSpaces();
}

async function handleTabCreated(tab) {
    if (!sidebarReady || isCreatingSpace || isOpeningBookmark || tab.pinned || tab.windowId !== currentWindow?.id) return;
    await pendingSpaceSaves;
    const next = await spaceRequest('get');
    await adoptStoredSpaces(next);
    const space = ownerOf(spaces, tab.id);
    if (space) await tryBindNewTabToPinnedBookmark(tab, space);
}

// Returns true if the new tab was successfully bound to an unrealized pinned
// bookmark in the given space (and thus placed into the pinned section instead of temp).
async function tryBindNewTabToPinnedBookmark(newTab, space) {
    try {
        if (!space || !newTab?.id) return false;
        const url = newTab.url || newTab.pendingUrl || '';
        if (!url) return false;
        // Skip browser-internal URLs that pinned bookmarks would never match.
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
            url.startsWith('about:') || url.startsWith('edge://') || url.startsWith('devtools://')) {
            return false;
        }
        const targetUrlKey = Utils.getPinnedUrlKey(url);
        if (!targetUrlKey) return false;

        // Cheap short-circuit before the bookmark-tree walk: an unrealized pinned
        // bookmark always renders a `.bookmark-only` placeholder. This runs only
        // for the active (rendered) space, so if there are no placeholders there's
        // nothing to bind to — skip the chrome.bookmarks traversal entirely.
        const spaceEl = document.querySelector(`[data-space-id="${space.id}"]`);
        if (spaceEl && !spaceEl.querySelector('.tab.bookmark-only')) return false;

        // Compute which bookmarks/URL keys are already realized by tabs in this space.
        const pinnedStatesById = await Utils.getPinnedTabStates();
        const claimedBookmarkIds = new Set();
        const claimedUrlKeys = new Set();
        for (const boundId of space.spaceBookmarks) {
            if (boundId === newTab.id) continue;
            const state = pinnedStatesById[boundId];
            if (state?.bookmarkId) claimedBookmarkIds.add(String(state.bookmarkId));
            try {
                const t = await chrome.tabs.get(boundId);
                if (t?.url) claimedUrlKeys.add(Utils.getPinnedUrlKey(t.url));
            } catch (e) { /* dead tab id; ignore */ }
        }

        // Locate the space's bookmark folder.
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title === space.name);
        if (!spaceFolder) return false;

        const target = await BookmarkUtils.findUnboundPinnedBookmarkByUrlKey(
            spaceFolder.id,
            targetUrlKey,
            Utils.getPinnedUrlKey.bind(Utils),
            claimedBookmarkIds,
            claimedUrlKeys
        );
        if (!target) return false;

        Logger.log('[AutoBind] Binding new tab', newTab.id, 'to unrealized pinned bookmark', target.id, target.url);

        // Capture the bookmark-only placeholder's slot BEFORE moveTabToSpace runs,
        // because moveTabToSpace will append the new element to the bottom of the
        // top-level pinned container. We want the bound tab to inherit the
        // placeholder's exact position (including folder containment).
        const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
        const targetBookmarkId = String(target.id);
        const targetUrl = target.url;
        const matchingPlaceholders = [];
        let anchorParent = null;
        let anchorNextSibling = null;
        let anchorFolder = null;
        if (spaceElement) {
            spaceElement.querySelectorAll('.tab.bookmark-only').forEach(el => {
                const matchesById = el.dataset.bookmarkId && String(el.dataset.bookmarkId) === targetBookmarkId;
                const matchesByUrl = el.dataset.url === targetUrl;
                if (matchesById || matchesByUrl) {
                    matchingPlaceholders.push(el);
                    if (!anchorParent) {
                        anchorParent = el.parentNode;
                        anchorNextSibling = el.nextSibling;
                        anchorFolder = el.closest('.folder');
                    }
                }
            });
        }

        // Move the tab into the pinned section of the space.
        await moveTabToSpace(newTab.id, space.id, true /* pinned */, newTab.openerTabId);
        await Utils.setPinnedTabState(newTab.id, { pinnedUrl: target.url, bookmarkId: target.id });

        // Reposition the newly created pinned element to the placeholder's slot,
        // then drop the placeholder(s). Done in this order so insertBefore can
        // still see the placeholder as a reference node if it happens to remain
        // as anchorNextSibling.
        if (spaceElement && anchorParent) {
            const newTabIdStr = String(newTab.id);
            let newElement = null;
            spaceElement.querySelectorAll('.tab').forEach(el => {
                if (el.dataset.tabId && String(el.dataset.tabId) === newTabIdStr && !el.classList.contains('bookmark-only')) {
                    newElement = el;
                }
            });

            const foldersToRefresh = new Set();
            if (newElement) {
                // Track the folder the new element was originally appended into (if any)
                // so we can refresh its placeholder state after we move it out.
                const formerFolder = newElement.closest('.folder');
                if (formerFolder && formerFolder !== anchorFolder) {
                    foldersToRefresh.add(formerFolder);
                }
                // Insert at the placeholder's slot. If anchorNextSibling has since
                // been removed from the DOM (defensive), fall back to appendChild.
                if (anchorNextSibling && anchorNextSibling.parentNode === anchorParent) {
                    anchorParent.insertBefore(newElement, anchorNextSibling);
                } else {
                    anchorParent.appendChild(newElement);
                }
                if (anchorFolder) foldersToRefresh.add(anchorFolder);
            }

            matchingPlaceholders.forEach(el => {
                const parentFolder = el.closest('.folder');
                if (parentFolder) foldersToRefresh.add(parentFolder);
                el.remove();
            });
            foldersToRefresh.forEach(f => updateFolderPlaceholder(f));
        }
        return true;
    } catch (e) {
        Logger.error('[AutoBind] Error while attempting to bind new tab to pinned bookmark:', e);
        return false;
    }
}


function handleTabUpdate(tabId, changeInfo, tab) {
    if (isOpeningBookmark) {
        return;
    }
    chrome.windows.getCurrent({ populate: false }, async (currentWindow) => {
        // Spaces can show tabs from every window; keep all visible rows current.
        Logger.log('Tab updated:', tabId, changeInfo, spaces);

        // Check if a temporary tab's new URL matches a pinned bookmark in the space
        if (changeInfo.url) {
            const space = spaces.find(s => s.temporaryTabs.includes(tabId));
            if (space) {
                try {
                    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
                    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
                    const spaceFolder = spaceFolders.find(f => f.title === space.name);
                    if (spaceFolder) {
                        // Try exact URL match first, then base URL match (same as loadTabs init logic)
                        let bookmarkResult = await BookmarkUtils.findBookmarkInFolderRecursive(spaceFolder.id, { url: changeInfo.url });
                        if (!bookmarkResult) {
                            // Base URL match: check all bookmarks ignoring query params/hash
                            const allBookmarks = await BookmarkUtils.getBookmarksFromFolderRecursive(spaceFolder.id);
                            const newUrlKey = Utils.getPinnedUrlKey(changeInfo.url);
                            const baseMatch = allBookmarks.find(b => Utils.getPinnedUrlKey(b.url) === newUrlKey);
                            if (baseMatch) {
                                bookmarkResult = { bookmark: baseMatch };
                            }
                        }
                        if (bookmarkResult) {
                            Logger.log('[PinnedMatch] Temp tab URL matches bookmark, promoting to pinned:', tabId, changeInfo.url);
                            // Move tab from temporaryTabs to spaceBookmarks
                            space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                            space.spaceBookmarks.push(tabId);
                            saveSpaces();

                            // Remove the temporary tab element
                            const tempTabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
                            if (tempTabEl) tempTabEl.remove();

                            // Find and replace the bookmark-only element with an active pinned tab
                            const bookmarkOnlyEl = document.querySelector(`.bookmark-only[data-bookmark-id="${bookmarkResult.bookmark.id}"]`)
                                || document.querySelector(`.bookmark-only[data-url="${bookmarkResult.bookmark.url}"]`);

                            const chromeTab = await chrome.tabs.get(tabId);
                            chromeTab.pinnedUrl = bookmarkResult.bookmark.url;
                            chromeTab.bookmarkId = bookmarkResult.bookmark.id;
                            const newTabElement = await createTabElement(chromeTab, true);

                            if (bookmarkOnlyEl) {
                                bookmarkOnlyEl.replaceWith(newTabElement);
                            } else {
                                // No bookmark-only element found — append to pinned container
                                const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
                                const pinnedContainer = spaceElement?.querySelector('[data-tab-type="pinned"]');
                                if (pinnedContainer) pinnedContainer.appendChild(newTabElement);
                            }

                            // Set pinned tab state
                            await Utils.setPinnedTabState(tabId, {
                                pinnedUrl: bookmarkResult.bookmark.url,
                                bookmarkId: bookmarkResult.bookmark.id
                            });

                            // Activate in DOM if this tab is the active Chrome tab
                            if (chromeTab.active) {
                                activateTabInDOM(tabId);
                            }

                            return; // Skip normal update handling — tab has been promoted
                        }
                    }
                } catch (err) {
                    Logger.error('[PinnedMatch] Error checking bookmark match:', err);
                }
            }
        }

        // Update tab element if it exists
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
            // Update Favicon if URL changed
            if (changeInfo.url || changeInfo.favIconUrl) {
                const img = tabElement.querySelector('img');
                if (img) {
                    img.src = tab.favIconUrl;
                    img.onerror = () => {
                        img.src = tab.favIconUrl;
                        img.onerror = () => { img.src = 'assets/default_icon.png'; }; // Fallback favicon
                    };
                }
            }

            const titleDisplay = tabElement.querySelector('.tab-title-display');
            const domainDisplay = tabElement.querySelector('.tab-domain-display');
            const titleInput = tabElement.querySelector('.tab-title-input'); // Get input element
            let displayTitle = tab.title; // Use potentially new title

            if (changeInfo.pinned !== undefined) {
                if (changeInfo.pinned) {
                    // Chrome-native-pinning a favorite must NOT delete its bookmark — the
                    // bookmark is the only durable record of the favorite. We only detach the
                    // runtime binding (remove the tab-id from the space arrays + pinned state)
                    // so the favorite persists as an unrealized bookmark and re-binds on unpin.

                    // Remove tab from all spaces data when it becomes pinned
                    spaces.forEach(space => {
                        space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
                        space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                    });
                    await Utils.removePinnedTabState(tabId);
                    saveSpaces();
                    tabElement.remove(); // Remove from space
                } else {
                    moveTabToSpace(tabId, activeSpaceId, false /* pinned */);
                }
                // Update pinned favicons for both pinning and unpinning
                updatePinnedFavicons();
            } else if (titleDisplay && domainDisplay && titleInput) { // Check if elements exist
                // Don't update if the input field is currently focused
                if (document.activeElement !== titleInput) {
                    const overrides = await Utils.getTabNameOverrides();
                    Logger.log('changeInfo', changeInfo);
                    Logger.log('overrides', overrides);
                    Logger.log('tab.url', tab.url); // Log the tab URL her
                    const override = overrides[tabId]; // Use potentially new URL
                    Logger.log('override', override); // Log the override object here
                    let displayDomain = null;
                    const pinnedUrl = tabElement.dataset.pinnedUrl || (await Utils.getPinnedTabState(tabId))?.pinnedUrl || null;
                    const isNavigatedAway = Boolean(pinnedUrl && tab.url && Utils.getPinnedUrlKey(tab.url) !== Utils.getPinnedUrlKey(pinnedUrl));

                    // Only force override title when we're still on the pinned URL.
                    if (override && !isNavigatedAway) {
                        displayTitle = override.name;
                    }
                    titleDisplay.textContent = displayTitle;

                    // Domain subtitle only when navigated away from pinned domain.
                    if (isNavigatedAway) {
                        try {
                            const pinnedDomain = new URL(pinnedUrl).hostname;
                            const currentDomain = new URL(tab.url).hostname;
                            if (currentDomain && pinnedDomain && currentDomain !== pinnedDomain) {
                                displayDomain = currentDomain;
                            }
                        } catch (e) { /* Ignore invalid URLs */ }
                    }
                    if (displayDomain) {
                        domainDisplay.textContent = displayDomain;
                        domainDisplay.style.display = 'block';
                    } else {
                        domainDisplay.style.display = 'none';
                    }
                    // Update input value only if not focused (might overwrite user typing)
                    titleInput.value = (override && !isNavigatedAway) ? override.name : tab.title;
                }
            }
            let faviconElement = tabElement.querySelector('.tab-favicon');
            if (!faviconElement) {
                // fallback to img element
                faviconElement = tabElement.querySelector('img');
            }
            if (changeInfo.url && faviconElement) {
                faviconElement.src = Utils.getFaviconUrl(changeInfo.url);
                // Do NOT auto-overwrite the pinned bookmark URL on navigation.
                // Instead, make favicon look actionable and show the Arc-like label only on favicon hover.
                tabElement.dataset.url = tab.url;
                if (tabElement.closest('[data-tab-type="pinned"]')) {
                    const pinnedUrl = tabElement.dataset.pinnedUrl || (await Utils.getPinnedTabState(tabId))?.pinnedUrl;
                    const shouldEnableBack = Boolean(pinnedUrl && tab.url && Utils.getPinnedUrlKey(tab.url) !== Utils.getPinnedUrlKey(pinnedUrl));
                    faviconElement.classList.toggle('pinned-back', shouldEnableBack);
                    faviconElement.title = shouldEnableBack ? 'Back to Pinned URL' : '';
                    const slash = tabElement.querySelector('.tab-url-changed-slash');
                    if (slash) slash.classList.toggle('visible', shouldEnableBack);
                }
            } else if (!faviconElement) {
                Logger.log('No favicon element found', faviconElement, tabElement);
            }
            // Update active state when tab's active state changes
            if (changeInfo.active !== undefined && changeInfo.active) {
                activateTabInDOM(tabId);
            }
            if (changeInfo.status == 'complete' || changeInfo.status == 'loading') {
                // Scroll to the newly created tab
                scrollToTab(tabId, 100);
            }
        }
    });
}

async function handleTabRemove(tabId) {
    Logger.log('Tab removed:', tabId);
    await Utils.removePinnedTabState(tabId);
    // Get tab element before removing it
    const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabElement) return;
    Logger.log("tabElement", tabElement);

    // Clean up the tabId from collapsedFolderShownTabs to prevent memory leaks from stale IDs.
    const parentFolder = tabElement.closest('.folder');
    if (parentFolder) {
        const shownTabIds = collapsedFolderShownTabs.get(parentFolder);
        if (shownTabIds) {
            shownTabIds.delete(tabId);
        }
    }
    // Judge pinned-ness against the space that actually OWNS the closed tab, not the
    // active space — closing a favorite in a non-active space must still convert it to a
    // bookmark-only element, and an undefined active space must not throw before cleanup.
    const owningSpace = spaces.find(s =>
        s.spaceBookmarks.includes(tabId) || s.temporaryTabs.includes(tabId)
    );
    Logger.log("owningSpace", owningSpace);
    const isPinned = owningSpace ? owningSpace.spaceBookmarks.includes(tabId) : false;
    Logger.log("isPinned", isPinned);

    if (isPinned) {
        // For pinned tabs, convert to bookmark-only element using existing bookmark data
        try {
            // Find the bookmark in Chrome bookmarks for this space
            const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
            const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            const spaceFolder = spaceFolders.find(f => f.title === owningSpace.name);

            if (spaceFolder) {
                // Try to get tab URL from Chrome API first, then fall back to DOM extraction
                let tabUrl;
                try {
                    const tabData = await chrome.tabs.get(tabId);
                    tabUrl = tabData.url;
                    Logger.log('Found tab URL from Chrome API:', tabUrl);
                } catch (error) {
                    // Tab already closed, try to extract URL from DOM or other means
                    Logger.log('Tab already closed, unable to get URL from Chrome API');
                }

                // Fallback: Extract URL from bookmark-only element's dataset if Chrome API failed
                if (!tabUrl && tabElement) {
                    Logger.log('!!!!!!!! TAB ELEMENT', tabElement);
                    if (tabElement.dataset.url) {
                        tabUrl = tabElement.dataset.url;
                        Logger.log('Extracted URL from bookmark-only element dataset:', tabUrl);
                    } else if (tabElement.classList.contains('bookmark-only')) {
                        Logger.log('Bookmark-only element found but no URL in dataset - this should not happen');
                    } else {
                        Logger.log('Real tab element found but Chrome API failed - tab may have been closed very recently');
                    }
                }

                // Use recursive search to find bookmark in space folder and all subfolders
                let matchingBookmark = null;
                if (tabUrl) {
                    Logger.log('Searching for bookmark recursively with URL:', tabUrl);
                    let bookmarkResult = await BookmarkUtils.findBookmarkInFolderRecursive(spaceFolder.id, { url: tabUrl });
                    Logger.log('Bookmark search result:', bookmarkResult);
                    matchingBookmark = bookmarkResult?.bookmark;
                }

                // If URL search failed, try fallback search by title (less reliable)
                if (!matchingBookmark) {
                    Logger.log('URL search failed, attempting fallback title search');
                    const titleElement = tabElement.querySelector('.tab-title-display, .tab-details span');
                    const titleText = titleElement?.textContent;

                    if (titleText) {
                        Logger.log('Searching for bookmark recursively with title:', titleText);
                        let bookmarkResult = await BookmarkUtils.findBookmarkInFolderRecursive(spaceFolder.id, { title: titleText });
                        Logger.log('Title search result:', bookmarkResult);
                        matchingBookmark = bookmarkResult?.bookmark;
                    }
                }

                if (matchingBookmark) {
                    // Use the established pattern from loadTabs()
                    const bookmarkTab = {
                        id: null,
                        title: matchingBookmark.title,
                        url: matchingBookmark.url,
                        favIconUrl: null,
                        spaceName: owningSpace.name
                    };
                    const bookmarkElement = await createTabElement(bookmarkTab, true, true);

                    // Preserve folder context - replace in the same DOM location
                    const parentFolder = tabElement.closest('.folder');
                    tabElement.replaceWith(bookmarkElement);
                    if (parentFolder) syncCollapsedFolderTabs(parentFolder);

                    // Update folder placeholder state if the tab was in a folder
                    if (parentFolder) {
                        Logger.log('Updated folder placeholder state after tab-to-bookmark conversion');
                        updateFolderPlaceholder(parentFolder);
                    }

                    Logger.log('Successfully converted closed pinned tab to bookmark-only element in', parentFolder ? 'folder' : 'root level');
                } else {
                    Logger.warn('Could not find matching bookmark for closed pinned tab, removing element');
                    tabElement.remove();
                }
            } else {
                Logger.warn('Could not find space folder for closed pinned tab, removing element');
                tabElement.remove();
            }
        } catch (error) {
            Logger.error('Error converting pinned tab to bookmark-only element:', error);
            // Fallback: just remove the element
            tabElement.remove();
        }
    } else {
        // If not a pinned tab, remove the element
        tabElement?.remove();
    }

    // Remove tab from spaces
    spaces.forEach(space => {
        space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
        space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
    });

    saveSpaces();

    // Update pinned favicons to show/hide placeholder when last pinned tab is removed
    updatePinnedFavicons();
}

// Prevent overlapping membership changes for the same tab.
const processingTabMoves = new Set();

function handleTabActivated(activeInfo) {
    if (isCreatingSpace) {
        Logger.log('Skipping tab creation handler - space is being created');
        return;
    }
    chrome.windows.getCurrent({ populate: false }, async (currentWindow) => {
        if (activeInfo.windowId !== currentWindow.id) {
            Logger.log('New tab is in a different window, ignoring...');
            return;
        }

        Logger.log('Tab activated:', activeInfo);
        activeChromeTabId = activeInfo.tabId;
        // Find which space contains this tab
        const spaceWithTab = spaces.find(space =>
            space.spaceBookmarks.includes(activeInfo.tabId) ||
            space.temporaryTabs.includes(activeInfo.tabId)
        );
        Logger.log("found space", spaceWithTab);

        if (spaceWithTab) {
            spaceWithTab.lastTab = activeInfo.tabId;
            saveSpaces();
            Logger.log("lasttab space", spaces);
        }

        if (spaceWithTab && spaceWithTab.id !== activeSpaceId) {
            // Switch to the space containing the tab
            activeSpaceId = spaceWithTab.id;
            await activateSpaceInDOM(spaceWithTab.id, spaces, updateSpaceSwitcher);
            await refreshActiveSpaceUI();
            activateTabInDOM(activeInfo.tabId);
        } else {
            // Activate only the tab in the current space
            activateTabInDOM(activeInfo.tabId);
        }

        // Arc-like behavior: if this tab is inside a collapsed folder, add it to the folder's shown tabs set.
        // This makes the tab stay visible in the collapsed folder until user manually opens/closes the folder.
        if (!showAllOpenTabsInCollapsedFolders) {
            const tabElement = document.querySelector(`.tab[data-tab-id="${activeInfo.tabId}"]`);
            if (tabElement) {
                const parentFolder = tabElement.closest('.folder');
                if (parentFolder && parentFolder.classList.contains('collapsed')) {
                    let shownTabIds = collapsedFolderShownTabs.get(parentFolder);
                    if (!shownTabIds) {
                        shownTabIds = new Set();
                        collapsedFolderShownTabs.set(parentFolder, shownTabIds);
                    }
                    shownTabIds.add(activeInfo.tabId);
                }
            }
        }

        // Update collapsed-folder projections to follow Arc behavior (active-only) unless user enabled "show all open".
        syncCollapsedFoldersInActiveSpace();

        // Scroll to the activated tab's location
        scrollToTab(activeInfo.tabId, 0);
    });
}

async function deleteSpace(spaceId) {
    Logger.log('Deleting space:', spaceId);
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
        // Close live tabs owned by the deleted space.
        const ownedTabs = await getOwnedTabs(spaceId);

        // Remove space from array
        spaces = spaces.filter(s => s.id !== spaceId);
        await saveSpaces();
        if (ownedTabs.length) await chrome.tabs.remove(ownedTabs.map(t => t.id));

        // Remove space element from DOM
        const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
        if (spaceElement) {
            spaceElement.remove();
        }

        // If this was the active space, switch to another space
        if (activeSpaceId === spaceId && spaces.length > 0) {
            await setActiveSpace(spaces[0].id);
        }

        // Delete bookmark folder for this space
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title === space.name);
        // Clean up the durable registry entry keyed by the folder id (before removing folder).
        const folderIdToForget = space.bookmarkFolderId ?? spaceFolder?.id;
        if (folderIdToForget) await LocalStorage.removeSpaceRegistryEntry(folderIdToForget);
        if (spaceFolder) await chrome.bookmarks.removeTree(spaceFolder.id);

        // Save changes
        saveSpaces();
        await updateSpaceSwitcher();
    }
}

////////////////////////////////////////////////////////////////
// -- Helper Functions
////////////////////////////////////////////////////////////////

/**
 * Scrolls to make a tab visible in the sidebar
 * @param {number} tabId - The ID of the tab to scroll to
 * @param {number} timeout - Timeout in milliseconds to wait before scrolling
 */
function scrollToTab(tabId, timeout = 0) {
    setTimeout(() => {
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
            const spaceElement = tabElement.closest('[data-space-id]');
            if (spaceElement) {
                const spaceContent = spaceElement.querySelector('.space-content');
                if (spaceContent) {
                    const tabRect = tabElement.getBoundingClientRect();
                    const spaceContentRect = spaceContent.getBoundingClientRect();

                    // Check if the tab is visible in the space content
                    const isTabVisible = tabRect.top >= spaceContentRect.top && tabRect.bottom <= spaceContentRect.bottom;

                    if (!isTabVisible) {
                        Logger.log('[ScrollDebug] Scrolling to show tab');
                        // Scroll to make the tab visible
                        const scrollTop = spaceContent.scrollTop + (tabRect.top - spaceContentRect.top);
                        spaceContent.scrollTop = scrollTop;
                    } else {
                        Logger.log('[ScrollDebug] Tab is already visible, no scroll needed');
                    }
                } else {
                    Logger.log('[ScrollDebug] Space content not found, no scroll needed');
                }
            } else {
                Logger.log('[ScrollDebug] Space not found, no scroll needed');
            }
        } else {
            Logger.log('[ScrollDebug] Tab not found, no scroll needed');
        }
    }, timeout);
}

async function moveTabToSpace(tabId, spaceId, pinned = false, openerTabId = null) {
    if (!spaces.some(s => s.id === spaceId)) return;
    processingTabMoves.add(tabId);
    try {
    // Remove tab from its original space data first
    const sourceSpace = spaces.find(s =>
        s.temporaryTabs.includes(tabId) || s.spaceBookmarks.includes(tabId)
    );
    if (sourceSpace && sourceSpace.id !== spaceId) {
        sourceSpace.temporaryTabs = sourceSpace.temporaryTabs.filter(id => id !== tabId);
        sourceSpace.spaceBookmarks = sourceSpace.spaceBookmarks.filter(id => id !== tabId);
        sourceSpace.lastTab = null;
    }

    // 1. Find the target space
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
        Logger.warn(`Space with ID ${spaceId} not found.`);
        return;
    }

    // 3. Update local space data
    // Remove tab from both arrays just in case
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
    space.lastTab = tabId;

    if (pinned) {
        space.spaceBookmarks.push(tabId);
    } else {
        const openerIndex = space.temporaryTabs.indexOf(openerTabId);
        if (openerIndex >= 0) space.temporaryTabs.splice(openerIndex + 1, 0, tabId);
        else space.temporaryTabs.push(tabId);
    }

    // 4. Update the UI (remove tab element from old section, create it in new section)
    // Remove any existing DOM element for this tab
    const oldTabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    oldTabElement?.remove();

    // Add a fresh tab element if needed
    const spaceElement = document.querySelector(`[data-space-id="${spaceId}"]`);
    if (spaceElement) {
        const containerSelector = pinned ? '[data-tab-type="pinned"]' : '[data-tab-type="temporary"]';
        const container = spaceElement.querySelector(containerSelector);

        const chromeTab = await chrome.tabs.get(tabId);
        const tabElement = await createTabElement(chromeTab, pinned);
        if (container.children.length > 1) {
            if (openerTabId) {
                let tabs = container.querySelectorAll(`.tab`);
                const openerTabIndex = Array.from(tabs).findIndex(tab => tab.dataset.tabId == openerTabId);
                if (openerTabIndex + 1 < tabs.length) {
                    const tabToInsertBefore = tabs[openerTabIndex + 1];
                    container.insertBefore(tabElement, tabToInsertBefore);
                } else {
                    container.appendChild(tabElement);
                }
            } else {
                if (pinned) {
                    // Add to the bottom after all existing elements
                    container.appendChild(tabElement);
                } else {
                    // Render temporary tabs in extension order
                    const ownedTabs = await getOwnedTabs(spaceId);
                    const currentTabIndex = ownedTabs.findIndex(t => t.id === tabId);

                    if (currentTabIndex !== -1 && ownedTabs.length > 1) {
                        // First, add the new tab element to the container so it can be found in the filter
                        container.appendChild(tabElement);

                        // Filter to only include tabs in the temporary container (including the new one)
                        const tabsInContainer = ownedTabs.filter(t => {
                            return container.querySelector(`[data-tab-id="${t.id}"]`);
                        });

                        // Apply invert order if enabled
                        const invertTabOrder = await Utils.getInvertTabOrder();
                        if (invertTabOrder) {
                            tabsInContainer.reverse();
                        }

                        // Re-append all tabs in correct order (including the new one)
                        tabsInContainer.forEach(t => {
                            const el = container.querySelector(`[data-tab-id="${t.id}"]`);
                            if (el) {
                                container.appendChild(el);
                            }
                        });
                    } else {
                        // Fallback: use simple insert logic
                        const invertTabOrder = await Utils.getInvertTabOrder();
                        if (invertTabOrder) {
                            container.insertBefore(tabElement, container.firstChild);
                        } else {
                            container.appendChild(tabElement);
                        }
                    }
                }
            }
        } else {
            container.appendChild(tabElement);
        }
    }

    // 5. Save the updated spaces to storage
    saveSpaces();
    } finally {
        // Always release the processing lock, even on the early `space not found`
        // return or any throw above — otherwise future moves for this tab are ignored.
        processingTabMoves.delete(tabId);
    }
}

// Tab navigation functions delegate to Utils to avoid code duplication
async function movToNextTabInSpace(tabId, sourceSpace) {
    return Utils.movToNextTabInSpace(tabId, sourceSpace);
}

async function movToPrevTabInSpace(tabId, sourceSpace) {
    return Utils.movToPrevTabInSpace(tabId, sourceSpace);
}
// Reusable function to set up folder context menu
function setupFolderContextMenu(folderElement, space, item = null) {
    folderElement.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const contextMenu = document.createElement('div');
        contextMenu.classList.add('context-menu');
        contextMenu.style.position = 'fixed';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;

        const spaceElement = folderElement.closest('.space');
        const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(space.name);
        const folderId = folderElement.dataset.bookmarkId;
        if (folderId && await canCreateFolder(spaceFolder.id, folderId)) {
            const newFolderOption = document.createElement('div');
            newFolderOption.classList.add('context-menu-item');
            newFolderOption.textContent = 'New Folder';
            newFolderOption.addEventListener('click', async () => {
                contextMenu.remove();
                await createNewFolder(spaceElement, folderElement);
            });
            contextMenu.appendChild(newFolderOption);
        }

        const deleteOption = document.createElement('div');
        deleteOption.classList.add('context-menu-item');
        deleteOption.textContent = 'Delete Folder';
        deleteOption.addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete this folder and all its contents?')) {
                if (folderId) await chrome.bookmarks.removeTree(folderId);
                const parentFolder = folderElement.parentElement.closest('.folder');
                folderElement.remove();
                if (parentFolder) updateFolderPlaceholder(parentFolder);
                updatePinnedSectionPlaceholders();
            }
            contextMenu.remove();
        });

        contextMenu.appendChild(deleteOption);
        document.body.appendChild(contextMenu);

        // Close context menu when clicking outside
        const closeContextMenu = (e) => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.remove();
                document.removeEventListener('click', closeContextMenu);
            }
        };
        document.addEventListener('click', closeContextMenu);
    });
}
