/**
 * E2E Tests for Options / Settings Page
 * Tests settings load, toggle behavior, auto-archive controls, advanced options,
 * color customization, persistence, and default space dropdown.
 */
import {
  launchBrowserWithExtension,
  openOptionsPage,
} from './helpers/extension-helper.js';
import {
  delay,
  takeScreenshotOnFailure,
  logTestStep,
} from './helpers/test-utils.js';

describe('Options Page', () => {
  let browser;
  let extensionId;
  let optionsPage;

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
    logTestStep('Opening options page...');
    optionsPage = await openOptionsPage(browser, extensionId);
    // Allow options.js DOMContentLoaded + restoreOptions to finish
    await delay(1500);
  });

  afterEach(async () => {
    if (optionsPage) {
      try { await optionsPage.close(); } catch (e) { /* already closed */ }
    }
    // Clean up extra tabs/pages to prevent slowdown
    try {
      const pages = await browser.pages();
      for (let i = pages.length - 1; i >= 1; i--) {
        try { await pages[i].close(); } catch (e) { /* already closed */ }
      }
    } catch (e) { /* browser closing */ }
  });

  // ---------------------------------------------------------------------------
  // 1. Options Page Load
  // ---------------------------------------------------------------------------
  describe('Options Page Load', () => {
    test('should load the options page successfully', async () => {
      try {
        logTestStep('Verifying options page loaded...');

        const title = await optionsPage.title();
        expect(title).toContain('Settings');

        const heading = await optionsPage.evaluate(() => {
          const h1 = document.querySelector('.options-title');
          return h1 ? h1.textContent.trim() : null;
        });
        expect(heading).toBe('Arcify Settings');

        logTestStep('Options page loaded successfully');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'options-load-failure');
        throw error;
      }
    });

    test('should have all settings elements present', async () => {
      try {
        logTestStep('Checking all settings elements...');

        const elements = await optionsPage.evaluate(() => {
          return {
            defaultSpaceName: !!document.getElementById('defaultSpaceName'),
            autoArchiveEnabled: !!document.getElementById('autoArchiveEnabled'),
            autoArchiveIdleMinutes: !!document.getElementById('autoArchiveIdleMinutes'),
            autoArchiveIdleMinutesContainer: !!document.getElementById('autoArchiveIdleMinutesContainer'),
            invertTabOrder: !!document.getElementById('invertTabOrder'),
            showAllOpenTabsInCollapsedFolders: !!document.getElementById('showAllOpenTabsInCollapsedFolders'),
            advancedOptionsToggle: !!document.getElementById('advancedOptionsToggle'),
            advancedOptionsContent: !!document.getElementById('advancedOptionsContent'),
            saveToast: !!document.getElementById('saveToast'),
            colorGrey: !!document.getElementById('colorGrey'),
            colorBlue: !!document.getElementById('colorBlue'),
            colorRed: !!document.getElementById('colorRed'),
            colorYellow: !!document.getElementById('colorYellow'),
            colorGreen: !!document.getElementById('colorGreen'),
            colorPink: !!document.getElementById('colorPink'),
            colorPurple: !!document.getElementById('colorPurple'),
            colorCyan: !!document.getElementById('colorCyan'),
          };
        });

        expect(elements.defaultSpaceName).toBe(true);
        expect(elements.autoArchiveEnabled).toBe(true);
        expect(elements.autoArchiveIdleMinutes).toBe(true);
        expect(elements.autoArchiveIdleMinutesContainer).toBe(true);
        expect(elements.invertTabOrder).toBe(true);
        expect(elements.showAllOpenTabsInCollapsedFolders).toBe(true);
        expect(elements.advancedOptionsToggle).toBe(true);
        expect(elements.advancedOptionsContent).toBe(true);
        expect(elements.saveToast).toBe(true);
        expect(elements.colorGrey).toBe(true);
        expect(elements.colorBlue).toBe(true);
        expect(elements.colorRed).toBe(true);
        expect(elements.colorYellow).toBe(true);
        expect(elements.colorGreen).toBe(true);
        expect(elements.colorPink).toBe(true);
        expect(elements.colorPurple).toBe(true);
        expect(elements.colorCyan).toBe(true);

        logTestStep('All settings elements present');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'options-elements-failure');
        throw error;
      }
    });

    test('should load correct default values', async () => {
      try {
        logTestStep('Checking default setting values...');

        const defaults = await optionsPage.evaluate(() => {
          return {
            autoArchiveEnabled: document.getElementById('autoArchiveEnabled')?.checked,
            invertTabOrder: document.getElementById('invertTabOrder')?.checked,
            showAllOpenTabsInCollapsedFolders: document.getElementById('showAllOpenTabsInCollapsedFolders')?.checked,
            debugLoggingEnabled: document.getElementById('debugLoggingEnabled')?.checked,
          };
        });

        // defaults: autoArchiveEnabled=false, invertTabOrder=true,
        // showAllOpenTabsInCollapsedFolders=false, debugLoggingEnabled=false
        expect(defaults.autoArchiveEnabled).toBe(false);
        expect(defaults.invertTabOrder).toBe(true);
        expect(defaults.showAllOpenTabsInCollapsedFolders).toBe(false);
        expect(defaults.debugLoggingEnabled).toBe(false);

        logTestStep('Default values loaded correctly');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'options-defaults-failure');
        throw error;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Checkbox Settings
  // ---------------------------------------------------------------------------
  describe('Checkbox Settings', () => {
    test('should toggle autoArchiveEnabled checkbox', async () => {
      try {
        logTestStep('Toggling autoArchiveEnabled...');

        const initialState = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveEnabled').checked;
        });

        // iOS-style toggles have hidden inputs; use evaluate to click
        await optionsPage.evaluate(() => document.getElementById('autoArchiveEnabled').click());
        await delay(800);

        const newState = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveEnabled').checked;
        });

        expect(newState).toBe(!initialState);
        logTestStep(`autoArchiveEnabled toggled from ${initialState} to ${newState}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'toggle-autoarchive-failure');
        throw error;
      }
    });

    test('should toggle invertTabOrder checkbox', async () => {
      try {
        logTestStep('Toggling invertTabOrder...');

        const initialState = await optionsPage.evaluate(() => {
          return document.getElementById('invertTabOrder').checked;
        });

        await optionsPage.evaluate(() => document.getElementById('invertTabOrder').click());
        await delay(800);

        const newState = await optionsPage.evaluate(() => {
          return document.getElementById('invertTabOrder').checked;
        });

        expect(newState).toBe(!initialState);
        logTestStep(`invertTabOrder toggled from ${initialState} to ${newState}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'toggle-inverttaborder-failure');
        throw error;
      }
    });

    test('should toggle showAllOpenTabsInCollapsedFolders checkbox', async () => {
      try {
        logTestStep('Toggling showAllOpenTabsInCollapsedFolders...');

        const initialState = await optionsPage.evaluate(() => {
          return document.getElementById('showAllOpenTabsInCollapsedFolders').checked;
        });

        await optionsPage.evaluate(() => document.getElementById('showAllOpenTabsInCollapsedFolders').click());
        await delay(800);

        const newState = await optionsPage.evaluate(() => {
          return document.getElementById('showAllOpenTabsInCollapsedFolders').checked;
        });

        expect(newState).toBe(!initialState);
        logTestStep(`showAllOpenTabsInCollapsedFolders toggled from ${initialState} to ${newState}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'toggle-collapsedfolders-failure');
        throw error;
      }
    });

    test('should toggle debugLoggingEnabled checkbox', async () => {
      try {
        logTestStep('Toggling debugLoggingEnabled...');

        const initialState = await optionsPage.evaluate(() => {
          return document.getElementById('debugLoggingEnabled').checked;
        });

        // debugLoggingEnabled is inside advanced options; expand first
        await optionsPage.click('#advancedOptionsToggle');
        await delay(500);

        await optionsPage.evaluate(() => document.getElementById('debugLoggingEnabled').click());
        await delay(800);

        const newState = await optionsPage.evaluate(() => {
          return document.getElementById('debugLoggingEnabled').checked;
        });

        expect(newState).toBe(!initialState);
        logTestStep(`debugLoggingEnabled toggled from ${initialState} to ${newState}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'toggle-debuglogging-failure');
        throw error;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Auto-Archive Settings
  // ---------------------------------------------------------------------------
  describe('Auto-Archive Settings', () => {
    test('should hide idle minutes input when auto-archive is disabled', async () => {
      try {
        logTestStep('Checking idle minutes visibility when disabled...');

        // Ensure auto-archive is disabled
        const isChecked = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveEnabled').checked;
        });
        if (isChecked) {
          await optionsPage.evaluate(() => document.getElementById('autoArchiveEnabled').click());
          await delay(800);
        }

        const containerDisplay = await optionsPage.evaluate(() => {
          const container = document.getElementById('autoArchiveIdleMinutesContainer');
          return container ? window.getComputedStyle(container).display : null;
        });

        expect(containerDisplay).toBe('none');
        logTestStep('Idle minutes container is hidden when auto-archive disabled');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'autoarchive-hidden-failure');
        throw error;
      }
    });

    test('should show idle minutes input when auto-archive is enabled', async () => {
      try {
        logTestStep('Checking idle minutes visibility when enabled...');

        // Ensure auto-archive is enabled
        const isChecked = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveEnabled').checked;
        });
        if (!isChecked) {
          await optionsPage.evaluate(() => document.getElementById('autoArchiveEnabled').click());
          await delay(800);
        }

        const containerDisplay = await optionsPage.evaluate(() => {
          const container = document.getElementById('autoArchiveIdleMinutesContainer');
          return container ? window.getComputedStyle(container).display : null;
        });

        expect(containerDisplay).not.toBe('none');

        const inputDisabled = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveIdleMinutes').disabled;
        });
        expect(inputDisabled).toBe(false);

        logTestStep('Idle minutes container is visible and input is enabled');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'autoarchive-shown-failure');
        throw error;
      }
    });

    test('should change auto-archive idle minutes value', async () => {
      try {
        logTestStep('Changing idle minutes value...');

        // Enable auto-archive first
        const isChecked = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveEnabled').checked;
        });
        if (!isChecked) {
          await optionsPage.evaluate(() => document.getElementById('autoArchiveEnabled').click());
          await delay(800);
        }

        // Clear and type a new value
        await optionsPage.evaluate(() => {
          const input = document.getElementById('autoArchiveIdleMinutes');
          input.value = '';
        });
        await optionsPage.type('#autoArchiveIdleMinutes', '120');
        await delay(800);

        const newValue = await optionsPage.evaluate(() => {
          return document.getElementById('autoArchiveIdleMinutes').value;
        });

        expect(newValue).toBe('120');
        logTestStep('Idle minutes value changed to 120');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'autoarchive-minutes-failure');
        throw error;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Advanced Options
  // ---------------------------------------------------------------------------
  describe('Advanced Options', () => {
    test('should have advanced options section initially hidden', async () => {
      try {
        logTestStep('Checking advanced options initial state...');

        const contentDisplay = await optionsPage.evaluate(() => {
          const content = document.getElementById('advancedOptionsContent');
          return content ? content.style.display : null;
        });

        expect(contentDisplay).toBe('none');
        logTestStep('Advanced options content is initially hidden');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'advanced-initial-failure');
        throw error;
      }
    });

    test('should show advanced options content when toggle is clicked', async () => {
      try {
        logTestStep('Clicking advanced options toggle to expand...');

        await optionsPage.click('#advancedOptionsToggle');
        await delay(500);

        const contentDisplay = await optionsPage.evaluate(() => {
          const content = document.getElementById('advancedOptionsContent');
          return content ? content.style.display : null;
        });

        expect(contentDisplay).toBe('block');

        const toggleExpanded = await optionsPage.evaluate(() => {
          const toggle = document.getElementById('advancedOptionsToggle');
          return toggle ? toggle.classList.contains('expanded') : false;
        });
        expect(toggleExpanded).toBe(true);

        logTestStep('Advanced options content is now visible');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'advanced-expand-failure');
        throw error;
      }
    });

    test('should hide advanced options content when toggle is clicked again', async () => {
      try {
        logTestStep('Toggling advanced options open then closed...');

        // First click to open
        await optionsPage.click('#advancedOptionsToggle');
        await delay(500);

        // Second click to close
        await optionsPage.click('#advancedOptionsToggle');
        await delay(500);

        const contentDisplay = await optionsPage.evaluate(() => {
          const content = document.getElementById('advancedOptionsContent');
          return content ? content.style.display : null;
        });

        expect(contentDisplay).toBe('none');

        const toggleExpanded = await optionsPage.evaluate(() => {
          const toggle = document.getElementById('advancedOptionsToggle');
          return toggle ? toggle.classList.contains('expanded') : false;
        });
        expect(toggleExpanded).toBe(false);

        logTestStep('Advanced options content hidden after second toggle');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'advanced-collapse-failure');
        throw error;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Color Customization
  // ---------------------------------------------------------------------------
  describe('Color Customization', () => {
    const colorNames = ['Grey', 'Blue', 'Red', 'Yellow', 'Green', 'Pink', 'Purple', 'Cyan'];

    test('should have all 8 color pickers present', async () => {
      try {
        logTestStep('Checking color picker elements...');

        const colorPickerInfo = await optionsPage.evaluate((names) => {
          return names.map(name => ({
            name,
            exists: !!document.getElementById(`color${name}`),
            type: document.getElementById(`color${name}`)?.type,
          }));
        }, colorNames);

        for (const picker of colorPickerInfo) {
          expect(picker.exists).toBe(true);
          expect(picker.type).toBe('color');
        }

        logTestStep(`All ${colorNames.length} color pickers present`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'color-pickers-presence-failure');
        throw error;
      }
    });

    test('should change a color picker value', async () => {
      try {
        logTestStep('Changing colorBlue picker value...');

        // Expand advanced options so color pickers are in view
        await optionsPage.click('#advancedOptionsToggle');
        await delay(500);

        const originalValue = await optionsPage.evaluate(() => {
          return document.getElementById('colorBlue').value;
        });

        const newColor = '#ff5500';
        await optionsPage.evaluate((color) => {
          const picker = document.getElementById('colorBlue');
          // Use native setter to properly update value
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          nativeInputValueSetter.call(picker, color);
          picker.dispatchEvent(new Event('input', { bubbles: true }));
        }, newColor);
        await delay(800);

        const updatedValue = await optionsPage.evaluate(() => {
          return document.getElementById('colorBlue').value;
        });

        expect(updatedValue).toBe(newColor);
        expect(updatedValue).not.toBe(originalValue);
        logTestStep(`Color changed from ${originalValue} to ${updatedValue}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'color-change-failure');
        throw error;
      }
    });

    test('should have reset buttons for each color', async () => {
      try {
        logTestStep('Checking color reset buttons...');

        const resetButtons = await optionsPage.evaluate(() => {
          const buttons = document.querySelectorAll('.color-reset-btn');
          return Array.from(buttons).map(btn => ({
            colorAttr: btn.dataset.color,
            text: btn.textContent.trim(),
          }));
        });

        const expectedColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
        expect(resetButtons.length).toBe(expectedColors.length);

        for (const color of expectedColors) {
          const btn = resetButtons.find(b => b.colorAttr === color);
          expect(btn).toBeDefined();
          expect(btn.text).toBe('Reset');
        }

        logTestStep(`All ${resetButtons.length} color reset buttons present`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'color-reset-buttons-failure');
        throw error;
      }
    });

    test('should restore default color when reset button is clicked', async () => {
      try {
        logTestStep('Testing color reset to default...');

        // Expand advanced options
        await optionsPage.click('#advancedOptionsToggle');
        await delay(500);

        const defaultBlue = '#8bb3f3';
        const customColor = '#123456';

        // Set a custom color first
        await optionsPage.evaluate((color) => {
          const picker = document.getElementById('colorBlue');
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          nativeInputValueSetter.call(picker, color);
          picker.dispatchEvent(new Event('input', { bubbles: true }));
        }, customColor);
        await delay(800);

        // Verify custom color is set
        const afterCustom = await optionsPage.evaluate(() => {
          return document.getElementById('colorBlue').value;
        });
        expect(afterCustom).toBe(customColor);

        // Click reset button for blue
        await optionsPage.evaluate(() => {
          const resetBtn = document.querySelector('.color-reset-btn[data-color="blue"]');
          if (resetBtn) resetBtn.click();
        });
        await delay(800);

        const afterReset = await optionsPage.evaluate(() => {
          return document.getElementById('colorBlue').value;
        });

        expect(afterReset).toBe(defaultBlue);
        logTestStep(`Color reset from ${customColor} back to default ${defaultBlue}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'color-reset-failure');
        throw error;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Settings Persistence
  // ---------------------------------------------------------------------------
  describe('Settings Persistence', () => {
    test('should retain changed setting after reopening options page', async () => {
      try {
        logTestStep('Testing settings persistence across page reopen...');

        // Read the current state of invertTabOrder
        const initialState = await optionsPage.evaluate(() => {
          return document.getElementById('invertTabOrder').checked;
        });

        // Toggle it
        await optionsPage.evaluate(() => document.getElementById('invertTabOrder').click());
        await delay(1000);

        const toggledState = await optionsPage.evaluate(() => {
          return document.getElementById('invertTabOrder').checked;
        });
        expect(toggledState).toBe(!initialState);

        // Close and reopen options page
        await optionsPage.close();
        optionsPage = await openOptionsPage(browser, extensionId);
        await delay(1500);

        const persistedState = await optionsPage.evaluate(() => {
          return document.getElementById('invertTabOrder').checked;
        });

        expect(persistedState).toBe(toggledState);
        logTestStep(`Setting persisted: invertTabOrder = ${persistedState}`);

        // Reset to original state to avoid test pollution
        if (persistedState !== initialState) {
          await optionsPage.evaluate(() => document.getElementById('invertTabOrder').click());
          await delay(1000);
        }
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'persistence-failure');
        throw error;
      }
    });

    test('should show toast notification after saving', async () => {
      try {
        logTestStep('Checking toast notification on setting change...');

        // Toggle a checkbox to trigger save
        await optionsPage.evaluate(() => document.getElementById('autoArchiveEnabled').click());
        await delay(500);

        // Check for the toast with .show class
        const toastVisible = await optionsPage.evaluate(() => {
          const toast = document.getElementById('saveToast');
          return toast ? toast.classList.contains('show') : false;
        });

        expect(toastVisible).toBe(true);
        logTestStep('Toast notification appeared after save');

        // Wait for toast to disappear (2 seconds per the code)
        await delay(2500);

        const toastHidden = await optionsPage.evaluate(() => {
          const toast = document.getElementById('saveToast');
          return toast ? !toast.classList.contains('show') : true;
        });

        expect(toastHidden).toBe(true);
        logTestStep('Toast notification dismissed after timeout');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'toast-notification-failure');
        throw error;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Default Space Name
  // ---------------------------------------------------------------------------
  describe('Default Space Name', () => {
    test('should have default space name dropdown present', async () => {
      try {
        logTestStep('Checking default space name dropdown...');

        const dropdownInfo = await optionsPage.evaluate(() => {
          const select = document.getElementById('defaultSpaceName');
          if (!select) return null;
          return {
            tagName: select.tagName.toLowerCase(),
            id: select.id,
          };
        });

        expect(dropdownInfo).not.toBeNull();
        expect(dropdownInfo.tagName).toBe('select');
        expect(dropdownInfo.id).toBe('defaultSpaceName');

        logTestStep('Default space name dropdown is present');
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'default-space-dropdown-failure');
        throw error;
      }
    });

    test('should have at least one option (Home) in the dropdown', async () => {
      try {
        logTestStep('Checking dropdown options...');

        const optionInfo = await optionsPage.evaluate(() => {
          const select = document.getElementById('defaultSpaceName');
          if (!select) return { count: 0, values: [] };
          const options = Array.from(select.options);
          return {
            count: options.length,
            values: options.map(opt => opt.value),
            texts: options.map(opt => opt.textContent.trim()),
          };
        });

        expect(optionInfo.count).toBeGreaterThanOrEqual(1);

        // At minimum, Home should be available (either from storage or fallback)
        const hasHome = optionInfo.values.includes('Home') || optionInfo.texts.includes('Home');
        expect(hasHome).toBe(true);

        logTestStep(`Dropdown has ${optionInfo.count} option(s): ${optionInfo.texts.join(', ')}`);
      } catch (error) {
        await takeScreenshotOnFailure(optionsPage, 'default-space-options-failure');
        throw error;
      }
    });
  });
});
