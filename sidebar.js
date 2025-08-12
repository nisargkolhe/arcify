/**
 * Sidebar - Main extension UI and tab/space management
 * 
 * Purpose: Implements Arc-like vertical tab organization with spaces (Chrome tab groups)
 * Key Functions: Space creation/management, tab organization, drag-and-drop, archived tabs, spotlight integration
 * Architecture: Side panel UI that syncs with Chrome's native tab groups API
 * 
 * Critical Notes:
 * - Primary user interface for tab and space management
 * - Real-time sync with Chrome tab groups and active tab changes
 * - Handles drag-and-drop for tab/space reorganization
 * - Integrates with spotlight system for search functionality
 * - Manages archived tabs and auto-archive settings
 */

import { ChromeHelper } from './chromeHelper.js';
import { FOLDER_CLOSED_ICON, FOLDER_OPEN_ICON } from './icons.js';
import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';
import { BookmarkUtils } from './bookmark-utils.js';
import { setupDOMElements, showSpaceNameInput, activateTabInDOM, activateSpaceInDOM, showTabContextMenu, showArchivedTabsPopup, setupQuickPinListener } from './domManager.js';

// Constants
const MouseButton = {
    LEFT: 0,
    MIDDLE: 1,
    RIGHT: 2
};

// DOM Elements
const spacesList = document.getElementById('spacesList');
const spaceSwitcher = document.getElementById('spaceSwitcher');
const addSpaceBtn = document.getElementById('addSpaceBtn');
const newTabBtn = document.getElementById('newTabBtn');
const spaceTemplate = document.getElementById('spaceTemplate');

// Global state
let spaces = [];
let activeSpaceId = null;
let isCreatingSpace = false;
let isOpeningBookmark = false;
let isDraggingTab = false;
let currentWindow = null;
let defaultSpaceName = 'Home';

// Helper function to update bookmark for a tab
async function updateBookmarkForTab(tab, bookmarkTitle) {
    console.log("updating bookmark", tab, bookmarkTitle);
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

    for (const spaceFolder of spaceFolders) {
        console.log("looking for space folder", spaceFolder);
        const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
        console.log("looking for bookmarks", bookmarks);
        const bookmark = BookmarkUtils.findBookmarkByUrl(bookmarks, tab.url);
        if (bookmark) {
            await chrome.bookmarks.update(bookmark.id, {
                title: bookmarkTitle,
                url: tab.url
            });
        }
    }

}

console.log("hi");

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
            faviconElement.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.pinned-favicon').forEach(t => t.classList.remove('active'));
                // Add active class to clicked tab
                faviconElement.classList.add('active');
                chrome.tabs.update(tab.id, { active: true });
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

    // Add drag and drop event listeners
    pinnedFavicons.addEventListener('dragover', e => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    });

    pinnedFavicons.addEventListener('dragleave', e => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
    });

    pinnedFavicons.addEventListener('drop', async e => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const draggingElement = document.querySelector('.dragging');
        if (draggingElement && draggingElement.dataset.tabId) {
            const tabId = parseInt(draggingElement.dataset.tabId);
            await chrome.tabs.update(tabId, { pinned: true });
            updatePinnedFavicons();
            // Remove the tab from its original container
            draggingElement.remove();
        }
    });
}

// Utility function to activate a pinned tab by URL (reuses existing bookmark opening logic)
async function activatePinnedTabByURL(bookmarkUrl, targetSpaceId, spaceName) {
    console.log('[PinnedTabActivator] Activating pinned tab:', bookmarkUrl, targetSpaceId, spaceName);
    
    try {
        // Try to find existing tab with this URL
        const tabs = await chrome.tabs.query({});
        const existingTab = BookmarkUtils.findTabByUrl(tabs, bookmarkUrl);
        
        if (existingTab) {
            console.log('[PinnedTabActivator] Found existing tab, switching to it:', existingTab.id);
            // Tab already exists, just switch to it and highlight
            chrome.tabs.update(existingTab.id, { active: true });
            activateTabInDOM(existingTab.id);
            
            // Store last active tab for the space
            const space = spaces.find(s => s.id === existingTab.groupId);
            if (space) {
                space.lastTab = existingTab.id;
                saveSpaces();
            }
        } else {
            console.log('[PinnedTabActivator] No existing tab found, opening bookmark');
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
                spaceName: spaceName
            };

            // Prepare context for BookmarkUtils
            const context = {
                spaces,
                activeSpaceId,
                currentWindow,
                saveSpaces,
                createTabElement,
                activateTabInDOM,
                Utils
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
        console.error("[PinnedTabActivator] Error activating pinned tab:", error);
        isOpeningBookmark = false;
    }
}

// Initialize the sidebar when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing sidebar...');
    initSidebar();
    updatePinnedFavicons(); // Initial load of pinned favicons

    // Add Chrome tab event listeners
    chrome.tabs.onCreated.addListener(handleTabCreated);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        handleTabUpdate(tabId, changeInfo, tab);
        if (tab.pinned) updatePinnedFavicons(); // Update favicons when a tab is pinned/unpinned
    });
    chrome.tabs.onRemoved.addListener(handleTabRemove);
    // chrome.tabs.onMoved.addListener(handleTabMove);
    chrome.tabs.onActivated.addListener(handleTabActivated);

    // Setup Quick Pin listener
    setupQuickPinListener(moveTabToSpace, moveTabToPinned, moveTabToTemp, activeSpaceId, setActiveSpace, activatePinnedTabByURL);

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

async function initSidebar() {
    console.log('Initializing sidebar...');
    let settings = await Utils.getSettings();
    if (settings.defaultSpaceName) {
        defaultSpaceName = settings.defaultSpaceName;
    }
    try {
        currentWindow = await chrome.windows.getCurrent({populate: false});

        let tabGroups = await chrome.tabGroups.query({});
        let allTabs = await chrome.tabs.query({currentWindow: true});
        console.log("tabGroups", tabGroups);
        console.log("allTabs", allTabs);

        // Check for duplicates
        await LocalStorage.mergeDuplicateSpaceFolders();

        // Create bookmarks folder for spaces if it doesn't exist
        const spacesFolder = await LocalStorage.getOrCreateArcifyFolder();
        console.log("spacesFolder", spacesFolder);
        const subFolders = await chrome.bookmarks.getChildren(spacesFolder.id);
        console.log("subFolders", subFolders);
        if (tabGroups.length === 0) {
            let currentTabs = allTabs.filter(tab => tab.id && !tab.pinned) ?? [];

            if (currentTabs.length == 0) {
                await chrome.tabs.create({ active: true });
                allTabs = await chrome.tabs.query({});
                currentTabs = allTabs.filter(tab => tab.id && !tab.pinned) ?? [];
            }

            // Create default tab group and move all tabs to it
            console.log('currentTabs', currentTabs);
            const groupId = await chrome.tabs.group({tabIds: currentTabs.map(tab => tab.id)});
            const groupColor = await Utils.getTabGroupColor(defaultSpaceName);
            await chrome.tabGroups.update(groupId, {title: defaultSpaceName, color: groupColor});

            // Create default space with UUID
            const defaultSpace = {
                id: groupId,
                uuid: Utils.generateUUID(),
                name: defaultSpaceName,
                color: groupColor,
                spaceBookmarks: [],
                temporaryTabs: currentTabs.map(tab => tab.id),
            };

            // Create bookmark folder for space bookmarks using UUID
            const bookmarkFolder = subFolders.find(f => !f.url && f.title == defaultSpaceName);
            if (!bookmarkFolder) {
                await chrome.bookmarks.create({
                    parentId: spacesFolder.id,
                    title: defaultSpaceName
                });
            }

            spaces = [defaultSpace];
            saveSpaces();
            createSpaceElement(defaultSpace);
            await setActiveSpace(defaultSpace.id);
        } else {
            // Find tabs that aren't in any group
            const ungroupedTabs = allTabs.filter(tab => tab.groupId === -1 && !tab.pinned);
            let defaultGroupId = null;

            // If there are ungrouped tabs, check for existing Default group or create new one
            if (ungroupedTabs.length > 0) {
                console.log("found ungrouped tabs", ungroupedTabs);
                const defaultGroup = tabGroups.find(group => group.title === defaultSpaceName);
                if (defaultGroup) {
                    console.log("found existing default group", defaultGroup);
                    if (defaultGroup.windowId === currentWindow.id) {
                        // Move ungrouped tabs to existing Default group
                        await chrome.tabs.group({tabIds: ungroupedTabs.map(tab => tab.id), groupId: defaultGroup.id});
                    } else {
                        // Create new Default group
                        defaultGroupId = await chrome.tabs.group({tabIds: ungroupedTabs.map(tab => tab.id)});
                        await chrome.tabGroups.update(defaultGroupId, {title: defaultSpaceName+currentWindow.id, color: 'grey'});
                    }
                } else {
                    // Create new Default group
                    defaultGroupId = await chrome.tabs.group({tabIds: ungroupedTabs.map(tab => tab.id)});
                    await chrome.tabGroups.update(defaultGroupId, {title: defaultSpaceName, color: 'grey'});
                }
            }

            tabGroups = await chrome.tabGroups.query({});

            // Load existing tab groups as spaces
            spaces = await Promise.all(tabGroups.map(async group => {
                const tabs = await chrome.tabs.query({groupId: group.id});
                console.log("processing group", group);

                const mainFolder = await chrome.bookmarks.getSubTree(spacesFolder.id);
                const bookmarkFolder = mainFolder[0].children?.find(f => f.title == group.title);
                console.log("looking for existing folder", group.title, mainFolder, bookmarkFolder);
                let spaceBookmarks = [];
                if (!bookmarkFolder) {
                    console.log("creating new folder", group.title)
                    await chrome.bookmarks.create({
                        parentId: spacesFolder.id,
                        title: group.title
                    });
                } else {
                    console.log("found folder", group.title)
                    // Loop over bookmarks in the folder and add them to spaceBookmarks if there's an open tab

                    spaceBookmarks = await BookmarkUtils.matchTabsWithBookmarks(bookmarkFolder, group.id, Utils.setTabNameOverride.bind(Utils));
                    // Remove null values from spaceBookmarks
                    spaceBookmarks = spaceBookmarks.filter(id => id !== null);

                    console.log("space bookmarks in", group.title, spaceBookmarks);
                }
                const space = {
                    id: group.id,
                    uuid: Utils.generateUUID(),
                    name: group.title,
                    color: group.color,
                    spaceBookmarks: spaceBookmarks,
                    temporaryTabs: tabs.filter(tab => !spaceBookmarks.includes(tab.id)).map(tab => tab.id)
                };

                return space;
            }));
            spaces.forEach(space => createSpaceElement(space));
            console.log("initial save", spaces);
            saveSpaces();

            let activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTabs.length > 0) {
                const activeTab = activeTabs[0];
                if (activeTab.pinned) {
                    await setActiveSpace(spaces[0].id, false);
                    updatePinnedFavicons();
                } else {
                    await setActiveSpace(activeTab.groupId, false);
                }
            } else {
                await setActiveSpace(defaultGroupId ?? spaces[0].id);
            }
        }
    } catch (error) {
        console.error('Error initializing sidebar:', error);
    }

    setupDOMElements(createNewSpace);
}

function createSpaceElement(space) {
    console.log('Creating space element for:', space.id);
    const spaceElement = spaceTemplate.content.cloneNode(true);
    const sidebarContainer = document.getElementById('sidebar-container');
    const spaceContainer = spaceElement.querySelector('.space');
    spaceContainer.dataset.spaceId = space.id;
    spaceContainer.style.display = space.id === activeSpaceId ? 'flex' : 'none';
    spaceContainer.dataset.spaceUuid = space.id;

    // Set space background color based on the tab group color
    sidebarContainer.style.setProperty('--space-bg-color', `var(--chrome-${space.color}-color, rgba(255, 255, 255, 0.1))`);
    sidebarContainer.style.setProperty('--space-bg-color-dark', `var(--chrome-${space.color}-color-dark, rgba(255, 255, 255, 0.1))`);

    // Set up color select
    const colorSelect = spaceElement.getElementById('spaceColorSelect');
    colorSelect.value = space.color;
    colorSelect.addEventListener('change', async () => {
        const newColor = colorSelect.value;
        space.color = newColor;

        // Update tab group color
        await chrome.tabGroups.update(space.id, { color: newColor });

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

        const tabGroups = await chrome.tabGroups.query({});
        const tabGroupForSpace = tabGroups.find(group => group.id === space.id);
        console.log("updating tabGroupForSpace", tabGroupForSpace);
        if (tabGroupForSpace) {
            await chrome.tabGroups.update(tabGroupForSpace.id, {title: nameInput.value, color: 'grey'});
        }

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

    // Set up drag and drop
    setupDragAndDrop(pinnedContainer, tempContainer);

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
    loadTabs(space, pinnedContainer, tempContainer);

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
}

async function updateSpaceSwitcher() {
    console.log('Updating space switcher...');
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
            const draggedSpaceId = parseInt(draggedButton.dataset.spaceId);
            let targetSpaceId = targetElement ? parseInt(targetElement.dataset.spaceId) : null;

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
            console.log("droppedat", newIndex);

            if (newIndex < 0) {
                newIndex = 0;
            } else if (newIndex > spaces.length) {
                newIndex = spaces.length;
            }
            console.log("set", newIndex);

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

            console.log("clicked for active", space);
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
        if(spaces.find(space => space.name == spaceFolder.title)) {
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

function getDragAfterElementSwitcher(container, x) {
    const draggableElements = [...container.querySelectorAll('button:not(.dragging-switcher)')]; // Select only non-dragging buttons

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        // *** Calculate offset based on X axis (left and width) ***
        const offset = x - box.left - box.width / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.tab:not(.dragging), .folder:not(.dragging)')]

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child }
        } else {
            return closest
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element
}

async function setActiveSpace(spaceId, updateTab = true) {
    console.log('Setting active space:', spaceId);

    // Update global state
    activeSpaceId = spaceId;

    // Centralize logic in our new helper function
    await activateSpaceInDOM(spaceId, spaces, updateSpaceSwitcher);

    let tabGroups = await chrome.tabGroups.query({});
    let tabGroupsToClose = tabGroups.filter(group => group.id !== spaceId);
    tabGroupsToClose.forEach(async group => {
        await chrome.tabGroups.update(group.id, {collapsed: true})
    });

    const tabGroupForSpace = tabGroups.find(group => group.id === spaceId);
    if (!tabGroupForSpace) {
        isCreatingSpace = true;
        const space = spaces.find(s => s.id === spaceId);
        const newTab = await ChromeHelper.createNewTab();
        const groupId = await ChromeHelper.createNewTabGroup(newTab, space.name, space.color);

        // update spaceId with new groupId
        spaces = spaces.map(s => {
            if (s.id === spaceId) {
                return { ...s, id: groupId };
            }
            return s;
        });
        saveSpaces();
        isCreatingSpace = false;
    } else {
        // Uncollpase space's tab group
        await chrome.tabGroups.update(spaceId, {collapsed: false})

        // Get all tabs in the space and activate the last one
        if (updateTab) {
            const space = spaces.find(s => s.id === parseInt(spaceId));
            console.log("updateTab space",space);
            chrome.tabs.query({ groupId: spaceId }, tabs => {
                if (tabs.length > 0) {
                    const lastTab = space.lastTab ?? tabs[tabs.length - 1].id;
                    chrome.tabs.update(lastTab, { active: true });
                    activateTabInDOM(lastTab);
                }
            });
        }
    }
}

async function createSpaceFromInactive(spaceName, tabToMove) {
    console.log(`Creating inactive space "${spaceName}" with tab:`, tabToMove);
    isCreatingSpace = true;
    try {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title === spaceName);

        if (!spaceFolder) {
            console.error(`Bookmark folder for inactive space "${spaceName}" not found.`);
            return;
        }

        const groupColor = await Utils.getTabGroupColor(spaceName);
        const groupId = await ChromeHelper.createNewTabGroup(tabToMove, spaceName, groupColor);
        const spaceBookmarks = await BookmarkUtils.matchTabsWithBookmarks(spaceFolder, groupId, Utils.setTabNameOverride.bind(Utils));

        const space = {
            id: groupId,
            uuid: Utils.generateUUID(),
            name: spaceName,
            color: groupColor,
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
        console.error(`Error creating space from inactive bookmark:`, error);
    } finally {
        isCreatingSpace = false;
    }
}

function saveSpaces() {
    console.log('Saving spaces to storage...', spaces);
    chrome.storage.local.set({ spaces }, () => {
        console.log('Spaces saved successfully');
    });
}

async function moveTabToPinned(space, tab) {
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tab.id);
    if (!space.spaceBookmarks.includes(tab.id)) {
        space.spaceBookmarks.push(tab.id);
    }
    const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(space.name);
    const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
    const existingBookmark = BookmarkUtils.findBookmarkByUrl(bookmarks, tab.url);
    if (!existingBookmark) {
        // delete existing bookmark
        await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url);

        await chrome.bookmarks.create({
            parentId: spaceFolder.id,
            title: tab.title,
            url: tab.url
        });
    }
    
    // Update chevron state after moving tab to pinned
    const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
    if (spaceElement) {
        const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
        updateChevronState(spaceElement, pinnedContainer);
    }
}

async function moveTabToTemp(space, tab) {
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    const spaceFolder = spaceFolders.find(f => f.title === space.name);

    if (spaceFolder) {
        await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url);
    }

    // Move tab from bookmarks to temporary tabs in space data
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tab.id);
    if (!space.temporaryTabs.includes(tab.id)) {
        space.temporaryTabs.push(tab.id);
    }

    saveSpaces();
    
    // Update chevron state after moving tab from pinned
    const spaceElement = document.querySelector(`[data-space-id="${space.id}"]`);
    if (spaceElement) {
        const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
        updateChevronState(spaceElement, pinnedContainer);
    }
}

async function setupDragAndDrop(pinnedContainer, tempContainer) {
    console.log('Setting up drag and drop handlers...');
    [pinnedContainer, tempContainer].forEach(container => {
        container.addEventListener('dragover', e => {
            e.preventDefault();
            const draggingElement = document.querySelector('.dragging');
            if (draggingElement) {
                const targetFolder = e.target.closest('.folder-content');
                const targetContainer = targetFolder || container;

                // Get the element we're dragging over
                const afterElement = getDragAfterElement(targetContainer, e.clientY);
                if (afterElement) {
                    targetContainer.insertBefore(draggingElement, afterElement);
                } else {
                    targetContainer.appendChild(draggingElement);
                }

                // Handle tab being moved to pinned section or folder
                if (container.dataset.tabType === 'pinned' && draggingElement.dataset.tabId && !isDraggingTab) {
                    console.log("Tab dragged to pinned section or folder");
                    isDraggingTab = true;
                    const tabId = parseInt(draggingElement.dataset.tabId);
                    chrome.tabs.get(tabId, async (tab) => {
                        const spaceId = container.closest('.space').dataset.spaceId;
                        const space = spaces.find(s => s.id === parseInt(spaceId));

                        if (space && tab) {
                            // Move tab from temporary to pinned in space data
                            space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                            if (!space.spaceBookmarks.includes(tabId)) {
                                space.spaceBookmarks.push(tabId);
                            }

                            // Determine the target folder or container
                            const targetFolderContent = draggingElement.closest('.folder-content');
                            const targetFolder = targetFolderContent ? targetFolderContent.closest('.folder') : null;

                            // Add to bookmarks if URL doesn't exist
                            const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(space.name);
                            if (spaceFolder) {
                                let parentId = spaceFolder.id;
                                if (targetFolder) {
                                    console.log("moving into a folder");
                                    const folderElement = targetFolder.closest('.folder');
                                    const folderName = folderElement.querySelector('.folder-name').value;
                                    const existingFolders = await chrome.bookmarks.getChildren(spaceFolder.id);
                                    let folder = existingFolders.find(f => f.title === folderName);
                                    if (!folder) {
                                        folder = await chrome.bookmarks.create({
                                            parentId: spaceFolder.id,
                                            title: folderName
                                        });
                                    }
                                    parentId = folder.id;

                                    // Check if bookmark already exists in the target folder
                                    const existingBookmarks = await chrome.bookmarks.getChildren(parentId);
                                    if (BookmarkUtils.findBookmarkByUrl(existingBookmarks, tab.url)) {
                                        console.log('Bookmark already exists in folder:', folderName);
                                        isDraggingTab = false;
                                        return;
                                    }

                                    // Find and remove the bookmark from its original location
                                    await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url);

                                    // Create the bookmark in the new location
                                    await chrome.bookmarks.create({
                                        parentId: parentId,
                                        title: tab.title,
                                        url: tab.url
                                    });

                                    // hide placeholder
                                    const placeHolderElement = folderElement.querySelector('.tab-placeholder');
                                    if (placeHolderElement) {
                                        console.log("hiding from", folderElement);
                                        placeHolderElement.classList.add('hidden');
                                    }
                                } else {
                                    await moveTabToPinned(space, tab);
                                }
                            }

                            saveSpaces();
                        }
                        isDraggingTab = false;
                    });
                } else if (container.dataset.tabType === 'temporary' && draggingElement.dataset.tabId && !isDraggingTab) {
                    console.log("Tab dragged to temporary section");
                    isDraggingTab = true;
                    const tabId = parseInt(draggingElement.dataset.tabId);
                    chrome.tabs.get(tabId, async (tab) => {
                        const space = spaces.find(s => s.id === parseInt(activeSpaceId));

                        if (space && tab) {
                            // Remove tab from bookmarks if it exists
                            moveTabToTemp(space, tab);
                        }
                        isDraggingTab = false;
                    });
                } else if(draggingElement && draggingElement.classList.contains('pinned-favicon') && draggingElement.dataset.tabId) {
                    const tabId = parseInt(draggingElement.dataset.tabId);
                    chrome.tabs.update(tabId, { pinned: false });
                }
            }
        });
    });
}

async function createNewFolder(spaceElement) {
    const pinnedContainer = spaceElement.querySelector('[data-tab-type="pinned"]');
    const folderTemplate = document.getElementById('folderTemplate');
    const newFolder = folderTemplate.content.cloneNode(true);
    const folderElement = newFolder.querySelector('.folder');
    const folderHeader = folderElement.querySelector('.folder-header');
    const folderTitle = folderElement.querySelector('.folder-title');
    const folderNameInput = folderElement.querySelector('.folder-name');
    const folderIcon = folderElement.querySelector('.folder-icon');
    const folderToggle = folderElement.querySelector('.folder-toggle');
    const folderContent = folderElement.querySelector('.folder-content');

    // Open new folder by default
    folderElement.classList.toggle('collapsed');
    folderContent.classList.toggle('collapsed');
    folderToggle.classList.toggle('collapsed');

    // Set up initial display for new folder
    folderNameInput.style.display = 'inline-block';
    folderTitle.style.display = 'none';

    folderHeader.addEventListener('click', () => {
        folderElement.classList.toggle('collapsed');
        folderContent.classList.toggle('collapsed');
        folderToggle.classList.toggle('collapsed');
        folderIcon.innerHTML = folderElement.classList.contains('collapsed') ? FOLDER_CLOSED_ICON : FOLDER_OPEN_ICON;
    });

    // Set up folder name input
    folderNameInput.addEventListener('change', async () => {
        const spaceName = spaceElement.querySelector('.space-name').value;
        const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(spaceName);
        const existingFolders = await chrome.bookmarks.getChildren(spaceFolder.id);
        const folder = existingFolders.find(f => f.title === folderNameInput.value);
        if (!folder) {
            await chrome.bookmarks.create({
                parentId: spaceFolder.id,
                title: folderNameInput.value
            });
            folderNameInput.style.display = 'none';
            folderTitle.innerHTML = folderNameInput.value;
            folderTitle.style.display = 'inline';
        }
    });

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
        if (save) {
            const newName = folderNameInput.value.trim();
            if (newName) {
                const spaceName = spaceElement.querySelector('.space-name').value;
                const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(spaceName);
                const existingFolders = await chrome.bookmarks.getChildren(spaceFolder.id);
                const folder = existingFolders.find(f => f.title === newName);
                if (!folder) {
                    await chrome.bookmarks.create({
                        parentId: spaceFolder.id,
                        title: newName
                    });
                }
            }
        }
        // Update display regardless of save/cancel
        folderNameInput.style.display = 'none';
        folderTitle.innerHTML = folderNameInput.value || 'Untitled';
        folderTitle.style.display = 'inline';
    };

    folderNameInput.addEventListener('blur', () => saveOrCancelNewFolderEdit(true));
    folderNameInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            await saveOrCancelNewFolderEdit(true);
            folderNameInput.blur();
        } else if (e.key === 'Escape') {
            await saveOrCancelNewFolderEdit(false);
            folderNameInput.blur();
        }
    });

    // Add the new folder to the pinned container
    pinnedContainer.appendChild(folderElement);
    folderNameInput.focus();
}

async function loadTabs(space, pinnedContainer, tempContainer) {
    console.log('Loading tabs for space:', space.id);
    console.log('Space bookmarks in space:', space.spaceBookmarks);

    var bookmarkedTabURLs = [];
    try {
        const tabs = await chrome.tabs.query({});
        const pinnedTabs = await chrome.tabs.query({ pinned: true });
        const pinnedUrls = new Set(pinnedTabs.map(tab => tab.url));

        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const spaceFolder = spaceFolders.find(f => f.title == space.name);

        if (spaceFolder) {
            // Recursive function to process bookmarks and folders
            async function processBookmarkNode(node, container) {
                const bookmarks = await chrome.bookmarks.getChildren(node.id);
                console.log('Processing bookmarks:', bookmarks);
                const processedUrls = new Set();

                for (const item of bookmarks) {
                    if (!item.url) {
                        // This is a folder
                        const folderTemplate = document.getElementById('folderTemplate');
                        const newFolder = folderTemplate.content.cloneNode(true);
                        const folderElement = newFolder.querySelector('.folder');
                        const folderHeader = folderElement.querySelector('.folder-header');
                        const folderIcon = folderElement.querySelector('.folder-icon');
                        const folderTitle = folderElement.querySelector('.folder-title');
                        const folderNameInput = folderElement.querySelector('.folder-name');
                        const folderContent = folderElement.querySelector('.folder-content');
                        const folderToggle = folderElement.querySelector('.folder-toggle');
                        const placeHolderElement = folderElement.querySelector('.tab-placeholder');
                        // Set up folder toggle functionality
                        // Add context menu for folder
                        folderElement.addEventListener('contextmenu', async (e) => {
                            e.preventDefault();
                            const contextMenu = document.createElement('div');
                            contextMenu.classList.add('context-menu');
                            contextMenu.style.position = 'fixed';
                            contextMenu.style.left = `${e.clientX}px`;
                            contextMenu.style.top = `${e.clientY}px`;

                            const deleteOption = document.createElement('div');
                            deleteOption.classList.add('context-menu-item');
                            deleteOption.textContent = 'Delete Folder';
                            deleteOption.addEventListener('click', async () => {
                                if (confirm('Are you sure you want to delete this folder and all its contents?')) {
                                    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
                                    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
                                    const spaceFolder = spaceFolders.find(f => f.title === space.name);
                                    if (spaceFolder) {
                                        const folders = await chrome.bookmarks.getChildren(spaceFolder.id);
                                        const folder = folders.find(f => f.title === item.title);
                                        if (folder) {
                                            await chrome.bookmarks.removeTree(folder.id);
                                            folderElement.remove();
                                        }
                                    }
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

                        folderHeader.addEventListener('click', () => {
                            folderElement.classList.toggle('collapsed');
                            folderContent.classList.toggle('collapsed');
                            folderToggle.classList.toggle('collapsed');
                            folderIcon.innerHTML = folderElement.classList.contains('collapsed') ? FOLDER_CLOSED_ICON : FOLDER_OPEN_ICON;
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
                                        console.error("Error updating folder name:", error);
                                    }
                                }
                            }
                            // Update display regardless of save/cancel
                            folderNameInput.value = item.title;
                            folderNameInput.readOnly = true;
                            folderNameInput.disabled = true;
                            folderNameInput.style.display = 'none';
                            folderTitle.innerHTML = item.title;
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
                        folderTitle.innerHTML = item.title;
                        folderTitle.style.display = 'inline';
                        placeHolderElement.classList.remove('hidden');

                        container.appendChild(folderElement);

                        // Recursively process the folder's contents
                        await processBookmarkNode(item, folderElement.querySelector('.folder-content'));
                    } else {
                        // This is a bookmark
                        if (!processedUrls.has(item.url) && !pinnedUrls.has(item.url)) {
                            const existingTab = BookmarkUtils.findTabByUrl(tabs, item.url);
                            if (existingTab) {
                                console.log('Creating UI element for active bookmark:', existingTab);
                                bookmarkedTabURLs.push(existingTab.url);
                                const tabElement = await createTabElement(existingTab, true);
                                console.log('Appending tab element to container:', tabElement);
                                container.appendChild(tabElement);
                            } else {
                                // Create UI element for inactive bookmark
                                const bookmarkTab = {
                                    id: null,
                                    title: item.title,
                                    url: item.url,
                                    favIconUrl: null,
                                    spaceName: space.name
                                };
                                console.log('Creating UI element for inactive bookmark:', item);
                                const tabElement = await createTabElement(bookmarkTab, true, true);
                                bookmarkedTabURLs.push(item.url);
                                container.appendChild(tabElement);
                            }
                            processedUrls.add(item.url);
                            const placeHolderElement = container.querySelector('.tab-placeholder');
                            if (placeHolderElement) {
                                placeHolderElement.classList.add('hidden');
                            }
                        }
                    }
                }
                return bookmarkedTabURLs;
            }

            // Process the space folder and get all bookmarked URLs
            bookmarkedTabURLs = await processBookmarkNode(spaceFolder, pinnedContainer);
        }


        // Load temporary tabs
        space.temporaryTabs.reverse().forEach(async tabId => {
            console.log("checking", tabId, spaces);
            const tab = tabs.find(t => t.id === tabId);
            const pinned = bookmarkedTabURLs.find(url => url == tab.url);
            console.log("pinned", pinned);

            if (tab && pinned == null) {
                const tabElement = await createTabElement(tab);
                tempContainer.appendChild(tabElement);
            }
        });
    } catch (error) {
        console.error('Error loading tabs:', error);
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
    console.log('Closing tab:', tab, tabElement, isPinned, isBookmarkOnly);

    if (isBookmarkOnly) {
        // Remove from bookmarks
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        const activeSpace = spaces.find(s => s.id === activeSpaceId);

        const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
        console.log("spaceFolder", spaceFolder);
        if (spaceFolder) {
            await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url, {
                removeTabElement: true,
                tabElement: tabElement,
                logRemoval: true
            });
        }

        return;
    }

    // If last tab is closed, create a new empty tab to prevent tab group from closing
    const tabsInGroup = await chrome.tabs.query({ groupId: activeSpaceId });
    console.log("tabsInGroup", tabsInGroup);
    if (tabsInGroup.length < 2) {
        console.log("creating new tab");
        await createNewTab(async () => {
            closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        });
        return;
    }
    const activeSpace = spaces.find(s => s.id === activeSpaceId);
    console.log("activeSpace", activeSpace);
    const isCurrentlyPinned = activeSpace?.spaceBookmarks.includes(tab.id);
    const isCurrentlyTemporary= activeSpace?.temporaryTabs.includes(tab.id);
    console.log("isCurrentlyPinned", isCurrentlyPinned, "isCurrentlyTemporary", isCurrentlyTemporary, "isPinned", isPinned);
    if (isCurrentlyPinned || (isPinned && !isCurrentlyTemporary)) {
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);

        const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
        console.log("spaceFolder", spaceFolder);
        if (spaceFolder) {
            console.log("tab", tab);

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
            const inactiveTabElement = await createTabElement(bookmarkTab, true, true);
            tabElement.replaceWith(inactiveTabElement);

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
    console.log('Creating tab element:', tab.id, 'IsBookmarkOnly:', isBookmarkOnly);
    const tabElement = document.createElement('div');
    tabElement.classList.add('tab');
    if (isBookmarkOnly) {
        tabElement.classList.add('inactive', 'bookmark-only'); // Add specific class for styling
        tabElement.dataset.url = tab.url;
    } else {
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true;
        if (tab.active) {
            tabElement.classList.add('active');
        }
    }

    const favicon = document.createElement('img');
    favicon.src = Utils.getFaviconUrl(tab.url);
    favicon.classList.add('tab-favicon');
    favicon.onerror = () => { 
        favicon.src = tab.favIconUrl; 
        favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; }; // Fallback favicon
    }; // Fallback favicon

    // --- Renaming Elements ---
    const tabDetails = document.createElement('div');
    tabDetails.className = 'tab-details';

    const titleDisplay = document.createElement('span');
    titleDisplay.className = 'tab-title-display';

    const domainDisplay = document.createElement('span');
    domainDisplay.className = 'tab-domain-display';
    domainDisplay.style.display = 'none'; // Hide initially

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'tab-title-input';
    titleInput.style.display = 'none'; // Hide initially
    titleInput.spellcheck = false; // Optional: disable spellcheck

    tabDetails.appendChild(titleDisplay);
    tabDetails.appendChild(domainDisplay);
    tabDetails.appendChild(titleInput);
    // --- End Renaming Elements ---

    const actionButton = document.createElement('button');
    actionButton.classList.add(isBookmarkOnly ? 'tab-remove' : 'tab-close'); // Use 'tab-remove' for bookmarks
    actionButton.innerHTML = isBookmarkOnly ? '−' : '×'; // Use minus for remove, times for close
    actionButton.title = isBookmarkOnly ? 'Remove Bookmark' : 'Close Tab';
    actionButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const activeSpace = spaces.find(s => s.id === activeSpaceId);
        console.log("activeSpace", activeSpace);
        const isCurrentlyPinned = activeSpace?.spaceBookmarks.includes(tab.id);
        closeTab(tabElement, tab, isCurrentlyPinned, isBookmarkOnly);
    });

    tabElement.appendChild(favicon);
    tabElement.appendChild(tabDetails); // Add the details container
    tabElement.appendChild(actionButton);

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

        if (override) {
            displayTitle = override.name;
            titleInput.value = override.name; // Set input value to override name
            try {
                // Check if current domain differs from original override domain
                const currentDomain = new URL(tab.url).hostname;
                if (override.originalDomain && currentDomain !== override.originalDomain) {
                    displayDomain = currentDomain;
                }
            } catch (e) {
                console.warn("Error parsing URL for domain check:", tab.url, e);
            }
        }

        titleDisplay.textContent = displayTitle;
        if (displayDomain) {
            domainDisplay.textContent = displayDomain;
            domainDisplay.style.display = 'block';
        } else {
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
                            await BookmarkUtils.updateBookmarkTitle(tab, activeSpace, newName);
                        }
                    } else {
                        // If name is empty or same as original, remove override
                        await Utils.removeTabNameOverride(tab.id);
                        if (isPinned) {
                            await BookmarkUtils.updateBookmarkTitle(tab, activeSpace, originalTitle);
                        }
                    }
                } catch (error) {
                    console.error("Error getting tab info or saving override:", error);
                    // Handle cases where the tab might have been closed during edit
                }
            }
            // Update display regardless of save/cancel to show correct state
            // Need to fetch tab again in case URL changed during edit? Unlikely but possible.
            try {
                 const potentiallyUpdatedTab = await chrome.tabs.get(tab.id);
                 tab.title = potentiallyUpdatedTab.title; // Update local tab object title
                 tab.url = potentiallyUpdatedTab.url; // Update local tab object url
            } catch(e) {
                console.log("Tab likely closed during edit, cannot update display.");
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

    // --- Click Handler ---
    tabElement.addEventListener('click', async (e) => {
        // Don't activate tab when clicking input or close button
        if (e.target === titleInput || e.target === actionButton) return;

        // Remove active class from all tabs and favicons
        document.querySelectorAll('.tab.active').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.pinned-favicon.active').forEach(t => t.classList.remove('active'));

        let chromeTab = null;
        try {
            chromeTab = await chrome.tabs.get(tab.id);
        } catch(e) {
            console.log("Tab likely closed during archival.", e, tab);
        }

        if (isBookmarkOnly || !chromeTab) {
            console.log('Opening bookmark:', tab);
            isOpeningBookmark = true; // Set flag
            try {
                // Find the space this bookmark belongs to (assuming it's the active one for simplicity)
                const space = spaces.find(s => s.id === activeSpaceId);
                if (!space) {
                    console.error("Cannot open bookmark: Active space not found.");
                    isOpeningBookmark = false;
                    return;
                }

                // Prepare bookmark data for opening
                const bookmarkData = {
                    url: tab.url,
                    title: tab.title,
                    spaceName: tab.spaceName
                };

                // Prepare context for BookmarkUtils
                const context = {
                    spaces,
                    activeSpaceId,
                    currentWindow,
                    saveSpaces,
                    createTabElement,
                    activateTabInDOM,
                    Utils
                };

                // Use shared bookmark opening logic
                await BookmarkUtils.openBookmarkAsTab(bookmarkData, activeSpaceId, tabElement, context, isPinned);

            } catch (error) {
                console.error("Error opening bookmark:", error);
            } finally {
                isOpeningBookmark = false; // Reset flag
            }
        } else {
            // It's a regular tab, just activate it
            tabElement.classList.add('active');
            chrome.tabs.update(tab.id, { active: true });
            // Store last active tab for the space
            const space = spaces.find(s => s.id === tab.groupId);
            if (space) {
                space.lastTab = tab.id;
                saveSpaces();
            }
        }
    });

    // Close tab on middle click
    tabElement.addEventListener('mousedown', (event) => {
        if (event.button === MouseButton.MIDDLE) {
            event.preventDefault(); // Prevent default middle-click actions (like autoscroll)
            closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        }
    });

    if (!isBookmarkOnly) {
        tabElement.addEventListener('dragstart', () => {
            tabElement.classList.add('dragging');
        });

        tabElement.addEventListener('dragend', () => {
            tabElement.classList.remove('dragging');
        });
    }

    // --- Context Menu ---
    tabElement.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
        const allBookmarkSpaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
        showTabContextMenu(e.pageX, e.pageY, tab, isPinned, isBookmarkOnly, tabElement, closeTab, spaces, moveTabToSpace, setActiveSpace, allBookmarkSpaceFolders, createSpaceFromInactive);
    });

    // Create a wrapper container for the tab and spacing
    const tabWrapper = document.createElement('div');
    tabWrapper.style.display = 'flex';
    tabWrapper.style.flexDirection = 'column';
    
    // Add the tab element to the wrapper
    tabWrapper.appendChild(tabElement);
    
    // Add vertical spacing element below the tab
    const spacingElement = document.createElement('div');
    spacingElement.style.height = '4px';
    spacingElement.style.width = '100%';
    tabWrapper.appendChild(spacingElement);

    return tabWrapper;
}

function createNewTab(callback = () => {}) {
    console.log('Creating new tab...');
    chrome.tabs.create({ active: true }, async (tab) => {
        console.log('activeSpaceId', activeSpaceId);
        if (activeSpaceId) {
            await chrome.tabs.group({tabIds: tab.id, groupId: activeSpaceId});
            const space = spaces.find(s => s.id === activeSpaceId);
            if (space) {
                space.temporaryTabs.push(tab.id);
                saveSpaces();
                // Callback call fails sometimes with "callback is not a function" error.
                if(typeof callback === 'function') {
                    callback();
                }
            }
        }
    });
}

async function createNewSpace() {
    console.log('Creating new space... Button clicked');
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
        const newTab = await ChromeHelper.createNewTab();
        const groupId = await ChromeHelper.createNewTabGroup(newTab, spaceName, spaceColor);

        const space = {
            id: groupId,
            uuid: Utils.generateUUID(),
            name: spaceName,
            color: spaceColor,
            spaceBookmarks: [],
            temporaryTabs: [newTab.id]
        };

        // Create bookmark folder for new space
        await LocalStorage.getOrCreateSpaceFolder(space.name);

        spaces.push(space);
        console.log('New space created:', { spaceId: space.id, spaceName: space.name, spaceColor: space.color });

        createSpaceElement(space);
        await updateSpaceSwitcher();
        await setActiveSpace(space.id);
        saveSpaces();

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
        console.error('Error creating new space:', error);
    }
}

function cleanTemporaryTabs(spaceId) {
    console.log('Cleaning temporary tabs for space:', spaceId);
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
        console.log("space.temporaryTabs", space.temporaryTabs);

        // iterate through temporary tabs and remove them with index
        space.temporaryTabs.forEach((tabId, index) => {
            if (index == space.temporaryTabs.length - 1) {
                createNewTab();
            }
            chrome.tabs.remove(tabId);
        });

        space.temporaryTabs = [];
        saveSpaces();
    }
}

function handleTabCreated(tab) {
    if (isCreatingSpace || isOpeningBookmark) {
        console.log('Skipping tab creation handler - space is being created');
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (tab.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }

        console.log('Tab created:', tab);
        // Always ensure we have the current activeSpaceId
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            try {
                // Get the current active tab's group ID
                // const currentGroupId = await chrome.tabs.group({ tabIds: tab.id });
                const space = spaces.find(s => s.id === activeSpaceId);

                if (space) {
                    await moveTabToSpace(tab.id, space.id, false /* pinned? */, tab.openerTabId);
                }
            } catch (error) {
                console.error('Error handling new tab:', error);
            }
        });
    });
}


function handleTabUpdate(tabId, changeInfo, tab) {
    if (isOpeningBookmark) {
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (tab.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }
        console.log('Tab updated:', tabId, changeInfo, spaces);

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
                    // Find which space this tab belongs to
                    const spaceWithTab = spaces.find(space =>
                        space.spaceBookmarks.includes(tabId) ||
                        space.temporaryTabs.includes(tabId)
                    );
                    
                    // If tab was in a space and was bookmarked, remove it from bookmarks
                    if (spaceWithTab && spaceWithTab.spaceBookmarks.includes(tabId)) {
                        const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
                        const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
                        const spaceFolder = spaceFolders.find(f => f.title === spaceWithTab.name);
                        
                        if (spaceFolder) {
                            await BookmarkUtils.removeBookmarkByUrl(spaceFolder.id, tab.url);
                        }
                    }
                    
                    // Remove tab from all spaces data when it becomes pinned
                    spaces.forEach(space => {
                        space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
                        space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
                    });
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
                   console.log('changeInfo', changeInfo);
                   console.log('overrides', overrides);
                   console.log('tab.url', tab.url); // Log the tab URL her
                   const override = overrides[tabId]; // Use potentially new URL
                   console.log('override', override); // Log the override object here
                   let displayDomain = null;

                   if (override) {
                       displayTitle = override.name;
                       try {
                           const currentDomain = new URL(tab.url).hostname;
                           if (currentDomain !== override.originalDomain) {
                               displayDomain = currentDomain;
                           }
                       } catch (e) { /* Ignore invalid URLs */ }
                   } else {
                        titleDisplay.textContent = displayTitle;
                   }
                   if (displayDomain) {
                       domainDisplay.textContent = displayDomain;
                       domainDisplay.style.display = 'block';
                   } else {
                       domainDisplay.style.display = 'none';
                   }
                   // Update input value only if not focused (might overwrite user typing)
                   titleInput.value = override ? override.name : tab.title;
               }
           }
            let faviconElement = tabElement.querySelector('.tab-favicon');
            if (!faviconElement) {
                // fallback to img element
                faviconElement = tabElement.querySelector('img');
            }
            if (changeInfo.url && faviconElement) {
                faviconElement.src = Utils.getFaviconUrl(changeInfo.url);
                // Update bookmark URL if this is a pinned tab
                if (tabElement.closest('[data-tab-type="pinned"]')) {
                    updateBookmarkForTab(tab, displayTitle);
                }
            } else if (!faviconElement) {
                console.log('No favicon element found', faviconElement, tabElement);
            }
            // Update active state when tab's active state changes
            if (changeInfo.active !== undefined && changeInfo.active) {
                activateTabInDOM(tabId);
            }
        }
    });
}

async function handleTabRemove(tabId) {
    console.log('Tab removed:', tabId);
    // Get tab element before removing it
    const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabElement) return;
    console.log("tabElement", tabElement);
    const activeSpace = spaces.find(s => s.id === activeSpaceId);
    console.log("activeSpace", activeSpace);
    const isPinned = activeSpace.spaceBookmarks.find(id => id === tabId) != null;
    console.log("isPinned", isPinned);

    if (isPinned) {
        // For pinned tabs, convert to bookmark-only element using existing bookmark data
        try {
            // Find the bookmark in Chrome bookmarks for this space
            const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
            const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
            const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
            
            if (spaceFolder) {
                const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
                
                // Try to get tab URL from Chrome API first, then fall back to searching bookmarks
                let tabUrl;
                try {
                    const tabData = await chrome.tabs.get(tabId);
                    tabUrl = tabData.url;
                } catch (error) {
                    // Tab already closed, we'll find it by searching bookmarks
                }
                
                // Find matching bookmark
                const matchingBookmark = bookmarks.find(b => {
                    if (tabUrl) return b.url === tabUrl;
                    // Fallback: try to match by title from DOM
                    const titleElement = tabElement.querySelector('.tab-title, .tab-details span');
                    const titleText = titleElement?.textContent;
                    return titleText && b.title === titleText;
                });
                
                if (matchingBookmark) {
                    // Use the established pattern from loadTabs()
                    const bookmarkTab = {
                        id: null,
                        title: matchingBookmark.title,
                        url: matchingBookmark.url,
                        favIconUrl: null,
                        spaceName: activeSpace.name
                    };
                    const bookmarkElement = await createTabElement(bookmarkTab, true, true);
                    tabElement.replaceWith(bookmarkElement);
                    console.log('Converted closed pinned tab to bookmark-only element');
                } else {
                    console.warn('Could not find matching bookmark for closed pinned tab, removing element');
                    tabElement.remove();
                }
            } else {
                console.warn('Could not find space folder for closed pinned tab, removing element');
                tabElement.remove();
            }
        } catch (error) {
            console.error('Error converting pinned tab to bookmark-only element:', error);
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
}

function handleTabMove(tabId, moveInfo) {
    if (isOpeningBookmark) {
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {

        if (tab.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }
        console.log('Tab moved:', tabId, moveInfo);

        // Get the tab's current information
        chrome.tabs.get(tabId, async (tab) => {
            const newGroupId = tab.groupId;
            console.log('Tab moved to group:', newGroupId);

            // Find the source and destination spaces
            const sourceSpace = spaces.find(s =>
                s.temporaryTabs.includes(tabId) || s.spaceBookmarks.includes(tabId)
            );
            const destSpace = spaces.find(s => s.id === newGroupId);

            if (sourceSpace && destSpace && sourceSpace.id !== destSpace.id) {
                console.log('Moving tab between spaces:', sourceSpace.name, '->', destSpace.name);

                // Remove from source space
                sourceSpace.temporaryTabs = sourceSpace.temporaryTabs.filter(id => id !== tabId);
                sourceSpace.spaceBookmarks = sourceSpace.spaceBookmarks.filter(id => id !== tabId);

                // Add to destination space's temporary tabs
                if (!destSpace.temporaryTabs.includes(tabId)) {
                    destSpace.temporaryTabs.push(tabId);
                }

                // Update the DOM
                const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
                if (tabElement) {
                    const destSpaceElement = document.querySelector(`[data-space-id="${destSpace.id}"]`);
                    if (destSpaceElement) {
                        const destTempContainer = destSpaceElement.querySelector('[data-tab-type="temporary"]');
                        if (destTempContainer) {
                            destTempContainer.appendChild(tabElement);
                        }
                    }
                }

                saveSpaces();
            } else {
                // Handle regular tab position updates within the same space
                const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
                if (tabElement) {
                    const container = tabElement.parentElement;
                    const tabs = Array.from(container.children);
                    const currentIndex = tabs.indexOf(tabElement);
                    if (currentIndex !== moveInfo.toIndex) {
                        container.insertBefore(tabElement, container.children[moveInfo.toIndex]);
                    }
                }
            }
        });
    });
}

function handleTabActivated(activeInfo) {
    if (isCreatingSpace) {
        console.log('Skipping tab creation handler - space is being created');
        return;
    }
    chrome.windows.getCurrent({populate: false}, async (currentWindow) => {
        if (activeInfo.windowId !== currentWindow.id) {
            console.log('New tab is in a different window, ignoring...');
            return;
        }

        console.log('Tab activated:', activeInfo);
        // Find which space contains this tab
        const spaceWithTab = spaces.find(space =>
            space.spaceBookmarks.includes(activeInfo.tabId) ||
            space.temporaryTabs.includes(activeInfo.tabId)
        );
        console.log("found space", spaceWithTab);

        if (spaceWithTab) {
            spaceWithTab.lastTab = activeInfo.tabId;
            saveSpaces();
            console.log("lasttab space", spaces);
        }

        if (spaceWithTab && spaceWithTab.id !== activeSpaceId) {
            // Switch to the space containing the tab
            await activateSpaceInDOM(spaceWithTab.id, spaces, updateSpaceSwitcher);
            activateTabInDOM(activeInfo.tabId);
        } else {
            // Activate only the tab in the current space
            activateTabInDOM(activeInfo.tabId);
        }
    });
}

async function deleteSpace(spaceId) {
    console.log('Deleting space:', spaceId);
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
        // Close all tabs in the space
        [...space.spaceBookmarks, ...space.temporaryTabs].forEach(tabId => {
            chrome.tabs.remove(tabId);
        });

        // Remove space from array
        spaces = spaces.filter(s => s.id !== spaceId);

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
        await chrome.bookmarks.removeTree(spaceFolder.id);

        // Save changes
        saveSpaces();
        await updateSpaceSwitcher();
    }
}

////////////////////////////////////////////////////////////////
// -- Helper Functions
////////////////////////////////////////////////////////////////

async function moveTabToSpace(tabId, spaceId, pinned = false, openerTabId = null) {
    // Remove tab from its original space data first
    const sourceSpace = spaces.find(s => 
        s.temporaryTabs.includes(tabId) || s.spaceBookmarks.includes(tabId)
    );
    if (sourceSpace && sourceSpace.id !== spaceId) {
        sourceSpace.temporaryTabs = sourceSpace.temporaryTabs.filter(id => id !== tabId);
        sourceSpace.spaceBookmarks = sourceSpace.spaceBookmarks.filter(id => id !== tabId);
    }
    
    // 1. Find the target space
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
        console.warn(`Space with ID ${spaceId} not found.`);
        return;
    }

    // 2. Move tab to Chrome tab group
    try {
        await chrome.tabs.group({ tabIds: tabId, groupId: spaceId });
    } catch (err) {
        console.warn(`Error grouping tab ${tabId} to space ${spaceId}:`, err);
    }

    // 3. Update local space data
    // Remove tab from both arrays just in case
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);

    if (pinned) {
        space.spaceBookmarks.push(tabId);
    } else {
        space.temporaryTabs.push(tabId);
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
                container.insertBefore(tabElement, container.firstChild);
            }
        } else {
            container.appendChild(tabElement);
        }
    }

    // 5. Save the updated spaces to storage
    saveSpaces();
    
    // 6. Scroll to top of temporary tabs if this is a new tab being added to temporary section    
    if (!pinned && spaceElement) {
        const spaceContent = spaceElement.querySelector('.space-content');
        
        if (spaceContent) {            
            // Use setTimeout to ensure the DOM has been updated
            setTimeout(() => {                
                // Check if the top of temporary-tabs section is within the frame
                const tempTabsSection = spaceElement.querySelector('.temporary-tabs');
                if (tempTabsSection) {
                    const tempTabsRect = tempTabsSection.getBoundingClientRect();
                    const spaceContentRect = spaceContent.getBoundingClientRect();
                    
                    // Check if the top of temporary-tabs is above the visible area of spaceContent
                    const isTempTabsTopVisible = tempTabsRect.top >= spaceContentRect.top;
                    console.log('[ScrollDebug] Temp tabs top visible:', isTempTabsTopVisible, 'tempTabsRect.top:', tempTabsRect.top, 'spaceContentRect.top:', spaceContentRect.top);
                    
                    if (!isTempTabsTopVisible) {
                        console.log('[ScrollDebug] Scrolling to show temp tabs - top was out of frame');
                        // Scroll to make the temporary-tabs section visible at the top
                        spaceContent.scrollTop = (spaceContentRect.top - tempTabsRect.top);
                    } else {
                        console.log('[ScrollDebug] Not scrolling - temp tabs top is already visible');
                    }
                } else {
                    console.warn('[ScrollDebug] Temporary tabs section not found');
                }
            }, 0);
        } else {
            console.warn('[ScrollDebug] Space content element not found');
        }
    } else {
        console.log('[ScrollDebug] Skipping scroll - pinned:', pinned, 'spaceElement exists:', !!spaceElement);
    }
}