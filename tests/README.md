# E2E Testing Guide

This directory contains end-to-end (E2E) tests for the Arcify sidebar extension using Puppeteer and Jest.

## 🚀 Quick Start

```bash
# Run all E2E tests
npm test

# Run specific test suites
npm run test:spaces      # Test space management
npm run test:tabs        # Test tab management
npm run test:bookmarks   # Test pinned tabs/bookmarks
npm run test:spotlight   # Test spotlight search
npm run test:drag        # Test drag-and-drop

# Run tests with visible browser (non-headless)
npm run test:e2e:headed

# Watch mode for development
npm run test:e2e:watch
```

## 📁 Project Structure

```
tests/
├── e2e/
│   ├── helpers/
│   │   ├── extension-helper.js    # Extension-specific utilities
│   │   └── test-utils.js          # Common test utilities
│   ├── fixtures/                   # Test data and fixtures
│   ├── screenshots/                # Test failure screenshots
│   ├── spaces.test.js             # Space management tests
│   ├── tabs.test.js               # Tab management tests
│   ├── bookmarks.test.js          # Bookmark/pinned tab tests
│   ├── spotlight.test.js          # Spotlight search tests
│   ├── drag-drop.test.js          # Drag and drop tests
│   ├── setup.js                   # Per-suite setup
│   ├── global-setup.js            # Global setup
│   └── global-teardown.js         # Global teardown
└── README.md                       # This file
```

## 🧪 Test Suites

### Space Management (`spaces.test.js`)
- Space creation
- Space renaming
- Space deletion
- Space color changes
- Multiple space handling

### Tab Management (`tabs.test.js`)
- Tab display and rendering
- Tab switching/activation
- Tab closing
- Tab organization within spaces
- Context menu interactions

### Bookmarks (`bookmarks.test.js`)
- Tab pinning/unpinning
- Keyboard shortcut (Alt+D) for quick pin
- Pinned tabs display
- Space bookmark management
- Bookmark persistence

### Spotlight Search (`spotlight.test.js`)
- Spotlight activation (Alt+L, Alt+T)
- Tab search
- Bookmark search
- History search
- Search suggestions
- Keyboard navigation (arrow keys, Enter, Escape)
- Result selection
- Search debouncing

### Drag and Drop (`drag-drop.test.js`)
- Tab dragging and reordering
- Moving tabs between spaces
- Space reordering
- Visual feedback during drag
- Drop zone indicators
- Drag event handling

## 🛠️ Helper Functions

### Extension Helpers (`extension-helper.js`)
- `launchBrowserWithExtension()` - Launch Chrome with extension loaded
- `openSidebar()` - Open the extension sidebar
- `openOptionsPage()` - Open extension options
- `getSidebarTabs()` - Get all tabs from sidebar
- `getSidebarSpaces()` - Get all spaces from sidebar
- `clickElement()` - Click an element by selector
- `typeIntoField()` - Type text into input field
- `clearExtensionStorage()` - Clear extension storage for clean tests

### Test Utilities (`test-utils.js`)
- `delay()` - Create async delay
- `randomString()` - Generate random strings
- `generateTestTabs()` - Generate test tab data
- `generateTestSpaces()` - Generate test space data
- `takeScreenshotOnFailure()` - Capture screenshots on failures
- `retry()` - Retry function with exponential backoff
- `waitForElementCount()` - Wait for specific element count

## 🎯 Writing Tests

### Basic Test Structure

```javascript
import {
  launchBrowserWithExtension,
  openSidebar,
} from './helpers/extension-helper.js';
import { delay, logTestStep } from './helpers/test-utils.js';

describe('Feature Name', () => {
  let browser, extensionId, sidebarPage;

  beforeAll(async () => {
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    extensionId = result.extensionId;
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  beforeEach(async () => {
    sidebarPage = await openSidebar(browser, extensionId);
    await delay(1000);
  });

  afterEach(async () => {
    if (sidebarPage) await sidebarPage.close();
  });

  test('should do something', async () => {
    logTestStep('Testing feature...');
    // Test implementation
  });
});
```

### Best Practices

1. **Always add delays** after actions - Chrome extensions need time to update UI
2. **Use helper functions** - Don't duplicate selector logic
3. **Take screenshots on failure** - Use `takeScreenshotOnFailure()` in catch blocks
4. **Log test steps** - Use `logTestStep()` for better debugging
5. **Clean up resources** - Close pages, clear storage when needed
6. **Handle missing elements gracefully** - Extension UI might vary
7. **Use data attributes** - Prefer `data-*` selectors over classes

### Example Test

```javascript
test('should create a new space', async () => {
  try {
    logTestStep('Creating new space...');

    await clickElement(sidebarPage, '#createSpaceBtn');
    await delay(500);

    await typeIntoField(sidebarPage, '#spaceNameInput', 'Test Space');
    await sidebarPage.keyboard.press('Enter');
    await delay(1000);

    const spaces = await getSidebarSpaces(sidebarPage);
    const newSpace = spaces.find(s => s.name === 'Test Space');

    expect(newSpace).toBeDefined();
    logTestStep('✓ Space created successfully');
  } catch (error) {
    await takeScreenshotOnFailure(sidebarPage, 'create-space-failure');
    throw error;
  }
});
```

## 🔧 Configuration

### Environment Variables

- `HEADLESS` - Run tests in headless mode (default: `true`)
- `EXTENSION_PATH` - Path to built extension (default: `./dist`)
- `CI` - Running in CI environment

### Jest Configuration

See `jest.config.js` in project root for Jest settings.

## 🐛 Debugging

### Run Tests with Visible Browser

```bash
npm run test:e2e:headed
```

### Run Single Test File

```bash
npx jest tests/e2e/spaces.test.js
```

### Enable Chrome DevTools

In `extension-helper.js`, set `devtools: true` in launch options.

### Check Screenshots

Failed tests automatically save screenshots to `tests/e2e/screenshots/`.

## 📊 CI/CD Integration

Tests run automatically on GitHub Actions:
- On push to `main` and `develop` branches
- On pull requests
- Can be triggered manually via `workflow_dispatch`

See `.github/workflows/e2e-tests.yml` for CI configuration.

## 🔍 Troubleshooting

### Tests Timeout
- Increase timeout in `jest.config.js`
- Add more delays after actions
- Check if extension loaded properly

### Element Not Found
- Verify selectors match current DOM structure
- Add wait for element with `waitForElement()`
- Check if element is in iframe or shadow DOM

### Extension Not Loading
- Ensure `npm run build` completed successfully
- Check `dist/` directory exists
- Verify manifest.json is valid

### Drag and Drop Not Working
- Puppeteer's drag API can be finicky
- Try increasing `steps` in mouse movements
- Add delays between drag actions
- Verify elements have `draggable` attribute

## 📚 Resources

- [Puppeteer Documentation](https://pptr.dev/)
- [Jest Documentation](https://jestjs.io/)
- [Chrome Extension Testing Guide](https://developer.chrome.com/docs/extensions/mv3/tut_testing/)

## 🤝 Contributing

When adding new tests:
1. Follow existing test structure
2. Add helper functions for reusable logic
3. Include descriptive test names
4. Add error handling with screenshots
5. Update this README if adding new test suites
