# Technology Stack

**Analysis Date:** 2026-02-03

## Languages

**Primary:**
- JavaScript (ES6+) - All extension code, scripts, and configuration
- HTML5 - UI markup for sidebar, options page, and onboarding flows
- CSS3 - Styling for all extension UI components

**Build/Config:**
- JavaScript (Node.js) - Build scripts and Vite configuration

## Runtime

**Environment:**
- Chrome Extension (Manifest V3)
- Service Worker runtime for background.js
- DOM context for sidebar.html, options.html, onboarding pages

**Package Manager:**
- npm (Node Package Manager)
- Lockfile: package-lock.json present

## Frameworks

**Core:**
- Vite 6.0.0 - Build tool and development server
- Chrome Extensions API - Native extension framework (no wrapper library)

**Build/Dev:**
- vite-plugin-web-extension 4.4.3 - Web extension build support
- vite-plugin-singlefile 2.3.0 - Bundle assets into single files
- archiver 6.0.1 - ZIP archive creation for distribution
- fs-extra 11.2.0 - Enhanced file system operations

## Key Dependencies

**Critical:**
- vite 6.0.0 - Build bundler and dev server
- vite-plugin-web-extension 4.4.3 - Handles manifest.json and extension-specific bundling
- archiver 6.0.1 - Creates deployment ZIP for Chrome Web Store

**Infrastructure:**
- fs-extra 11.2.0 - File system utilities for build scripts

## Configuration

**Environment:**
- No environment variables or .env files in use
- All configuration via manifest.json (Manifest V3)
- Runtime settings stored in chrome.storage.sync and chrome.storage.local (see INTEGRATIONS.md)

**Build:**
- `vite.config.js` - Production build config
- `vite.config.dev.js` - Development build config with watch mode
- `vite-plugins/vite-plugin-arcify-extension.js` - Custom plugin handling extension-specific bundling
- `manifest.json` - Chrome extension manifest (Manifest V3)

**Build Outputs:**
- Production: `dist/` directory
- Development: `dist-dev/` directory
- Distribution: `arcify-extension.zip` for Chrome Web Store

## Platform Requirements

**Development:**
- Node.js with npm (version requirements: check in local Node environment)
- Chrome browser for testing and loading unpacked extension

**Production:**
- Chrome browser (Manifest V3 support required - Chrome 88+)
- Runs in:
  - Service Worker context (background.js)
  - Side Panel UI context (sidebar.html)
  - Options page context (options.html)
  - Content script contexts (injected on all URLs)
  - Custom new tab context (if spotlight feature deployed)

## Extension Architecture

**Manifest Version:** 3

**Key Entry Points:**
- `background.js` - Service worker (extension lifecycle, message routing, Chrome API access)
- `sidebar.js` - Side panel UI (main space/tab management interface)
- `options.js` - Settings/preferences page
- `installation-onboarding.js` - First-run onboarding experience
- `sidebar.html`, `options.html`, `installation-onboarding.html` - UI markup

**Script Organization:**
- All source JavaScript files in root directory: `*.js`
- Utility modules: `utils.js`, `logger.js`, `bookmark-utils.js`, `domManager.js`, `localstorage.js`, `chromeHelper.js`, `icons.js`
- No TypeScript - Pure JavaScript with JSDoc comments for type hints
- ES6 modules (`type: "module"` in package.json)

## Build Commands

```bash
npm run dev          # Development build with watch mode (outputs to dist-dev/)
npm run build        # Production build (outputs to dist/)
npm run build:zip    # Build + create arcify-extension.zip for distribution
npm run clean        # Remove dist/, dist-dev/, and zip files
npm run release <type>  # Bump version (patch/minor/major) and push git tag
npm run info         # Show build information
```

## Development Workflow

**Loading in Chrome:**
1. Run `npm run dev` for watch mode builds
2. Navigate to `chrome://extensions/`
3. Enable "Developer Mode"
4. Click "Load unpacked" and select `dist-dev/` directory
5. Changes auto-reload when saved (vite watch mode)

**Publishing:**
1. Bump version: `npm run release patch|minor|major`
2. Create distribution: `npm run build:zip`
3. Upload `arcify-extension.zip` to Chrome Web Store

---

*Stack analysis: 2026-02-03*
