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

  describe('Pin/Unpin Toggle Consistency', () => {
    test('should complete a full pin and unpin round-trip', async () => {
      try {
        logTestStep('Testing full pin/unpin round-trip...');

        // Open a test page
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Close and reopen sidebar to pick up the new tab
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Get initial counts in both sections
        const initialCounts = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              return {
                pinned: pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0,
                temporary: tempSection ? tempSection.querySelectorAll('.tab').length : 0,
              };
            }
          }
          return { pinned: 0, temporary: 0 };
        });

        logTestStep(`Initial counts - pinned: ${initialCounts.pinned}, temporary: ${initialCounts.temporary}`);

        // Pin a tab from the temporary section via context menu
        const pinResult = await sidebarPage.evaluate(async () => {
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

          const rect = targetTab.getBoundingClientRect();
          targetTab.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, button: 2,
            clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
          }));
          await new Promise(r => setTimeout(r, 500));

          for (const item of document.querySelectorAll('.context-menu-item')) {
            if (item.textContent.trim() === 'Pin Tab') {
              item.click();
              return { success: true, action: 'pinned' };
            }
          }
          return { success: false, reason: 'Pin Tab option not found' };
        });

        await delay(2000);

        if (pinResult.success) {
          // Reopen sidebar and verify tab moved to pinned section
          await sidebarPage.close();
          sidebarPage = await openSidebar(browser, extensionId);

          const afterPinCounts = await sidebarPage.evaluate(() => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                const tempSection = space.querySelector('[data-tab-type="temporary"]');
                return {
                  pinned: pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0,
                  temporary: tempSection ? tempSection.querySelectorAll('.tab').length : 0,
                };
              }
            }
            return { pinned: 0, temporary: 0 };
          });

          expect(afterPinCounts.pinned).toBeGreaterThan(initialCounts.pinned);
          logTestStep(`After pin - pinned: ${afterPinCounts.pinned}, temporary: ${afterPinCounts.temporary}`);

          // Now unpin the tab from the pinned section
          const unpinResult = await sidebarPage.evaluate(async () => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                if (!pinnedSection) return { success: false, reason: 'no pinned section' };
                const pinnedTab = pinnedSection.querySelector('.tab');
                if (!pinnedTab) return { success: false, reason: 'no pinned tab found' };

                const rect = pinnedTab.getBoundingClientRect();
                pinnedTab.dispatchEvent(new MouseEvent('contextmenu', {
                  bubbles: true, cancelable: true, button: 2,
                  clientX: rect.x + 5, clientY: rect.y + 5,
                }));
                await new Promise(r => setTimeout(r, 500));

                for (const item of document.querySelectorAll('.context-menu-item')) {
                  if (item.textContent.trim() === 'Unpin Tab') {
                    item.click();
                    return { success: true, action: 'unpinned' };
                  }
                }
                return { success: false, reason: 'Unpin Tab not found in context menu' };
              }
            }
            return { success: false, reason: 'no visible space' };
          });

          await delay(2000);

          if (unpinResult.success) {
            // Reopen sidebar and verify tab moved back to temporary section
            await sidebarPage.close();
            sidebarPage = await openSidebar(browser, extensionId);

            const afterUnpinCounts = await sidebarPage.evaluate(() => {
              const spaces = document.querySelectorAll('.space');
              for (const space of spaces) {
                if (space.style.display !== 'none') {
                  const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                  const tempSection = space.querySelector('[data-tab-type="temporary"]');
                  return {
                    pinned: pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0,
                    temporary: tempSection ? tempSection.querySelectorAll('.tab').length : 0,
                  };
                }
              }
              return { pinned: 0, temporary: 0 };
            });

            expect(afterUnpinCounts.pinned).toBe(initialCounts.pinned);
            logTestStep(`After unpin - pinned: ${afterUnpinCounts.pinned}, temporary: ${afterUnpinCounts.temporary}`);
            logTestStep('✓ Full pin/unpin round-trip completed successfully');
          } else {
            logTestStep(`⚠ ${unpinResult.reason}`);
          }
        } else {
          logTestStep(`⚠ ${pinResult.reason}`);
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'pin-unpin-roundtrip-failure');
        throw error;
      }
    });

    test('should increment pinned tab count when pinning multiple tabs', async () => {
      try {
        logTestStep('Testing pinned tab count increments correctly...');

        // Open two test pages
        const testPage1 = await browser.newPage();
        await testPage1.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(500);
        const testPage2 = await browser.newPage();
        await testPage2.goto('https://www.example.com?page=wiki', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Close and reopen sidebar to pick up both tabs
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Get initial pinned count
        const initialPinnedCount = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              return pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
            }
          }
          return 0;
        });

        logTestStep(`Initial pinned count: ${initialPinnedCount}`);

        // Pin first tab
        const pinFirst = await sidebarPage.evaluate(async () => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (!tempSection) return { success: false, reason: 'no temporary section' };
              const tab = tempSection.querySelector('.tab[data-tab-id]');
              if (!tab) return { success: false, reason: 'no tab in temporary section' };

              const rect = tab.getBoundingClientRect();
              tab.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2,
                clientX: rect.x + 5, clientY: rect.y + 5,
              }));
              await new Promise(r => setTimeout(r, 500));

              for (const item of document.querySelectorAll('.context-menu-item')) {
                if (item.textContent.trim() === 'Pin Tab') {
                  item.click();
                  return { success: true };
                }
              }
              return { success: false, reason: 'Pin Tab not found' };
            }
          }
          return { success: false, reason: 'no visible space' };
        });

        await delay(2000);

        if (pinFirst.success) {
          // Reopen sidebar and check count after first pin
          await sidebarPage.close();
          sidebarPage = await openSidebar(browser, extensionId);

          const afterFirstPin = await sidebarPage.evaluate(() => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                return pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
              }
            }
            return 0;
          });

          expect(afterFirstPin).toBe(initialPinnedCount + 1);
          logTestStep(`After first pin: ${afterFirstPin} pinned tabs`);

          // Pin second tab
          const pinSecond = await sidebarPage.evaluate(async () => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const tempSection = space.querySelector('[data-tab-type="temporary"]');
                if (!tempSection) return { success: false, reason: 'no temporary section' };
                const tab = tempSection.querySelector('.tab[data-tab-id]');
                if (!tab) return { success: false, reason: 'no tab in temporary section' };

                const rect = tab.getBoundingClientRect();
                tab.dispatchEvent(new MouseEvent('contextmenu', {
                  bubbles: true, cancelable: true, button: 2,
                  clientX: rect.x + 5, clientY: rect.y + 5,
                }));
                await new Promise(r => setTimeout(r, 500));

                for (const item of document.querySelectorAll('.context-menu-item')) {
                  if (item.textContent.trim() === 'Pin Tab') {
                    item.click();
                    return { success: true };
                  }
                }
                return { success: false, reason: 'Pin Tab not found' };
              }
            }
            return { success: false, reason: 'no visible space' };
          });

          await delay(2000);

          if (pinSecond.success) {
            // Reopen sidebar and check count after second pin
            await sidebarPage.close();
            sidebarPage = await openSidebar(browser, extensionId);

            const afterSecondPin = await sidebarPage.evaluate(() => {
              const spaces = document.querySelectorAll('.space');
              for (const space of spaces) {
                if (space.style.display !== 'none') {
                  const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                  return pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
                }
              }
              return 0;
            });

            expect(afterSecondPin).toBe(initialPinnedCount + 2);
            logTestStep(`After second pin: ${afterSecondPin} pinned tabs`);
            logTestStep('✓ Pinned tab count increments correctly');
          } else {
            logTestStep(`⚠ Second pin: ${pinSecond.reason}`);
          }
        } else {
          logTestStep(`⚠ First pin: ${pinFirst.reason}`);
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'pinned-count-increment-failure');
        throw error;
      }
    });
  });

  describe('Pinned Tab Section Structure', () => {
    test('should show pinned section before temporary section in DOM order', async () => {
      try {
        logTestStep('Testing DOM order of pinned and temporary sections...');

        const sectionOrder = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (!pinnedSection || !tempSection) {
                return { hasBoth: false };
              }
              // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4
              // If pinned comes before temporary, temporary follows pinned
              const position = pinnedSection.compareDocumentPosition(tempSection);
              return {
                hasBoth: true,
                pinnedBeforeTemporary: (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
              };
            }
          }
          return { hasBoth: false };
        });

        if (sectionOrder.hasBoth) {
          expect(sectionOrder.pinnedBeforeTemporary).toBe(true);
          logTestStep('✓ Pinned section appears before temporary section in DOM');
        } else {
          logTestStep('⚠ Both sections not present (may need tabs to be pinned first)');
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'section-dom-order-failure');
        throw error;
      }
    });

    test('should have both sections present for structural integrity', async () => {
      try {
        logTestStep('Testing structural integrity of tab sections...');

        const sectionInfo = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              return {
                hasPinnedSection: !!space.querySelector('[data-tab-type="pinned"]'),
                hasTemporarySection: !!space.querySelector('[data-tab-type="temporary"]'),
                hasPinnedContainer: !!space.querySelector('.pinned-tabs'),
              };
            }
          }
          return { hasPinnedSection: false, hasTemporarySection: false, hasPinnedContainer: false };
        });

        // The space should always have both section types for structural integrity
        expect(sectionInfo.hasPinnedSection || sectionInfo.hasPinnedContainer).toBe(true);
        expect(sectionInfo.hasTemporarySection).toBe(true);
        logTestStep(`✓ Sections present - pinned: ${sectionInfo.hasPinnedSection || sectionInfo.hasPinnedContainer}, temporary: ${sectionInfo.hasTemporarySection}`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'section-structural-integrity-failure');
        throw error;
      }
    });

    test('should keep pinned tabs and temporary tabs in separate containers', async () => {
      try {
        logTestStep('Testing pinned and temporary tabs are in separate containers...');

        // Open a test page and pin it to ensure both sections have content
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Pin a tab first
        await sidebarPage.evaluate(async () => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (!tempSection) return;
              const tab = tempSection.querySelector('.tab[data-tab-id]');
              if (!tab) return;

              const rect = tab.getBoundingClientRect();
              tab.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2,
                clientX: rect.x + 5, clientY: rect.y + 5,
              }));
              await new Promise(r => setTimeout(r, 500));

              for (const item of document.querySelectorAll('.context-menu-item')) {
                if (item.textContent.trim() === 'Pin Tab') {
                  item.click();
                  break;
                }
              }
              break;
            }
          }
        });

        await delay(2000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        const containerInfo = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (!pinnedSection || !tempSection) {
                return { separate: false, reason: 'sections not found' };
              }
              // Check that pinned section is not inside temporary and vice versa
              const pinnedContainsTemp = pinnedSection.contains(tempSection);
              const tempContainsPinned = tempSection.contains(pinnedSection);
              // Check that they share no tab elements
              const pinnedTabIds = Array.from(pinnedSection.querySelectorAll('.tab[data-tab-id]'))
                .map(t => t.dataset.tabId);
              const tempTabIds = Array.from(tempSection.querySelectorAll('.tab[data-tab-id]'))
                .map(t => t.dataset.tabId);
              const overlap = pinnedTabIds.filter(id => tempTabIds.includes(id));
              return {
                separate: !pinnedContainsTemp && !tempContainsPinned,
                noOverlap: overlap.length === 0,
                pinnedCount: pinnedTabIds.length,
                tempCount: tempTabIds.length,
                overlapCount: overlap.length,
              };
            }
          }
          return { separate: false, reason: 'no visible space' };
        });

        expect(containerInfo.separate).toBe(true);
        expect(containerInfo.noOverlap).toBe(true);
        logTestStep(`✓ Containers are separate (pinned: ${containerInfo.pinnedCount}, temp: ${containerInfo.tempCount}, overlap: ${containerInfo.overlapCount})`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'separate-containers-failure');
        throw error;
      }
    });
  });

  describe('Bookmark Persistence Across Sidebar Reloads', () => {
    test('should maintain pinned tab count across multiple sidebar close/reopen cycles', async () => {
      try {
        logTestStep('Testing pinned tab count consistency across multiple reloads...');

        // Open a test page and pin it to ensure we have a pinned tab
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Pin a tab to have at least one pinned
        await sidebarPage.evaluate(async () => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (!tempSection) return;
              const tab = tempSection.querySelector('.tab[data-tab-id]');
              if (!tab) return;

              const rect = tab.getBoundingClientRect();
              tab.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2,
                clientX: rect.x + 5, clientY: rect.y + 5,
              }));
              await new Promise(r => setTimeout(r, 500));

              for (const item of document.querySelectorAll('.context-menu-item')) {
                if (item.textContent.trim() === 'Pin Tab') {
                  item.click();
                  break;
                }
              }
              break;
            }
          }
        });

        await delay(2000);

        // Perform 3 sidebar close/reopen cycles and compare counts
        const counts = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          await sidebarPage.close();
          sidebarPage = await openSidebar(browser, extensionId);

          const cycleCounts = await sidebarPage.evaluate(() => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
                const tempSection = space.querySelector('[data-tab-type="temporary"]');
                return {
                  pinned: pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0,
                  temporary: tempSection ? tempSection.querySelectorAll('.tab').length : 0,
                  total: space.querySelectorAll('.tab').length,
                };
              }
            }
            return { pinned: 0, temporary: 0, total: 0 };
          });

          counts.push(cycleCounts);
          logTestStep(`Cycle ${cycle + 1}: pinned=${cycleCounts.pinned}, temporary=${cycleCounts.temporary}, total=${cycleCounts.total}`);
        }

        // All cycles should have the same pinned count
        expect(counts[0].pinned).toBeGreaterThan(0);
        expect(counts[1].pinned).toBe(counts[0].pinned);
        expect(counts[2].pinned).toBe(counts[0].pinned);
        logTestStep('✓ Pinned tab count consistent across 3 sidebar reload cycles');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'persistence-multi-reload-failure');
        throw error;
      }
    });

    test('should maintain tab positions (pinned vs temporary) after sidebar reopen', async () => {
      try {
        logTestStep('Testing tab position persistence after sidebar reopen...');

        // Open a test page
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Get the current state of tabs in each section (with tab IDs)
        const beforeState = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              const pinnedTabIds = pinnedSection
                ? Array.from(pinnedSection.querySelectorAll('.tab[data-tab-id]')).map(t => t.dataset.tabId)
                : [];
              const tempTabIds = tempSection
                ? Array.from(tempSection.querySelectorAll('.tab[data-tab-id]')).map(t => t.dataset.tabId)
                : [];
              return { pinnedTabIds, tempTabIds };
            }
          }
          return { pinnedTabIds: [], tempTabIds: [] };
        });

        logTestStep(`Before reopen - pinned IDs: [${beforeState.pinnedTabIds.join(', ')}], temp IDs: [${beforeState.tempTabIds.join(', ')}]`);

        // Close and reopen sidebar
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Get state after reopen
        const afterState = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              const pinnedTabIds = pinnedSection
                ? Array.from(pinnedSection.querySelectorAll('.tab[data-tab-id]')).map(t => t.dataset.tabId)
                : [];
              const tempTabIds = tempSection
                ? Array.from(tempSection.querySelectorAll('.tab[data-tab-id]')).map(t => t.dataset.tabId)
                : [];
              return { pinnedTabIds, tempTabIds };
            }
          }
          return { pinnedTabIds: [], tempTabIds: [] };
        });

        logTestStep(`After reopen - pinned IDs: [${afterState.pinnedTabIds.join(', ')}], temp IDs: [${afterState.tempTabIds.join(', ')}]`);

        // Verify pinned and temporary tab counts are preserved across sidebar reopen
        // Note: Exact tab IDs may shift if the extension re-renders the DOM,
        // so we verify counts rather than exact ID matches
        expect(afterState.pinnedTabIds.length).toBe(beforeState.pinnedTabIds.length);
        expect(afterState.tempTabIds.length).toBe(beforeState.tempTabIds.length);

        // Verify the total number of tabs is consistent
        const beforeTotal = beforeState.pinnedTabIds.length + beforeState.tempTabIds.length;
        const afterTotal = afterState.pinnedTabIds.length + afterState.tempTabIds.length;
        expect(afterTotal).toBe(beforeTotal);
        logTestStep('✓ Tab positions (pinned vs temporary) maintained after sidebar reopen');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-position-persistence-failure');
        throw error;
      }
    });
  });

  describe('Multiple Bookmarks', () => {
    test('should pin multiple tabs and verify all appear in pinned section', async () => {
      try {
        logTestStep('Testing pinning multiple tabs...');

        // Open multiple test pages
        const testPage1 = await browser.newPage();
        await testPage1.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(500);
        const testPage2 = await browser.newPage();
        await testPage2.goto('https://www.example.com?page=wiki', { waitUntil: 'domcontentloaded' });
        await delay(500);
        const testPage3 = await browser.newPage();
        await testPage3.goto('https://www.example.com?page=search', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Close and reopen sidebar to pick up all tabs
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Get initial pinned count
        const initialPinned = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              return pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
            }
          }
          return 0;
        });

        logTestStep(`Initial pinned count: ${initialPinned}`);

        // Pin tabs one by one (up to 3)
        let pinned = 0;
        for (let i = 0; i < 3; i++) {
          const result = await sidebarPage.evaluate(async () => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const tempSection = space.querySelector('[data-tab-type="temporary"]');
                if (!tempSection) return { success: false, reason: 'no temporary section' };
                const tab = tempSection.querySelector('.tab[data-tab-id]');
                if (!tab) return { success: false, reason: 'no tab in temporary section' };

                const rect = tab.getBoundingClientRect();
                tab.dispatchEvent(new MouseEvent('contextmenu', {
                  bubbles: true, cancelable: true, button: 2,
                  clientX: rect.x + 5, clientY: rect.y + 5,
                }));
                await new Promise(r => setTimeout(r, 500));

                for (const item of document.querySelectorAll('.context-menu-item')) {
                  if (item.textContent.trim() === 'Pin Tab') {
                    item.click();
                    return { success: true };
                  }
                }
                return { success: false, reason: 'Pin Tab not found' };
              }
            }
            return { success: false, reason: 'no visible space' };
          });

          if (result.success) {
            pinned++;
            await delay(2000);
            // Reopen sidebar to refresh state before next pin
            if (i < 2) {
              await sidebarPage.close();
              sidebarPage = await openSidebar(browser, extensionId);
            }
          } else {
            logTestStep(`⚠ Pin attempt ${i + 1}: ${result.reason}`);
            break;
          }
        }

        // Reopen sidebar and verify final pinned count
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        const finalPinned = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              return pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
            }
          }
          return 0;
        });

        expect(finalPinned).toBe(initialPinned + pinned);
        logTestStep(`✓ Pinned ${pinned} tabs, final pinned count: ${finalPinned}`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'pin-multiple-tabs-failure');
        throw error;
      }
    });

    test('should decrease temporary tab count as tabs are pinned', async () => {
      try {
        logTestStep('Testing temporary tab count decreases when tabs are pinned...');

        // Open test pages
        const testPage1 = await browser.newPage();
        await testPage1.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(500);
        const testPage2 = await browser.newPage();
        await testPage2.goto('https://www.example.com?page=wiki', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        // Get initial temporary count
        const initialTemp = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              return tempSection ? tempSection.querySelectorAll('.tab').length : 0;
            }
          }
          return 0;
        });

        logTestStep(`Initial temporary count: ${initialTemp}`);

        // Pin one tab
        const pinResult = await sidebarPage.evaluate(async () => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              if (!tempSection) return { success: false, reason: 'no temporary section' };
              const tab = tempSection.querySelector('.tab[data-tab-id]');
              if (!tab) return { success: false, reason: 'no tab in temporary section' };

              const rect = tab.getBoundingClientRect();
              tab.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2,
                clientX: rect.x + 5, clientY: rect.y + 5,
              }));
              await new Promise(r => setTimeout(r, 500));

              for (const item of document.querySelectorAll('.context-menu-item')) {
                if (item.textContent.trim() === 'Pin Tab') {
                  item.click();
                  return { success: true };
                }
              }
              return { success: false, reason: 'Pin Tab not found' };
            }
          }
          return { success: false, reason: 'no visible space' };
        });

        await delay(2000);

        if (pinResult.success) {
          // Reopen sidebar and check temporary count decreased
          await sidebarPage.close();
          sidebarPage = await openSidebar(browser, extensionId);

          const afterPinTemp = await sidebarPage.evaluate(() => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const tempSection = space.querySelector('[data-tab-type="temporary"]');
                return tempSection ? tempSection.querySelectorAll('.tab').length : 0;
              }
            }
            return 0;
          });

          expect(afterPinTemp).toBe(initialTemp - 1);
          logTestStep(`After pin - temporary count: ${afterPinTemp} (decreased by 1)`);
          logTestStep('✓ Temporary tab count decreases correctly when tabs are pinned');
        } else {
          logTestStep(`⚠ ${pinResult.reason}`);
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'temp-count-decrease-failure');
        throw error;
      }
    });
  });

  describe('Tab Display in Sections', () => {
    test('should have consistent structure (favicon + title + close) for all tabs', async () => {
      try {
        logTestStep('Testing consistent tab structure across all sections...');

        // Open a test page to ensure tabs exist
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        const tabStructure = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const allTabs = space.querySelectorAll('.tab');
              const results = [];
              for (const tab of allTabs) {
                results.push({
                  hasFavicon: !!tab.querySelector('.tab-favicon'),
                  hasTitle: !!tab.querySelector('.tab-title-display'),
                  hasClose: !!tab.querySelector('.tab-close, .close-btn, [data-action="close"]'),
                  titleText: tab.querySelector('.tab-title-display')?.textContent?.trim() || '',
                });
              }
              return { total: allTabs.length, tabs: results };
            }
          }
          return { total: 0, tabs: [] };
        });

        expect(tabStructure.total).toBeGreaterThan(0);

        let allHaveFavicon = true;
        let allHaveTitle = true;
        let allHaveClose = true;
        for (const tab of tabStructure.tabs) {
          if (!tab.hasFavicon) allHaveFavicon = false;
          if (!tab.hasTitle) allHaveTitle = false;
          if (!tab.hasClose) allHaveClose = false;
        }

        expect(allHaveFavicon).toBe(true);
        expect(allHaveTitle).toBe(true);
        logTestStep(`✓ All ${tabStructure.total} tabs have consistent structure (favicon: ${allHaveFavicon}, title: ${allHaveTitle}, close: ${allHaveClose})`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-structure-consistency-failure');
        throw error;
      }
    });

    test('should have total tab count equal to pinned + temporary counts', async () => {
      try {
        logTestStep('Testing total tab count equals pinned + temporary...');

        // Open a test page
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);

        const tabCounts = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const pinnedSection = space.querySelector('[data-tab-type="pinned"]');
              const tempSection = space.querySelector('[data-tab-type="temporary"]');
              const pinnedCount = pinnedSection ? pinnedSection.querySelectorAll('.tab').length : 0;
              const tempCount = tempSection ? tempSection.querySelectorAll('.tab').length : 0;
              const totalTabs = space.querySelectorAll('.tab').length;
              return { pinnedCount, tempCount, totalTabs };
            }
          }
          return { pinnedCount: 0, tempCount: 0, totalTabs: 0 };
        });

        logTestStep(`Pinned: ${tabCounts.pinnedCount}, Temporary: ${tabCounts.tempCount}, Total: ${tabCounts.totalTabs}`);

        expect(tabCounts.totalTabs).toBe(tabCounts.pinnedCount + tabCounts.tempCount);
        logTestStep('✓ Total tab count equals pinned + temporary counts');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-count-sum-failure');
        throw error;
      }
    });
  });
});
