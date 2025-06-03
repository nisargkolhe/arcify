import { ChromeHelper } from './chromeHelper.js';
import { FOLDER_CLOSED_ICON, FOLDER_OPEN_ICON } from './icons.js';
import { LocalStorage } from './localstorage.js';
import { Utils } from './utils.js';
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
        const bookmark = bookmarks.find(b => b.url === tab.url);
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
        const tabId = element.dataset.tabId;
        if (!pinnedTabs.some(tab => tab.id.toString() === tabId)) {
            element.remove();
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

            const img = document.createElement('img');
            img.src = Utils.getFaviconUrl(tab.url, "96");
            img.alt = tab.title;

            faviconElement.appendChild(img);
            faviconElement.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.pinned-favicon').forEach(t => t.classList.remove('active'));
                // Add active class to clicked tab
                faviconElement.classList.add('active');
                chrome.tabs.update(tab.id, { active: true });
            });

            pinnedFavicons.appendChild(faviconElement);
        }
    });
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
    setupQuickPinListener(spaces, moveTabToSpace, moveTabToPinned, moveTabToTemp);
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
            await chrome.tabGroups.update(groupId, {title: defaultSpaceName, color: 'grey'});

            // Create default space with UUID
            const defaultSpace = {
                id: groupId,
                uuid: Utils.generateUUID(),
                name: defaultSpaceName,
                color: 'grey',
                spaceBookmarks: [],
                temporaryTabs: currentTabs.map(tab => tab.id),
            };

            // Create bookmark folder for space bookmarks using UUID
            const bookmarkFolder = spacesFolder.children.find(f => f.title == defaultSpaceName);
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

                    spaceBookmarks = await Utils.processBookmarkFolder(bookmarkFolder, group.id);
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

    setupDOMElements(createNewSpace, createNewTab);
}

function createSpaceElement(space) {
    console.log('Creating space element for:', space.id);
    const spaceElement = spaceTemplate.content.cloneNode(true);
    const sidebarContainer = document.getElementById('sidebar-container');
    const spaceContainer = spaceElement.querySelector('.space');
    spaceContainer.dataset.spaceId = space.id;
    spaceContainer.style.display = space.id === activeSpaceId ? 'block' : 'none';
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

    newFolderBtn.addEventListener('click', () => {
        createNewFolder(spaceContainer);
    });

    deleteSpaceBtn.addEventListener('click', () => {
        if (confirm('Delete this space and close all its tabs?')) {
            deleteSpace(space.id);
        }
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
                console.log("button click inactive space", spaceFolder);
                isCreatingSpace = true;
                const newTab = await ChromeHelper.createNewTab();
                const groupId = await ChromeHelper.createNewTabGroup(newTab, spaceFolder.title, 'grey');
                const spaceBookmarks = await Utils.processBookmarkFolder(spaceFolder, groupId);

                const colors = [
                    "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"
                ];

                const randomIndex = Math.floor(Math.random() * colors.length);
                const color = colors[randomIndex];

                const space = {
                    id: groupId,
                    uuid: Utils.generateUUID(),
                    name: spaceFolder.title,
                    color: color,
                    spaceBookmarks: spaceBookmarks,
                    temporaryTabs: [newTab.id],
                    lastTab: newTab.id,
                };
                spaces.push(space);
                saveSpaces();
                createSpaceElement(space);
                await setActiveSpace(space.id);
                isCreatingSpace = false;
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

function saveSpaces() {
    console.log('Saving spaces to storage...', spaces);
    chrome.storage.local.set({ spaces }, () => {
        console.log('Spaces saved successfully');
    });
}

const searchBookmarks = async (folderId, tab) => {
    const items = await chrome.bookmarks.getChildren(folderId);
    console.log("searching to delete", folderId, items);
    for (const item of items) {
        if (item.url === tab.url) {
            console.log("found and deleted");
            await chrome.bookmarks.remove(item.id);
        } else if (!item.url) {
            console.log("recursive folder search", item.id);
            // Recursively search in subfolders
            await searchBookmarks(item.id, tab);
        }
    }
};

async function moveTabToPinned(space, tab) {
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tab.id);
    if (!space.spaceBookmarks.includes(tab.id)) {
        space.spaceBookmarks.push(tab.id);
    }
    const spaceFolder = await LocalStorage.getOrCreateSpaceFolder(space.name);
    const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
    const existingBookmark = bookmarks.find(b => b.url === tab.url);
    if (!existingBookmark) {
        // delete existing bookmark
        await searchBookmarks(spaceFolder.id, tab);

        await chrome.bookmarks.create({
            parentId: spaceFolder.id,
            title: tab.title,
            url: tab.url
        });
    }
}

async function moveTabToTemp(space, tab) {
    const arcifyFolder = await LocalStorage.getOrCreateArcifyFolder();
    const spaceFolders = await chrome.bookmarks.getChildren(arcifyFolder.id);
    const spaceFolder = spaceFolders.find(f => f.title === space.name);

    if (spaceFolder) {
        const searchAndRemoveBookmark = async (folderId) => {
            const items = await chrome.bookmarks.getChildren(folderId);
            for (const item of items) {
                if (item.url === tab.url) {
                    await chrome.bookmarks.remove(item.id);
                    return true;
                } else if (!item.url) {
                    const found = await searchAndRemoveBookmark(item.id);
                    if (found) return true;
                }
            }
            return false;
        };

        await searchAndRemoveBookmark(spaceFolder.id);
    }

    // Move tab from bookmarks to temporary tabs in space data
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tab.id);
    if (!space.temporaryTabs.includes(tab.id)) {
        space.temporaryTabs.push(tab.id);
    }

    saveSpaces();
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
                                    if (existingBookmarks.some(b => b.url === tab.url)) {
                                        console.log('Bookmark already exists in folder:', folderName);
                                        isDraggingTab = false;
                                        return;
                                    }

                                    // Find and remove the bookmark from its original location
                                    await searchBookmarks(spaceFolder.id, tab);

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
            folderNameInput.classList.toggle('hidden');
            folderTitle.innerHTML = folderNameInput.value;
            folderTitle.classList.toggle('hidden');
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

                        folderNameInput.value = item.title;
                        folderNameInput.readOnly = true;
                        folderNameInput.disabled = true;
                        folderNameInput.classList.toggle('hidden');
                        folderTitle.innerHTML = item.title;
                        folderTitle.classList.toggle('hidden');
                        placeHolderElement.classList.remove('hidden');

                        container.appendChild(folderElement);

                        // Recursively process the folder's contents
                        await processBookmarkNode(item, folderElement.querySelector('.folder-content'));
                    } else {
                        // This is a bookmark
                        if (!processedUrls.has(item.url)) {
                            const existingTab = tabs.find(t => t.url === item.url);
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
        space.temporaryTabs.forEach(async tabId => {
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
            const searchAndRemoveBookmark = async (folderId) => {
                const items = await chrome.bookmarks.getChildren(folderId);
                for (const item of items) {
                    if (item.url === tab.url) {
                        console.log("removing bookmark", item);
                        await chrome.bookmarks.remove(item.id);
                        tabElement.remove();
                        return true; // Bookmark found and removed
                    } else if (!item.url) {
                        // This is a folder, search recursively
                        const found = await searchAndRemoveBookmark(item.id);
                        if (found) return true;
                    }
                }
                return false;
            };

            await searchAndRemoveBookmark(spaceFolder.id);
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
            const bookmarkTab = {
                id: null,
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                spaceName: tab.spaceName
            };
            const inactiveTabElement = await createTabElement(bookmarkTab, true, true);
            tabElement.replaceWith(inactiveTabElement);

            chrome.tabs.remove(tab.id);
            return;
        }
    } else {
        chrome.tabs.remove(tab.id);
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
    favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; }; // Fallback favicon

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
                        await Utils.updateBookmarkTitleIfNeeded(tab, activeSpace, newName);
                    } else {
                        // If name is empty or same as original, remove override
                        await Utils.removeTabNameOverride(tab.id);
                        await Utils.updateBookmarkTitleIfNeeded(tab, activeSpace, originalTitle);
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

                // Create new tab with bookmark URL in the active group
                const newTab = await chrome.tabs.create({
                    url: tab.url,
                    active: true, // Make it active immediately
                    windowId: currentWindow.id // Ensure it opens in the current window
                });

                // If bookmark has a custom name, set tab name override
                if (tab.title && newTab.title !== tab.title) {
                    await Utils.setTabNameOverride(newTab.id, tab.url, tab.title);
                }

                // Replace tab element
                const bookmarkTab = {
                    id: newTab.id,
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl,
                    spaceName: tab.spaceName
                };
                const activeBookmark = await createTabElement(bookmarkTab, true, false);
                activeBookmark.classList.add('active');
                tabElement.replaceWith(activeBookmark);

                // Immediately group the new tab
                await chrome.tabs.group({ tabIds: [newTab.id], groupId: activeSpaceId });

                if (isPinned) {
                    const space = spaces.find(s => s.name === tab.spaceName);
                    if (space) {
                        space.spaceBookmarks.push(newTab.id);
                        saveSpaces();
                    }
                }

                saveSpaces(); // Save updated space state

                // Replace the bookmark-only element with a real tab element
                activateTabInDOM(newTab.id); // Visually activate

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
    tabElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showTabContextMenu(e.pageX, e.pageY, tab, isPinned, isBookmarkOnly, tabElement, closeTab);
    });


    return tabElement;
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
                if(callback) {
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
                    img.src = Utils.getFaviconUrl(tab.url); // Use updated URL
                }
            }

            const titleDisplay = tabElement.querySelector('.tab-title-display');
            const domainDisplay = tabElement.querySelector('.tab-domain-display');
            const titleInput = tabElement.querySelector('.tab-title-input'); // Get input element
            let displayTitle = tab.title; // Use potentially new title

            if (changeInfo.pinned !== undefined) {
                if (changeInfo.pinned) {
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

            if (changeInfo.url) {
                tabElement.querySelector('.tab-favicon').src = Utils.getFaviconUrl(changeInfo.url);
                // Update bookmark URL if this is a pinned tab
                if (tabElement.closest('[data-tab-type="pinned"]')) {
                    updateBookmarkForTab(tab, displayTitle);
                }
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


    // Remove tab from spaces
    spaces.forEach(space => {
        space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tabId);
        space.temporaryTabs = space.temporaryTabs.filter(id => id !== tabId);
    });

    if (!isPinned) {
        // If not a pinned tab or bookmark not found, remove the element
        tabElement?.remove();
    }

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
            await activateSpaceInDOM(spaceWithTab.id);
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
}