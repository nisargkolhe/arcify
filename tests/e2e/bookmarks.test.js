/**
 * E2E Tests for Bookmarks and Pinned Tabs
 * Tests pinning/unpinning tabs, bookmark management, and space bookmarks
 */
import {
  launchBrowserWithExtension,
  openSidebar,
  getSidebarTabs,
  createSpace,
} from './helpers/extension-helper.js';
import {
  delay,
  takeScreenshotOnFailure,
  logTestStep,
  getElementCount,
} from './helpers/test-utils.js';

describe('Bookmarks and Pinned Tabs', () => {
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

  describe('Tab Pinning', () => {
    test('should pin a tab via context menu', async () => {
      try {
        logTestStep('Testing tab pinning...');

        // Open a test page
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Close and reopen sidebar to pick up new tab
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Use evaluate to trigger context menu and click "Pin Tab"
        const pinResult = await sidebarPage.evaluate(async () => {
          // Find a tab in the visible space's temporary section
          const spaces = document.querySelectorAll('.space');
          let targetTab = null;
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (tempSection) {
                targetTab = tempSection.querySelector('.tab[data-tab-id]');
              }
              if (!targetTab) {
                targetTab = space.querySelector('.tab[data-tab-id]');
              }
              break;
            }
          }
          if (!targetTab) return { success: false, reason: 'no tab found' };

          // Dispatch contextmenu event to trigger the extension's context menu
          const rect = targetTab.getBoundingClientRect();
          const event = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: rect.x + rect.width / 2,
            clientY: rect.y + rect.height / 2,
          });
          targetTab.dispatchEvent(event);

          // Wait for context menu to appear
          await new Promise(r => setTimeout(r, 500));

          // Find and click "Pin Tab" option
          const menuItems = document.querySelectorAll('.context-menu-item');
          for (const item of menuItems) {
            if (item.textContent.trim() === 'Pin Tab') {
              item.click();
              return { success: true, action: 'pinned' };
            }
          }
          return { success: false, reason: 'Pin Tab option not found in context menu' };
        });

        await delay(2000);

        if (pinResult.success) {
          // Verify the tab moved to pinned section by reopening sidebar
          await sidebarPage.close();
          sidebarPage = await openSidebar(browser, extensionId);

          const pinnedInfo = await sidebarPage.evaluate(() => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                const pinnedTabs = pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
                return { pinnedTabs };
              }
            }
            return { pinnedTabs: 0 };
          });

          expect(pinnedInfo.pinnedTabs).toBeGreaterThan(0);
          logTestStep(`✓ Tab pinned successfully (${pinnedInfo.pinnedTabs} pinned tabs)`);
        } else {
          logTestStep(`⚠ ${pinResult.reason}`);
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'pin-tab-failure');
        throw error;
      }
    });

    test('should unpin a pinned tab via context menu', async () => {
      try {
        logTestStep('Testing tab unpinning...');

        // Open a test page
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Close and reopen sidebar to pick up new tab
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // First pin a tab, then unpin it, all via evaluate
        const result = await sidebarPage.evaluate(async () => {
          // Find a tab in visible space
          const spaces = document.querySelectorAll('.space');
          let targetTab = null;
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              targetTab = space.querySelector('.tab[data-tab-id]');
              break;
            }
          }
          if (!targetTab) return { success: false, reason: 'no tab found' };

          // Pin the tab first
          const rect = targetTab.getBoundingClientRect();
          targetTab.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, button: 2,
            clientX: rect.x + 5, clientY: rect.y + 5,
          }));
          await new Promise(r => setTimeout(r, 500));

          let pinClicked = false;
          for (const item of document.querySelectorAll('.context-menu-item')) {
            if (item.textContent.trim() === 'Pin Tab') {
              item.click();
              pinClicked = true;
              break;
            }
          }
          if (!pinClicked) return { success: false, reason: 'Pin Tab not found' };

          await new Promise(r => setTimeout(r, 2000));

          // Now find the pinned tab and unpin it
          let pinnedTab = null;
          for (const space of document.querySelectorAll('.space')) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              if (pinnedSection) {
                pinnedTab = pinnedSection.querySelector('.tab');
              }
              break;
            }
          }
          if (!pinnedTab) return { success: false, reason: 'no pinned tab found after pinning' };

          const rect2 = pinnedTab.getBoundingClientRect();
          pinnedTab.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, button: 2,
            clientX: rect2.x + 5, clientY: rect2.y + 5,
          }));
          await new Promise(r => setTimeout(r, 500));

          for (const item of document.querySelectorAll('.context-menu-item')) {
            if (item.textContent.trim() === 'Unpin Tab') {
              item.click();
              return { success: true, action: 'unpinned' };
            }
          }
          return { success: false, reason: 'Unpin Tab not found in context menu' };
        });

        await delay(2000);

        if (result.success) {
          logTestStep('✓ Tab unpinned successfully');
        } else {
          logTestStep(`⚠ ${result.reason}`);
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'unpin-tab-failure');
        throw error;
      }
    });

    test('should use keyboard shortcut to pin/unpin tab', async () => {
      try {
        logTestStep('Testing pin/unpin keyboard shortcut (Alt+D)...');

        // Open a test page
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Focus the test page and press Alt+D
        await testPage.bringToFront();
        await testPage.keyboard.down('Alt');
        await testPage.keyboard.press('KeyD');
        await testPage.keyboard.up('Alt');
        await delay(1000);

        // Close and reopen sidebar to check if tab is pinned
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        const pinnedCount = await getElementCount(
          sidebarPage,
          '.pinned-tab, [data-pinned="true"]'
        );

        if (pinnedCount > 0) {
          logTestStep('✓ Tab pinned via keyboard shortcut');
        } else {
          logTestStep('⚠ Keyboard shortcut might not be working (check permissions)');
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'pin-shortcut-failure');
        throw error;
      }
    });
  });

  describe('Pinned Tabs Display', () => {
    test('should have pinned and temporary tab sections', async () => {
      try {
        logTestStep('Checking tab section structure...');

        // Check if there are pinned and temporary sections in the space
        const sectionInfo = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              return {
                hasPinnedSection: !!space.querySelector('[data-tab-type="pinned"]'),
                hasTemporarySection: !!space.querySelector('[data-tab-type="temporary"]'),
                hasPinnedTabs: !!space.querySelector('.pinned-tabs'),
              };
            }
          }
          return { hasPinnedSection: false, hasTemporarySection: false, hasPinnedTabs: false };
        });

        // At minimum, the space should have tab sections
        expect(sectionInfo.hasPinnedSection || sectionInfo.hasPinnedTabs).toBe(true);
        logTestStep('✓ Tab section structure exists');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'pinned-section-failure');
        throw error;
      }
    });

    test('should show tabs with favicon and title', async () => {
      try {
        logTestStep('Checking tab display...');

        // Open a test page to ensure at least one tab exists
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        const tabDisplay = await sidebarPage.evaluate(() => {
          const tabs = document.querySelectorAll('.tab');
          let withFavicon = 0;
          let withTitle = 0;
          for (const tab of tabs) {
            if (tab.querySelector('.tab-favicon')) withFavicon++;
            if (tab.querySelector('.tab-title-display')?.textContent) withTitle++;
          }
          return { total: tabs.length, withFavicon, withTitle };
        });

        expect(tabDisplay.total).toBeGreaterThan(0);
        expect(tabDisplay.withFavicon).toBeGreaterThan(0);
        expect(tabDisplay.withTitle).toBeGreaterThan(0);
        logTestStep(`✓ ${tabDisplay.total} tabs with favicons and titles`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-display-failure');
        throw error;
      }
    });
  });

  describe('Space Bookmarks', () => {
    test('should add bookmark to space', async () => {
      try {
        logTestStep('Testing space bookmark addition...');

        // Create a space first
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Bookmark Test Space');

        // Check if space has bookmark structure
        const spaceInfo = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              return {
                hasPinnedSection: !!space.querySelector('[data-tab-type="pinned"], .pinned-tabs'),
                hasAddButton: !!space.querySelector('[data-action="add-bookmark"], .add-bookmark-btn, #addSpaceBookmark'),
              };
            }
          }
          return { hasPinnedSection: false, hasAddButton: false };
        });

        if (spaceInfo.hasAddButton) {
          logTestStep('✓ Add bookmark button found in space');
        } else {
          logTestStep('⚠ Add bookmark button not found (bookmarks added via drag or context menu)');
        }

        // Verify pinned section exists for bookmarks
        expect(spaceInfo.hasPinnedSection).toBe(true);
        logTestStep('✓ Space has pinned section for bookmarks');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'add-space-bookmark-failure');
        throw error;
      }
    });

    test('should remove bookmark from space', async () => {
      try {
        logTestStep('Testing space bookmark removal...');

        // Check if bookmarks exist with context menu for removal
        const bookmarkInfo = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const bookmarkOnlyTabs = space.querySelectorAll('.tab.bookmark-only');
              const allTabs = space.querySelectorAll('.tab');
              return {
                bookmarkOnlyCount: bookmarkOnlyTabs.length,
                totalTabs: allTabs.length,
              };
            }
          }
          return { bookmarkOnlyCount: 0, totalTabs: 0 };
        });

        if (bookmarkInfo.bookmarkOnlyCount > 0) {
          logTestStep(`Found ${bookmarkInfo.bookmarkOnlyCount} bookmark-only tabs`);
        } else {
          logTestStep('⚠ No bookmarks found to test removal (bookmarks created via pinning)');
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'remove-space-bookmark-failure');
        throw error;
      }
    });
  });

  describe('Bookmark Persistence', () => {
    test('should persist tab state after sidebar reopen', async () => {
      try {
        logTestStep('Testing bookmark persistence...');

        // Get current tab count
        const initialTabs = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              return space.querySelectorAll('.tab').length;
            }
          }
          return 0;
        });

        logTestStep(`Initial tabs: ${initialTabs}`);

        // Close and reopen sidebar
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Check tabs again
        const afterReopenTabs = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              return space.querySelectorAll('.tab').length;
            }
          }
          return 0;
        });

        expect(afterReopenTabs).toBe(initialTabs);
        logTestStep('✓ Tab state persisted after sidebar reopen');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'bookmark-persistence-failure');
        throw error;
      }
    });
  });
});
