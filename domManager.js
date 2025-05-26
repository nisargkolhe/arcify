import { Utils } from './utils.js';
import { RESTORE_ICON } from './icons.js';

// DOM Elements
const spacesList = document.getElementById('spacesList');
const spaceSwitcher = document.getElementById('spaceSwitcher');
const addSpaceBtn = document.getElementById('addSpaceBtn');
const newTabBtn = document.getElementById('newTabBtn');
const spaceTemplate = document.getElementById('spaceTemplate');

export function setupDOMElements(createNewSpace, createNewTab) {
    spaceSwitcher.addEventListener('wheel', (event) => {
        event.preventDefault();

        const scrollAmount = event.deltaY;

        spaceSwitcher.scrollLeft += scrollAmount;
    }, { passive: false });

    // Add event listeners for buttons
    addSpaceBtn.addEventListener('click', () => {
        const inputContainer = document.getElementById('addSpaceInputContainer');
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

    const createSpaceColorSwatch = document.getElementById('createSpaceColorSwatch');
    createSpaceColorSwatch.addEventListener('click', (e) => {
        if (e.target.classList.contains('color-swatch')) {
            const colorPicker = document.getElementById('createSpaceColorSwatch');
            const select = document.getElementById('spaceColor');
            const color = e.target.dataset.color;

            // Update selected swatch
            colorPicker.querySelectorAll('.color-swatch').forEach(swatch => {
                swatch.classList.remove('selected');
            });
            e.target.classList.add('selected');

            // Update hidden select value
            select.value = color;

            // Trigger change event on select
            const event = new Event('change');
            select.dispatchEvent(event);
        }
    });

    // Initialize selected swatches
    document.querySelectorAll('.space-color-select').forEach(select => {
        const colorPicker = select.nextElementSibling;
        const currentColor = select.value;
        const swatch = colorPicker.querySelector(`[data-color="${currentColor}"]`);
        if (swatch) {
            swatch.classList.add('selected');
        }
    });

    // Add input validation for new space name
    document.getElementById('newSpaceName').addEventListener('input', (e) => {
        const createSpaceBtn = document.getElementById('createSpaceBtn');
        createSpaceBtn.disabled = !e.target.value.trim();
    });
}

export function showSpaceNameInput() {
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

export function activateTabInDOM(tabId) {
    // Remove active class from all tabs and pinned favicons
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pinned-favicon').forEach(f => f.classList.remove('active'));

    // If there's a tab element with this ID, mark it active
    const targetTab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

export function activateSpaceInDOM(spaceId, spaces, updateSpaceSwitcher) {
    // Show/hide space containers
    document.querySelectorAll('.space').forEach(s => {
        const isActive = s.dataset.spaceId === String(spaceId);
        s.classList.toggle('active', isActive);
        s.style.display = isActive ? 'block' : 'none';
    });

    // Get space color and update sidebar container background
    const space = spaces.find(s => s.id === spaceId);
    if (space) {
        // Update background color
        const sidebarContainer = document.getElementById('sidebar-container');
        sidebarContainer.style.setProperty('--space-bg-color', `var(--chrome-${space.color}-color, rgba(255, 255, 255, 0.1))`);
        sidebarContainer.style.setProperty('--space-bg-color-dark', `var(--chrome-${space.color}-color-dark, rgba(255, 255, 255, 0.1))`);
    }

    // Update space switcher
    updateSpaceSwitcher();
}

export function showTabContextMenu(x, y, tab, isPinned, isBookmarkOnly, tabElement, closeTab) {
    // Remove any existing context menus
    const existingMenu = document.getElementById('tab-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const contextMenu = document.createElement('div');
    contextMenu.id = 'tab-context-menu';
    contextMenu.className = 'context-menu'; // Reuse general context menu styling
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;

    // --- Menu Items ---

    // 1. Archive Tab (Only for active tabs)
    if (!isBookmarkOnly) {
        const archiveOption = document.createElement('div');
        archiveOption.className = 'context-menu-item';
        archiveOption.textContent = 'Archive Tab';
        archiveOption.addEventListener('click', async () => {
            await Utils.archiveTab(tab.id); // Use the utility function
            contextMenu.remove();
        });
        contextMenu.appendChild(archiveOption);
    }

    // 2. TODO: Move tab to another space

    // 3. Close Tab / Remove Bookmark
    const closeOption = document.createElement('div');
    closeOption.className = 'context-menu-item';
    closeOption.textContent = isBookmarkOnly ? 'Remove Bookmark' : 'Close Tab';
    closeOption.addEventListener('click', () => {
        closeTab(tabElement, tab, isPinned, isBookmarkOnly);
        contextMenu.remove();
    });
    contextMenu.appendChild(closeOption);

    // --- Add to DOM and setup closing ---
    document.body.appendChild(contextMenu);

    // Close context menu when clicking outside
    const closeContextMenu = (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.remove();
            document.removeEventListener('click', closeContextMenu, { capture: true }); // Use capture phase
        }
    };
    // Use capture phase to catch clicks before they bubble up
    document.addEventListener('click', closeContextMenu, { capture: true });
}

export async function showArchivedTabsPopup(activeSpaceId) {
    const spaceElement = document.querySelector(`[data-space-id="${activeSpaceId}"]`);

    const popup = spaceElement.querySelector('.archived-tabs-popup');
    const list = popup.querySelector('.archived-tabs-list');
    const message = popup.querySelector('.no-archived-tabs-message');
    list.innerHTML = ''; // Clear previous items

    if (!(await Utils.isArchivingEnabled())) {
        message.textContent = 'Tab Archiving is disabled. Go to extension settings to enable.';
        list.style.display = 'none';
        return;
    }

    const allArchived = await Utils.getArchivedTabs();
    if (allArchived.length === 0) {
        message.textContent = 'No archived tabs.';
        list.style.display = 'none';
    } else {
        message.textContent = '';
        list.style.display = 'block';
        allArchived.forEach(archivedTab => {
            const item = document.createElement('div');
            item.className = 'tab archived-item';
            item.title = `${archivedTab.name}\n${archivedTab.url}\nArchived: ${new Date(archivedTab.archivedAt).toLocaleString()}`;

            const favicon = document.createElement('img');
            favicon.src = Utils.getFaviconUrl(archivedTab.url);
            favicon.className = 'tab-favicon';
            favicon.onerror = () => { favicon.src = 'assets/default_icon.png'; };

            const details = document.createElement('div');
            details.className = 'tab-details';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'tab-title-display';
            titleSpan.textContent = archivedTab.name;
            details.appendChild(titleSpan);

            const restoreButton = document.createElement('button');
            restoreButton.innerHTML = RESTORE_ICON;
            restoreButton.className = 'tab-restore';
            restoreButton.style.marginLeft = 'auto';
            restoreButton.addEventListener('click', (e) => {
                e.stopPropagation();
                Utils.restoreArchivedTab(archivedTab);
                item.remove();
                if (list.children.length === 0) {
                    message.style.display = 'block';
                    list.style.display = 'none';
                }
            });

            item.appendChild(favicon);
            item.appendChild(details);
            item.appendChild(restoreButton);
            list.appendChild(item);
        });
    }
}

export function setupQuickPinListener(spaces, moveTabToSpace, moveTabToPinned, moveTabToTemp) {
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.command === "quickPinToggle") {
            console.log("listening");
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                const currentTab = tabs[0];
                console.log("currentTab", currentTab);

                const spaceWithTempTab = spaces.find(space =>
                    space.temporaryTabs.includes(currentTab.id)
                );
                console.log("spaceWithTempTab", spaceWithTempTab);
                if (spaceWithTempTab) {
                    moveTabToSpace(currentTab.id, spaceWithTempTab.id, true);
                    moveTabToPinned(spaceWithTempTab, currentTab);
                } else {
                    const spaceWithBookmark = spaces.find(space =>
                        space.spaceBookmarks.includes(currentTab.id)
                    );
                    console.log("spaceWithBookmark", spaceWithBookmark);
                    if (spaceWithBookmark) {
                        moveTabToSpace(currentTab.id, spaceWithBookmark.id, false);
                        moveTabToTemp(spaceWithBookmark, currentTab);
                    }
                }
            });
        }
    });
} 