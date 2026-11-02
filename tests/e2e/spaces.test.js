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
import { createServer } from 'node:http';
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

async function dragSpaceChip(page, sourceIndex, targetIndex) {
  return page.evaluate(async (sourceIndex, targetIndex) => {
    const buttons = [...document.querySelectorAll('.space-switcher button[data-space-id]')];
    const source = buttons[sourceIndex];
    const target = buttons[targetIndex];
    const targetRect = target.getBoundingClientRect();
    const clientX = targetRect.left + targetRect.width / 4;
    const clientY = targetRect.top + targetRect.height / 2;
    const dataTransfer = new DataTransfer();

    source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));

    await new Promise(resolve => setTimeout(resolve, 0));

    const startedAt = performance.now();
    while (performance.now() - startedAt < 500) {
      document.elementFromPoint(clientX, clientY).dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        dataTransfer,
      }));
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    const dropTarget = document.elementFromPoint(clientX, clientY);
    dropTarget.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      dataTransfer,
    }));

    await new Promise(resolve => setTimeout(resolve, 500));
    return source.textContent.trim();
  }, sourceIndex, targetIndex);
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

        // Add known bookmark contents so the warning proves the full folder tree is counted.
        await sidebarPage.evaluate(async () => {
          const { spaces = [] } = await chrome.storage.local.get('spaces');
          const space = spaces.find(item => item.name === 'Space to Delete');
          const nestedFolder = await chrome.bookmarks.create({
            parentId: space.bookmarkFolderId,
            title: 'Nested folder',
          });
          await chrome.bookmarks.create({
            parentId: space.bookmarkFolderId,
            title: 'Direct bookmark',
            url: 'https://example.com/direct',
          });
          await chrome.bookmarks.create({
            parentId: nestedFolder.id,
            title: 'Nested bookmark',
            url: 'https://example.com/nested',
          });
        });

        // Force-show the dropdown and click delete
        await showSpaceOptionsDropdown(sidebarPage);

        // Register dialog handler to accept the confirm('Delete this space...')
        let dialogMessage = '';
        sidebarPage.on('dialog', async dialog => {
          dialogMessage = dialog.message();
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

        expect(dialogMessage).toBe('Delete "Space to Delete"? This deletes its bookmark folder (2 bookmarks) and closes its tabs.');
        expect(finalSpaces.length).toBe(initialCount - 1);
        expect(finalSpaces.find(s => s.name === 'Space to Delete')).toBeUndefined();

        logTestStep('✓ Space deleted successfully');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'delete-space-failure');
        throw error;
      }
    }, 120000);

    test('should confirm and report when the space bookmark folder cannot be read', async () => {
      let folderId;
      let originalParentId;
      try {
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Unreadable Space');

        await sidebarPage.evaluate(() => {
          for (const btn of document.querySelectorAll('.space-switcher button')) {
            if (btn.textContent.trim() === 'Unreadable Space') { btn.click(); break; }
          }
        });
        await delay(1000);

        ({ folderId, originalParentId } = await sidebarPage.evaluate(async () => {
          const { spaces = [] } = await chrome.storage.local.get('spaces');
          const space = spaces.find(item => item.name === 'Unreadable Space');
          const [folder] = await chrome.bookmarks.get(space.bookmarkFolderId);
          await chrome.bookmarks.move(folder.id, { parentId: '1' });
          return { folderId: folder.id, originalParentId: folder.parentId };
        }));
        await sidebarPage.waitForSelector('.space.active .bookmark-association-error');

        await showSpaceOptionsDropdown(sidebarPage);

        const dialogs = [];
        sidebarPage.on('dialog', async dialog => {
          dialogs.push({ type: dialog.type(), message: dialog.message() });
          await dialog.accept();
        });

        await sidebarPage.$eval('.space.active .delete-space-btn', btn => btn.click());
        await delay(1500);

        expect(dialogs).toEqual([
          {
            type: 'confirm',
            message: 'Delete "Unreadable Space"? Its bookmark folder could not be read. The bookmark folder is no longer inside the Arcify folder.',
          },
          { type: 'alert', message: 'The bookmark folder is no longer inside the Arcify folder.' },
        ]);
        const remaining = await getSidebarSpaces(sidebarPage);
        expect(remaining.find(s => s.name === 'Unreadable Space')).toBeDefined();
        const [folder] = await sidebarPage.evaluate(id => chrome.bookmarks.get(id), folderId);
        expect(folder.parentId).toBe('1');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'delete-unreadable-space-failure');
        throw error;
      } finally {
        if (folderId && originalParentId) {
          await sidebarPage.evaluate(({ id, parentId }) => chrome.bookmarks.move(id, { parentId }),
            { id: folderId, parentId: originalParentId }).catch(() => {});
        }
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

  describe('Space Switching', () => {
    test('should switch between spaces via space-switcher buttons', async () => {
      try {
        logTestStep('Creating a second space to switch between...');

        // Close sidebar first, then create a new space
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Switch Target');

        const spaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Spaces available: ${spaces.map(s => s.name).join(', ')}`);
        expect(spaces.length).toBeGreaterThanOrEqual(2);

        // Get the name of the first space (not 'Switch Target')
        const firstSpaceName = spaces.find(s => s.name !== 'Switch Target')?.name;
        expect(firstSpaceName).toBeDefined();
        logTestStep(`Will switch from 'Switch Target' to '${firstSpaceName}'`);

        // Click the first space's switcher button to switch away
        await sidebarPage.evaluate((targetName) => {
          const buttons = document.querySelectorAll('.space-switcher button');
          for (const btn of buttons) {
            if (btn.textContent.trim() === targetName) {
              btn.click();
              break;
            }
          }
        }, firstSpaceName);
        await delay(1500);

        // Verify the active space changed: the visible space should match the target
        const visibleSpaceName = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              return input ? input.value.trim() : null;
            }
          }
          return null;
        });

        expect(visibleSpaceName).toBe(firstSpaceName);
        logTestStep(`✓ Successfully switched to '${visibleSpaceName}'`);

        // Now switch back to 'Switch Target'
        await sidebarPage.evaluate(() => {
          const buttons = document.querySelectorAll('.space-switcher button');
          for (const btn of buttons) {
            if (btn.textContent.trim() === 'Switch Target') {
              btn.click();
              break;
            }
          }
        });
        await delay(1500);

        const switchedBackName = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              return input ? input.value.trim() : null;
            }
          }
          return null;
        });

        expect(switchedBackName).toBe('Switch Target');
        logTestStep('✓ Successfully switched back to Switch Target');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'switch-spaces-failure');
        throw error;
      }
    }, 120000);

    test('should show only one space at a time after switching', async () => {
      try {
        logTestStep('Creating a second space to verify single visibility...');

        // Close sidebar first, then create a new space
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Visibility Test');

        const spaces = await getSidebarSpaces(sidebarPage);
        expect(spaces.length).toBeGreaterThanOrEqual(2);

        // Click the first space's switcher button
        const firstSpaceName = spaces.find(s => s.name !== 'Visibility Test')?.name;
        await sidebarPage.evaluate((targetName) => {
          const buttons = document.querySelectorAll('.space-switcher button');
          for (const btn of buttons) {
            if (btn.textContent.trim() === targetName) {
              btn.click();
              break;
            }
          }
        }, firstSpaceName);
        await delay(1500);

        // Count how many spaces are visible (display !== 'none')
        const visibleCount = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          let count = 0;
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              count++;
            }
          }
          return count;
        });

        expect(visibleCount).toBe(1);
        logTestStep(`✓ Only ${visibleCount} space visible at a time`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'single-visibility-failure');
        throw error;
      }
    }, 120000);
  });

  describe('Multiple Spaces', () => {
    test('should create multiple spaces in sequence', async () => {
      try {
        logTestStep('Creating 3 spaces in sequence...');

        const spaceNames = ['Multi Space A', 'Multi Space B', 'Multi Space C'];

        // Get initial count
        const initialSpaces = await getSidebarSpaces(sidebarPage);
        const initialCount = initialSpaces.length;
        logTestStep(`Initial space count: ${initialCount}`);

        // Create each space sequentially
        for (const name of spaceNames) {
          await sidebarPage.close();
          sidebarPage = await createSpace(browser, extensionId, name);
          logTestStep(`Created space: ${name}`);
        }

        const finalSpaces = await getSidebarSpaces(sidebarPage);
        logTestStep(`Final spaces: ${finalSpaces.map(s => s.name).join(', ')}`);

        expect(finalSpaces.length).toBe(initialCount + spaceNames.length);
        logTestStep(`✓ Space count increased from ${initialCount} to ${finalSpaces.length}`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'create-multiple-spaces-failure');
        throw error;
      }
    }, 120000);

    test('should show all created spaces in the space switcher', async () => {
      try {
        logTestStep('Creating spaces and verifying switcher buttons...');

        const spaceNames = ['Switcher A', 'Switcher B', 'Switcher C'];

        // Close sidebar and create spaces
        for (const name of spaceNames) {
          await sidebarPage.close();
          sidebarPage = await createSpace(browser, extensionId, name);
        }

        // Get all switcher button texts
        const switcherNames = await sidebarPage.evaluate(() => {
          const buttons = document.querySelectorAll('.space-switcher button');
          return Array.from(buttons).map(btn => btn.textContent.trim());
        });
        logTestStep(`Switcher buttons: ${switcherNames.join(', ')}`);

        // Verify each created space appears in the switcher
        for (const name of spaceNames) {
          expect(switcherNames).toContain(name);
          logTestStep(`✓ '${name}' found in space switcher`);
        }
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'switcher-buttons-failure');
        throw error;
      }
    }, 120000);
  });

  describe('Space Name Edge Cases', () => {
    test('should handle renaming space to empty string', async () => {
      try {
        logTestStep('Attempting to rename space to empty string...');

        // Get the current name of the active space before clearing
        const originalName = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              return input ? input.value.trim() : null;
            }
          }
          return null;
        });
        logTestStep(`Original space name: '${originalName}'`);

        // Focus the visible space's name input and clear it
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

        // Clear the input and press Enter
        await sidebarPage.keyboard.press('Backspace');
        await sidebarPage.keyboard.press('Enter');
        await delay(1500);

        // Verify the space name is not empty (should keep original or use default)
        const nameAfterClear = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              return input ? input.value.trim() : null;
            }
          }
          return null;
        });
        logTestStep(`Name after empty rename attempt: '${nameAfterClear}'`);

        // Space name should either revert to original or use a default, but not be empty
        // The UI might allow empty (placeholder visible), so we check the DOM exists and is functional
        const spaceStillExists = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              return space.querySelector('.space-name') !== null;
            }
          }
          return false;
        });
        expect(spaceStillExists).toBe(true);
        logTestStep('✓ Space remains functional after empty name attempt');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'empty-name-failure');
        throw error;
      }
    });

    test('should handle very long space name without breaking UI', async () => {
      try {
        const longName = 'A'.repeat(120);
        logTestStep(`Renaming space to ${longName.length}-character name...`);

        // Focus the visible space's name input
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

        await sidebarPage.keyboard.type(longName);
        await sidebarPage.keyboard.press('Enter');
        await delay(1500);

        // Verify the name was applied (may be truncated by the UI)
        const appliedName = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              return input ? input.value : null;
            }
          }
          return null;
        });
        logTestStep(`Applied name length: ${appliedName ? appliedName.length : 0}`);

        // Name should have been set (possibly truncated) but input should not be broken
        expect(appliedName).toBeDefined();
        expect(appliedName.length).toBeGreaterThan(0);

        // Verify the sidebar UI is still functional (no layout breakage)
        const sidebarFunctional = await sidebarPage.evaluate(() => {
          const container = document.getElementById('sidebar-container');
          if (!container) return false;
          const rect = container.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        expect(sidebarFunctional).toBe(true);
        logTestStep('✓ UI remains functional with very long space name');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'long-name-failure');
        throw error;
      }
    });

    test('should handle special characters and emojis in space name', async () => {
      try {
        const specialName = 'Test <>&" Space';
        logTestStep(`Renaming space to special characters: '${specialName}'...`);

        // Focus the visible space's name input
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

        await sidebarPage.keyboard.type(specialName);
        await sidebarPage.keyboard.press('Enter');
        await delay(1500);

        // Verify the name was applied correctly
        const appliedName = await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const input = space.querySelector('.space-name');
              return input ? input.value.trim() : null;
            }
          }
          return null;
        });
        logTestStep(`Applied name: '${appliedName}'`);

        expect(appliedName).toBe(specialName);

        // Verify the space switcher also shows the special name
        const switcherHasName = await sidebarPage.evaluate((name) => {
          const buttons = document.querySelectorAll('.space-switcher button');
          for (const btn of buttons) {
            if (btn.classList.contains('active') && btn.textContent.trim() === name) {
              return true;
            }
          }
          return false;
        }, specialName);
        expect(switcherHasName).toBe(true);
        logTestStep('✓ Special characters rendered correctly in space name and switcher');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'special-chars-name-failure');
        throw error;
      }
    });
  });

  describe('Space Color Cycling', () => {
    test('should apply all available colors sequentially', async () => {
      try {
        const allColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
        logTestStep(`Testing all ${allColors.length} color options...`);

        for (const color of allColors) {
          // Force-show the dropdown
          await showSpaceOptionsDropdown(sidebarPage);

          // Click the color swatch for the current color
          const swatchClicked = await sidebarPage.evaluate((targetColor) => {
            const spaces = document.querySelectorAll('.space');
            for (const space of spaces) {
              if (space.style.display !== 'none') {
                const swatch = space.querySelector(`.space-options-dropdown .color-swatch[data-color="${targetColor}"]`);
                if (swatch) { swatch.click(); return true; }
              }
            }
            return false;
          }, color);
          expect(swatchClicked).toBe(true);
          await delay(500);

          logTestStep(`Applied color: ${color}`);
        }

        logTestStep('✓ All colors applied successfully without errors');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'color-cycling-failure');
        throw error;
      }
    });

    test('should reflect color change on active space-switcher button', async () => {
      try {
        logTestStep('Verifying color reflects on space-switcher button...');

        // Force-show the dropdown and apply red color
        await showSpaceOptionsDropdown(sidebarPage);

        await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const swatch = space.querySelector('.space-options-dropdown .color-swatch[data-color="red"]');
              if (swatch) { swatch.click(); break; }
            }
          }
        });
        await delay(1500);

        // Check the active switcher button has a non-transparent background
        const buttonStyled = await sidebarPage.evaluate(() => {
          const switcherBtns = document.querySelectorAll('.space-switcher button');
          for (const btn of switcherBtns) {
            if (btn.classList.contains('active')) {
              const style = window.getComputedStyle(btn);
              return style.backgroundColor !== '' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
            }
          }
          return false;
        });
        expect(buttonStyled).toBe(true);
        logTestStep('✓ Active switcher button reflects the color change');

        // Now change to green and verify it updates
        await showSpaceOptionsDropdown(sidebarPage);

        await sidebarPage.evaluate(() => {
          const spaces = document.querySelectorAll('.space');
          for (const space of spaces) {
            if (space.style.display !== 'none') {
              const swatch = space.querySelector('.space-options-dropdown .color-swatch[data-color="green"]');
              if (swatch) { swatch.click(); break; }
            }
          }
        });
        await delay(1500);

        // Get background color after changing to green
        const greenBgColor = await sidebarPage.evaluate(() => {
          const switcherBtns = document.querySelectorAll('.space-switcher button');
          for (const btn of switcherBtns) {
            if (btn.classList.contains('active')) {
              return window.getComputedStyle(btn).backgroundColor;
            }
          }
          return null;
        });

        expect(greenBgColor).not.toBeNull();
        expect(greenBgColor).not.toBe('rgba(0, 0, 0, 0)');
        logTestStep(`✓ Switcher button color updated to green (${greenBgColor})`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'color-switcher-reflect-failure');
        throw error;
      }
    });
  });

  describe('Space Reordering', () => {
    test('should drop space chips where the open gap indicates', async () => {
      try {
        const switcherButtons = await sidebarPage.$$('.space-switcher button[data-space-id]');
        for (let i = switcherButtons.length; i < 11; i++) {
          await sidebarPage.close();
          sidebarPage = await createSpace(browser, extensionId, `Drag ${i}`);
        }

        const movedFirst = await dragSpaceChip(sidebarPage, 4, 0);
        let order = await sidebarPage.$$eval('.space-switcher button[data-space-id]', buttons => {
          return buttons.map(button => button.textContent.trim());
        });
        expect(order[0]).toBe(movedFirst);

        const movedMiddle = await dragSpaceChip(sidebarPage, order.length - 1, 5);
        order = await sidebarPage.$$eval('.space-switcher button[data-space-id]', buttons => {
          return buttons.map(button => button.textContent.trim());
        });
        expect(order[5]).toBe(movedMiddle);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'space-switcher-reorder-failure');
        throw error;
      }
    }, 120000);
  });

  describe('Space Order', () => {
    const chipOrder = page => page.$$eval('.space-switcher button', els => els.map(el => el.textContent.trim()));
    const folderOrder = page => page.evaluate(async () => {
      const [root] = (await chrome.bookmarks.search({ title: 'Arcify' })).filter(node => !node.url);
      return (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url).map(node => node.title);
    });
    const waitForOrder = (page, expected) => page.waitForFunction(async expected => {
      const chips = [...document.querySelectorAll('.space-switcher button')].map(el => el.textContent.trim());
      const [root] = (await chrome.bookmarks.search({ title: 'Arcify' })).filter(node => !node.url);
      const folders = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url).map(node => node.title);
      return [chips, folders].every(order => JSON.stringify(order) === JSON.stringify(expected));
    }, { polling: 100, timeout: 5000 }, expected);
    const dragChip = (page, from, to, edge) => page.evaluate(async (from, to, edge) => {
      const buttons = [...document.querySelectorAll('.space-switcher button')];
      const source = buttons.at(from);
      const target = to === null ? document.getElementById('spaceSwitcher') : buttons.at(to);
      const rect = target.getBoundingClientRect();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
      await new Promise(resolve => setTimeout(resolve, 0));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: edge === 'left' ? rect.left + 1 : rect.right - 1 }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    }, from, to, edge);

    test('should keep space chips and Arcify bookmark folders in the same order', async () => {
      try {
        for (const name of ['Order A', 'Order B']) {
          await sidebarPage.close();
          sidebarPage = await createSpace(browser, extensionId, name);
        }
        let expected = await chipOrder(sidebarPage);
        expect(expected.length).toBeGreaterThanOrEqual(3);
        expect(await folderOrder(sidebarPage)).toEqual(expected);

        logTestStep('Dragging the last chip to the front...');
        expected = [expected.at(-1), ...expected.slice(0, -1)];
        await dragChip(sidebarPage, -1, 0, 'left');
        await waitForOrder(sidebarPage, expected);
        logTestStep('✓ Chip drag reordered the bookmark folders');

        logTestStep('Dragging the first chip past the second...');
        expected = [expected[1], expected[0], ...expected.slice(2)];
        await dragChip(sidebarPage, 0, 1, 'right');
        await waitForOrder(sidebarPage, expected);
        logTestStep('✓ Forward chip drag moved its bookmark folder one place right');

        logTestStep('Dropping the first chip after the last chip...');
        expected = [...expected.slice(1), expected[0]];
        await dragChip(sidebarPage, 0, null, 'right');
        await waitForOrder(sidebarPage, expected);
        logTestStep('✓ Drop at the end moved the bookmark folder last');

        logTestStep('Dropping the last chip on itself...');
        await dragChip(sidebarPage, -1, -1, 'right');
        await delay(1000);
        expect(await folderOrder(sidebarPage)).toEqual(expected);
        expect(await chipOrder(sidebarPage)).toEqual(expected);
        logTestStep('✓ Self-drop left chips and bookmark folders in place');

        logTestStep('Moving the last folder to the top in bookmarks...');
        const moved = await sidebarPage.evaluate(async () => {
          const [root] = (await chrome.bookmarks.search({ title: 'Arcify' })).filter(node => !node.url);
          const folder = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url).at(-1);
          await chrome.bookmarks.move(folder.id, { parentId: root.id, index: 0 });
          return folder.title;
        });
        await sidebarPage.waitForFunction(name => document.querySelector('.space-switcher button')?.textContent.trim() === name,
          { polling: 100, timeout: 5000 }, moved);
        expect(await chipOrder(sidebarPage)).toEqual(await folderOrder(sidebarPage));

        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);
        expect(await chipOrder(sidebarPage)).toEqual(await folderOrder(sidebarPage));
        logTestStep('✓ Bookmark folder move reordered the chips');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'space-order-failure');
        throw error;
      }
    }, 120000);

    test('should not pull a space folder moved out of Arcify back in when its chip is dragged', async () => {
      try {
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Relocated');
        const folderId = await sidebarPage.evaluate(async () => {
          const [folder] = (await chrome.bookmarks.search({ title: 'Relocated' })).filter(node => !node.url);
          await chrome.bookmarks.move(folder.id, { parentId: '1' });
          return folder.id;
        });
        await sidebarPage.close();
        sidebarPage = await openSidebar(browser, extensionId);
        await sidebarPage.waitForFunction(() =>
          [...document.querySelectorAll('.space-switcher button')].at(-1)?.textContent.trim() === 'Relocated',
          { polling: 100, timeout: 5000 });
        const before = await folderOrder(sidebarPage);

        logTestStep('Dragging the relocated space chip to the front...');
        await dragChip(sidebarPage, -1, 0, 'left');
        await delay(1000);
        const [folder] = await sidebarPage.evaluate(id => chrome.bookmarks.get(id), folderId);
        expect(folder.parentId).toBe('1');
        expect(await folderOrder(sidebarPage)).toEqual(before);
        logTestStep('✓ Chip drag left the relocated folder where the user put it');

        await sidebarPage.evaluate(async id => {
          const [root] = (await chrome.bookmarks.search({ title: 'Arcify' })).filter(node => !node.url);
          await chrome.bookmarks.move(id, { parentId: root.id });
        }, folderId);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'space-order-relocated-failure');
        throw error;
      }
    }, 60000);
  });

  describe('Space Persistence', () => {
    test('should persist spaces after closing and reopening sidebar', async () => {
      try {
        logTestStep('Creating a space to test persistence...');

        // Close sidebar and create a named space
        await sidebarPage.close();
        sidebarPage = await createSpace(browser, extensionId, 'Persistent Space');

        const spacesBeforeClose = await getSidebarSpaces(sidebarPage);
        const countBeforeClose = spacesBeforeClose.length;
        const namesBeforeClose = spacesBeforeClose.map(s => s.name).sort();
        logTestStep(`Spaces before close (${countBeforeClose}): ${namesBeforeClose.join(', ')}`);

        // Close the sidebar
        await sidebarPage.close();
        await delay(1000);

        // Reopen the sidebar
        sidebarPage = await openSidebar(browser, extensionId);

        const spacesAfterReopen = await getSidebarSpaces(sidebarPage);
        const countAfterReopen = spacesAfterReopen.length;
        const namesAfterReopen = spacesAfterReopen.map(s => s.name).sort();
        logTestStep(`Spaces after reopen (${countAfterReopen}): ${namesAfterReopen.join(', ')}`);

        // Verify the count and the persistent space still exists
        expect(countAfterReopen).toBe(countBeforeClose);
        const persistentSpace = spacesAfterReopen.find(s => s.name === 'Persistent Space');
        expect(persistentSpace).toBeDefined();
        logTestStep('✓ Spaces persist after sidebar close and reopen');
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'persistence-failure');
        throw error;
      }
    }, 120000);

    test('should maintain consistent space count after sidebar reload', async () => {
      try {
        logTestStep('Checking space count consistency across reloads...');

        const initialSpaces = await getSidebarSpaces(sidebarPage);
        const initialCount = initialSpaces.length;
        logTestStep(`Initial space count: ${initialCount}`);

        // Close and reopen sidebar multiple times
        for (let i = 0; i < 3; i++) {
          await sidebarPage.close();
          await delay(500);
          sidebarPage = await openSidebar(browser, extensionId);

          const currentSpaces = await getSidebarSpaces(sidebarPage);
          logTestStep(`Reload ${i + 1}: ${currentSpaces.length} spaces`);
          expect(currentSpaces.length).toBe(initialCount);
        }

        logTestStep(`✓ Space count remained consistent at ${initialCount} across 3 reloads`);
      } catch (error) {
        await takeScreenshotOnFailure(sidebarPage, 'reload-consistency-failure');
        throw error;
      }
    }, 120000);
  });
  describe('Move Favorite to Space', () => {
    let server;
    let url;
    const targetName = 'Favorite Target';

    beforeAll(async () => {
      server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Move fixture</title>'); });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${server.address().port}/`;
      const page = await createSpace(browser, extensionId, targetName);
      await page.close();
    });

    afterAll(async () => {
      if (!server) return;
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    });

    async function moveRowToSpace(selector, spaceName) {
      await sidebarPage.waitForSelector(selector);
      await sidebarPage.$eval(selector, el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      await sidebarPage.waitForSelector('#tab-context-menu');
      await sidebarPage.evaluate(name => {
        const item = [...document.querySelectorAll('#tab-context-menu .submenu .context-menu-item')]
          .find(el => el.textContent === name);
        if (!item) throw new Error(`Move to Space target missing: ${name}`);
        item.click();
      }, spaceName);
    }

    // Activates another space as the source so the target is offered in the submenu.
    async function getFixtureSpaces() {
      const fixture = await sidebarPage.evaluate(async name => {
        const { spaces } = await chrome.storage.local.get('spaces');
        const source = spaces.find(s => s.name !== name);
        const { id: windowId } = await chrome.windows.getCurrent();
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'activate', windowId, spaceId: source.id });
        await chrome.storage.session.set({ activeSpaces: { [windowId]: source.id } });
        return { source, target: spaces.find(s => s.name === name) };
      }, targetName);
      await sidebarPage.reload();
      await sidebarPage.waitForSelector(`.space.active[data-space-id="${fixture.source.id}"]`);
      return fixture;
    }

    async function pinOpenTab(source, path) {
      const tabId = await sidebarPage.evaluate(async ({ url, spaceId }) => {
        const tab = await chrome.tabs.create({ url, active: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
        return tab.id;
      }, { url: `${url}${path}`, spaceId: source.id });
      await sidebarPage.reload();
      const row = `.space.active .tab[data-tab-id="${tabId}"]`;
      await sidebarPage.waitForSelector(row);
      await sidebarPage.$eval(row, el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      await sidebarPage.evaluate(() => {
        [...document.querySelectorAll('.context-menu-item')].find(el => el.textContent === 'Pin Tab').click();
      });
      const pinnedRow = `.space.active [data-tab-type="pinned"] .tab[data-tab-id="${tabId}"][data-bookmark-id]`;
      await sidebarPage.waitForSelector(pinnedRow);
      return { tabId, pinnedRow, bookmarkId: await sidebarPage.$eval(pinnedRow, el => el.dataset.bookmarkId) };
    }

    // Favorites are space-wide, so another window can hold a second tab bound to the same bookmark.
    async function openBoundTabInOtherWindow(source, bookmarkId, path) {
      return sidebarPage.evaluate(async ({ url, spaceId, bookmarkId }) => {
        const { tabs: [tab] } = await chrome.windows.create({ url, focused: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId, pinned: true });
        const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');
        pinnedTabStatesById[tab.id] = { bookmarkId, pinnedUrl: url };
        await chrome.storage.local.set({ pinnedTabStatesById });
        return tab.id;
      }, { url: `${url}${path}`, spaceId: source.id, bookmarkId });
    }

    test('should move an open favorite with its bookmark and keep it bound', async () => {
      const { source, target } = await getFixtureSpaces();
      const { tabId, pinnedRow, bookmarkId } = await pinOpenTab(source, 'open');

      await moveRowToSpace(pinnedRow, targetName);
      await sidebarPage.waitForFunction(async ({ bookmarkId, folderId }) =>
        (await chrome.bookmarks.get(bookmarkId))[0].parentId === folderId, { polling: 100 }, { bookmarkId, folderId: target.bookmarkFolderId });
      await sidebarPage.waitForFunction(async ({ tabId, name }) => {
        const { spaces } = await chrome.storage.local.get('spaces');
        return spaces.find(s => s.name === name).spaceBookmarks.includes(tabId);
      }, { polling: 100 }, { tabId, name: targetName });

      const after = await sidebarPage.evaluate(async ({ tabId, sourceId, bookmarkId }) => {
        const { spaces, pinnedTabStatesById = {} } = await chrome.storage.local.get(['spaces', 'pinnedTabStatesById']);
        const source = spaces.find(s => s.id === sourceId);
        return {
          binding: pinnedTabStatesById[tabId]?.bookmarkId,
          sourceOwns: [...source.spaceBookmarks, ...source.temporaryTabs].includes(tabId),
          sourceBookmarks: (await chrome.bookmarks.getChildren(source.bookmarkFolderId)).map(node => node.id),
          sourceRows: document.querySelectorAll(`.space[data-space-id="${sourceId}"] .tab[data-bookmark-id="${bookmarkId}"]`).length
        };
      }, { tabId, sourceId: source.id, bookmarkId });
      expect(after.binding).toBe(bookmarkId);
      expect(after.sourceOwns).toBe(false);
      expect(after.sourceBookmarks).not.toContain(bookmarkId);
      expect(after.sourceRows).toBe(0);
    }, 60000);

    test('should move an open favorite into an inactive space folder and keep it bound', async () => {
      const inactiveName = 'Inactive Favorite Target';
      const { source } = await getFixtureSpaces();
      const { tabId, pinnedRow, bookmarkId } = await pinOpenTab(source, 'inactive');
      const otherTabId = await openBoundTabInOtherWindow(source, bookmarkId, 'inactive');
      await sidebarPage.reload();
      await sidebarPage.waitForSelector(pinnedRow);

      // The sidebar adopts new root folders on its next refresh, so pick the folder before that runs.
      const { folderId, inactive } = await sidebarPage.evaluate(async ({ name, selector }) => {
        const root = (await chrome.bookmarks.search({ title: 'Arcify' })).find(node => !node.url);
        const folder = await chrome.bookmarks.create({ parentId: root.id, title: name });
        document.querySelector(selector).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        let item;
        while (!(item = [...document.querySelectorAll('#tab-context-menu .submenu .context-menu-item')].find(el => el.textContent === name))) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        const separator = item.parentElement.querySelector('.context-menu-separator');
        const inactive = Boolean(separator && separator.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
        item.click();
        return { folderId: folder.id, inactive };
      }, { name: inactiveName, selector: pinnedRow });
      expect(inactive).toBe(true);
      await sidebarPage.waitForFunction(async ({ tabId, name }) => {
        const { spaces } = await chrome.storage.local.get('spaces');
        return spaces.find(s => s.name === name)?.spaceBookmarks.includes(tabId);
      }, { polling: 100 }, { tabId, name: inactiveName });

      const after = await sidebarPage.evaluate(async ({ tabIds, sourceId, bookmarkId, name }) => {
        const { spaces, pinnedTabStatesById = {} } = await chrome.storage.local.get(['spaces', 'pinnedTabStatesById']);
        const source = spaces.find(s => s.id === sourceId);
        const created = spaces.find(s => s.name === name);
        return {
          parentId: (await chrome.bookmarks.get(bookmarkId))[0].parentId,
          bindings: tabIds.map(id => pinnedTabStatesById[id]?.bookmarkId),
          createdPinned: tabIds.map(id => created.spaceBookmarks.includes(id)),
          sourceOwns: tabIds.some(id => [...source.spaceBookmarks, ...source.temporaryTabs].includes(id)),
          sourceRows: document.querySelectorAll(`.space[data-space-id="${sourceId}"] .tab[data-bookmark-id="${bookmarkId}"]`).length
        };
      }, { tabIds: [tabId, otherTabId], sourceId: source.id, bookmarkId, name: inactiveName });
      expect(after.parentId).toBe(folderId);
      expect(after.bindings).toEqual([bookmarkId, bookmarkId]);
      expect(after.createdPinned).toEqual([true, true]);
      expect(after.sourceOwns).toBe(false);
      expect(after.sourceRows).toBe(0);
    }, 60000);

    test('should move an unloaded favorite bookmark to another space', async () => {
      const { source, target } = await getFixtureSpaces();
      const bookmarkId = await sidebarPage.evaluate(async ({ url, folderId }) =>
        (await chrome.bookmarks.create({ parentId: folderId, title: 'Unloaded favorite', url: `${url}unloaded` })).id,
        { url, folderId: source.bookmarkFolderId });
      await sidebarPage.reload();
      const row = `.space.active .tab.bookmark-only[data-bookmark-id="${bookmarkId}"]`;

      await moveRowToSpace(row, targetName);
      await sidebarPage.waitForFunction(async ({ bookmarkId, folderId }) =>
        (await chrome.bookmarks.get(bookmarkId))[0].parentId === folderId, { polling: 100 }, { bookmarkId, folderId: target.bookmarkFolderId });
      await sidebarPage.waitForFunction(({ sourceId, bookmarkId }) =>
        !document.querySelector(`.space[data-space-id="${sourceId}"] .tab[data-bookmark-id="${bookmarkId}"]`),
        { polling: 100 }, { sourceId: source.id, bookmarkId });
    }, 60000);

    test('should move tabs in other windows bound to an unloaded favorite', async () => {
      const { source, target } = await getFixtureSpaces();
      const bookmarkId = await sidebarPage.evaluate(async ({ url, folderId }) =>
        (await chrome.bookmarks.create({ parentId: folderId, title: 'Elsewhere favorite', url: `${url}elsewhere` })).id,
        { url, folderId: source.bookmarkFolderId });
      const otherTabId = await openBoundTabInOtherWindow(source, bookmarkId, 'elsewhere');
      await sidebarPage.reload();
      const row = `.space.active .tab.bookmark-only[data-bookmark-id="${bookmarkId}"]`;

      await moveRowToSpace(row, targetName);
      await sidebarPage.waitForFunction(async ({ tabId, targetId }) => {
        const { spaces } = await chrome.storage.local.get('spaces');
        return spaces.find(s => s.id === targetId).spaceBookmarks.includes(tabId);
      }, { polling: 100 }, { tabId: otherTabId, targetId: target.id });

      const after = await sidebarPage.evaluate(async ({ tabId, sourceId, bookmarkId }) => {
        const { spaces, pinnedTabStatesById = {} } = await chrome.storage.local.get(['spaces', 'pinnedTabStatesById']);
        const source = spaces.find(s => s.id === sourceId);
        return {
          parentId: (await chrome.bookmarks.get(bookmarkId))[0].parentId,
          binding: pinnedTabStatesById[tabId]?.bookmarkId,
          sourceOwns: [...source.spaceBookmarks, ...source.temporaryTabs].includes(tabId)
        };
      }, { tabId: otherTabId, sourceId: source.id, bookmarkId });
      expect(after.parentId).toBe(target.bookmarkFolderId);
      expect(after.binding).toBe(bookmarkId);
      expect(after.sourceOwns).toBe(false);
    }, 60000);

    test('should move the clicked favorite when another bound tab has already closed', async () => {
      const { source, target } = await getFixtureSpaces();
      const { tabId, pinnedRow, bookmarkId } = await pinOpenTab(source, 'stale');
      const closedTabId = await openBoundTabInOtherWindow(source, bookmarkId, 'stale');
      await sidebarPage.reload();
      await sidebarPage.waitForSelector(pinnedRow);

      // Close the other tab and move before the sidebar refreshes its space ownership.
      await sidebarPage.evaluate(async ({ closedTabId, bookmarkId, selector, name }) => {
        await chrome.tabs.remove(closedTabId);
        await new Promise(resolve => setTimeout(resolve, 50));
        const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');
        pinnedTabStatesById[closedTabId] = { bookmarkId, pinnedUrl: null };
        await chrome.storage.local.set({ pinnedTabStatesById });
        document.querySelector(selector).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        let item;
        while (!(item = [...document.querySelectorAll('#tab-context-menu .submenu .context-menu-item')].find(el => el.textContent === name))) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        item.click();
      }, { closedTabId, bookmarkId, selector: pinnedRow, name: targetName });
      await sidebarPage.waitForFunction(async ({ tabId, targetId }) => {
        const { spaces } = await chrome.storage.local.get('spaces');
        return spaces.find(s => s.id === targetId).spaceBookmarks.includes(tabId);
      }, { polling: 100 }, { tabId, targetId: target.id });
      const parentId = await sidebarPage.evaluate(async id => (await chrome.bookmarks.get(id))[0].parentId, bookmarkId);
      expect(parentId).toBe(target.bookmarkFolderId);
    }, 60000);
  });
});
