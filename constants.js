/**
 * Constants - Centralized CSS classes, selectors, and timing values
 *
 * Purpose: Single source of truth for hardcoded values used across the extension
 * Key Benefits: Eliminates magic strings, improves maintainability, enables easy refactoring
 */

// CSS class names used throughout the application
export const CSS_CLASSES = {
    // State classes
    ACTIVE: 'active',
    COLLAPSED: 'collapsed',
    HIDDEN: 'hidden',
    VISIBLE: 'visible',
    INACTIVE: 'inactive',
    DISABLED: 'disabled',

    // Drag and drop classes
    DRAGGING: 'dragging',
    DRAGGING_SWITCHER: 'dragging-switcher',
    DRAG_OVER: 'drag-over',
    DRAG_OVER_PLACEHOLDER_BEFORE: 'drag-over-placeholder-before',
    DRAG_OVER_PLACEHOLDER_AFTER: 'drag-over-placeholder-after',

    // Drop indicator classes
    DROP_INDICATOR_HORIZONTAL: 'drop-indicator-horizontal',
    DROP_INDICATOR_VERTICAL: 'drop-indicator-vertical',

    // Position classes for drop indicators
    ABOVE: 'above',
    BELOW: 'below',
    LEFT: 'left',
    RIGHT: 'right',

    // Tab classes
    TAB: 'tab',
    BOOKMARK_ONLY: 'bookmark-only',
    TAB_CLOSE: 'tab-close',
    TAB_REMOVE: 'tab-remove',
    TAB_FAVICON: 'tab-favicon',
    TAB_PLACEHOLDER: 'tab-placeholder',

    // Pinned/Favorites classes
    PINNED_FAVICON: 'pinned-favicon',
    PINNED_PLACEHOLDER_CONTAINER: 'pinned-placeholder-container',
    PINNED_BACK: 'pinned-back',

    // Folder classes
    FOLDER: 'folder',
    FOLDER_HEADER: 'folder-header',
    FOLDER_CONTENT: 'folder-content',
    FOLDER_NAME: 'folder-name',
    FOLDER_TITLE: 'folder-title',
    FOLDER_ICON: 'folder-icon',
    FOLDER_TOGGLE: 'folder-toggle',

    // Space classes
    SPACE: 'space',

    // UI feedback classes
    ERROR_POPUP: 'error-popup',
    SPOTLIGHT_ACTIVE: 'spotlight-active',
    URL_CHANGED_SLASH: 'tab-url-changed-slash',

    // Context menu classes
    CONTEXT_MENU: 'context-menu',
    CONTEXT_MENU_ITEM: 'context-menu-item',
    CONTEXT_MENU_SEPARATOR: 'context-menu-separator',
    WITH_SUBMENU: 'with-submenu',
    SUBMENU: 'submenu',
};

// DOM selectors for querying elements
export const SELECTORS = {
    // Tab selectors
    TAB_BY_ID: (tabId) => `[data-tab-id="${tabId}"]`,
    TAB_BY_URL: (url) => `[data-url="${CSS.escape(url)}"]`,
    ALL_TABS: '.tab',
    ACTIVE_TABS: '.tab.active',
    BOOKMARK_ONLY_TABS: '.tab.bookmark-only',
    DRAGGABLE_TABS: '.tab:not(.dragging), .folder:not(.dragging)',

    // Space selectors
    SPACE_BY_ID: (spaceId) => `[data-space-id="${spaceId}"]`,
    ALL_SPACES: '.space',

    // Container selectors
    PINNED_CONTAINER: '[data-tab-type="pinned"]',
    TEMP_CONTAINER: '[data-tab-type="temporary"]',

    // Pinned favicon selectors
    ALL_PINNED_FAVICONS: '.pinned-favicon',
    DRAGGABLE_PINNED_FAVICONS: '.pinned-favicon:not(.dragging)',
    ACTIVE_PINNED_FAVICONS: '.pinned-favicon.active',

    // Switcher selectors
    DRAGGABLE_SWITCHER_BUTTONS: 'button:not(.dragging-switcher)',

    // Folder selectors
    ALL_FOLDERS: '.folder',
    FOLDER_CONTENT: '.folder-content',

    // Template selectors
    TAB_TEMPLATE: '#tabTemplate',
    FOLDER_TEMPLATE: '#folderTemplate',
    SPACE_TEMPLATE: '#spaceTemplate',

    // UI element selectors
    SIDEBAR_CONTAINER: '#sidebar-container',
    SPACES_LIST: '#spacesList',
    SPACE_SWITCHER: '#spaceSwitcher',
    PINNED_FAVICONS: '#pinnedFavicons',
    ADD_SPACE_BTN: '#addSpaceBtn',
    NEW_TAB_BTN: '#newTabBtn',
    ADD_SPACE_INPUT_CONTAINER: '#addSpaceInputContainer',
    NEW_SPACE_NAME: '#newSpaceName',
    SPACE_COLOR: '#spaceColor',
    CREATE_SPACE_BTN: '#createSpaceBtn',
    CREATE_SPACE_COLOR_SWATCH: '#createSpaceColorSwatch',
    URL_COPY_TOAST: '#urlCopyToast',
    TAB_CONTEXT_MENU: '#tab-context-menu',

    // Placeholder selectors
    TAB_PLACEHOLDER: '.tab-placeholder',
    PINNED_PLACEHOLDER: '.pinned-placeholder-container',

    // Drop indicator selectors
    DROP_INDICATORS: '.drop-indicator-horizontal, .drop-indicator-vertical',
};

// Timing constants (in milliseconds unless noted)
export const TIMING = {
    // Auto-open delays
    FOLDER_AUTO_OPEN_DELAY: 250,

    // UI feedback durations
    ERROR_POPUP_DURATION: 3000,
    TOAST_DURATION: 2000,

    // Debounce intervals
    DEBOUNCE_DEFAULT: 250,
    DEBOUNCE_UI_REFRESH: 100,

    // Drag operation timing
    DRAG_CLASS_DELAY: 0, // setTimeout(fn, 0) for class addition
};

// Mouse button constants
export const MOUSE_BUTTON = {
    LEFT: 0,
    MIDDLE: 1,
    RIGHT: 2,
};

// Tab type constants
export const TAB_TYPE = {
    PINNED: 'pinned',
    TEMPORARY: 'temporary',
};

// Drop position constants
export const DROP_POSITION = {
    ABOVE: 'above',
    BELOW: 'below',
    LEFT: 'left',
    RIGHT: 'right',
};

// Axis constants for drag operations
export const AXIS = {
    X: 'x',
    Y: 'y',
};
