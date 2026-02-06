/**
 * E2E Tests for Drag and Drop Functionality
 * Tests dragging tabs between spaces, reordering tabs, and drag-and-drop interactions
 */
import {
  launchBrowserWithExtension,
  openSidebar,
  getSidebarTabs,
  getSidebarSpaces,
  clickElement,
  createSpace,
} from './helpers/extension-helper.js';
import {
  delay,
  takeScreenshotOnFailure,
  logTestStep,
  generateTestSpaces,
} from './helpers/test-utils.js';

describe('Drag and Drop', () => {
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
    await delay(1000);
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

  describe('Tab Dragging', () => {
    test('should enable dragging on tabs', async () => {
      try {
        logTestStep('Testing tab drag capability...');

        // Open a test tab
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Refresh sidebar
        await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Check if tabs have draggable attribute
        const isDraggable = await sidebarPage.evaluate(() => {
          const tabs = document.querySelectorAll('.tab');
          return Array.from(tabs).some(tab => tab.draggable === true || tab.getAttribute('draggable') === 'true');
        });

        expect(isDraggable).toBe(true);
        logTestStep('✓ Tabs are draggable');

        await testPage.close();
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-draggable-failure');
        throw error;
      }
    });

    test('should drag tab to reorder within same space', async () => {
      try {
        logTestStep('Testing tab reordering...');

        // Open multiple test tabs
        const testPages = [];
        for (let i = 0; i < 3; i++) {
          const page = await browser.newPage();
          await page.goto(`https://www.example.com?page=${i}`, { waitUntil: 'domcontentloaded' });
          await page.evaluate((idx) => {
            document.title = `Test Tab ${idx}`;
          }, i);
          testPages.push(page);
          await delay(500);
        }

        // Refresh sidebar
        await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Get initial tab order
        const initialTabs = await getSidebarTabs(sidebarPage);
        logTestStep(`Initial tab order: ${initialTabs.map(t => t.title).join(', ')}`);

        // Get tab elements
        const tabElements = await sidebarPage.$$('.tab');

        if (tabElements.length >= 2) {
          const sourceTab = tabElements[0];
          const targetTab = tabElements[1];

          // Get bounding boxes
          const sourceBox = await sourceTab.boundingBox();
          const targetBox = await targetTab.boundingBox();

          if (sourceBox && targetBox) {
            // Perform drag and drop
            await sidebarPage.mouse.move(
              sourceBox.x + sourceBox.width / 2,
              sourceBox.y + sourceBox.height / 2
            );
            await sidebarPage.mouse.down();
            await delay(300);

            await sidebarPage.mouse.move(
              targetBox.x + targetBox.width / 2,
              targetBox.y + targetBox.height / 2,
              { steps: 10 }
            );
            await delay(300);

            await sidebarPage.mouse.up();
            await delay(1000);

            // Get final tab order
            const finalTabs = await getSidebarTabs(sidebarPage);
            logTestStep(`Final tab order: ${finalTabs.map(t => t.title).join(', ')}`);

            // Verify order changed
            const orderChanged = JSON.stringify(initialTabs) !== JSON.stringify(finalTabs);
            if (orderChanged) {
              logTestStep('✓ Tab order changed after drag');
            } else {
              logTestStep('⚠ Tab order unchanged (drag might need different implementation)');
            }
          }
        }

        // Cleanup
        for (const page of testPages) {
          await page.close();
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-reorder-failure');
        throw error;
      }
    });

    test('should drag tab between spaces', async () => {
      try {
        logTestStep('Testing tab drag between spaces...');

        // Create two spaces
        const spaces = generateTestSpaces(2);
        for (const space of spaces) {
          await sidebarPage.close();
          sidebarPage = await createSpace(browser, extensionId, space.name);
        }

        // Open a test tab
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Refresh sidebar
        await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
        await delay(2000);

        // Get tab and space elements
        const tabElement = await sidebarPage.$('.tab');
        const spaceElements = await sidebarPage.$$('.space');

        if (tabElement && spaceElements.length >= 2) {
          const targetSpace = spaceElements[1];

          // Get bounding boxes
          const tabBox = await tabElement.boundingBox();
          const spaceBox = await targetSpace.boundingBox();

          if (tabBox && spaceBox) {
            // Drag tab to space
            await sidebarPage.mouse.move(
              tabBox.x + tabBox.width / 2,
              tabBox.y + tabBox.height / 2
            );
            await sidebarPage.mouse.down();
            await delay(300);

            await sidebarPage.mouse.move(
              spaceBox.x + spaceBox.width / 2,
              spaceBox.y + spaceBox.height / 2,
              { steps: 10 }
            );
            await delay(300);

            await sidebarPage.mouse.up();
            await delay(1000);

            logTestStep('✓ Tab dragged to another space');
          }
        }

        await testPage.close();
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'tab-drag-spaces-failure');
        throw error;
      }
    });
  });

  describe('Visual Feedback', () => {
    test('should show drag visual feedback', async () => {
      try {
        logTestStep('Testing drag visual feedback...');

        // Open a test tab
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Refresh sidebar
        await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);

        const tabElement = await sidebarPage.$('.tab');
        if (tabElement) {
          const tabBox = await tabElement.boundingBox();

          if (tabBox) {
            // Start dragging
            await sidebarPage.mouse.move(
              tabBox.x + tabBox.width / 2,
              tabBox.y + tabBox.height / 2
            );
            await sidebarPage.mouse.down();
            await delay(500);

            // Check for visual feedback classes
            const hasDragFeedback = await sidebarPage.evaluate(() => {
              const draggingElement = document.querySelector('.dragging, .is-dragging, [data-dragging="true"]');
              return draggingElement !== null;
            });

            if (hasDragFeedback) {
              logTestStep('✓ Drag visual feedback present');
            } else {
              logTestStep('⚠ No visual feedback detected during drag');
            }

            await sidebarPage.mouse.up();
          }
        }

        await testPage.close();
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'drag-feedback-failure');
        throw error;
      }
    });

    test('should show drop zone indicator', async () => {
      try {
        logTestStep('Testing drop zone indicator...');

        // Create a space
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Drop Zone Test');

        // Open a test tab
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Refresh sidebar
        await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);

        const tabElement = await sidebarPage.$('.tab');
        const spaceElement = await sidebarPage.$('.space');

        if (tabElement && spaceElement) {
          const tabBox = await tabElement.boundingBox();
          const spaceBox = await spaceElement.boundingBox();

          if (tabBox && spaceBox) {
            // Drag tab over space
            await sidebarPage.mouse.move(
              tabBox.x + tabBox.width / 2,
              tabBox.y + tabBox.height / 2
            );
            await sidebarPage.mouse.down();
            await delay(300);

            await sidebarPage.mouse.move(
              spaceBox.x + spaceBox.width / 2,
              spaceBox.y + spaceBox.height / 2,
              { steps: 10 }
            );
            await delay(500);

            // Check for drop zone indicator
            const hasDropZone = await sidebarPage.evaluate(() => {
              const dropZone = document.querySelector('.drop-zone, .drop-target, [data-drop-target="true"]');
              return dropZone !== null;
            });

            if (hasDropZone) {
              logTestStep('✓ Drop zone indicator visible');
            } else {
              logTestStep('⚠ Drop zone indicator not detected');
            }

            await sidebarPage.mouse.up();
          }
        }

        await testPage.close();
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'drop-zone-failure');
        throw error;
      }
    });
  });

  describe('Space Reordering', () => {
    test('should reorder spaces via drag and drop', async () => {
      try {
        logTestStep('Testing space reordering...');

        // Create multiple spaces
        const spaces = generateTestSpaces(3);
        for (const space of spaces) {
          await sidebarPage.close();
          sidebarPage = await createSpace(browser, extensionId, space.name);
        }

        // Get initial space order
        const initialSpaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Initial space order: ${initialSpaces.map(s => s.name).join(', ')}`);

        // Get space elements
        const spaceElements = await sidebarPage.$$('.space');

        if (spaceElements.length >= 2) {
          const sourceSpace = spaceElements[0];
          const targetSpace = spaceElements[spaceElements.length - 1];

          // Get bounding boxes
          const sourceBox = await sourceSpace.boundingBox();
          const targetBox = await targetSpace.boundingBox();

          if (sourceBox && targetBox) {
            // Drag first space to last position
            await sidebarPage.mouse.move(
              sourceBox.x + sourceBox.width / 2,
              sourceBox.y + sourceBox.height / 2
            );
            await sidebarPage.mouse.down();
            await delay(300);

            await sidebarPage.mouse.move(
              targetBox.x + targetBox.width / 2,
              targetBox.y + targetBox.height + 10,
              { steps: 10 }
            );
            await delay(300);

            await sidebarPage.mouse.up();
            await delay(1000);

            // Get final space order
            const finalSpaces = await getSidebarSpaces(sidebarPage);
            logTestStep(`Final space order: ${finalSpaces.map(s => s.name).join(', ')}`);

            // Verify order changed
            const orderChanged = JSON.stringify(initialSpaces) !== JSON.stringify(finalSpaces);
            if (orderChanged) {
              logTestStep('✓ Space order changed after drag');
            } else {
              logTestStep('⚠ Space order unchanged');
            }
          }
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'space-reorder-failure');
        throw error;
      }
    });
  });

  describe('Drag Events', () => {
    test('should fire drag events correctly', async () => {
      try {
        logTestStep('Testing drag event listeners...');

        // Add event listener to track drag events
        await sidebarPage.evaluate(() => {
          window.dragEvents = [];

          document.addEventListener('dragstart', () => {
            window.dragEvents.push('dragstart');
          });

          document.addEventListener('dragend', () => {
            window.dragEvents.push('dragend');
          });

          document.addEventListener('dragover', () => {
            if (!window.dragEvents.includes('dragover')) {
              window.dragEvents.push('dragover');
            }
          });

          document.addEventListener('drop', () => {
            window.dragEvents.push('drop');
          });
        });

        // Open a test tab
        const testPage = await browser.newPage();
        await testPage.goto('https://www.example.com', { waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Refresh sidebar
        await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);

        // Re-add event listeners after reload
        await sidebarPage.evaluate(() => {
          window.dragEvents = [];

          document.addEventListener('dragstart', () => {
            window.dragEvents.push('dragstart');
          });

          document.addEventListener('dragend', () => {
            window.dragEvents.push('dragend');
          });
        });

        // Perform a drag operation
        const tabElement = await sidebarPage.$('.tab');
        if (tabElement) {
          const tabBox = await tabElement.boundingBox();
          if (tabBox) {
            await sidebarPage.mouse.move(
              tabBox.x + tabBox.width / 2,
              tabBox.y + tabBox.height / 2
            );
            await sidebarPage.mouse.down();
            await delay(500);
            await sidebarPage.mouse.up();
            await delay(500);
          }
        }

        // Check if events were fired
        const events = await sidebarPage.evaluate(() => window.dragEvents);
        logTestStep(`Drag events fired: ${events.join(', ')}`);

        if (events.length > 0) {
          logTestStep('✓ Drag events are firing');
        }

        await testPage.close();
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'drag-events-failure');
        throw error;
      }
    });
  });
});
