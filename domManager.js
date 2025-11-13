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

export function showTabContextMenu(x, y, tab, isPinned, isBookmarkOnly, tabElement, closeTab, spaces, moveTabToSpace, setActiveSpace, allBookmarkSpaceFolders, createSpaceFromInactive) {
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

    // Only show these options for actual tabs that are part of a space
    if (!isBookmarkOnly) {
        const addToFavoritesOption = document.createElement('div');
        addToFavoritesOption.className = 'context-menu-item';
        addToFavoritesOption.textContent = 'Add to Favorites';
        addToFavoritesOption.addEventListener('click', async () => {
            await chrome.tabs.update(tab.id, { pinned: true });
            contextMenu.remove();
        });
        contextMenu.appendChild(addToFavoritesOption);

        const pinInSpaceOption = document.createElement('div');
        pinInSpaceOption.className = 'context-menu-item';
        pinInSpaceOption.textContent = isPinned ? 'Unpin Tab' : 'Pin Tab';
        pinInSpaceOption.addEventListener('click', () => {
            chrome.runtime.sendMessage({ command: 'toggleSpacePin', tabId: tab.id });
            contextMenu.remove();
        });
        contextMenu.appendChild(pinInSpaceOption);

        // Add a separator
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        contextMenu.appendChild(separator);

        // 2. Move to Space
        const moveToSpaceItem = document.createElement('div');
        moveToSpaceItem.className = 'context-menu-item with-submenu';
        moveToSpaceItem.textContent = 'Move to Space';

        const submenu = document.createElement('div');
        submenu.className = 'context-menu submenu';

        // Add active spaces
        const currentSpace = spaces.find(s => s.temporaryTabs.includes(tab.id) || s.spaceBookmarks.includes(tab.id));
        const otherActiveSpaces = spaces.filter(s => s.id !== currentSpace?.id);
        otherActiveSpaces.forEach(space => {
            const submenuItem = document.createElement('div');
            submenuItem.className = 'context-menu-item';
            submenuItem.textContent = space.name;
            submenuItem.addEventListener('click', async (e) => {
                e.stopPropagation();
                contextMenu.remove(); // Close menu immediately for better UX

                await moveTabToSpace(tab.id, space.id, false);
                // Set the space as active, but prevent it from auto-activating a different tab
                await setActiveSpace(space.id, false);
                // Explicitly activate the tab that was just moved
                await chrome.tabs.update(tab.id, { active: true });
            });
            submenu.appendChild(submenuItem);
        });

        // Add inactive spaces
        const activeSpaceNames = new Set(spaces.map(s => s.name));
        const inactiveSpaceFolders = allBookmarkSpaceFolders.filter(f => !f.url && !activeSpaceNames.has(f.title));

        if (otherActiveSpaces.length > 0 && inactiveSpaceFolders.length > 0) {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            submenu.appendChild(separator);
        }

        inactiveSpaceFolders.forEach(folder => {
            const submenuItem = document.createElement('div');
            submenuItem.className = 'context-menu-item';
            submenuItem.textContent = folder.title;
            submenuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                createSpaceFromInactive(folder.title, tab);
                contextMenu.remove();
            });
            submenu.appendChild(submenuItem);
        });

        // Only add the "Move to" menu if there's somewhere to move to
        if (submenu.hasChildNodes()) {
            moveToSpaceItem.appendChild(submenu);
            contextMenu.appendChild(moveToSpaceItem);
        }
    }

    // Archive Tab (Only for active tabs)
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

    // Close Tab / Remove Bookmark
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
    list.innerHTML = '';

    // --- Archiving Controls ---
    let controls = popup.querySelector('.archiving-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.className = 'archiving-controls';
        popup.insertBefore(controls, list);
    } else {
        controls.innerHTML = '';
    }

    // Fetch current settings
    const settings = await Utils.getSettings();
    const archivingEnabled = settings.autoArchiveEnabled;
    const archiveTime = settings.autoArchiveIdleMinutes;

    // Toggle (styled)
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'archiving-toggle-label';
    const toggleWrapper = document.createElement('span');
    toggleWrapper.className = 'archiving-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = archivingEnabled;
    const slider = document.createElement('span');
    slider.className = 'archiving-toggle-slider';
    toggleWrapper.appendChild(toggle);
    toggleWrapper.appendChild(slider);
    toggleLabel.appendChild(toggleWrapper);
    toggleLabel.appendChild(document.createTextNode('Enable Archiving'));
    controls.appendChild(toggleLabel);

    // Archive time input (styled)
    const timeContainer = document.createElement('div');
    timeContainer.className = 'archiving-time-container';
    const timeInput = document.createElement('input');
    timeInput.type = 'number';
    timeInput.min = '1';
    timeInput.value = archiveTime;
    timeInput.className = 'archiving-time-input';
    timeInput.disabled = !archivingEnabled;
    const minLabel = document.createElement('span');
    minLabel.textContent = 'min';
    timeContainer.appendChild(timeInput);
    timeContainer.appendChild(minLabel);
    controls.appendChild(timeContainer);

    // Event listeners
    toggle.addEventListener('change', async (e) => {
        const enabled = toggle.checked;
        timeInput.disabled = !enabled;
        await Utils.setArchivingEnabled(enabled);
    });
    timeInput.addEventListener('change', async (e) => {
        let val = parseInt(timeInput.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        timeInput.value = val;
        await Utils.setArchiveTime(val);
    });

    // --- End Archiving Controls ---

    if (!archivingEnabled) {
        message.textContent = 'Tab Archiving is disabled. Use the toggle above to enable.';
        list.style.display = 'none';
        return;
    }

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

export function setupQuickPinListener(moveTabToSpace, moveTabToPinned, moveTabToTemp) {
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.command === "quickPinToggle" || request.command === "toggleSpacePin") {
            console.log(`[QuickPin] Received command: ${request.command}`, { request });
            chrome.storage.local.get('spaces', function(result) {
                const spaces = result.spaces || [];
                console.log("[QuickPin] Loaded spaces from storage:", spaces);

                const getTabAndToggle = (tabToToggle) => {
                    if (!tabToToggle) {
                        console.error("[QuickPin] No tab found to toggle.");
                        return;
                    }
                    console.log("[QuickPin] Toggling pin state for tab:", tabToToggle);

                    const spaceWithTempTab = spaces.find(space =>
                        space.temporaryTabs.includes(tabToToggle.id)
                    );

                    if (spaceWithTempTab) {
                        console.log(`[QuickPin] Tab ${tabToToggle.id} is a temporary tab in space "${spaceWithTempTab.name}". Pinning it.`);
                        moveTabToSpace(tabToToggle.id, spaceWithTempTab.id, true);
                        moveTabToPinned(spaceWithTempTab, tabToToggle);
                    } else {
                        const spaceWithBookmark = spaces.find(space =>
                            space.spaceBookmarks.includes(tabToToggle.id)
                        );

                        if (spaceWithBookmark) {
                            console.log(`[QuickPin] Tab ${tabToToggle.id} is a bookmarked tab in space "${spaceWithBookmark.name}". Unpinning it.`);
                            moveTabToSpace(tabToToggle.id, spaceWithBookmark.id, false);
                            moveTabToTemp(spaceWithBookmark, tabToToggle);
                        } else {
                            console.warn(`[QuickPin] Tab ${tabToToggle.id} not found in any space as temporary or bookmarked.`);
                        }
                    }
                };

                if (request.command === "quickPinToggle") {
                    console.log("[QuickPin] Handling quickPinToggle for active tab.");
                    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                        getTabAndToggle(tabs[0]);
                    });
                } else if (request.command === "toggleSpacePin" && request.tabId) {
                    console.log(`[QuickPin] Handling toggleSpacePin for tabId: ${request.tabId}`);
                    chrome.tabs.get(request.tabId, function(tab) {
                        getTabAndToggle(tab);
                    });
                }
            });
        }
    });
}
