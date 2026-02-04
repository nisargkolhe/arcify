# Codebase Structure

**Analysis Date:** 2026-02-03

## Directory Layout

```
/Users/nisargkolhe/arcsidebar/
├── background.js              # Service worker - Chrome API gateway, message routing, lifecycle
├── sidebar.js                 # Main UI - space/tab management, DOM rendering, state sync
├── sidebar.html               # Sidebar UI markup with templates
├── options.js                 # Settings page script
├── options.html               # Settings page UI
├── installation-onboarding.js # First-run setup flow
├── installation-onboarding.html
├── manifest.json              # Manifest V3 extension configuration
├── domManager.js              # DOM utilities - separates DOM from business logic
├── bookmark-utils.js          # Bookmark API wrapper with 3-method fallback
├── localstorage.js            # Chrome bookmark folder management
├── utils.js                   # Shared utilities - settings, UUID, favicon, archived tabs
├── chromeHelper.js            # Promise wrappers for Chrome APIs
├── logger.js                  # Centralized logging with debug setting support
├── icons.js                   # Icon SVG constants
├── styles.css                 # Main sidebar styling
├── installation-onboarding.css
├── package.json               # NPM dependencies (Vite, build tools)
├── vite.config.js             # Vite build configuration
├── vite.config.dev.js         # Development build config
├── vite-plugins/
│   └── vite-plugin-arcify-extension.js  # Custom Vite plugin for extension building
├── scripts/
│   ├── build-info.js          # Build information generator
│   ├── release.js             # Version bumping and tagging
│   └── zip.js                 # Chrome Web Store zip packaging
├── dist/                      # Production build output (gitignored)
├── dist-dev/                  # Development build output (gitignored)
├── assets/                    # Icon and image assets
├── .planning/                 # GSD documentation (this file)
├── .github/                   # GitHub workflows for CI/CD
├── src/                       # (Currently empty, reserved for TypeScript/future modularization)
│   ├── components/
│   ├── handlers/
│   └── utils/
└── node_modules/              # npm dependencies (gitignored)
```

## Directory Purposes

**Project Root:**
- Purpose: Main extension code and configuration
- Contains: Core .js files for all extension contexts (background, sidebar, options, onboarding)
- Key files: `background.js`, `sidebar.js`, `manifest.json`

**assets/ Directory:**
- Purpose: Static assets - extension icons and user-facing images
- Contains: PNG icons for extension branding and UI
- Key files: `icon.png` (128x128 extension icon)

**dist/ Directory:**
- Purpose: Production-ready extension build
- Contains: Processed .js files, bundled assets, manifest
- Generated: Yes (by `npm run build`)
- Committed: No

**dist-dev/ Directory:**
- Purpose: Development build with watch mode
- Contains: Source-mapped .js files for debugging
- Generated: Yes (by `npm run dev`)
- Committed: No

**vite-plugins/ Directory:**
- Purpose: Custom build configuration plugins
- Contains: Vite plugin for extension-specific processing
- Key files: `vite-plugin-arcify-extension.js`

**scripts/ Directory:**
- Purpose: Build and release automation
- Contains: NPM run script implementations
- Key files: `release.js` (version bumping), `zip.js` (Chrome Web Store packaging)

**src/ Directory:**
- Purpose: Reserved for future modularization (currently empty)
- Contains: Placeholder subdirectories for components, handlers, utils
- Note: Codebase currently flat in root; could migrate here for larger modules

## Key File Locations

**Entry Points:**
- `background.js`: Service worker entry point - handles Chrome API calls, messaging, auto-archive scheduling
- `sidebar.html` + `sidebar.js`: Side panel UI entry point - main user interface
- `options.html` + `options.js`: Extension settings page entry point
- `installation-onboarding.html` + `installation-onboarding.js`: First-run onboarding flow
- `manifest.json`: Extension manifest defining all permissions, entry points, and metadata

**Configuration:**
- `manifest.json`: Permissions, service worker, side panel config, keyboard commands
- `vite.config.js`: Production build configuration
- `vite.config.dev.js`: Development watch mode configuration
- `package.json`: Dependencies and build scripts

**Core Logic:**
- `sidebar.js`: Primary business logic - space/tab state management, Chrome API interaction
- `background.js`: Extension lifecycle, message routing, tab activity tracking, auto-archive
- `utils.js`: Shared utilities for settings, storage, UUID, favicon, tab name overrides
- `bookmark-utils.js`: Robust bookmark API wrapper with fallback strategies

**DOM & UI:**
- `domManager.js`: DOM creation/manipulation utilities, separates UI logic from business logic
- `styles.css`: All sidebar and UI styling
- `sidebar.html`: Sidebar markup with space/tab templates
- `icons.js`: SVG icon constants for UI elements

**Storage & Persistence:**
- `localstorage.js`: Bookmark folder creation and Chrome bookmark API helpers
- `logger.js`: Logging utility with debug toggle support

**Utilities:**
- `chromeHelper.js`: Promise wrappers for callback-based Chrome APIs
- `icons.js`: SVG constants for folder, restore, and menu icons

## Naming Conventions

**Files:**

- **Main scripts**: camelCase + .js
  - Examples: `background.js`, `sidebar.js`, `domManager.js`, `bookmark-utils.js`
  - Style: Lowercase, descriptive names, dash-separated for multi-word utilities

- **HTML files**: camelCase + .html
  - Examples: `sidebar.html`, `options.html`, `installation-onboarding.html`
  - Style: Matches corresponding script names

- **CSS files**: kebab-case + .css
  - Examples: `styles.css`, `installation-onboarding.css`
  - Style: Matches corresponding HTML/JS components

- **Config files**: lowercase, dot-separated
  - Examples: `manifest.json`, `vite.config.js`, `vite.config.dev.js`

- **Build/script files**: camelCase in `scripts/` directory
  - Examples: `build-info.js`, `release.js`, `zip.js`

**Directories:**

- **Source code**: Root level for core files, subdirectories for utilities
  - Pattern: Flat structure preferred (no deep nesting)
  - Special: `vite-plugins/`, `scripts/`, `assets/` contain specialized files

- **Utility modules**: Named by functionality
  - Examples: `bookmark-utils.js`, `domManager.js`, `chromeHelper.js`
  - Style: Descriptive, reflects responsibility

## Where to Add New Code

**New Feature (e.g., tab search, bulk operations):**
- **Primary code**: Add to root level as `feature-name.js` (e.g., `tab-search.js`)
- **UI components**: Add template to `sidebar.html`, styling to `styles.css`
- **Import in**: `sidebar.js` or `background.js` depending on context (UI vs. background)
- **Tests**: If testing added, create `feature-name.test.js` (no test runner currently configured)

**New Utility Module (e.g., color management, URL parsing):**
- **Implementation**: Add to root as `utility-name.js` (e.g., `color-utils.js`)
- **Export**: Use named export: `export const ColorUtils = { ... }`
- **Import pattern**: `import { ColorUtils } from './color-utils.js'`
- **Example**: `bookmark-utils.js` pattern - static object with named methods

**New Storage Feature (new sync/local setting):**
- **Define in**: `utils.js` - add to `getSettings()` default object and setter functions
- **UI control**: Add to `options.html` and handling in `options.js`
- **Cross-context access**: Use `Utils.getSetting()` or `Utils.setSetting()` from any context

**New DOM Component (new UI section in sidebar):**
- **Template**: Add to `sidebar.html` as a `<template>` element
- **Rendering**: Create function in `domManager.js` following naming pattern: `create<ComponentName>()`
- **Styling**: Add CSS classes to `styles.css` using existing naming conventions
- **Event handlers**: Attach in `sidebar.js` using delegated listeners or direct `addEventListener()`

**New Background Task (background.js):**
- **Handler**: Add listener to `background.js` (e.g., `chrome.alarms.onAlarm.addListener()`)
- **Message routing**: If coordinating with sidebar, add handler to `chrome.runtime.onMessage.addListener()`
- **Chrome APIs**: All Chrome API calls go here; other contexts message to background

**New Settings/Options:**
- **HTML UI**: Add form control to `options.html`
- **Script handling**: Add to `options.js` saveOptions() and loadOptions() functions
- **Storage default**: Add to `Utils.getSettings()` default object
- **Usage**: Access via `Utils.getSetting('settingName')` from any context

## Special Directories

**assets/ Directory:**
- Purpose: Static extension assets
- Generated: No
- Committed: Yes
- Contents: Icon files required by manifest, user-facing images

**dist/ & dist-dev/ Directories:**
- Purpose: Build outputs
- Generated: Yes (Vite)
- Committed: No (.gitignored)
- dist/: Production build with minification
- dist-dev/: Development build with source maps, watch mode compatible

**node_modules/ Directory:**
- Purpose: NPM dependencies
- Generated: Yes (npm install)
- Committed: No (.gitignored)
- Key packages: Vite (build tool), vite-plugin-web-extension (MV3 support), archiver (ZIP creation)

**.planning/ Directory:**
- Purpose: GSD (Get Stuff Done) codebase documentation
- Generated: No (manually created by GSD mapper)
- Committed: Yes
- Contents: Architecture, structure, conventions, testing, concerns analysis documents

## File Organization Patterns

**Imports in sidebar.js (main UI file):**
```javascript
import { ChromeHelper } from './chromeHelper.js';
import { Utils } from './utils.js';
import { setupDOMElements, ... } from './domManager.js';
import { BookmarkUtils } from './bookmark-utils.js';
import { LocalStorage } from './localstorage.js';
import { Logger } from './logger.js';
```
- Pattern: Utility imports first (ChromeHelper, Utils), then DOM (domManager), then storage (BookmarkUtils, LocalStorage), then logging
- All relative paths, ES6 modules

**Imports in utility files (e.g., utils.js):**
```javascript
import { BookmarkUtils } from './bookmark-utils.js';
import { Logger } from './logger.js';
```
- Pattern: Minimal dependencies, only what's needed
- Avoid circular imports (utils ← bookmarks-utils → logger)

**Export pattern:**
```javascript
// For single responsibility modules:
export const ModuleName = {
  method1: async function() { ... },
  method2: function() { ... }
};

// For Logger (exception - exported as object):
export { Logger };
```
- Consistent use of named exports
- Static object pattern for utility modules (no classes)

## File Size & Complexity

**Largest files (main logic):**
- `sidebar.js` (5900+ lines): Main UI and state management, can be refactored
- `background.js` (500+ lines): Extension lifecycle and message handling
- `domManager.js` (700+ lines): DOM utilities and component creation
- `bookmark-utils.js` (300+ lines): Bookmark operations with fallbacks
- `utils.js` (600+ lines): Shared utilities and settings management

**Smallest utility files:**
- `chromeHelper.js` (35 lines): Simple promise wrappers
- `icons.js` (140 lines): Icon SVG constants
- `logger.js` (140 lines): Logging utility

**Note on sidebar.js:**
The 5900+ line sidebar.js file is a refactoring candidate. Could split into:
- `space-manager.js` - space CRUD and activation
- `tab-manager.js` - tab lifecycle and drag-drop
- `archive-manager.js` - archived tabs handling
However, current flat structure works due to browser extension context constraints.

