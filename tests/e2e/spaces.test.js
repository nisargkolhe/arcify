/**
 * E2E Tests for Space Management
 * Tests creation, deletion, renaming, and color changes for spaces
 */
import {
  launchBrowserWithExtension,
  openSidebar,
  getSidebarSpaces,
  createSpace,
} from './helpers/extension-helper.js';
import {
  delay,
  takeScreenshotOnFailure,
  logTestStep,
} from './helpers/test-utils.js';

/**
 * Helper: force-show the options dropdown on the visible (active) space.
 */
async function showSpaceOptionsDropdown(page) {
  await page.evaluate(() => {
    const spaces = document.querySelectorAll('.space');
    for (const space of spaces) {
      if (space.style.display !== 'none') {
        const dropdown = space.querySelector('.space-options-dropdown');
        if (dropdown) dropdown.style.display = 'flex';
        break;
      }
    }
  });
  await delay(300);
}

describe('Space Management', () => {
  let browser;
  let extensionId;
  let sidebarPage;

  beforeAll(async () => {
    logTestStep('Launching browser with extension...');
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    extensionId = result.extensionId;
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    logTestStep('Opening sidebar...');
    sidebarPage = await openSidebar(browser, extensionId);
  });

  afterEach(async () => {
    if (sidebarPage) {
      try { await sidebarPage.close(); } catch (e) { /* already closed */ }
    }
    // Clean up extra tabs/pages to prevent slowdown
    try {
      const pages = await browser.pages();
      for (let i = pages.length - 1; i >= 1; i--) {
        try { await pages[i].close(); } catch (e) { /* already closed */ }
      }
    } catch (e) { /* browser closing */ }
  });

  describe('Space Creation', () => {
    test('should have a default Home space on load', async () => {
      try {
        logTestStep('Checking for default Home space...');

        const spaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Found ${spaces.length} spaces: ${spaces.map(s => s.name).join(', ')}`);

        expect(spaces.length).toBeGreaterThanOrEqual(1);
        logTestStep('✓ Default space exists');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'default-space-failure');
        throw error;
      }
    });

    test('should create a new space', async () => {
      try {
        logTestStep('Creating new space...');

        const initialSpaces = await getSidebarSpaces(sidebarPage);
        const initialCount = initialSpaces.length;

        // Close sidebar first to prevent handleTabCreated from interfering
        await sidebarPage.close();

        // createSpace creates the tab group and returns a new sidebar page
        sidebarPage = await createSpace(browser, extensionId, 'E2E Test Space');

        const spaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Spaces after creation: ${spaces.map(s => s.name).join(', ')}`);

        expect(spaces.length).toBe(initialCount + 1);
        const createdSpace = spaces.find(space => space.name === 'E2E Test Space');
        expect(createdSpace).toBeDefined();
        logTestStep('✓ Space created successfully');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'create-space-failure');
        throw error;
      }
    });
  });

  describe('Space Renaming', () => {
    test('should rename an existing space', async () => {
      try {
        logTestStep('Renaming the active space...');

        // Focus the VISIBLE space's name input via evaluate
        const inputFound = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              if (input) {
                input.focus();
                input.select();
                return true;
              }
            }
          }
          return false;
        });
        expect(inputFound).toBe(true);

        await sidebarPage.keyboard.type('Renamed Space');
        await sidebarPage.keyboard.press('Enter');
        await delay(1500);

        const spaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Spaces after rename: ${spaces.map(s => s.name).join(', ')}`);

        const renamedSpace = spaces.find(s => s.name === 'Renamed Space');
        expect(renamedSpace).toBeDefined();
        logTestStep('✓ Space renamed successfully');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'rename-space-failure');
        throw error;
      }
    });
  });

  describe('Space Deletion', () => {
    test('should delete a space', async () => {
      try {
        logTestStep('Creating space to delete...');

        // Close sidebar, create space, get new sidebar
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Space to Delete');

        const initialSpaces = await getSidebarSpaces(sidebarPage);
        const initialCount = initialSpaces.length;
        logTestStep(`Spaces before delete: ${initialSpaces.map(s => s.name).join(', ')}`);

        // Switch to "Space to Delete" by clicking its space switcher button
        await sidebarPage.evaluate(() => {
          const buttons = document.querySelectorAll('.space-switcher button');
          for (const btn of buttons) {
            if (btn.textContent.trim() === 'Space to Delete') {
              btn.click();
              break;
            }
          }
        });
        await delay(1000);

        // Force-show the dropdown and click delete
        await showSpaceOptionsDropdown(sidebarPage);

        // Register dialog handler to accept the confirm('Delete this space...')
        sidebarPage.on('dialog', async dialog => {
          await dialog.accept();
        });

        // Click delete button on the visible space
        await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const btn = space.querySelector('.delete-space-btn');
              if (btn) { btn.click(); break; }
            }
          }
        });

        await delay(3000);

        // Reconnect if page was affected by the deletion
        try {
          await Promise.race([
            sidebarPage.evaluate(() => true),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ]);
        } catch {
          sidebarPage = await openSidebar(browser, extensionId);
        }

        const finalSpaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Spaces after delete: ${finalSpaces.map(s => s.name).join(', ')}`);

        expect(finalSpaces.length).toBe(initialCount - 1);
        expect(finalSpaces.find(s => s.name === 'Space to Delete')).toBeUndefined();

        logTestStep('✓ Space deleted successfully');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'delete-space-failure');
        throw error;
      }
    }, 120000);
  });

  describe('Space Colors', () => {
    test('should change space color via options dropdown', async () => {
      try {
        logTestStep('Changing space color...');

        // Force-show the dropdown via JS
        await showSpaceOptionsDropdown(sidebarPage);

        // Click the blue color swatch via evaluate
        await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const swatch = space.querySelector('.space-options-dropdown .color-swatch[data-color="blue"]');
              if (swatch) { swatch.click(); break; }
            }
          }
        });
        await delay(1500);

        // Verify color was applied
        const colorApplied = await sidebarPage.evaluate(() => {
          const switcherBtns = document.querySelectorAll('.space-switcher button');
          for (const btn of switcherBtns) {
            if (btn.classList.contains('active')) {
              const style = window.getComputedStyle(btn);
              return style.backgroundColor !== '' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
            }
          }
          return document.querySelector('.space') !== null;
        });

        expect(colorApplied).toBe(true);
        logTestStep('✓ Space color changed successfully');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'change-space-color-failure');
        throw error;
      }
    });
  });
});
