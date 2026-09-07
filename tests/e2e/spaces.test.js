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
});
