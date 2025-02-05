import { FOLDER_CLOSED_ICON, FOLDER_OPEN_ICON } from './icons.js';

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
// let isCreatingTab = false;
let isOpeningBookmark = false;
let isDraggingTab = false;
let currentWindow = null;

// Helper function to generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper function to update bookmark for a tab
async function updateBookmarkForTab(tab) {
    console.log("updating tab", tab);
    const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
    if (bookmarkFolders.length > 0) {
        const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
        for (const spaceFolder of spaceFolders) {
            console.log("looking for space folder", spaceFolder);
            const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
            console.log("looking for bookmarks", bookmarks);
            const bookmark = bookmarks.find(b => b.url === tab.url);
            if (bookmark) {
                await chrome.bookmarks.update(bookmark.id, {
                    title: tab.title,
                    url: tab.url
                });
            }
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
            img.src = tab.favIconUrl || 'assets/default_icon.png';
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
});

async function initSidebar() {
    console.log('Initializing sidebar...');
    try {
        currentWindow = await chrome.windows.getCurrent({populate: false});

        let tabGroups = await chrome.tabGroups.query({});
        let allTabs = await chrome.tabs.query({});
        console.log("tabGroups", tabGroups);
        console.log("allTabs", allTabs);
        // Create bookmarks folder for spaces if it doesn't exist
        const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
        let spacesFolder;
        if (bookmarkFolders.length === 0) {
            spacesFolder = await chrome.bookmarks.create({title: 'Arcify'});
        } else {
            spacesFolder = bookmarkFolders[0];
        }

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
            await chrome.tabGroups.update(groupId, {title: 'Home', color: 'grey'});

            // Create default space with UUID
            const defaultSpace = {
                id: groupId,
                uuid: generateUUID(),
                name: 'Home',
                spaceBookmarks: [],
                temporaryTabs: currentTabs.map(tab => tab.id),
            };

            // Create bookmark folder for space bookmarks using UUID
            await chrome.bookmarks.create({
                parentId: spacesFolder.id,
                title: defaultSpace.name
            });

            spaces = [defaultSpace];
            saveSpaces();
            createSpaceElement(defaultSpace);
            setActiveSpace(defaultSpace.id);
        } else {
            const result = await chrome.storage.local.get('spaces');
            console.log("local storage", result);

            // Find tabs that aren't in any group
            const ungroupedTabs = allTabs.filter(tab => tab.groupId === -1 && !tab.pinned);
            let defaultGroupId = null;

            // If there are ungrouped tabs, check for existing Default group or create new one
            if (ungroupedTabs.length > 0) {
                console.log("found ungrouped tabs", ungroupedTabs);
                const defaultGroup = tabGroups.find(group => group.title === 'Home');
                if (defaultGroup) {
                    console.log("found existing default group", defaultGroup);
                    if (defaultGroup.windowId === currentWindow.id) {
                        // Move ungrouped tabs to existing Default group
                        await chrome.tabs.group({tabIds: ungroupedTabs.map(tab => tab.id), groupId: defaultGroup.id});
                    } else {
                        // Create new Default group
                        defaultGroupId = await chrome.tabs.group({tabIds: ungroupedTabs.map(tab => tab.id)});
                        await chrome.tabGroups.update(defaultGroupId, {title: 'Home'+currentWindow.id, color: 'grey'});
                    }
                } else {
                    // Create new Default group
                    defaultGroupId = await chrome.tabs.group({tabIds: ungroupedTabs.map(tab => tab.id)});
                    await chrome.tabGroups.update(defaultGroupId, {title: 'Home', color: 'grey'});
                }
            }

            tabGroups = await chrome.tabGroups.query({});

            // Load existing tab groups as spaces
            spaces = await Promise.all(tabGroups.map(async group => {
                const tabs = await chrome.tabs.query({groupId: group.id});
                console.log("processing group", group);
                const spaceBookmarks = result.spaces?.find(s => s.name == group.title)?.spaceBookmarks || [];
                console.log("space bookmarks", spaceBookmarks);
                const space = {
                    id: group.id,
                    uuid: generateUUID(),
                    name: group.title,
                    spaceBookmarks: spaceBookmarks,
                    temporaryTabs: tabs.map(tab => tab.id)
                };
                chrome.bookmarks.getSubTree(spacesFolder.id, async mainFolder => {
                     // Create bookmark folder for the space if it doesn't exist
                    const bookmarkFolder = mainFolder[0].children?.find(f => f.title == space.name);
                    console.log("looking for existing folder", mainFolder, bookmarkFolder);
                    if (!bookmarkFolder) {
                        console.log("creating new folder")
                        await chrome.bookmarks.create({
                            parentId: spacesFolder.id,
                            title: space.name
                        });
                    }
                })

                return space;
            }));
            spaces.forEach(space => createSpaceElement(space));
            saveSpaces();

            let activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTabs.length > 0) {
                const activeTab = activeTabs[0];
                setActiveSpace(activeTab.groupId);
            } else {
                setActiveSpace(defaultGroupId ?? spaces[0].id);
            }
        }
    } catch (error) {
        console.error('Error initializing sidebar:', error);
    }

    // Add event listeners for buttons
    addSpaceBtn.addEventListener('click', () => {
        const inputContainer = document.getElementById('addSpaceInputContainer');
        const spaceSwitcher = document.getElementById('spaceSwitcher');
        const spaceNameInput = document.getElementById('newSpaceName');
        const isInputVisible = inputContainer.classList.contains('visible');

        // Toggle visibility classes
        inputContainer.classList.toggle('visible');
        addSpaceBtn.classList.toggle('active');

        // Toggle space switcher visibility
        if (isInputVisible) {
            spaceSwitcher.style.opacity = '1';
            spaceSwitcher.style.visibility = 'visible';
        } else {
            spaceNameInput.value = '';
            spaceSwitcher.style.opacity = '0';
            spaceSwitcher.style.visibility = 'hidden';
        }
    });
    document.getElementById('createSpaceBtn').addEventListener('click', createNewSpace);
    newTabBtn.addEventListener('click', createNewTab);
}

function createSpaceElement(space) {
    console.log('Creating space element for:', space.id);
    const spaceElement = spaceTemplate.content.cloneNode(true);
    const spaceContainer = spaceElement.querySelector('.space');
    spaceContainer.dataset.spaceId = space.id;
    spaceContainer.style.display = space.id === activeSpaceId ? 'block' : 'none';
    spaceContainer.dataset.spaceUuid = space.id;

    // Set up space name input
    const nameInput = spaceElement.querySelector('.space-name');
    nameInput.value = space.name;
    nameInput.addEventListener('change', async () => {
        // Update bookmark folder name
        const oldName = space.name;
        const oldFolder = await getOrCreateSpaceFolder(oldName);
        await chrome.bookmarks.update(oldFolder.id, { title: nameInput.value });

        const tabGroups = await chrome.tabGroups.query({});
        const tabGroupForSpace = tabGroups.find(group => group.id === space.id);
        console.log("updating tabGroupForSpace", tabGroupForSpace);
        if (tabGroupForSpace) {
            await chrome.tabGroups.update(tabGroupForSpace.id, {title: nameInput.value, color: 'grey'});
        }

        space.name = nameInput.value;
        saveSpaces();
        updateSpaceSwitcher();
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

    // Add to DOM
    spacesList.appendChild(spaceElement);
}

function updateSpaceSwitcher() {
    console.log('Updating space switcher...');
    spaceSwitcher.innerHTML = '';
    spaces.forEach(space => {
        const button = document.createElement('button');
        button.textContent = space.name;
        button.classList.toggle('active', space.id === activeSpaceId);
        button.addEventListener('click', () => setActiveSpace(space.id));
        spaceSwitcher.appendChild(button);
    });
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

function setActiveSpace(spaceId) {
    console.log('Setting active space:', spaceId);

    // Centralize logic in our new helper function
    activateSpaceInDOM(spaceId);

    // Get all tabs in the space and activate the last one
    chrome.tabs.query({ groupId: spaceId }, tabs => {
        if (tabs.length > 0) {
            const lastTab = tabs[tabs.length - 1];
            chrome.tabs.update(lastTab.id, { active: true });
            activateTabInDOM(lastTab.id);
        }
    });
}

function saveSpaces() {
    console.log('Saving spaces to storage...');
    chrome.storage.local.set({ spaces }, () => {
        console.log('Spaces saved successfully');
    });
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

                        const searchBookmarks = async (folderId) => {
                            const items = await chrome.bookmarks.getChildren(folderId);
                            console.log("searching to delete", folderId, items);
                            for (const item of items) {
                                if (item.url === tab.url) {
                                    console.log("found and deleted");
                                    await chrome.bookmarks.remove(item.id);
                                } else if (!item.url) {
                                    console.log("recursive folder search", item.id);
                                    // Recursively search in subfolders
                                    await searchBookmarks(item.id);
                                }
                            }
                        };

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
                            const spaceFolder = await getOrCreateSpaceFolder(space.name);
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
                                    await searchBookmarks(spaceFolder.id);

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
                                    const bookmarks = await chrome.bookmarks.getChildren(spaceFolder.id);
                                    const existingBookmark = bookmarks.find(b => b.url === tab.url);
                                    if (!existingBookmark) {
                                        // delete existing bookmark
                                        await searchBookmarks(spaceFolder.id);

                                        await chrome.bookmarks.create({
                                            parentId: spaceFolder.id,
                                            title: tab.title,
                                            url: tab.url
                                        });
                                    }
                                }
                            }

                            saveSpaces();
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
        const spaceFolder = await getOrCreateSpaceFolder(spaceName);
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
        const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});

        if (bookmarkFolders.length > 0) {
            const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
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
                                        const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
                                        if (bookmarkFolders.length > 0) {
                                            const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
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
                                    const tabElement = createTabElement(existingTab, true);
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
                                    console.log('Creating UI element for inactive bookmark:', item.title);
                                    const tabElement = createTabElement(bookmarkTab, true, true);
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
        }

        // Load temporary tabs
        space.temporaryTabs.forEach(tabId => {
            console.log("checking", tabId, spaces);
            const tab = tabs.find(t => t.id === tabId);
            const pinned = bookmarkedTabURLs.find(url => url == tab.url);
            console.log("pinned", pinned);

            if (tab && pinned == null) {
                const tabElement = createTabElement(tab);
                tempContainer.appendChild(tabElement);
            }
        });
    } catch (error) {
        console.error('Error loading tabs:', error);
    }
}

async function closeTab(tabElement, tab, isPinned = false, isBookmarkOnly = false) {
console.log('Closing tab:', tab);

    if (isBookmarkOnly) {
        // Remove from bookmarks
        const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
        if (bookmarkFolders.length > 0) {
            const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
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
        }
        return;
    }

    // If last tab is closed, create a new empty tab to prevent tab group from closing
    const tabsInGroup = await chrome.tabs.query({ groupId: activeSpaceId });
    console.log("tabsInGroup", tabsInGroup);
    if (tabsInGroup.length < 2) {
        console.log("creating new tab");
        await createNewTab(async () => {
            if (isBookmarkOnly) {
                // Remove from bookmarks
                const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
                if (bookmarkFolders.length > 0) {
                    const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
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
                }
            } else if (isPinned) {
                const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
                if (bookmarkFolders.length > 0) {
                    const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
                    const activeSpace = spaces.find(s => s.id === activeSpaceId);

                    const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
                    console.log("spaceFolder", spaceFolder);
                    if (spaceFolder) {
                        const bookmarkTab = {
                            id: null,
                            title: tab.title,
                            url: tab.url,
                            favIconUrl: tab.favIconUrl,
                            spaceName: tab.spaceName
                        };
                        const inactiveTabElement = createTabElement(bookmarkTab, true, true);
                        tabElement.replaceWith(inactiveTabElement);

                        chrome.tabs.remove(tab.id);
                        return;
                    }
                }
            } else {
                chrome.tabs.remove(tab.id);
            }
        });
        return;
    }
    
    if (isPinned) {
        const bookmarkFolders = await chrome.bookmarks.search({title: 'Arcify'});
        if (bookmarkFolders.length > 0) {
            const spaceFolders = await chrome.bookmarks.getChildren(bookmarkFolders[0].id);
            const activeSpace = spaces.find(s => s.id === activeSpaceId);

            const spaceFolder = spaceFolders.find(f => f.title === activeSpace.name);
            console.log("spaceFolder", spaceFolder);
            if (spaceFolder) {
                const bookmarkTab = {
                    id: null,
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl,
                    spaceName: tab.spaceName
                };
                const inactiveTabElement = createTabElement(bookmarkTab, true, true);
                tabElement.replaceWith(inactiveTabElement);

                chrome.tabs.remove(tab.id);
                return;
            }
        }
    } else {
        chrome.tabs.remove(tab.id);
    }
}

function createTabElement(tab, isPinned = false, isBookmarkOnly = false) {
    console.log('Creating tab element:', tab.id);
    const tabElement = document.createElement('div');
    tabElement.classList.add('tab');
    if (!isBookmarkOnly) {
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true;

        // Add active class if this is the active tab
        if (tab.active) {
            tabElement.classList.add('active');
        }
    } else {
        tabElement.classList.add('inactive');
        tabElement.dataset.url = tab.url;
    }

    const favicon = document.createElement('img');
    favicon.src = tab.favIconUrl || 'assets/default_icon.png';
    favicon.classList.add('tab-favicon');

    const title = document.createElement('span');
    title.textContent = tab.title;
    title.classList.add('tab-title');

    const actionButton = document.createElement('button');
    actionButton.classList.add(isBookmarkOnly ? 'tab-remove' : 'tab-close');
    actionButton.innerHTML = isBookmarkOnly ? '-' : '×';
    actionButton.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent tab activation when closing
        closeTab(tabElement, tab, isPinned, isBookmarkOnly);
    });

    tabElement.appendChild(favicon);
    tabElement.appendChild(title);
    tabElement.appendChild(actionButton);

    // Add click handler
    tabElement.addEventListener('click', async () => {
        // Remove active class from all tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.pinned-favicon').forEach(t => t.classList.remove('active'));

        if (isBookmarkOnly) {
            console.log('Opening bookmark:', tab.url);
            isOpeningBookmark = true;
            // Create new tab with bookmark URL
            const newTab = await chrome.tabs.create({ url: tab.url, active: true });

            console.log("newTab", newTab);
            const bookmarkTab = {
                id: newTab.id,
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                spaceName: tab.spaceName
            };
            const activeBookmark = createTabElement(bookmarkTab, true, false);
            activeBookmark.classList.add('active');

            console.log("activeBookmark", activeBookmark);
            tabElement.replaceWith(activeBookmark);

            await chrome.tabs.group({ tabIds: newTab.id, groupId: activeSpaceId });


            isOpeningBookmark = false;
            // if (isPinned) {
            //     const space = spaces.find(s => s.name === tab.spaceName);
            //     if (space) {
            //         space.spaceBookmarks.push(newTab.id);
            //         saveSpaces();
            //     }
            // }
        } else {
            // Add active class to clicked tab
            tabElement.classList.add('active');
            chrome.tabs.update(tab.id, { active: true });
        }
    });

    // Close tab on middle click
    tabElement.addEventListener('mousedown', (event) => {
        if (event.button === MouseButton.MIDDLE) {
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
                callback();
            }
        }
    });
}

function showSpaceNameInput() {
    const addSpaceBtn = document.getElementById('addSpaceBtn');
    const addSpaceInputContainer = document.getElementById('addSpaceInputContainer');

    addSpaceBtn.classList.toggle('active');
    addSpaceInputContainer.classList.toggle('visible');
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

// Add input validation for new space name
document.getElementById('newSpaceName').addEventListener('input', (e) => {
    const createSpaceBtn = document.getElementById('createSpaceBtn');
    createSpaceBtn.disabled = !e.target.value.trim();
});

async function createNewSpace() {
    console.log('Creating new space... Button clicked');
    isCreatingSpace = true;
    try {
        const spaceNameInput = document.getElementById('newSpaceName');
        const spaceName = spaceNameInput.value.trim();

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

        // First create a new tab
        const newTab = await new Promise((resolve, reject) => {
            chrome.tabs.create({ active: true }, (tab) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(tab);
                }
            });
        });

        // Create a new tab group with the new tab
        const groupId = await chrome.tabs.group({ tabIds: [newTab.id] });
        await chrome.tabGroups.update(groupId, { title: spaceName, color: 'grey' });

        const space = {
            id: groupId,
            uuid: generateUUID(),
            name: spaceName,
            spaceBookmarks: [],
            temporaryTabs: [newTab.id]
        };

        // Create bookmark folder for new space
        await getOrCreateSpaceFolder(space.name);

        spaces.push(space);
        console.log('New space created:', { spaceId: space.id, spaceName: space.name });

        createSpaceElement(space);
        updateSpaceSwitcher();
        setActiveSpace(space.id);
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
    } finally {

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

        console.log('Tab created:', tab.id);
        // Always ensure we have the current activeSpaceId
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            try {
                // Get the current active tab's group ID
                // const currentGroupId = await chrome.tabs.group({ tabIds: tab.id });
                const space = spaces.find(s => s.id === activeSpaceId);

                if (space) {
                    await moveTabToSpace(tab.id, space.id, false /* pinned? */);
                    // Optionally, update UI or switch to the tab if needed
                    await chrome.tabs.update(tab.id, { active: true });
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

        // Handle tab pinning state changes
        if (changeInfo.pinned !== undefined) {
            if (changeInfo.pinned) {
                moveTabToSpace(tabId, activeSpaceId, true /* pinned */);
            } else {
                moveTabToSpace(tabId, activeSpaceId, false /* pinned */);
            }
            // Update pinned favicons for both pinning and unpinning
            updatePinnedFavicons();
        }

        // Update tab element if it exists
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
            if (changeInfo.title) {
                tabElement.querySelector('.tab-title').textContent = changeInfo.title;
                // Update bookmark title if this is a pinned tab
                if (tabElement.closest('[data-tab-type="pinned"]')) {
                    updateBookmarkForTab(tab);
                }
            }
            if (changeInfo.favIconUrl) {
                tabElement.querySelector('.tab-favicon').src = changeInfo.favIconUrl || 'assets/default_icon.png';
            }
            if (changeInfo.url) {
                // Update bookmark URL if this is a pinned tab
                if (tabElement.closest('[data-tab-type="pinned"]')) {
                    updateBookmarkForTab(tab);
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


    // If not a pinned tab or bookmark not found, remove the element
    tabElement?.remove();


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

        if (spaceWithTab && spaceWithTab.id !== activeSpaceId) {
            // Switch to the space containing the tab
            activateSpaceInDOM(spaceWithTab.id);
            activateTabInDOM(activeInfo.tabId);
        } else {
            // Activate only the tab in the current space
            activateTabInDOM(activeInfo.tabId);
        }
    });
}

function deleteSpace(spaceId) {
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
            setActiveSpace(spaces[0].id);
        }

        // Save changes
        saveSpaces();
        updateSpaceSwitcher();
    }
}

////////////////////////////////////////////////////////////////
// -- Helper Functions
////////////////////////////////////////////////////////////////

async function getOrCreateArcifyFolder() {
    let [ folder ] = await chrome.bookmarks.search({ title: 'Arcify' });
    if (!folder) {
        folder = await chrome.bookmarks.create({ title: 'Arcify' });
    }
    return folder;
}

async function getOrCreateSpaceFolder(spaceName) {
    const arcifyFolder = await getOrCreateArcifyFolder();
    const children = await chrome.bookmarks.getChildren(arcifyFolder.id);
    let spaceFolder = children.find((f) => f.title === spaceName);

    if (!spaceFolder) {
        spaceFolder = await chrome.bookmarks.create({
            parentId: arcifyFolder.id,
            title: spaceName
        });
    }
    return spaceFolder;
}

async function moveTabToSpace(tabId, spaceId, pinned = false) {
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
        const tabElement = createTabElement(chromeTab, pinned);
        if (container.children.length > 1) {
            container.insertBefore(tabElement, container.firstChild);
        } else {
            container.appendChild(tabElement);
        }
    }

    // 5. Save the updated spaces to storage
    saveSpaces();
}

function activateTabInDOM(tabId) {
    // Remove active class from all tabs and pinned favicons
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pinned-favicon').forEach(f => f.classList.remove('active'));

    // If there's a tab element with this ID, mark it active
    const targetTab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

function activateSpaceInDOM(spaceId) {
    // Update global state
    activeSpaceId = spaceId;

    // Show/hide space containers
    document.querySelectorAll('.space').forEach(s => {
        const isActive = s.dataset.spaceId === String(spaceId);
        s.classList.toggle('active', isActive);
        s.style.display = isActive ? 'block' : 'none';
    });

    // Update space switcher
    updateSpaceSwitcher();
}
